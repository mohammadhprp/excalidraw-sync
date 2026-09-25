/**
 * Conflict-aware sync state machine — pure, no DOM, no `chrome`.
 *
 * Wraps the frozen `github:saveBoard` / `github:readBoard` protocol and owns the
 * "never silently overwrite" rule:
 *
 *  - a `conflict` outcome only sets status and leaves `dirty` set; it performs
 *    no further write,
 *  - `keepLocal()` re-saves with `baseSha = remoteSha` (which matches the
 *    remote, so the PUT proceeds and overwrites it with the local scene),
 *  - `keepRemote()` reads the remote board, hands it to `applyScene`, and
 *    adopts `remoteSha` as the new base.
 */

import type { BoardRef, Req, Res, SceneFile, SyncOutcome } from "../lib";

export type SyncStatus =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "synced"; at: number }
  | { kind: "conflict"; remoteSha: string; baseSha: string | null }
  | { kind: "error"; message: string };

/** The board the panel is currently working against. */
export interface BoardView {
  collection: string;
  name: string;
  path: string;
  sha: string | null;
}

export interface SyncControllerState {
  status: SyncStatus;
  board: BoardView | null;
  dirty: boolean;
}

export interface SyncControllerDeps {
  /** `chrome.runtime.sendMessage` wrapper (see `messaging.ts`). */
  send: <T>(req: Req) => Promise<Res<T>>;
  /** Read the live scene from localStorage + IndexedDB. */
  readScene: () => Promise<SceneFile>;
  /** Replace the live canvas with `scene`. */
  applyScene: (scene: SceneFile) => Promise<void>;
  /** Called on every state change so the view can re-render. */
  onChange: (state: SyncControllerState) => void;
  now?: () => number;
}

export interface SyncController {
  state(): SyncControllerState;
  /**
   * Capture the full state (board, dirty flag and status) so a failed
   * create/switch can be rolled back exactly. `setBoard` resets dirty/status
   * when the flow points at the target, so the board pointer alone cannot
   * restore the selection's unsaved state.
   */
  snapshot(): SyncControllerState;
  setBoard(board: BoardView | null): void;
  /**
   * Restore a state captured with `snapshot()` — board, dirty flag and status
   * together. Unlike `setBoard` (which opens a board clean), this puts the
   * previous selection back without silently marking its unsaved work saved or
   * resetting its status.
   */
  restore(snapshot: SyncControllerState): void;
  markDirty(): void;
  save(): Promise<void>;
  keepLocal(): Promise<void>;
  keepRemote(): Promise<void>;
  reloadFromRemote(): Promise<void>;
}

export function createSyncController(deps: SyncControllerDeps): SyncController {
  const now = deps.now ?? ((): number => Date.now());
  let state: SyncControllerState = {
    status: { kind: "idle" },
    board: null,
    dirty: false,
  };

  function set(patch: Partial<SyncControllerState>): void {
    state = { ...state, ...patch };
    deps.onChange(state);
  }

  /** Shared PUT path; `baseSha` is the concurrency token sent to GitHub. */
  async function performSave(
    scene: SceneFile,
    baseSha: string | null,
  ): Promise<void> {
    const board = state.board;
    if (!board) {
      set({ status: { kind: "error", message: "No board selected." } });
      return;
    }

    set({ status: { kind: "syncing" } });
    const res = await deps.send<SyncOutcome>({
      type: "github:saveBoard",
      path: board.path,
      scene,
      baseSha,
    });

    if (!res.ok) {
      set({ status: { kind: "error", message: res.error } });
      return;
    }

    const outcome = res.data;
    switch (outcome.status) {
      case "created":
      case "updated":
        set({
          status: { kind: "synced", at: now() },
          dirty: false,
          board: { ...board, sha: outcome.sha },
        });
        return;
      case "unchanged":
        set({
          status: { kind: "synced", at: now() },
          dirty: false,
          board: { ...board, sha: outcome.sha ?? board.sha },
        });
        return;
      case "conflict":
        // Do NOT push. Surface the conflict; the user chooses.
        set({
          status: {
            kind: "conflict",
            remoteSha: outcome.remoteSha,
            baseSha: outcome.baseSha,
          },
          dirty: true,
        });
        return;
    }
  }

  async function save(): Promise<void> {
    const scene = await deps.readScene();
    await performSave(scene, state.board?.sha ?? null);
  }

  async function keepLocal(): Promise<void> {
    if (state.status.kind !== "conflict") return;
    const remoteSha = state.status.remoteSha;
    const scene = await deps.readScene();
    // baseSha = remoteSha matches the remote, so this PUT overwrites it.
    await performSave(scene, remoteSha || null);
  }

  async function keepRemote(): Promise<void> {
    if (state.status.kind !== "conflict" || !state.board) return;
    const remoteSha = state.status.remoteSha;
    const board = state.board;

    set({ status: { kind: "syncing" } });
    const res = await deps.send<SceneFile>({
      type: "github:readBoard",
      path: board.path,
    });
    if (!res.ok) {
      set({ status: { kind: "error", message: res.error } });
      return;
    }

    try {
      await deps.applyScene(res.data);
    } catch (error) {
      // The canvas could not be replaced with the remote scene. Do not adopt
      // the remote sha: nothing was actually applied, so the local scene stays
      // the base for the next save.
      set({
        status: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }
    set({
      status: { kind: "synced", at: now() },
      dirty: false,
      board: { ...board, sha: remoteSha || null },
    });
  }

  async function reloadFromRemote(): Promise<void> {
    const board = state.board;
    if (!board) {
      set({ status: { kind: "error", message: "No board selected." } });
      return;
    }
    set({ status: { kind: "syncing" } });
    const res = await deps.send<SceneFile>({
      type: "github:readBoard",
      path: board.path,
    });
    if (!res.ok) {
      set({ status: { kind: "error", message: res.error } });
      return;
    }
    try {
      await deps.applyScene(res.data);
    } catch (error) {
      // Nothing was applied, so keep the current base sha rather than letting a
      // later save treat the (unreplaced) local scene as matching the remote.
      set({
        status: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    // Refresh the concurrency token. `github:readBoard` returns only a
    // SceneFile, so re-list the collection and adopt the matching board's sha.
    // Without this, a save right after a remote reload would report a false
    // conflict (local scene == remote scene, but baseSha stale).
    let sha = board.sha;
    const listing = await deps.send<BoardRef[]>({
      type: "github:listBoards",
      collection: board.collection,
    });
    if (listing.ok) {
      const match = listing.data.find((item) => item.path === board.path);
      if (match) sha = match.sha;
    }

    set({ status: { kind: "synced", at: now() }, dirty: false, board: { ...board, sha } });
  }

  return {
    state: () => state,
    snapshot: () => ({ ...state }),
    setBoard: (board) =>
      set({ board, status: { kind: "idle" }, dirty: false }),
    // Roll a failed create/switch back to the previous selection exactly: the
    // captured board, dirty flag and status. `setBoard` cleared dirty/status
    // when the flow pointed at the target, so restoring only the board would
    // mark the previous board's unsaved work clean and reset its status. `set`
    // still emits `onChange`, so the panel re-renders against the restored state.
    restore: (snapshot) =>
      set({ board: snapshot.board, status: snapshot.status, dirty: snapshot.dirty }),
    markDirty: () => {
      // A document with no board has nothing to save, so it must never become
      // dirty: `save()` can only set an error without a board and could never
      // clear `dirty`, which would strand the unsaved-changes guard. Smart sync
      // calls this on every local scene change, including with no board open.
      if (!state.board) return;
      if (!state.dirty) set({ dirty: true });
    },
    save,
    keepLocal,
    keepRemote,
    reloadFromRemote,
  };
}
