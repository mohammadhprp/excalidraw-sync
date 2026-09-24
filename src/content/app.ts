/**
 * Content-script orchestrator.
 *
 * Owns the panel state, wires the panel's actions to the sync controller, the
 * smart-sync detector, and the frozen `chrome.runtime` protocol. All GitHub I/O
 * stays in the service worker; this file only sends `Req` messages.
 */

import {
  boardFilePath,
  type ConnectionInfo,
  type Collection,
  type PublicSettings,
  type SceneFile,
  type Settings,
} from "../lib";
import { createPanel, type Panel, type PanelActions, type PanelState } from "../ui/panel";
import { mountPanelHost } from "../ui/host";
import {
  BADGE_STORAGE_KEY,
  parseBadgePosition,
  serializeBadgePosition,
  type Point,
} from "../ui/badgePosition";
import { installAutomationBridge } from "./automation";
import { collectReferencedFileIds, parseElements, readScene, readTheme, APP_STATE_KEY, ELEMENTS_KEY } from "./scene";
import { readFilesFromIndexedDb } from "./files";
import { computeSceneHash } from "./hash";
import { createMessageSender, type RuntimeLike } from "./messaging";
import { createSmartSync, type SmartSync } from "./smartSync";
import { createSyncController } from "./syncController";
import { createDomWriteTarget, runWriteStrategies, waitForElement } from "./write";

const SMART_SYNC_INTERVAL_MS = 1500;
/** Keep the primary-button spinner visible this long, to avoid flicker. */
const MIN_LOADING_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Badge position persistence. Stored directly in `chrome.storage.local` under
 * its own key, so the frozen `Settings` interface is untouched.
 */
function loadBadgePosition(): Promise<Point | null> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(BADGE_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(parseBadgePosition(result?.[BADGE_STORAGE_KEY]));
      });
    } catch {
      resolve(null);
    }
  });
}

function saveBadgePosition(position: Point | null): void {
  try {
    if (position === null) {
      chrome.storage.local.remove(BADGE_STORAGE_KEY);
      return;
    }
    chrome.storage.local.set({ [BADGE_STORAGE_KEY]: serializeBadgePosition(position) });
  } catch {
    // Storage is best-effort; a failure just means the default position next load.
  }
}

function initialState(): PanelState {
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

export async function startApp(): Promise<void> {
  const doc = window.document;
  const win = window;
  const storage = win.localStorage;
  const origin = win.location.origin;
  const { shadow } = mountPanelHost(doc);

  let state = initialState();
  // Resolve the theme synchronously so the panel's very first paint already
  // matches the page (loading straight into dark mode shows no light flash).
  state.theme = themeFromPage();

  // Load the stored badge position before mounting so the first paint is already
  // in the persisted place (no jump from the default bottom-right).
  const storedBadge = await loadBadgePosition();
  if (storedBadge) state.badgePosition = storedBadge;

  let panel: Panel | null = null;
  let smartSync: SmartSync | null = null;
  let smartSyncRunning = false;
  let collections: Collection[] = [];

  const sender = createMessageSender(chrome.runtime as unknown as RuntimeLike);

  const writeTarget = createDomWriteTarget({
    document: doc,
    localStorage: storage,
    location: win.location,
    DataTransfer: win.DataTransfer,
    File: win.File,
    DragEvent: win.DragEvent,
    ClipboardEvent: win.ClipboardEvent,
    KeyboardEvent: win.KeyboardEvent,
    PointerEvent: win.PointerEvent,
    waitForElement: (selector, timeoutMs) => waitForElement(doc, selector, timeoutMs),
  });

  const readLocalScene = (): Promise<SceneFile> =>
    readScene(storage, origin, readFilesFromIndexedDb);

  function render(): void {
    panel?.render(state);
  }

  function refreshLocalInfo(): void {
    const elements = parseElements(storage.getItem(ELEMENTS_KEY));
    state.localElementCount = elements.length;
    state.localImageCount = collectReferencedFileIds(elements).length;
  }

  function themeFromPage(): "light" | "dark" {
    // `html.dark` is authoritative when present; otherwise the stored
    // preference. Same-tab localStorage writes do not emit `storage` events,
    // so `watchTheme` also polls.
    if (doc.documentElement.classList.contains("dark")) return "dark";
    return readTheme(storage);
  }

  function syncTheme(): void {
    const next = themeFromPage();
    if (next !== state.theme) {
      state.theme = next;
      render();
    }
  }

  function scheduleLocalRefresh(): void {
    setTimeout(() => {
      refreshLocalInfo();
      render();
    }, 500);
  }

  async function applyScene(scene: SceneFile): Promise<void> {
    const result = await runWriteStrategies(writeTarget, scene);
    if (!result.ok) throw new Error(result.error ?? "Scene write failed.");
    state.writeStrategy = result.strategy;
    refreshLocalInfo();
    scheduleLocalRefresh();
  }

  const controller = createSyncController({
    send: sender,
    readScene: readLocalScene,
    applyScene,
    onChange: (next) => {
      state.status = next.status;
      state.dirty = next.dirty;
      state.board = next.board;
      if (!next.dirty) smartSync?.markSynced();
      render();
    },
  });

  smartSync = createSmartSync({
    hash: () =>
      computeSceneHash(storage.getItem(ELEMENTS_KEY), storage.getItem(APP_STATE_KEY)),
    isHidden: () => doc.hidden,
    delayMs: state.smartSyncDelayMs,
    intervalMs: SMART_SYNC_INTERVAL_MS,
    onChange: () => {
      refreshLocalInfo();
      controller.markDirty();
      render();
    },
    save: () => {
      if (!state.configured) return;
      if (!controller.state().board) return;
      void controller.save();
    },
  });

  function applySettings(next: PublicSettings): void {
    state.settings = next;
    state.hasToken = next.hasToken;
    state.smartSync = next.smartSync;
    state.smartSyncDelayMs = next.smartSyncDelayMs;
    state.configured = Boolean(next.hasToken && next.owner && next.repo);
    smartSync?.setDelay(next.smartSyncDelayMs);

    const shouldRun = next.smartSync && state.configured;
    if (shouldRun && !smartSyncRunning) {
      smartSync?.start();
      smartSyncRunning = true;
    } else if (!shouldRun && smartSyncRunning) {
      smartSync?.stop();
      smartSyncRunning = false;
    }
  }

  function setNotice(kind: "info" | "error", message: string): void {
    state.notice = { kind, message };
    render();
  }

  async function loadCollections(): Promise<void> {
    if (!state.configured) return;
    state.loadingCollections = true;
    render();
    const res = await sender<Collection[]>({ type: "github:listCollections" });
    state.loadingCollections = false;
    if (!res.ok) {
      setNotice("error", res.error);
      return;
    }
    collections = res.data;
    state.collections = collections;
    if (!state.activeCollection && collections[0]) {
      state.activeCollection = collections[0].slug;
    }
    render();
  }

  async function switchBoard(board: PanelState["board"]): Promise<void> {
    if (!board) return;
    state.notice = null;
    const res = await sender<SceneFile>({ type: "github:readBoard", path: board.path });
    if (!res.ok) {
      setNotice("error", res.error);
      return;
    }
    try {
      await applyScene(res.data);
    } catch (error) {
      setNotice("error", errorMessage(error));
      return;
    }
    controller.setBoard(board);
    state.activeCollection = board.collection;
    smartSync?.markSynced();
    refreshLocalInfo();
    render();
  }

  function newBoard(collectionSlug: string, name: string): void {
    const rootPath = state.settings?.rootPath || "excalidraw";
    const path = boardFilePath(rootPath, collectionSlug, name);
    controller.setBoard({ collection: collectionSlug, name, path, sha: null });
    controller.markDirty();
    state.activeCollection = collectionSlug;
    refreshLocalInfo();
    render();
  }

  async function createCollection(name: string): Promise<void> {
    const res = await sender<Collection>({ type: "github:createCollection", name });
    if (!res.ok) {
      setNotice("error", res.error);
      return;
    }
    state.activeCollection = res.data.slug;
    state.expandedCollection = res.data.slug;
    await loadCollections();
  }

  async function saveSettings(patch: Partial<Settings>, message: string): Promise<void> {
    state.savingSettings = true;
    state.settingsError = null;
    render();
    const startedAt = Date.now();
    const res = await sender<PublicSettings>({ type: "settings:set", patch });
    const remaining = MIN_LOADING_MS - (Date.now() - startedAt);
    if (remaining > 0) await delay(remaining);
    state.savingSettings = false;
    if (!res.ok) {
      state.settingsError = res.error;
      setNotice("error", res.error);
      return;
    }
    applySettings(res.data);
    state.testResult = null;
    setNotice("info", message);
  }

  async function testConnection(): Promise<void> {
    const res = await sender<ConnectionInfo>({ type: "github:testConnection" });
    state.testResult = res.ok
      ? `Connected: ${res.data.owner}/${res.data.repo} @ ${res.data.branch}`
      : `Error: ${res.error}`;
    render();
  }

  /** Warn before any action that would drop unsaved local changes. */
  function guardDirty(message: string, proceed: () => void): void {
    const current = controller.state();
    if (!current.dirty) {
      proceed();
      return;
    }
    const conflicted = current.status.kind === "conflict";
    state.confirm = {
      message: conflicted
        ? `${message} Resolve the conflict first.`
        : `${message} Save the current board first?`,
      confirmLabel: conflicted ? "Close" : "Save & continue",
      confirmDisabled: false,
      onConfirm: () => {
        state.confirm = null;
        if (conflicted) {
          render();
          return;
        }
        void (async () => {
          await controller.save();
          if (controller.state().dirty) {
            render();
            return;
          }
          proceed();
        })();
      },
      onCancel: () => {
        state.confirm = null;
        render();
      },
    };
    render();
  }

  const actions: PanelActions = {
    onToggleExpanded: (expanded) => {
      state.expanded = expanded;
      render();
      if (expanded && state.configured && collections.length === 0) {
        void loadCollections();
      }
    },
    onSelectTab: (tab) => {
      state.activeTab = tab;
      render();
    },
    onOpenTokenSettings: () => {
      // The PAT lives on the extension options page, never in this script.
      // Content scripts cannot call `runtime.openOptionsPage` (it is not in
      // their `chrome.runtime` surface), so relay it to the worker.
      void sender<null>({ type: "ui:openOptions" }).then((res) => {
        if (!res.ok) setNotice("error", `Could not open settings: ${res.error}`);
      });
    },
    onSave: () => {
      if (!state.configured) {
        setNotice("error", "Configure a GitHub token in Settings first.");
        return;
      }
      if (!controller.state().board) {
        setNotice("error", "Select or create a board first.");
        return;
      }
      void controller.save();
    },
    onReloadFromRemote: () =>
      guardDirty("Reload the remote board?", () => void controller.reloadFromRemote()),
    onSelectBoard: (board) =>
      guardDirty(`Switch to ${board.name}?`, () => void switchBoard(board)),
    onExpandCollection: (slug) => {
      state.expandedCollection = slug;
      if (slug) state.activeCollection = slug;
      render();
    },
    onCreateCollection: (name) => void createCollection(name),
    onRefreshCollections: () => void loadCollections(),
    onNewBoard: (collectionSlug, name) =>
      guardDirty(`Create board ${name}?`, () => newBoard(collectionSlug, name)),
    onKeepLocal: () => void controller.keepLocal(),
    onKeepRemote: () => void controller.keepRemote(),
    onSaveSettings: (patch) => void saveSettings(patch, "Settings saved."),
    onTestConnection: () => void testConnection(),
    onToggleSmartSync: (enabled) =>
      void saveSettings({ smartSync: enabled }, enabled ? "Smart sync on." : "Smart sync off."),
    onSetSmartSyncDelay: (ms) =>
      void saveSettings({ smartSyncDelayMs: ms }, "Smart sync delay updated."),
    onBadgeMove: (position) => {
      state.badgePosition = position;
      saveBadgePosition(position);
      render();
    },
    onResetBadge: () => {
      state.badgePosition = null;
      saveBadgePosition(null);
      render();
    },
    onConfirm: () => state.confirm?.onConfirm(),
    onCancelConfirm: () => state.confirm?.onCancel(),
    onDismissNotice: () => {
      state.notice = null;
      render();
    },
  };

  panel = createPanel(shadow, actions);

  doc.addEventListener("visibilitychange", () => smartSync?.check());
  win.addEventListener("focus", () => smartSync?.check());

  function watchTheme(): void {
    syncTheme();
    const observer = new MutationObserver(() => syncTheme());
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["class"] });
    // Poll for the stored preference (a same-tab write fires no `storage` event).
    setInterval(syncTheme, 1000);
  }

  async function boot(): Promise<void> {
    render();
    const res = await sender<PublicSettings>({ type: "settings:get" });
    if (!res.ok) {
      setNotice("error", `Service worker unavailable: ${res.error}`);
    } else {
      applySettings(res.data);
    }
    refreshLocalInfo();
    syncTheme();
    render();

    if (state.configured) void loadCollections();
    watchTheme();

    installAutomationBridge(win, storage, {
      readScene: readLocalScene,
      writeScene: async (scene) => {
        try {
          await applyScene(scene);
          return { strategy: state.writeStrategy, ok: true };
        } catch (error) {
          return { strategy: null, ok: false, error: errorMessage(error) };
        }
      },
      getState: () => ({
        status: controller.state().status,
        board: controller.state().board,
        dirty: controller.state().dirty,
        writeStrategy: state.writeStrategy,
        configured: state.configured,
      }),
    });
  }

  void boot().catch((error) => {
    setNotice("error", `Init failed: ${errorMessage(error)}`);
  });
}
