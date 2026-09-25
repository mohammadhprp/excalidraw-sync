/**
 * Board flow — the pure, testable decisions behind creating and switching a
 * board, kept out of the DOM/`chrome` glue in `app.ts`:
 *
 *  - **Creating** a board must open a genuinely empty canvas, never adopt the
 *    drawing already on screen, and never silently discard unsaved work. A
 *    board-less drawing (elements in localStorage with no board open) can never
 *    be marked `dirty` — `markDirty()` no-ops without a board — so it is
 *    detected explicitly from the live content.
 *  - **Switching** a board must point the controller at the target board
 *    *around* the canvas write, so no smart-sync tick can attribute the
 *    incoming scene to the board being left.
 *
 * It also owns the "can this write path fully replace the scene?" rule, used to
 * route a scene only through strategies that can carry all of it (so a fallback
 * that drops `appState`/`files` is never accepted as a full apply), plus the
 * pure equivalence used to check the scene that actually landed.
 */

import type { SceneFile } from "../lib";
import { buildScene } from "./scene";
import type { BoardView, SyncControllerState } from "./syncController";
import type { WriteStrategy } from "./write";

/* ------------------------------ scene parts ------------------------------ */

export type ScenePart = "elements" | "appState" | "files";

/**
 * The scene parts each write strategy actually replaces on the live canvas.
 *
 * `paste` carries an `excalidraw/clipboard` payload — elements + files — and
 * has no way to set `appState`; `reload` writes localStorage elements + appState
 * but never writes embedded images back to IndexedDB. Only `drop`, a full
 * `.excalidraw` file, carries all three.
 */
export function strategyCarriedParts(strategy: WriteStrategy): ScenePart[] {
  switch (strategy) {
    case "drop":
      return ["elements", "appState", "files"];
    case "paste":
      return ["elements", "files"];
    case "reload":
      return ["elements", "appState"];
  }
}

/**
 * The parts a scene actually needs replaced. `appState`/`files` only count when
 * the scene has any, so an elements-only scene never demands more than a
 * strategy can carry.
 */
export function requiredParts(scene: SceneFile): ScenePart[] {
  const parts: ScenePart[] = ["elements"];
  if (Object.keys(scene.appState).length > 0) parts.push("appState");
  if (Object.keys(scene.files).length > 0) parts.push("files");
  return parts;
}

/** The parts of `scene` a strategy cannot carry (empty when it fully applies). */
export function missingParts(strategy: WriteStrategy, scene: SceneFile): ScenePart[] {
  const carried = new Set(strategyCarriedParts(strategy));
  return requiredParts(scene).filter((part) => !carried.has(part));
}

/** True when applying `scene` with `strategy` fully replaces the live scene. */
export function strategyFullyApplies(strategy: WriteStrategy, scene: SceneFile): boolean {
  return missingParts(strategy, scene).length === 0;
}

/**
 * Whether `strategy` can complete a *board switch* without leaving the page.
 *
 * `drop` and `paste` rewrite the live canvas in place, so the controller can
 * finish pointing at the target board after the write. `reload` writes
 * localStorage and navigates: the navigation tears down the content script
 * before the panel can adopt the new selection, so the drawing shows but no
 * board is selected. A switch must therefore never route through `reload` and
 * instead fail clearly (the previous selection is restored) when no in-place
 * strategy can carry the scene.
 */
export function strategyCompletesSwitch(strategy: WriteStrategy): boolean {
  return strategy !== "reload";
}

/* --------------------------- applied-scene check ------------------------- */

function elementIds(elements: unknown[]): string[] {
  return elements
    .map((element) =>
      element && typeof element === "object"
        ? (element as { id?: unknown }).id
        : undefined,
    )
    .filter((id): id is string => typeof id === "string")
    .sort();
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Whether the scene on the canvas matches the one that was requested.
 *
 * Compares the drawing's identity — the set of element ids — plus every image
 * the request expected. `appState` is deliberately ignored: Excalidraw rewrites
 * transient appState keys when it restores a scene, so a deep appState compare
 * would false-fail a correct apply, while a wrong or merged element set is
 * exactly what "the wrong drawing is on screen" gets wrong.
 */
export function sceneMatches(expected: SceneFile, actual: SceneFile): boolean {
  if (!sameStrings(elementIds(expected.elements), elementIds(actual.elements))) {
    return false;
  }
  return Object.keys(expected.files).every((id) => id in actual.files);
}

/**
 * Resolve once `readScene` reports `scene` is actually on the canvas, or
 * `timeoutMs` elapses.
 *
 * A successful write only means the write was *dispatched*: the `drop` path
 * hands Excalidraw a `File` and returns, and the page reads and restores it
 * asynchronously. A caller that baselines smart sync immediately would capture
 * the *previous* drawing; when the applied scene later lands, the interval
 * re-detects it as an edit and debounce-saves without the user asking. Waiting
 * for the scene to become observable (the same lag `scheduleLocalRefresh` in
 * `app.ts` exists for) lets the create flow baseline at what is really on the
 * canvas. The timeout keeps a never-observable scene from stalling the caller.
 */
export async function waitForAppliedScene(
  scene: SceneFile,
  readScene: () => Promise<SceneFile>,
  options: {
    pollMs?: number;
    timeoutMs?: number;
    now?: () => number;
    delay?: (ms: number) => Promise<void>;
  } = {},
): Promise<void> {
  const pollMs = options.pollMs ?? 100;
  const timeoutMs = options.timeoutMs ?? 3000;
  const now = options.now ?? ((): number => Date.now());
  const delay =
    options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      if (sceneMatches(scene, await readScene())) return;
    } catch {
      // A failed read is treated as "not yet observable"; retry until the cap.
    }
    if (now() >= deadline) return;
    await delay(pollMs);
  }
}

/* ------------------------------ empty scene ------------------------------ */

/** The scene for a brand-new, genuinely empty board. */
export function createEmptyScene(origin: string): SceneFile {
  return buildScene([], {}, {}, origin);
}

/* ------------------------------ create guard ----------------------------- */

export interface CreateFlowInput {
  /** A board is currently open in the controller. */
  boardOpen: boolean;
  /** The controller reports unsaved changes (an open board's local edits). */
  dirty: boolean;
  /** The controller is in a conflict that must be resolved first. */
  conflicted: boolean;
  /** The live canvas holds elements that are not saved to any board. */
  hasLocalDrawing: boolean;
}

export type CreateFlowDecision =
  | { kind: "proceed" }
  | { kind: "blocked"; reason: "conflict" }
  | { kind: "confirm"; reason: "dirty-board" | "boardless-drawing" };

/**
 * Decide what a Create-board click must do before the canvas may be replaced.
 *
 * - A conflict blocks: it must be resolved before the canvas is replaced (the
 *   same rule the open-board guard already enforces).
 * - An open board with unsaved edits prompts — save or discard, never silent.
 * - A drawing on the canvas with no board open prompts too: it exists only in
 *   localStorage, creating a board would replace it, and it can never set
 *   `dirty`, so it must be checked for explicitly.
 * - Anything else opens an empty board directly.
 */
export function decideCreateFlow(input: CreateFlowInput): CreateFlowDecision {
  if (input.conflicted) return { kind: "blocked", reason: "conflict" };
  if (input.boardOpen && input.dirty) return { kind: "confirm", reason: "dirty-board" };
  if (!input.boardOpen && input.hasLocalDrawing) {
    return { kind: "confirm", reason: "boardless-drawing" };
  }
  return { kind: "proceed" };
}

/* ------------------------ create / switch sequencing --------------------- */

/** The live controller/smart-sync verbs the create and switch flows need. */
export interface BoardFlowDeps {
  /**
   * Capture the controller's full state (board, dirty flag and status) before
   * pointing it at the target, so a failed flow can roll back exactly.
   */
  snapshot(): SyncControllerState;
  /**
   * Point the controller at `board`, resetting its dirty flag and status (a
   * board is being opened, so it starts clean). A failed flow rolls back with
   * `restore(snapshot)`.
   */
  setBoard(board: BoardView | null): void;
  /**
   * Restore a state captured with `snapshot()` — board, dirty flag and status
   * together. Used to roll a failed create/switch back to the previous
   * selection without discarding the unsaved state or resetting its status
   * (which `setBoard` already cleared to open the target clean).
   */
  restore(snapshot: SyncControllerState): void;
  /**
   * Replace the live canvas with `scene`. `inPlaceOnly` routes only through
   * strategies that complete without navigating (see `strategyCompletesSwitch`),
   * which a board switch requires.
   */
  applyScene(scene: SceneFile, options?: ApplySceneOptions): Promise<void>;
  /**
   * Resolve once `scene` is actually observable on the live canvas (or the
   * wait caps out). `applyScene` may return before the async write has landed.
   */
  awaitSceneApplied(scene: SceneFile): Promise<void>;
  markDirty(): void;
  markSynced(): void;
}

/** Per-call routing for `applyScene`. */
export interface ApplySceneOptions {
  /**
   * Allow only strategies that complete in place (no `reload`). A board switch
   * sets this so it never navigates away and loses the in-memory selection.
   */
  inPlaceOnly?: boolean;
}

/**
 * Create `board` and open it empty.
 *
 * The controller is pointed at the new board *before* the canvas is cleared, so
 * a smart-sync tick during the clear attributes the empty scene to the new
 * board — never the drawing being left, which would otherwise be saved into the
 * new path. On failure the previous selection is restored (preserving its
 * dirty/status), so whatever is on screen is never attributed to the unopened
 * board.
 */
export async function applyBoardCreate(
  deps: BoardFlowDeps,
  board: BoardView,
  origin: string,
): Promise<void> {
  const previous = deps.snapshot();
  deps.setBoard(board);
  // Baseline at the pre-clear scene: a tick must not mistake the clear for an
  // edit of the outgoing board before the canvas write lands.
  deps.markSynced();
  const empty = createEmptyScene(origin);
  try {
    await deps.applyScene(empty);
  } catch (error) {
    deps.restore(previous);
    deps.markSynced();
    throw error;
  }
  // The new board is not on GitHub yet, so it is unsaved; its intended content
  // is the empty canvas, so its first save writes *that* to the new path.
  deps.markDirty();
  // Baseline smart sync only once the empty canvas has actually landed. The
  // write was merely dispatched above, so baselining now would capture the
  // *outgoing* drawing; when the empty scene then lands, smart sync would
  // re-detect it as an edit and debounce-save the new board without the user
  // choosing to. Waiting for it to become observable keeps the new board
  // unsaved until the user saves it, and nothing auto-saves.
  await deps.awaitSceneApplied(empty);
  deps.markSynced();
}

/**
 * Switch to `board`, applying its `scene`, with the controller pointed at the
 * target board around the write. `markSynced` runs only after the scene is
 * applied, so the switch itself is never re-detected as a local edit.
 *
 * The write is restricted to in-place strategies (`inPlaceOnly`): `reload`
 * navigates and would tear the content script down before the target selection
 * is adopted, leaving the drawing on screen with no board selected. On failure
 * the previous selection is restored (preserving its dirty/status).
 */
export async function applyBoardSwitch(
  deps: BoardFlowDeps,
  board: BoardView,
  scene: SceneFile,
): Promise<void> {
  const previous = deps.snapshot();
  // Point at the target board before the write: a tick during it must attribute
  // the incoming scene to the board being opened, never the one being left.
  deps.setBoard(board);
  try {
    await deps.applyScene(scene, { inPlaceOnly: true });
  } catch (error) {
    deps.restore(previous);
    deps.markSynced();
    throw error;
  }
  deps.markSynced();
}
