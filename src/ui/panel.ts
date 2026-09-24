/**
 * Shadow-DOM panel view — tabbed (Boards | Sync | Settings).
 *
 * Built once and updated in place. The persistent header (board + collection +
 * live status) and the tab bar never scroll; each tab panel scrolls on its own.
 * Form inputs keep their values across renders so typing is never clobbered.
 * Nothing overlays the tab bar or tab body; the only overlay is the confirm
 * dialog, which is shown on demand for the unsaved-changes guard.
 */

import type { Collection, PublicSettings, Settings } from "../lib";
import type { BoardView, SyncStatus } from "../content/syncController";
import { clear, h } from "./dom";
import { PANEL_CSS } from "./styles";
import {
  buildSettingsPatch,
  headerStatus,
  headerStatusText,
  headerTone,
  shortSha,
  statusLabel,
  type SettingsFormValues,
} from "./format";
import { setupState } from "./setupState";
import { nextTabId, TAB_IDS, TAB_LABELS, type TabId } from "./tabs";
import {
  BADGE_MARGIN,
  DRAG_THRESHOLD,
  PANEL_GAP,
  PANEL_MARGIN,
  clampBadgePosition,
  defaultBadgePosition,
  isDragDistance,
  placePanel,
  type Point,
  type Size,
} from "./badgePosition";

export type { BoardView, SyncStatus };
export type { TabId };

export interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface PanelNotice {
  kind: "info" | "error";
  message: string;
}

export interface PanelState {
  configured: boolean;
  hasToken: boolean;
  expanded: boolean;
  activeTab: TabId;
  status: SyncStatus;
  dirty: boolean;
  board: BoardView | null;
  collections: Collection[];
  loadingCollections: boolean;
  expandedCollection: string | null;
  activeCollection: string | null;
  localElementCount: number | null;
  localImageCount: number | null;
  theme: "light" | "dark";
  notice: PanelNotice | null;
  testResult: string | null;
  confirm: ConfirmRequest | null;
  settings: PublicSettings | null;
  smartSync: boolean;
  smartSyncDelayMs: number;
  savingSettings: boolean;
  settingsError: string | null;
  writeStrategy: string | null;
  /** Badge top-left in viewport px; `null` = default bottom-right. */
  badgePosition: Point | null;
}

export interface PanelActions {
  onToggleExpanded(expanded: boolean): void;
  onSelectTab(tab: TabId): void;
  onSave(): void;
  onReloadFromRemote(): void;
  onSelectBoard(board: BoardView): void;
  onExpandCollection(slug: string | null): void;
  onCreateCollection(name: string): void;
  onRefreshCollections(): void;
  onNewBoard(collectionSlug: string, name: string): void;
  onKeepLocal(): void;
  onKeepRemote(): void;
  onSaveSettings(patch: Partial<Settings>): void;
  onOpenTokenSettings(): void;
  onTestConnection(): void;
  onToggleSmartSync(enabled: boolean): void;
  onSetSmartSyncDelay(ms: number): void;
  onBadgeMove(position: Point): void;
  onResetBadge(): void;
  onConfirm(): void;
  onCancelConfirm(): void;
  onDismissNotice(): void;
}

export interface Panel {
  render(state: PanelState): void;
}

/** Fixed panel height; must match `--ex-panel-height` in styles.ts. */
const PANEL_DEFAULT_HEIGHT = 560;

interface PrimaryControl {
  button: HTMLButtonElement;
  update(opts: {
    label: string;
    loadingLabel: string;
    disabled: boolean;
    loading: boolean;
    error: string | null;
  }): void;
  error: HTMLElement;
}

function toneClass(base: string, tone: string): string {
  return `${base} tone-${tone}`;
}

export function createPanel(root: ShadowRoot, actions: PanelActions): Panel {
  root.append(h("style", { text: PANEL_CSS }));

  const wrap = h("div", { class: "ex-root" });

  /* Launcher ------------------------------------------------------------- */
  const launcherDot = h("span", { class: "ex-dot", attrs: { "aria-hidden": "true" } });
  const launcher = h(
    "button",
    {
      class: "ex-launcher",
      attrs: { type: "button" },
    },
    launcherDot,
    h("span", { class: "ex-launcher-text", text: "Sync" }),
  );

  /* Persistent header ---------------------------------------------------- */
  const headerBoard = h("div", { class: "ex-header-board" });
  const headerSub = h("div", { class: "ex-header-sub" });
  const headerDot = h("span", { class: "ex-dot" });
  const statusBadgeText = h("span", { text: "Synced" });
  const statusBadge = h("span", { class: "ex-status-badge" }, headerDot, statusBadgeText);
  const closeBtn = h("button", {
    class: "ex-close",
    attrs: { type: "button", "aria-label": "Close panel" },
    on: { click: () => actions.onToggleExpanded(false) },
  }, "\u00d7");
  // Packaged logo (no remote URL). An extension asset loaded by the content
  // script must be web-accessible; the manifest lists `icons/*.png`.
  const logo = h("img", {
    class: "ex-logo",
    attrs: { alt: "", "aria-hidden": "true", draggable: "false" },
  });
  try {
    logo.src = chrome.runtime.getURL("icons/icon-48.png");
  } catch {
    // Not an extension context (e.g. a unit test): leave the source unset.
  }
  const header = h(
    "header",
    { class: "ex-header" },
    logo,
    h("div", { class: "ex-header-text" }, headerBoard, headerSub),
    statusBadge,
    closeBtn,
  );

  /* Notice --------------------------------------------------------------- */
  const noticeText = h("span", { class: "ex-notice-text" });
  const notice = h(
    "div",
    { class: "ex-notice", hidden: true },
    noticeText,
    h("button", {
      class: "ex-link",
      attrs: { type: "button", "aria-label": "Dismiss notice" },
      on: { click: () => actions.onDismissNotice() },
    }, "Dismiss"),
  );

  /* Tabs ----------------------------------------------------------------- */
  const tabButtons = new Map<TabId, HTMLButtonElement>();
  const tabPanels = new Map<TabId, HTMLElement>();

  function onTabKey(event: KeyboardEvent, id: TabId): void {
    let target: TabId | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = nextTabId(id, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = nextTabId(id, -1);
    else if (event.key === "Home") target = TAB_IDS[0] ?? id;
    else if (event.key === "End") target = TAB_IDS[TAB_IDS.length - 1] ?? id;
    if (!target) return;
    event.preventDefault();
    actions.onSelectTab(target);
    tabButtons.get(target)?.focus();
  }

  const tablist = h("div", {
    class: "ex-tabs",
    attrs: { role: "tablist", "aria-label": "Excalidraw Sync sections" },
  });

  // The Settings tab carries a "needs setup" dot when configuration is missing.
  const settingsTabDot = h("span", {
    class: "ex-tab-dot",
    hidden: true,
    attrs: { "aria-hidden": "true" },
  });

  for (const id of TAB_IDS) {
    const button = h(
      "button",
      {
        class: "ex-tab",
        id: `ex-tab-${id}`,
        role: "tab",
        attrs: { type: "button", "aria-controls": `ex-panel-${id}` },
        on: {
          click: () => actions.onSelectTab(id),
          keydown: (event) => onTabKey(event as KeyboardEvent, id),
        },
      },
      h("span", { class: "ex-tab-label", text: TAB_LABELS[id] }),
      id === "settings" ? settingsTabDot : null,
    );
    tabButtons.set(id, button);
    tablist.append(button);
  }

  function createPrimary(label: string, onClick: () => void, id?: string): PrimaryControl {
    const labelEl = h("span", { class: "ex-btn-label", text: label });
    const spinner = h("span", { class: "ex-spinner", attrs: { "aria-hidden": "true" } });
    const button = h(
      "button",
      {
        class: "ex-primary block",
        attrs: { type: "button" },
        ...(id ? { id } : {}),
        on: { click: onClick },
      },
      spinner,
      labelEl,
    );
    const error = h("div", { class: "ex-action-error", hidden: true, attrs: { role: "alert" } });
    return {
      button,
      error,
      update(opts): void {
        button.disabled = opts.disabled || opts.loading;
        button.classList.toggle("ex-loading", opts.loading);
        button.setAttribute("aria-busy", String(opts.loading));
        labelEl.textContent = opts.loading ? opts.loadingLabel : opts.label;
        error.hidden = !opts.error;
        error.textContent = opts.error ?? "";
      },
    };
  }

  /** A labelled form field; associates its label with the control. */
  let fieldSeq = 0;
  function field(label: string, control: HTMLElement): HTMLElement {
    if (!control.id) control.id = `ex-field-${++fieldSeq}`;
    return h("div", { class: "ex-field" }, h("label", { text: label, for: control.id }), control);
  }

  /* Boards tab ----------------------------------------------------------- */
  const savePrimary = createPrimary("Save", () => actions.onSave(), "ex-boards-save");
  const boardMeta = h("div", { class: "ex-meta" });
  const reloadBtn = h("button", {
    class: "ex-btn block",
    attrs: { type: "button" },
    on: { click: () => actions.onReloadFromRemote() },
  }, "Reload from GitHub");

  // A conflict is actionable from the Boards tab too, not only on Sync, so the
  // header's "Conflict" badge never leaves the user without an action.
  const boardsConflict = h(
    "div",
    { class: "ex-conflict", hidden: true, attrs: { role: "alert" } },
    h("strong", { text: "Remote changed since your last sync." }),
    h(
      "div",
      { class: "ex-btn-row wrap" },
      h("button", {
        class: "ex-primary",
        attrs: { type: "button" },
        on: { click: () => actions.onKeepLocal() },
      }, "Keep local"),
      h("button", {
        class: "ex-btn",
        attrs: { type: "button" },
        on: { click: () => actions.onKeepRemote() },
      }, "Keep remote"),
    ),
  );

  // One collection selector drives both the board list below and the target of
  // the New board form, so the form is self-explanatory.
  const boardCollectionSelect = h("select", {
    attrs: { "aria-label": "Collection" },
    on: { change: () => actions.onExpandCollection(boardCollectionSelect.value) },
  });
  const newBoardName = h("input", {
    class: "ex-input",
    type: "text",
    placeholder: "New board name",
    attrs: { "aria-label": "New board name" },
  });
  const newBoardBtn = h("button", {
    class: "ex-btn",
    attrs: { type: "button" },
    on: {
      click: () => {
        const name = newBoardName.value.trim();
        const slug = boardCollectionSelect.value;
        if (name && slug) actions.onNewBoard(slug, name);
      },
    },
  }, "Create");

  const collectionsList = h("div", { class: "ex-list" });
  const refreshBtn = h("button", {
    class: "ex-btn",
    attrs: { type: "button" },
    on: { click: () => actions.onRefreshCollections() },
  }, "Refresh");
  const newCollectionName = h("input", {
    class: "ex-input",
    type: "text",
    placeholder: "New collection name",
    attrs: { "aria-label": "New collection name" },
  });
  const newCollectionBtn = h("button", {
    class: "ex-btn",
    attrs: { type: "button" },
    on: {
      click: () => {
        const name = newCollectionName.value.trim();
        if (name) {
          actions.onCreateCollection(name);
          newCollectionName.value = "";
        }
      },
    },
  }, "Create");

  const boardsPanel = h(
    "section",
    { class: "ex-tabpanel", id: "ex-panel-boards", role: "tabpanel", attrs: { "aria-labelledby": "ex-tab-boards" } },
    // The current-board card groups the primary Save with the secondary Reload.
    h(
      "div",
      { class: "ex-card ex-board-card" },
      boardMeta,
      savePrimary.button,
      savePrimary.error,
      h("div", { class: "ex-row" }, reloadBtn),
    ),
    boardsConflict,
    h("div", { class: "ex-divider" }),
    h(
      "div",
      { class: "ex-section-head" },
      h("h3", { class: "ex-section-title", text: "Boards" }),
      refreshBtn,
    ),
    field("Collection", boardCollectionSelect),
    collectionsList,
    h("div", { class: "ex-divider" }),
    h("h3", { class: "ex-section-title", text: "New board" }),
    h("div", { class: "ex-row" }, h("div", { class: "ex-grow" }, newBoardName), newBoardBtn),
    h("div", { class: "ex-divider" }),
    h("h3", { class: "ex-section-title", text: "New collection" }),
    h("div", { class: "ex-row" }, h("div", { class: "ex-grow" }, newCollectionName), newCollectionBtn),
  );

  /* Sync tab ------------------------------------------------------------- */
  const syncPrimary = createPrimary("Sync now", () => actions.onSave(), "ex-sync-now");
  const statusLine = h("div", { class: "ex-card", attrs: { "aria-live": "polite" } });
  const smartSyncToggle = h("input", {
    type: "checkbox",
    attrs: { "aria-label": "Smart sync" },
    on: { change: () => actions.onToggleSmartSync(smartSyncToggle.checked) },
  });
  const smartSyncDelay = h("input", {
    class: "ex-input",
    type: "number",
    attrs: { min: "0", step: "250", "aria-label": "Smart sync delay (ms)" },
    on: { change: () => actions.onSetSmartSyncDelay(Number(smartSyncDelay.value) || 0) },
  });

  const conflictBanner = h(
    "div",
    { class: "ex-conflict", hidden: true },
    h("strong", { text: "Remote changed since your last sync." }),
    h(
      "div",
      { class: "ex-btn-row wrap" },
      h("button", {
        class: "ex-primary",
        attrs: { type: "button" },
        on: { click: () => actions.onKeepLocal() },
      }, "Keep local"),
      h("button", {
        class: "ex-btn",
        attrs: { type: "button" },
        on: { click: () => actions.onKeepRemote() },
      }, "Keep remote"),
    ),
  );

  const syncPanel = h(
    "section",
    { class: "ex-tabpanel", id: "ex-panel-sync", role: "tabpanel", attrs: { "aria-labelledby": "ex-tab-sync" } },
    syncPrimary.button,
    syncPrimary.error,
    statusLine,
    conflictBanner,
    h("div", { class: "ex-divider" }),
    h("h3", { class: "ex-section-title", text: "Smart sync" }),
    h("label", { class: "ex-check" }, smartSyncToggle, h("span", { text: "Auto-save after edits" })),
    field("Debounce delay (ms)", smartSyncDelay),
  );

  /* Settings tab --------------------------------------------------------- */
  const settingsPrimary = createPrimary(
    "Save settings",
    () => actions.onSaveSettings(buildSettingsPatch(readSettingsForm())),
    "ex-settings-save",
  );

  // "Needs setup" banner: lists exactly which of token / owner / repo is missing.
  const setupMissing = h("span");
  const setupBanner = h(
    "div",
    { class: "ex-setup-banner", hidden: true },
    h("strong", { text: "Finish setup" }),
    h("div", { class: "ex-setup-missing" }, setupMissing),
  );

  // The PAT is never handled here: only whether one exists, plus help and a link
  // to the extension options page (not in the page realm).
  const tokenState = h("span", { class: "ex-muted" });
  const tokenHelp = h(
    "div",
    { class: "ex-hint", id: "ex-token-help", hidden: true },
    h(
      "ol",
      null,
      h("li", null, "Create a fine-grained personal access token: GitHub → Settings → Developer settings → Personal access tokens → ", h("strong", { text: "Fine-grained tokens" }), "."),
      h("li", null, "Repository access: ", h("strong", { text: "Only select repositories" }), " → choose this one repository."),
      h("li", null, "Permissions: ", h("strong", { text: "Contents → Read and write" }), "."),
      h("li", null, "Set an ", h("strong", { text: "expiration" }), " date."),
    ),
    h("p", { class: "ex-muted", text: "The token is stored only by the extension and is never sent to the Excalidraw page." }),
  );
  let tokenHelpOpen = false;
  const tokenHelpBtn = h("button", {
    class: "ex-link",
    attrs: { type: "button", "aria-expanded": "false", "aria-controls": "ex-token-help" },
    on: {
      click: () => {
        tokenHelpOpen = !tokenHelpOpen;
        tokenHelp.hidden = !tokenHelpOpen;
        tokenHelpBtn.setAttribute("aria-expanded", String(tokenHelpOpen));
      },
    },
  }, "How do I create a token?");
  const openTokenBtn = h("button", {
    class: "ex-btn",
    attrs: { type: "button" },
    on: { click: () => actions.onOpenTokenSettings() },
  }, "Open token settings");

  const ownerInput = h("input", { class: "ex-input", type: "text", attrs: { "aria-label": "Repository owner" } });
  const repoInput = h("input", { class: "ex-input", type: "text", attrs: { "aria-label": "Repository name" } });
  const branchInput = h("input", { class: "ex-input", type: "text", attrs: { "aria-label": "Branch" } });
  const rootInput = h("input", { class: "ex-input", type: "text", attrs: { "aria-label": "Root path" } });
  const templateInput = h("textarea", {
    class: "ex-input",
    attrs: { rows: "2", "aria-label": "Commit message template" },
  });
  const authorNameInput = h("input", { class: "ex-input", type: "text", attrs: { "aria-label": "Commit author name" } });
  const authorEmailInput = h("input", { class: "ex-input", type: "text", attrs: { "aria-label": "Commit author email" } });
  const settingsSmartSync = h("input", {
    type: "checkbox",
    attrs: { "aria-label": "Smart sync default" },
  });
  const settingsSmartSyncDelay = h("input", {
    class: "ex-input",
    type: "number",
    attrs: { min: "0", step: "250", "aria-label": "Smart sync default delay (ms)" },
  });

  const testResult = h("div", { class: "ex-meta" });
  const testBtn = h("button", {
    class: "ex-btn",
    attrs: { type: "button" },
    on: { click: () => actions.onTestConnection() },
  }, "Test connection");
  const resetBadgeBtn = h("button", {
    class: "ex-btn",
    attrs: { type: "button" },
    on: { click: () => actions.onResetBadge() },
  }, "Reset position");

  const settingsPanel = h(
    "section",
    { class: "ex-tabpanel", id: "ex-panel-settings", role: "tabpanel", attrs: { "aria-labelledby": "ex-tab-settings" } },
    settingsPrimary.button,
    settingsPrimary.error,
    setupBanner,
    h(
      "div",
      { class: "ex-card" },
      h("div", { class: "ex-row" }, tokenState, h("div", { class: "ex-grow" }), tokenHelpBtn, openTokenBtn),
      tokenHelp,
    ),
    h("div", { class: "ex-divider" }),
    h("h3", { class: "ex-section-title", text: "Repository" }),
    h("div", { class: "ex-grid" }, field("Owner", ownerInput), field("Repo", repoInput)),
    h("div", { class: "ex-grid" }, field("Branch", branchInput), field("Root path", rootInput)),
    field("Commit message template", templateInput),
    h("div", { class: "ex-grid" }, field("Author name", authorNameInput), field("Author email", authorEmailInput)),
    h("div", { class: "ex-divider" }),
    h("h3", { class: "ex-section-title", text: "Smart sync default" }),
    h("label", { class: "ex-check" }, settingsSmartSync, h("span", { text: "Enabled" })),
    field("Debounce delay (ms)", settingsSmartSyncDelay),
    h("div", { class: "ex-divider" }),
    h("div", { class: "ex-btn-row" }, testBtn),
    testResult,
    h("div", { class: "ex-divider" }),
    h("h3", { class: "ex-section-title", text: "Panel" }),
    h("div", { class: "ex-btn-row" }, resetBadgeBtn),
  );

  const tabPanelsWrap = h("div", { class: "ex-tabpanels" }, boardsPanel, syncPanel, settingsPanel);
  tabPanels.set("boards", boardsPanel);
  tabPanels.set("sync", syncPanel);
  tabPanels.set("settings", settingsPanel);

  /* Confirm modal -------------------------------------------------------- */
  const confirmText = h("p");
  const confirmYes = h("button", {
    class: "ex-primary",
    attrs: { type: "button" },
    on: { click: () => actions.onConfirm() },
  }, "Confirm");
  const confirmNo = h("button", {
    class: "ex-btn",
    attrs: { type: "button" },
    on: { click: () => actions.onCancelConfirm() },
  }, "Cancel");
  const confirmOverlay = h(
    "div",
    { class: "ex-confirm-overlay", hidden: true },
    h("div", { class: "ex-confirm" }, confirmText, h("div", { class: "ex-btn-row" }, confirmYes, confirmNo)),
  );

  const panel = h(
    "div",
    { class: "ex-panel" },
    header,
    notice,
    tablist,
    tabPanelsWrap,
    confirmOverlay,
  );
  wrap.append(launcher, panel);
  root.append(wrap);

  /* Badge drag + layout --------------------------------------------------- */
  let drag: {
    id: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null = null;
  let suppressClick = false;
  let currentBadge: Point | null = null;

  function viewportSize(): Size {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function elementSize(el: HTMLElement): Size {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  function effectiveBadgePosition(): Point {
    const badge = elementSize(launcher);
    const viewport = viewportSize();
    if (state.badgePosition) {
      return clampBadgePosition(state.badgePosition, badge, viewport, BADGE_MARGIN);
    }
    return defaultBadgePosition(badge, viewport, BADGE_MARGIN);
  }

  function applyBadge(position: Point): void {
    currentBadge = position;
    launcher.style.left = `${position.x}px`;
    launcher.style.top = `${position.y}px`;
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
  }

  function applyPanel(badgePosition: Point): void {
    if (panel.hidden) return;
    const viewport = viewportSize();
    const viewportCap = Math.max(160, viewport.height - 2 * PANEL_MARGIN);
    // The panel has a fixed height; the cap is the smaller of that fixed height
    // and the room on the badge's chosen side, so it always fits on-screen.
    const fixedHeight = Math.min(PANEL_DEFAULT_HEIGHT, viewportCap);
    panel.style.maxHeight = `${viewportCap}px`;
    const rect = launcher.getBoundingClientRect();
    const placement = placePanel(
      { x: badgePosition.x, y: badgePosition.y, width: rect.width, height: rect.height },
      { width: elementSize(panel).width, height: fixedHeight },
      viewport,
      PANEL_GAP,
      PANEL_MARGIN,
    );
    panel.style.maxHeight = `${placement.maxHeight}px`;
    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  /** Clamp the badge to the viewport and keep the panel adjacent to it. */
  function layout(): void {
    const position = effectiveBadgePosition();
    applyBadge(position);
    applyPanel(position);
  }

  launcher.addEventListener("pointerdown", (raw) => {
    const event = raw as PointerEvent;
    if (event.button !== 0) return;
    const base = currentBadge ?? effectiveBadgePosition();
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: base.x,
      originY: base.y,
      moved: false,
    };
    try {
      launcher.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; without it we still track while over the badge.
    }
    event.preventDefault();
    event.stopPropagation();
  });

  launcher.addEventListener("pointermove", (raw) => {
    const event = raw as PointerEvent;
    if (!drag || event.pointerId !== drag.id) return;
    if (
      !drag.moved &&
      !isDragDistance(
        { x: drag.startX, y: drag.startY },
        { x: event.clientX, y: event.clientY },
        DRAG_THRESHOLD,
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    drag.moved = true;
    launcher.classList.add("ex-dragging");
    const next = clampBadgePosition(
      {
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      },
      elementSize(launcher),
      viewportSize(),
      BADGE_MARGIN,
    );
    applyBadge(next);
    applyPanel(next);
    event.preventDefault();
    event.stopPropagation();
  });

  function endDrag(raw: Event, expectClick: boolean): void {
    const event = raw as PointerEvent;
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    const final = currentBadge ?? effectiveBadgePosition();
    try {
      launcher.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    drag = null;
    launcher.classList.remove("ex-dragging");
    if (moved) {
      // A drag suppresses the synthetic click so it never toggles the panel.
      if (expectClick) suppressClick = true;
      actions.onBadgeMove(final);
    }
    event.preventDefault();
    event.stopPropagation();
  }

  launcher.addEventListener("pointerup", (event) => endDrag(event, true));
  launcher.addEventListener("pointercancel", (event) => endDrag(event, false));
  launcher.addEventListener("selectstart", (event) => event.preventDefault());
  launcher.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    actions.onToggleExpanded(!state.expanded);
  });

  // Enter/Space toggle explicitly. Handled here (and default-prevented) because
  // Excalidraw binds Space globally to pan, which would otherwise swallow the
  // button's native Space activation.
  launcher.addEventListener("keydown", (raw) => {
    const event = raw as KeyboardEvent;
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    event.stopPropagation();
    actions.onToggleExpanded(!state.expanded);
  });

  window.addEventListener("resize", () => layout());

  /* Helpers -------------------------------------------------------------- */
  function readSettingsForm(): SettingsFormValues {
    return {
      owner: ownerInput.value,
      repo: repoInput.value,
      branch: branchInput.value,
      rootPath: rootInput.value,
      commitMessageTemplate: templateInput.value,
      authorName: authorNameInput.value,
      authorEmail: authorEmailInput.value,
      smartSync: settingsSmartSync.checked,
      smartSyncDelayMs: Number(settingsSmartSyncDelay.value) || 0,
    };
  }

  function setIfUnfocused(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    if (root.activeElement === input) return;
    input.value = value;
  }

  function updateTabs(state: PanelState): void {
    for (const id of TAB_IDS) {
      const button = tabButtons.get(id);
      const panelEl = tabPanels.get(id);
      const selected = state.activeTab === id;
      if (button) {
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      }
      if (panelEl) panelEl.hidden = !selected;
    }
  }

  function renderCollections(state: PanelState): void {
    clear(collectionsList);

    if (!state.configured) {
      collectionsList.append(h("div", { class: "ex-muted", text: "Set up a repository to list boards." }));
      return;
    }
    if (state.loadingCollections) {
      collectionsList.append(h("div", { class: "ex-muted", text: "Loading…" }));
      return;
    }
    if (state.collections.length === 0) {
      collectionsList.append(h("div", { class: "ex-muted", text: "No collections yet." }));
      return;
    }

    // The board list mirrors the collection selected above; boards are shown
    // flat (never nested under a "Collections" heading).
    const active =
      state.collections.find((collection) => collection.slug === state.activeCollection) ??
      state.collections[0];
    if (!active) return;

    if (active.boards.length === 0) {
      collectionsList.append(h("div", { class: "ex-muted", text: "No boards in this collection." }));
      return;
    }

    for (const board of active.boards) {
      collectionsList.append(
        h(
          "div",
          { class: "ex-board-row" },
          h("span", { class: "ex-muted ex-truncate ex-grow", text: board.name }),
          h("button", {
            class: "ex-btn",
            attrs: { type: "button", "aria-label": `Switch to ${board.name}` },
            on: {
              click: () =>
                actions.onSelectBoard({
                  collection: board.collection,
                  name: board.name,
                  path: board.path,
                  sha: board.sha,
                }),
            },
          }, "Switch"),
        ),
      );
    }
  }

  function updateBoardCollectionSelect(state: PanelState): void {
    clear(boardCollectionSelect);
    for (const collection of state.collections) {
      boardCollectionSelect.append(h("option", { attrs: { value: collection.slug } }, collection.name));
    }
    const active = state.activeCollection ?? state.collections[0]?.slug ?? "";
    if (active) boardCollectionSelect.value = active;
  }

  let state: PanelState;

  function render(next: PanelState): void {
    state = next;
    wrap.classList.toggle("ex-dark", state.theme === "dark");

    const hs = headerStatus({ configured: state.configured, status: state.status, dirty: state.dirty });
    const tone = headerTone(hs);
    launcherDot.className = toneClass("ex-dot", tone);
    headerDot.className = toneClass("ex-dot", tone);
    statusBadge.className = toneClass("ex-status-badge", tone);
    statusBadgeText.textContent = headerStatusText(hs);

    headerBoard.textContent = state.board ? state.board.name : "No board selected";
    headerSub.textContent = state.board
      ? `${state.board.collection} · ${shortSha(state.board.sha)}`
      : "Not connected";

    launcher.setAttribute("aria-expanded", String(state.expanded));
    launcher.setAttribute(
      "aria-label",
      state.expanded ? "Close Excalidraw Sync panel" : "Open Excalidraw Sync panel",
    );
    panel.hidden = !state.expanded;

    notice.hidden = state.notice === null;
    if (state.notice) {
      noticeText.textContent = state.notice.message;
      notice.className = `ex-notice ${state.notice.kind}`;
    }

    updateTabs(state);

    // "Needs setup": a dot on the Settings tab and a banner listing what is missing.
    const setup = setupState({
      hasToken: state.hasToken,
      owner: state.settings?.owner ?? "",
      repo: state.settings?.repo ?? "",
    });
    settingsTabDot.hidden = setup.configured;
    setupBanner.hidden = setup.configured;
    if (!setup.configured) {
      setupMissing.textContent = `Missing: ${setup.missingLabels.join(", ")}.`;
    }

    /* Boards */
    savePrimary.update({
      label: "Save",
      loadingLabel: "Saving…",
      disabled: !state.configured || state.board === null,
      loading: state.status.kind === "syncing",
      error: state.status.kind === "error" ? state.status.message : null,
    });
    const elements = state.localElementCount === null ? "—" : String(state.localElementCount);
    const images = state.localImageCount === null ? "—" : String(state.localImageCount);
    const strategy = state.writeStrategy ? ` · write: ${state.writeStrategy}` : "";
    boardMeta.textContent = `Remote: ${shortSha(state.board?.sha ?? null)} · local: ${elements} elements, ${images} images${strategy}`;
    reloadBtn.disabled = !state.configured || state.board === null;
    boardsConflict.hidden = state.status.kind !== "conflict";

    /* Sync */
    syncPrimary.update({
      label: "Sync now",
      loadingLabel: "Syncing…",
      disabled: !state.configured || state.board === null,
      loading: state.status.kind === "syncing",
      error: state.status.kind === "error" ? state.status.message : null,
    });
    statusLine.textContent = statusLabel(state.status);
    conflictBanner.hidden = state.status.kind !== "conflict";

    if (root.activeElement !== smartSyncToggle) smartSyncToggle.checked = state.smartSync;
    if (root.activeElement !== smartSyncDelay) smartSyncDelay.value = String(state.smartSyncDelayMs);

    /* Settings */
    tokenState.textContent = state.hasToken ? "Token configured" : "No token yet";
    settingsPrimary.update({
      label: "Save settings",
      loadingLabel: "Saving…",
      disabled: false,
      loading: state.savingSettings,
      error: state.settingsError,
    });
    const settings = state.settings;
    setIfUnfocused(ownerInput, settings?.owner ?? "");
    setIfUnfocused(repoInput, settings?.repo ?? "");
    setIfUnfocused(branchInput, settings?.branch ?? "");
    setIfUnfocused(rootInput, settings?.rootPath ?? "");
    setIfUnfocused(templateInput, settings?.commitMessageTemplate ?? "");
    setIfUnfocused(authorNameInput, settings?.author.name ?? "");
    setIfUnfocused(authorEmailInput, settings?.author.email ?? "");
    if (root.activeElement !== settingsSmartSync) settingsSmartSync.checked = state.smartSync;
    if (root.activeElement !== settingsSmartSyncDelay) {
      settingsSmartSyncDelay.value = String(state.smartSyncDelayMs);
    }
    testResult.textContent = state.testResult ?? "";

    renderCollections(state);
    updateBoardCollectionSelect(state);

    confirmOverlay.hidden = state.confirm === null;
    if (state.confirm) {
      confirmText.textContent = state.confirm.message;
      confirmYes.textContent = state.confirm.confirmLabel;
      confirmYes.disabled = state.confirm.confirmDisabled ?? false;
    }

    // Place the badge (clamped) and, if open, the panel adjacent to it.
    layout();
  }

  render(defaultState());
  return { render };
}

function defaultState(): PanelState {
  return {
    configured: false,
    hasToken: false,
    expanded: false,
    activeTab: "boards",
    status: { kind: "idle" },
    dirty: false,
    board: null,
    collections: [],
    loadingCollections: false,
    expandedCollection: null,
    activeCollection: null,
    localElementCount: null,
    localImageCount: null,
    theme: "light",
    notice: null,
    testResult: null,
    confirm: null,
    settings: null,
    smartSync: true,
    smartSyncDelayMs: 3000,
    savingSettings: false,
    settingsError: null,
    writeStrategy: null,
    badgePosition: null,
  };
}
