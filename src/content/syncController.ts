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
  setBoard(board: BoardView | null): void;
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

    await deps.applyScene(res.data);
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
    await deps.applyScene(res.data);

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
    setBoard: (board) =>
      set({ board, status: { kind: "idle" }, dirty: false }),
    markDirty: () => {
      if (!state.dirty) set({ dirty: true });
    },
    save,
    keepLocal,
    keepRemote,
    reloadFromRemote,
  };
}
