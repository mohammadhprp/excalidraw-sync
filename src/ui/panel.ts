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
  reconcileField,
  shortSha,
  statusLabel,
  type SettingsFormValues,
} from "./format";
import { setupState } from "./setupState";
import { nextStep, onboardingComplete, onboardingSteps } from "./onboarding";
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
  /**
   * When set, the dialog renders a text field and the confirm button stays
   * disabled until the typed value matches this phrase. Used for destructive
   * actions that need a strong confirmation (e.g. deleting a non-empty
   * collection, where the phrase is the collection name).
   */
  confirmPhrase?: string;
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
  /** True once the active board has a remote sha (i.e. saved to GitHub). */
  boardSaved: boolean;
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
  onDeleteBoard(board: BoardView): void;
  onDeleteCollection(collection: Collection): void;
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

/**
 * A compact trash glyph for destructive controls. Inline SVG (no dependency)
 * so the destructive affordance reads visually without a text label competing
 * with the row's primary action; the button always carries an `aria-label`.
 */
function trashIcon(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5L11 4.5M6.8 6.8v4M9.2 6.8v4");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
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

  // The New board form targets the active collection; its heading names that
  // collection so the target is explicit.
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
        const slug = activeCollection(state)?.slug;
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

  /* First-run experience -------------------------------------------------- */
  // The checklist mirrors the pure `onboardingSteps`; it is rebuilt each render
  // and the whole card hides once every step is done.
  const onboardingChecklist = h("ol", {
    class: "ex-checklist",
    attrs: { "aria-label": "Setup progress" },
  });
  const setupGithubBtn = h("button", {
    class: "ex-primary block",
    attrs: { type: "button" },
    on: { click: () => actions.onOpenTokenSettings() },
  }, "Set up GitHub");
  const getStartedCard = h(
    "div",
    { class: "ex-card ex-get-started", hidden: true },
    h("h3", { class: "ex-get-started-title", text: "Get started" }),
    h("p", {
      class: "ex-get-started-lede",
      text: "Connect GitHub, then create a collection and a board to save. Four quick steps.",
    }),
    onboardingChecklist,
    setupGithubBtn,
  );

  // The current-board card groups the primary Save with the secondary Reload.
  // It is hidden until a board is active, so no unusable Save is shown.
  const currentBoardCard = h(
    "div",
    { class: "ex-card ex-board-card" },
    boardMeta,
    savePrimary.button,
    savePrimary.error,
    h("div", { class: "ex-row" }, reloadBtn),
  );

  const boardsListSection = h(
    "div",
    { class: "ex-section" },
    h("div", { class: "ex-divider" }),
    h(
      "div",
      { class: "ex-section-head" },
      h("h3", { class: "ex-section-title", text: "Collections" }),
      refreshBtn,
    ),
    collectionsList,
  );

  const newBoardHint = h("p", {
    class: "ex-empty-hint",
    hidden: true,
    text: "A board is a drawing saved inside a collection.",
  });
  const newBoardTitle = h("h3", { class: "ex-section-title", text: "New board" });
  const newBoardSection = h(
    "div",
    { class: "ex-section" },
    h("div", { class: "ex-divider" }),
    newBoardTitle,
    newBoardHint,
    h("div", { class: "ex-row" }, h("div", { class: "ex-grow" }, newBoardName), newBoardBtn),
  );

  const newCollectionHint = h("p", {
    class: "ex-empty-hint",
    hidden: true,
    text: "A collection is a folder that groups related boards.",
  });
  const newCollectionTitle = h("h3", { class: "ex-section-title", text: "New collection" });
  const newCollectionSection = h(
    "div",
    { class: "ex-section" },
    h("div", { class: "ex-divider" }),
    newCollectionTitle,
    newCollectionHint,
    h("div", { class: "ex-row" }, h("div", { class: "ex-grow" }, newCollectionName), newCollectionBtn),
  );

  const boardsPanel = h(
    "section",
    { class: "ex-tabpanel", id: "ex-panel-boards", role: "tabpanel", attrs: { "aria-labelledby": "ex-tab-boards" } },
    getStartedCard,
    currentBoardCard,
    boardsConflict,
    boardsListSection,
    newBoardSection,
    newCollectionSection,
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
  const confirmPhraseInput = h("input", {
    class: "ex-input",
    type: "text",
    id: "ex-confirm-phrase",
    attrs: { "aria-label": "Type the name to confirm" },
  });
  const confirmPhraseField = h(
    "div",
    { class: "ex-field", hidden: true },
    h("label", { text: "Type the name to confirm", for: "ex-confirm-phrase" }),
    confirmPhraseInput,
  );
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
    h(
      "div",
      { class: "ex-confirm" },
      confirmText,
      confirmPhraseField,
      h("div", { class: "ex-btn-row" }, confirmYes, confirmNo),
    ),
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

  /* Keyboard isolation ---------------------------------------------------- */
  // The panel lives in a Shadow DOM: a key event from a panel field bubbles out,
  // is retargeted to the host <div>, and reaches excalidraw.com's global keydown
  // handler, which treats it as a canvas shortcut (preventDefault -> you cannot
  // type or Backspace, and keys change the drawing). Excalidraw registers its
  // own keydown/keyup handlers on `document` in the *bubble* phase (verified
  // against the live page; the capture-phase keydown listeners there are Sentry
  // breadcrumb instrumentation and never preventDefault). A bubble-phase
  // boundary on the shadow root therefore runs after the panel's own target
  // handlers and after native text editing, and stops the event before it can
  // reach the page. `preventDefault` is deliberately NOT called, so typing,
  // Backspace/Delete and Ctrl/Cmd+A/C/V/X in the panel's fields keep working.
  function isolatePanelKeyboard(event: Event): void {
    event.stopPropagation();
  }
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    root.addEventListener(type, isolatePanelKeyboard);
  }

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
      // Smart sync is owned by the Sync tab, which writes it immediately; the
      // Settings form only carries the current values through so the patch stays
      // complete. `state` is always set before a Save click can fire.
      smartSync: state.smartSync,
      smartSyncDelayMs: state.smartSyncDelayMs,
    };
  }

  /**
   * Settings fields the user has edited since the last confirmed submit. A
   * render must never clobber these: the save flow calls `render()` with the
   * still-stale `state.settings` before its async `settings:set` resolves, and
   * by then the Save click has blurred the edited field — without this marker
   * that render would overwrite the submitted text with the old persisted value
   * and desync the display.
   */
  const editedFields = new Set<HTMLInputElement | HTMLTextAreaElement>();
  const settingsFields: Array<HTMLInputElement | HTMLTextAreaElement> = [
    ownerInput,
    repoInput,
    branchInput,
    rootInput,
    templateInput,
    authorNameInput,
    authorEmailInput,
  ];
  for (const field of settingsFields) {
    field.addEventListener("input", () => editedFields.add(field));
  }

  /**
   * Reconcile one field with the persisted settings. The pure rule lives in
   * `reconcileField`: a focused or unconfirmed-edited field keeps its text;
   * otherwise it adopts the persisted value. Once the text matches the
   * persisted value the edit marker clears.
   */
  function syncField(
    input: HTMLInputElement | HTMLTextAreaElement,
    persisted: string,
  ): void {
    const result = reconcileField({
      persisted,
      displayed: input.value,
      editing: root.activeElement === input,
      edited: editedFields.has(input),
    });
    if (input.value !== result.value) input.value = result.value;
    if (!result.edited) editedFields.delete(input);
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

  function activeCollection(s: PanelState): Collection | undefined {
    return (
      s.collections.find((collection) => collection.slug === s.activeCollection) ??
      s.collections[0]
    );
  }

  /**
   * Render the first-run checklist and guide the flow with clear empty states.
   * The checklist shows until every step is done; while a step is next its form
   * becomes the prominent empty state and the unusable board card stays hidden.
   */
  function renderOnboarding(s: PanelState): void {
    // Total boards across every collection: the board steps track the repo's
    // content, not the locally selected board, so an already-populated repo is
    // complete for them even with nothing open.
    const boardCount = s.collections.reduce(
      (total, collection) => total + collection.boards.length,
      0,
    );
    const steps = onboardingSteps({
      hasToken: s.hasToken,
      owner: s.settings?.owner ?? "",
      repo: s.settings?.repo ?? "",
      collectionCount: s.collections.length,
      boardCount,
      boardSaved: s.boardSaved,
    });
    const complete = onboardingComplete(steps);
    getStartedCard.hidden = complete;
    // The "Set up GitHub" button is only actionable while setup is missing.
    setupGithubBtn.hidden = s.configured;

    const hasCollections = s.collections.length > 0;
    const loading = s.loadingCollections;

    // The board list needs a collection; while the first load runs keep it
    // visible so its "Loading…" line shows instead of flashing the empty state.
    boardsListSection.hidden = !s.configured || (!loading && !hasCollections);

    const collectionEmpty = s.configured && !loading && !hasCollections;
    newCollectionSection.hidden = !s.configured;
    newCollectionSection.classList.toggle("ex-empty-state", collectionEmpty);
    newCollectionTitle.textContent = collectionEmpty
      ? "Create your first collection"
      : "New collection";
    newCollectionHint.hidden = !collectionEmpty;

    // Only a repo with no boards anywhere gets the guided "first board" state;
    // a repo that already has boards must never show it.
    const boardEmpty =
      s.configured && !loading && hasCollections && s.board === null && boardCount === 0;
    // A new board needs a collection to live in; hide the form until one exists
    // (including while the first list is still loading).
    newBoardSection.hidden = !s.configured || !hasCollections;
    newBoardSection.classList.toggle("ex-empty-state", boardEmpty);
    const target = activeCollection(s)?.name ?? "";
    newBoardTitle.textContent = boardEmpty
      ? `Create your first board in «${target}»`
      : target
        ? `New board in «${target}»`
        : "New board";
    newBoardHint.hidden = !boardEmpty;

    clear(onboardingChecklist);
    if (complete) return;
    const current = nextStep(steps);
    for (const step of steps) {
      const isCurrent = current !== null && current.id === step.id;
      onboardingChecklist.append(
        h(
          "li",
          {
            class: `ex-check-item${step.done ? " done" : ""}${isCurrent ? " current" : ""}`,
            ...(isCurrent ? { attrs: { "aria-current": "step" } } : {}),
          },
          h("span", {
            class: "ex-check-marker",
            attrs: { "aria-hidden": "true" },
            text: step.done ? "\u2713" : "",
          }),
          h(
            "span",
            { class: "ex-check-body" },
            h("span", { class: "ex-check-label", text: step.label }),
            step.description
              ? h("span", { class: "ex-check-desc", text: step.description })
              : null,
          ),
        ),
      );
    }
  }

  /**
   * Render the inline collection/board navigator. Each collection row is toggled
   * by its own control (chevron + name, `aria-expanded`), and an expanded
   * collection shows its boards indented beneath it. The New board form targets
   * the active collection, so the navigator is the single source of that choice.
   */
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

    state.collections.forEach((collection, index) => {
      const expanded = state.expandedCollection === collection.slug;
      const boardsId = `ex-collection-boards-${index}`;
      const count = collection.boards.length;
      const countLabel = `${count} ${count === 1 ? "board" : "boards"}`;

      const toggle = h(
        "button",
        {
          class: "ex-collection-toggle",
          attrs: {
            type: "button",
            "aria-expanded": String(expanded),
            "aria-controls": boardsId,
          },
          on: {
            click: () => actions.onExpandCollection(expanded ? null : collection.slug),
          },
        },
        h("span", {
          class: "ex-chevron",
          attrs: { "aria-hidden": "true" },
          text: expanded ? "\u25be" : "\u25b8",
        }),
        h("span", { class: "ex-collection-name ex-truncate", text: collection.name }),
      );

      const deleteCollectionBtn = h(
        "button",
        {
          class: "ex-del",
          attrs: {
            type: "button",
            "aria-label": `Delete collection «${collection.name}»`,
            title: "Delete collection",
          },
          on: { click: () => confirmDeleteCollection(collection) },
        },
        trashIcon(),
      );

      collectionsList.append(
        h(
          "div",
          { class: "ex-collection-row" },
          toggle,
          h("span", { class: "ex-collection-count", text: countLabel }),
          deleteCollectionBtn,
        ),
      );

      const boardsWrap = h("div", {
        class: "ex-collection-boards",
        id: boardsId,
        hidden: !expanded,
      });
      if (expanded) {
        if (count === 0) {
          boardsWrap.append(
            h("div", { class: "ex-muted", text: "No boards in this collection." }),
          );
        } else {
          for (const board of collection.boards) {
            const isOpen = state.board?.path === board.path;
            const view: BoardView = {
              collection: board.collection,
              name: board.name,
              path: board.path,
              sha: board.sha,
            };
            boardsWrap.append(
              h(
                "div",
                { class: `ex-board-row ex-board-nested${isOpen ? " ex-board-active" : ""}` },
                h(
                  "button",
                  {
                    class: "ex-board-open ex-truncate ex-grow",
                    attrs: {
                      type: "button",
                      "aria-label": `Open board ${board.name}`,
                      ...(isOpen ? { "aria-current": "true" } : {}),
                    },
                    on: { click: () => actions.onSelectBoard(view) },
                  },
                  board.name,
                ),
                h(
                  "button",
                  {
                    class: "ex-del",
                    attrs: {
                      type: "button",
                      "aria-label": `Delete board «${board.name}»`,
                      title: "Delete board",
                    },
                    on: { click: () => confirmDeleteBoard(view) },
                  },
                  trashIcon(),
                ),
              ),
            );
          }
        }
      }
      collectionsList.append(boardsWrap);
    });
  }

  /**
   * Show a confirm dialog. The panel owns the request (so it can render the
   * optional phrase field and gate the confirm button on the typed value); the
   * confirmed action is delegated back through `PanelActions`.
   */
  function requestConfirm(request: ConfirmRequest): void {
    state.confirm = request;
    render(state);
  }

  function confirmDeleteBoard(board: BoardView): void {
    requestConfirm({
      message: `Delete board «${board.name}»? This removes the file from GitHub and cannot be undone. Your local drawing is not affected.`,
      confirmLabel: "Delete board",
      onConfirm: () => {
        state.confirm = null;
        render(state);
        actions.onDeleteBoard(board);
      },
      onCancel: () => {
        state.confirm = null;
        render(state);
      },
    });
  }

  function confirmDeleteCollection(collection: Collection): void {
    const count = collection.boards.length;
    const requiresPhrase = count > 0;
    const countText = `${count} ${count === 1 ? "board" : "boards"}`;
    requestConfirm({
      message: requiresPhrase
        ? `Delete collection «${collection.name}» and its ${countText}? This removes them from GitHub and cannot be undone. Your local drawing is not affected. Type the collection name to confirm.`
        : `Delete collection «${collection.name}»? This removes it from GitHub and cannot be undone.`,
      confirmLabel: "Delete collection",
      confirmPhrase: requiresPhrase ? collection.name : undefined,
      onConfirm: () => {
        state.confirm = null;
        render(state);
        actions.onDeleteCollection(collection);
      },
      onCancel: () => {
        state.confirm = null;
        render(state);
      },
    });
  }

  /** Keep the confirm button disabled until a required phrase matches. */
  function updateConfirmEnabled(): void {
    const request = state?.confirm;
    if (!request) return;
    const phrase = request.confirmPhrase;
    const matches =
      phrase === undefined || confirmPhraseInput.value.trim() === phrase.trim();
    confirmYes.disabled = (request.confirmDisabled ?? false) || !matches;
  }

  confirmPhraseInput.addEventListener("input", () => updateConfirmEnabled());

  let state: PanelState;
  /** The confirm currently rendered, to reset the phrase field on a new one. */
  let shownConfirm: ConfirmRequest | null = null;

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
    currentBoardCard.hidden = !state.configured || state.board === null;
    renderOnboarding(state);

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
    // With a token configured, the create-a-token help is noise: hide only the
    // "How do I create a token?" link and its disclosure, keeping the state and
    // "Open token settings". Without a token the behavior is unchanged.
    tokenHelpBtn.hidden = state.hasToken;
    if (state.hasToken) {
      tokenHelpOpen = false;
      tokenHelp.hidden = true;
      tokenHelpBtn.setAttribute("aria-expanded", "false");
    }
    settingsPrimary.update({
      label: "Save settings",
      loadingLabel: "Saving…",
      disabled: false,
      loading: state.savingSettings,
      error: state.settingsError,
    });
    const settings = state.settings;
    syncField(ownerInput, settings?.owner ?? "");
    syncField(repoInput, settings?.repo ?? "");
    syncField(branchInput, settings?.branch ?? "");
    syncField(rootInput, settings?.rootPath ?? "");
    syncField(templateInput, settings?.commitMessageTemplate ?? "");
    syncField(authorNameInput, settings?.author.name ?? "");
    syncField(authorEmailInput, settings?.author.email ?? "");
    testResult.textContent = state.testResult ?? "";

    renderCollections(state);

    // Reset the phrase field whenever a new confirm request is shown, so a
    // previous phrase never leaks into the next dialog.
    if (state.confirm !== shownConfirm) {
      shownConfirm = state.confirm;
      confirmPhraseInput.value = "";
    }
    confirmOverlay.hidden = state.confirm === null;
    if (state.confirm) {
      confirmText.textContent = state.confirm.message;
      confirmYes.textContent = state.confirm.confirmLabel;
      confirmPhraseField.hidden = state.confirm.confirmPhrase === undefined;
      updateConfirmEnabled();
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
    boardSaved: false,
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
