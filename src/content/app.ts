/**
 * Content-script orchestrator.
 *
 * Owns the panel state, wires the panel's actions to the sync controller, the
 * smart-sync detector, and the frozen `chrome.runtime` protocol. All GitHub I/O
 * stays in the service worker; this file only sends `Req` messages.
 */

import {
  boardFilePath,
  type Collection,
  type CollectionDeleteResult,
  type ConnectionInfo,
  type PublicSettings,
  type SceneFile,
  type Settings,
} from "../lib";
import { createPanel, type Panel, type PanelActions, type PanelState } from "../ui/panel";
import { mountPanelHost } from "../ui/host";
import { BUILT_IN_BRANCH, resolveAdoptedBranch } from "../ui/format";
import {
  BADGE_STORAGE_KEY,
  parseBadgePosition,
  serializeBadgePosition,
  type Point,
} from "../ui/badgePosition";
import { installAutomationBridge } from "./automation";
import {
  applyBoardCreate,
  applyBoardSwitch,
  decideCreateFlow,
  missingParts,
  sceneMatches,
  strategyCompletesSwitch,
  strategyFullyApplies,
  waitForAppliedScene,
  type ApplySceneOptions,
  type BoardFlowDeps,
} from "./boardFlow";
import { collectReferencedFileIds, parseElements, readScene, readTheme, APP_STATE_KEY, ELEMENTS_KEY } from "./scene";
import { readFilesFromIndexedDb } from "./files";
import { computeSceneHash } from "./hash";
import { createMessageSender, type RuntimeLike } from "./messaging";
import { createSmartSync, type SmartSync } from "./smartSync";
import { createSyncController, type BoardView } from "./syncController";
import { reconcileCollectionsView } from "./collectionRefresh";
import { createDomWriteTarget, runWriteStrategies, waitForElement } from "./write";

const SMART_SYNC_INTERVAL_MS = 1500;
/** Keep the primary-button spinner visible this long, to avoid flicker. */
const MIN_LOADING_MS = 500;
/**
 * `awaitSceneApplied` poll cadence and cap. A write target can return before the
 * page has persisted the scene (`drop` only dispatches), so the create flow
 * polls the live scene before baselining smart sync. The cap bounds the wait
 * when a scene never becomes observable.
 */
const APPLIED_SCENE_POLL_MS = 100;
const APPLIED_SCENE_TIMEOUT_MS = 3000;

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

  async function applyScene(
    scene: SceneFile,
    options: ApplySceneOptions = {},
  ): Promise<void> {
    // Route the write only through strategies that can carry the whole scene:
    // a fallback that cannot write appState/files must never be accepted as a
    // full canvas replace, which would leave a merged/partial scene behind. A
    // board switch additionally requires in-place strategies: `reload`
    // navigates and would discard the in-memory selection.
    const result = await runWriteStrategies(writeTarget, scene, {
      allow: (strategy) =>
        strategyFullyApplies(strategy, scene) &&
        (!options.inPlaceOnly || strategyCompletesSwitch(strategy)),
    });
    if (!result.ok) {
      // Name any fallbacks that were skipped because they cannot carry the
      // scene, rather than surfacing only the last bare write error.
      const skipped = (["paste", "reload"] as const)
        .map((strategy) => ({ strategy, missing: missingParts(strategy, scene) }))
        .filter((entry) => entry.missing.length > 0)
        .map((entry) => `${entry.strategy} (${entry.missing.join(", ")})`);
      const suffix =
        skipped.length > 0
          ? ` Skipped fallback write paths that cannot fully replace the scene: ${skipped.join("; ")}.`
          : "";
      throw new Error((result.error ?? "Scene write failed.") + suffix);
    }
    state.writeStrategy = result.strategy;
    refreshLocalInfo();
    scheduleLocalRefresh();
  }

  /**
   * Resolve once the applied scene is actually on the canvas (or the wait caps
   * out). `applyScene` may return before an async writer (`drop`) has persisted
   * the scene, so a caller that baselines smart sync after it would capture the
   * previous drawing and let the writer's own persist auto-save.
   */
  const awaitSceneApplied = (scene: SceneFile): Promise<void> =>
    waitForAppliedScene(scene, readLocalScene, {
      pollMs: APPLIED_SCENE_POLL_MS,
      timeoutMs: APPLIED_SCENE_TIMEOUT_MS,
    });

  /** True when the live canvas holds elements that are not saved to any board. */
  function hasLocalDrawing(): boolean {
    return parseElements(storage.getItem(ELEMENTS_KEY)).length > 0;
  }

  /** The controller/smart-sync verbs the create and switch flows drive. */
  function boardFlowDeps(): BoardFlowDeps {
    return {
      snapshot: () => controller.snapshot(),
      setBoard: (next: BoardView | null) => controller.setBoard(next),
      restore: (snapshot) => controller.restore(snapshot),
      applyScene,
      awaitSceneApplied,
      markDirty: () => controller.markDirty(),
      markSynced: () => smartSync?.markSynced(),
    };
  }

  /**
   * Best-effort confirmation that the canvas now holds `expected`. The live
   * Excalidraw write is external and asynchronous, so this is deferred and
   * advisory: a mismatch is surfaced for the user, never treated as a failed
   * switch (the board pointer already reflects the selected board).
   */
  function verifyAppliedScene(expected: SceneFile, label: string): void {
    setTimeout(() => {
      void (async () => {
        const actual = await readLocalScene();
        if (!sceneMatches(expected, actual)) {
          setNotice(
            "error",
            `Opened ${label}, but the canvas may not fully match it. Use Reload from GitHub to retry.`,
          );
        }
      })();
    }, 500);
  }

  const controller = createSyncController({
    send: sender,
    readScene: readLocalScene,
    applyScene,
    onChange: (next) => {
      const wasSynced = state.status.kind === "synced";
      state.status = next.status;
      state.dirty = next.dirty;
      state.board = next.board;
      // A board with a remote sha has been saved to GitHub; a freshly created
      // board (sha null) has not, so the checklist's "Save it" step stays open.
      state.boardSaved = next.board?.sha != null;
      if (!next.dirty) smartSync?.markSynced();
      // A successful save / remote reload changed the listing (a new board file,
      // a fresh sha). Refresh it off the critical path so counts and rows catch
      // up. `loadCollections` coalesces, so a burst of saves issues one listing.
      if (next.status.kind === "synced" && !wasSynced) void loadCollections({ silent: true });
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
      // Only a *selected* board can be dirty: with no board there is nothing to
      // save, and marking the document dirty would strand every `guardDirty`
      // action (save() can only set an error without a board and never clears
      // `dirty`). Keep the local counts and render live either way.
      if (controller.state().board) controller.markDirty();
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

  /** In-flight background refresh, so a burst of saves coalesces into one. */
  let listingInFlight: Promise<void> | null = null;

  /**
   * (Re)list collections and boards, serialized through one in-flight request.
   *
   * Sharing a single promise across both silent and explicit loads matters: a
   * silent background refresh (a save, a switch, opening the Boards tab) must
   * never run concurrently with an explicit load and overwrite its fresher
   * listing with a stale one. A `silent` refresh is positional (no spinner, no
   * error banner); an explicit load shows the spinner. The first caller wins
   * the mode, and every caller awaits the same listing.
   */
  function loadCollections(options: { silent?: boolean } = {}): Promise<void> {
    if (!state.configured) return Promise.resolve();
    if (listingInFlight) return listingInFlight;
    const run = runCollectionsLoad(options.silent === true);
    listingInFlight = run;
    return run.finally(() => {
      listingInFlight = null;
    });
  }

  async function runCollectionsLoad(silent: boolean): Promise<void> {
    if (!silent) {
      state.loadingCollections = true;
      render();
    }
    const res = await sender<Collection[]>({ type: "github:listCollections" });
    if (!silent) state.loadingCollections = false;
    if (!res.ok) {
      // A silent background refresh must never interrupt the user with an error
      // banner: it is an optimization, not an explicit action. Only a
      // user-initiated listing (boot, Refresh, create/delete) surfaces the
      // failure. Stale content is surfaced by the counts staying put.
      if (!silent) setNotice("error", res.error);
      return;
    }
    // A silent background refresh must never interrupt the user with an error
    // banner (handled above) and must stay out of the way: only a
    // user-initiated listing (boot, Refresh, create/delete) toggles the
    // spinner, so open/switch still refresh counts and rows.
    const next = reconcileCollectionsView(
      {
        expandedCollection: state.expandedCollection,
        activeCollection: state.activeCollection,
        // Read the live board: it may have changed while the listing was in
        // flight, and a listing refresh must never clobber the open board with
        // the snapshot captured when the refresh started.
        board: state.board,
      },
      res.data,
    );
    collections = next.collections;
    state.collections = next.collections;
    // A refresh must never collapse the collection the user just opened or lose
    // the open board.
    state.expandedCollection = next.expandedCollection;
    state.activeCollection = next.activeCollection;
    state.board = next.board;
    // Recompute derived flags after a (re)load so the checklist reflects the
    // new collection/board counts.
    state.boardSaved = state.board?.sha != null;
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
      // The controller is pointed at the target board around the write, so a
      // smart-sync tick can never attribute the incoming scene to the previous
      // board (which would save the new content into the old path).
      await applyBoardSwitch(boardFlowDeps(), board, res.data);
    } catch (error) {
      // `applyBoardSwitch` restored the previous selection; do not claim a
      // switch happened and do not leave the board attributed to a scene it
      // does not hold.
      setNotice("error", errorMessage(error));
      render();
      return;
    }
    state.activeCollection = board.collection;
    // Reveal the opened board in its collection in the navigator.
    state.expandedCollection = board.collection;
    refreshLocalInfo();
    render();
    verifyAppliedScene(res.data, `«${board.name}»`);
    // A switch can adopt a fresh sha; keep the listing current for the panel.
    void loadCollections({ silent: true });
  }

  async function newBoard(collectionSlug: string, name: string): Promise<void> {
    const rootPath = state.settings?.rootPath || "excalidraw";
    const path = boardFilePath(rootPath, collectionSlug, name);
    try {
      // Creating opens a genuinely empty canvas: the new board is pointed at
      // first and the live scene is cleared to an empty drawing, so the drawing
      // already on screen can never become the new board's content.
      await applyBoardCreate(
        boardFlowDeps(),
        { collection: collectionSlug, name, path, sha: null },
        origin,
      );
    } catch (error) {
      setNotice("error", errorMessage(error));
      render();
      return;
    }
    state.activeCollection = collectionSlug;
    // Reveal the new board in the navigator rather than leaving it collapsed.
    state.expandedCollection = collectionSlug;
    refreshLocalInfo();
    render();
    // The collection's listing may be stale; refresh it off the critical path so
    // boards that already exist remotely show up with a correct count.
    void loadCollections({ silent: true });
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

  /**
   * Delete a board file from GitHub. A board that was never synced has no
   * remote file, so we only refresh and say so. The local drawing is never
   * touched: deleting clears the selection at most.
   */
  async function deleteBoard(board: BoardView): Promise<void> {
    if (board.sha === null) {
      await loadCollections();
      setNotice("info", `Board «${board.name}» is not on GitHub yet, so there is nothing to delete there.`);
      return;
    }
    const res = await sender<null>({
      type: "github:deleteBoard",
      path: board.path,
      sha: board.sha,
    });
    if (!res.ok) {
      setNotice("error", res.error);
      return;
    }
    if (state.board?.path === board.path) {
      // Clear the selection only; the local drawing is deliberately untouched.
      controller.setBoard(null);
      state.activeCollection = board.collection;
      state.expandedCollection = board.collection;
    }
    await loadCollections();
    setNotice("info", `Deleted board «${board.name}» from GitHub.`);
  }

  /**
   * Delete a collection (cascade). If the open board lived there it is cleared;
   * the local drawing is never touched.
   */
  async function deleteCollection(collection: Collection): Promise<void> {
    const res = await sender<CollectionDeleteResult>({
      type: "github:deleteCollection",
      slug: collection.slug,
    });
    if (!res.ok) {
      setNotice("error", res.error);
      return;
    }
    if (state.board?.collection === collection.slug) {
      // Clear the selection only; the local drawing is deliberately untouched.
      controller.setBoard(null);
    }
    if (state.expandedCollection === collection.slug) state.expandedCollection = null;
    await loadCollections();

    const { deletedBoards, failures } = res.data;
    const boardWord = deletedBoards === 1 ? "board" : "boards";
    let message = `Deleted collection «${collection.name}» (${deletedBoards} ${boardWord} removed).`;
    if (failures.length > 0) {
      message += ` Could not delete ${failures.length} item${failures.length === 1 ? "" : "s"}: ${failures.join("; ")}`;
      setNotice("error", message);
      return;
    }
    setNotice("info", message);
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
    if (!res.ok) {
      state.testResult = `Error: ${res.error}`;
      render();
      return;
    }

    const decision = resolveAdoptedBranch({
      configuredBranch: state.settings?.branch ?? "",
      defaultBranch: res.data.branch,
    });
    const prefix = `Connected: ${res.data.owner}/${res.data.repo} @ `;

    if (!decision.adopted) {
      // The confirmation must name the branch actually in effect, not just the
      // repo default while the client would still use `main`.
      state.testResult = `${prefix}${decision.branch}`;
      render();
      return;
    }

    // Adopt and persist the repo's default branch so every later Contents call
    // uses it (the client is rebuilt from settings on each message).
    const saved = await sender<PublicSettings>({
      type: "settings:set",
      patch: { branch: decision.branch },
    });
    if (!saved.ok) {
      // Persisting failed: the client still uses the previous branch, so report
      // that branch rather than the one we could not save.
      const inEffect = (state.settings?.branch ?? "").trim() || BUILT_IN_BRANCH;
      state.testResult = `${prefix}${inEffect}`;
      setNotice("error", `Could not adopt the repository default branch: ${saved.error}`);
      return;
    }

    applySettings(saved.data);
    state.testResult = `${prefix}${decision.branch}`;
    setNotice("info", decision.notice ?? `Using repository default branch: ${decision.branch}`);
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
            if (controller.state().board === null) {
              // There is no board to save, so `save()` can never clear `dirty`.
              // Close the guard and say so rather than proceeding and silently
              // dropping the local changes.
              setNotice(
                "error",
                "Select or create a board first — there is no board to save.",
              );
              return;
            }
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

  /**
   * Guard for Create board. Creating opens a fresh, empty canvas, so it must
   * (a) never adopt the drawing already on screen and (b) never silently
   * discard unsaved work. `decideCreateFlow` owns the pure decision; this wires
   * it to the panel's confirm dialog, adding a "Discard & create" second action
   * when there is a board that can be saved first. The existing dirty/conflict
   * guard (`guardDirty`) is untouched.
   */
  function guardCreateBoard(collectionSlug: string, name: string): void {
    const current = controller.state();
    const decision = decideCreateFlow({
      boardOpen: current.board !== null,
      dirty: current.dirty,
      conflicted: current.status.kind === "conflict",
      hasLocalDrawing: hasLocalDrawing(),
    });

    if (decision.kind === "proceed") {
      void newBoard(collectionSlug, name);
      return;
    }

    const openName = current.board?.name ?? "the current board";

    if (decision.kind === "blocked") {
      state.confirm = {
        message: `Create board ${name}? Resolve the conflict on «${openName}» first.`,
        confirmLabel: "Close",
        confirmDisabled: false,
        onConfirm: () => {
          state.confirm = null;
          render();
        },
        onCancel: () => {
          state.confirm = null;
          render();
        },
      };
      render();
      return;
    }

    const dirtyBoard = decision.reason === "dirty-board";
    state.confirm = {
      message: dirtyBoard
        ? `Create board ${name}? «${openName}» has unsaved changes, and a new board opens an empty canvas. Save them or discard them?`
        : `Create board ${name}? The drawing on the canvas is not saved to a board, and a new board opens an empty canvas. Discard the drawing?`,
      // The safe default: save an open board, or keep a board-less drawing.
      confirmLabel: dirtyBoard ? "Save & continue" : "Discard & create",
      confirmDisabled: false,
      ...(dirtyBoard
        ? {
            secondaryLabel: "Discard & create",
            onSecondary: () => {
              state.confirm = null;
              render();
              void newBoard(collectionSlug, name);
            },
          }
        : {}),
      onConfirm: () => {
        state.confirm = null;
        if (!dirtyBoard) {
          // Board-less drawing: there is no board to save it to, so the only
          // way forward is the explicitly chosen discard. Cancel keeps it.
          render();
          void newBoard(collectionSlug, name);
          return;
        }
        void (async () => {
          await controller.save();
          if (controller.state().dirty) {
            // The save did not clear the changes (error or conflict): keep the
            // guard closed and do not discard the work.
            render();
            return;
          }
          await newBoard(collectionSlug, name);
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
      // Opening the Boards tab must show current content, not the listing
      // cached at boot.
      if (tab === "boards" && state.configured) void loadCollections({ silent: true });
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
    onDeleteBoard: (board) => void deleteBoard(board),
    onDeleteCollection: (collection) => void deleteCollection(collection),
    onCreateCollection: (name) => void createCollection(name),
    onRefreshCollections: () => void loadCollections(),
    onNewBoard: (collectionSlug, name) => guardCreateBoard(collectionSlug, name),
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
    onSecondaryConfirm: () => state.confirm?.onSecondary?.(),
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
