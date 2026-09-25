import { describe, expect, it, vi } from "vitest";

import type { Req, Res, SceneFile } from "../../src/lib";
import {
  createSyncController,
  type SyncControllerDeps,
  type SyncControllerState,
} from "../../src/content/syncController";

const scene: SceneFile = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [{ id: "a" }],
  appState: {},
  files: {},
};

const board = {
  collection: "design",
  name: "flow",
  path: "excalidraw/design/flow.excalidraw",
  sha: null as string | null,
};

function make(sendImpl: (req: Req) => Promise<Res<unknown>>) {
  const send = vi.fn(sendImpl);
  const sendFn = send as unknown as SyncControllerDeps["send"];
  const readScene = vi.fn(async () => scene);
  const applyScene = vi.fn(async () => {});
  const states: SyncControllerState[] = [];
  const controller = createSyncController({
    send: sendFn,
    readScene,
    applyScene,
    onChange: (state) => states.push(state),
    now: () => 1000,
  });
  return { controller, send, readScene, applyScene, states };
}

const unexpected = async (): Promise<Res<unknown>> => ({ ok: false, error: "unexpected" });

describe("syncController.save", () => {
  it("reports created, records the new sha, and clears dirty", async () => {
    const { controller, send } = make(async (req) =>
      req.type === "github:saveBoard"
        ? { ok: true, data: { status: "created", sha: "s1", commit: "c1" } }
        : unexpected(),
    );

    controller.setBoard(board);
    controller.markDirty();
    await controller.save();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: "github:saveBoard",
      path: board.path,
      scene,
      baseSha: null,
    });
    expect(controller.state().status).toEqual({ kind: "synced", at: 1000 });
    expect(controller.state().board).toEqual({ ...board, sha: "s1" });
    expect(controller.state().dirty).toBe(false);
  });

  it("sends the current baseSha on update", async () => {
    const { controller, send } = make(async (req) =>
      req.type === "github:saveBoard"
        ? { ok: true, data: { status: "updated", sha: "s2", commit: "c2" } }
        : unexpected(),
    );

    controller.setBoard({ ...board, sha: "base" });
    await controller.save();

    expect(send).toHaveBeenCalledWith({
      type: "github:saveBoard",
      path: board.path,
      scene,
      baseSha: "base",
    });
  });

  it("treats unchanged as synced without changing the sha", async () => {
    const { controller } = make(async (req) =>
      req.type === "github:saveBoard"
        ? { ok: true, data: { status: "unchanged", sha: "same" } }
        : unexpected(),
    );

    controller.setBoard({ ...board, sha: "same" });
    await controller.save();

    expect(controller.state().status).toEqual({ kind: "synced", at: 1000 });
    expect(controller.state().board?.sha).toBe("same");
    expect(controller.state().dirty).toBe(false);
  });

  it("surfaces a conflict without any further write", async () => {
    let saveCalls = 0;
    const { controller, send } = make(async (req) => {
      if (req.type !== "github:saveBoard") return unexpected();
      saveCalls += 1;
      return {
        ok: true,
        data: { status: "conflict", remoteSha: "remote", baseSha: null },
      };
    });

    controller.setBoard(board);
    controller.markDirty();
    await controller.save();

    expect(saveCalls).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(controller.state().status).toEqual({
      kind: "conflict",
      remoteSha: "remote",
      baseSha: null,
    });
    expect(controller.state().dirty).toBe(true);
    expect(controller.state().board?.sha).toBeNull();
  });

  it("serializes a send error as an error status", async () => {
    const { controller } = make(async () => ({ ok: false, error: "boom" }));
    controller.setBoard(board);
    await controller.save();
    expect(controller.state().status).toEqual({ kind: "error", message: "boom" });
  });

  it("errors when no board is selected", async () => {
    const { controller } = make(unexpected);
    await controller.save();
    expect(controller.state().status).toEqual({
      kind: "error",
      message: "No board selected.",
    });
  });

  it("a local change with no board selected does not leave the document dirty", async () => {
    // Smart sync calls `markDirty()` on every local scene change. With no board
    // selected there is nothing to save, so the document must not become dirty:
    // `save()` can only set an error without a board and could never clear it,
    // stranding the unsaved-changes guard. See AGENTS/CONTEXT and the defect.
    const { controller } = make(unexpected);

    controller.markDirty();
    await controller.save();

    expect(controller.state().board).toBeNull();
    expect(controller.state().dirty).toBe(false);
    expect(controller.state().status).toEqual({
      kind: "error",
      message: "No board selected.",
    });
  });

  it("a freshly created board saves the empty scene to its own path", async () => {
    // The create flow clears the live canvas to an empty drawing and points the
    // controller at the new board. Its first save must target the new path with
    // that empty scene — never the drawing that was previously on screen.
    const empty: SceneFile = {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [],
      appState: {},
      files: {},
    };
    const fresh = {
      collection: "design",
      name: "fresh",
      path: "excalidraw/design/fresh.excalidraw",
      sha: null as string | null,
    };
    const send = vi.fn(async (req: Req) =>
      req.type === "github:saveBoard"
        ? { ok: true, data: { status: "created", sha: "new-sha", commit: "c" } }
        : unexpected(),
    );
    const controller = createSyncController({
      send: send as unknown as SyncControllerDeps["send"],
      readScene: async () => empty,
      applyScene: async () => {},
      onChange: () => {},
      now: () => 1000,
    });

    controller.setBoard(fresh);
    controller.markDirty();
    await controller.save();

    expect(send).toHaveBeenCalledWith({
      type: "github:saveBoard",
      path: fresh.path,
      scene: empty,
      baseSha: null,
    });
    expect(controller.state().board).toEqual({ ...fresh, sha: "new-sha" });
    expect(controller.state().dirty).toBe(false);
  });
});

describe("syncController conflict resolution", () => {
  it("keepLocal re-saves with baseSha = remoteSha (overwrites remote)", async () => {
    let saveCalls = 0;
    const { controller, send } = make(async (req) => {
      if (req.type !== "github:saveBoard") return unexpected();
      saveCalls += 1;
      return saveCalls === 1
        ? { ok: true, data: { status: "conflict", remoteSha: "remote", baseSha: null } }
        : { ok: true, data: { status: "updated", sha: "remote", commit: "c" } };
    });

    controller.setBoard(board);
    await controller.save();
    await controller.keepLocal();

    expect(saveCalls).toBe(2);
    expect(send).toHaveBeenLastCalledWith({
      type: "github:saveBoard",
      path: board.path,
      scene,
      baseSha: "remote",
    });
    expect(controller.state().status).toEqual({ kind: "synced", at: 1000 });
    expect(controller.state().board?.sha).toBe("remote");
    expect(controller.state().dirty).toBe(false);
  });

  it("keepRemote reads the path, applies it, and adopts remoteSha", async () => {
    const remoteScene: SceneFile = { ...scene, elements: [{ id: "remote" }] };
    const { controller, send, applyScene } = make(async (req) => {
      if (req.type === "github:saveBoard") {
        return { ok: true, data: { status: "conflict", remoteSha: "remote", baseSha: null } };
      }
      if (req.type === "github:readBoard") {
        return { ok: true, data: remoteScene };
      }
      return unexpected();
    });

    controller.setBoard(board);
    await controller.save();
    await controller.keepRemote();

    expect(send).toHaveBeenLastCalledWith({
      type: "github:readBoard",
      path: board.path,
    });
    expect(applyScene).toHaveBeenCalledWith(remoteScene);
    expect(controller.state().status).toEqual({ kind: "synced", at: 1000 });
    expect(controller.state().board?.sha).toBe("remote");
    expect(controller.state().dirty).toBe(false);
  });

  it("keepRemote surfaces a failed apply without adopting the sha", async () => {
    const remoteScene: SceneFile = { ...scene, elements: [{ id: "remote" }] };
    const { controller, applyScene } = make(async (req) => {
      if (req.type === "github:saveBoard") {
        return { ok: true, data: { status: "conflict", remoteSha: "remote", baseSha: null } };
      }
      if (req.type === "github:readBoard") {
        return { ok: true, data: remoteScene };
      }
      return unexpected();
    });
    applyScene.mockRejectedValueOnce(new Error("canvas write failed"));

    controller.setBoard(board);
    await controller.save();
    await controller.keepRemote();

    expect(controller.state().status).toEqual({
      kind: "error",
      message: "canvas write failed",
    });
    expect(controller.state().board?.sha).toBeNull();
  });

  it("reloadFromRemote surfaces a failed apply and keeps the base sha", async () => {
    const remoteScene: SceneFile = { ...scene, elements: [{ id: "remote" }] };
    const { controller, applyScene } = make(async (req) => {
      if (req.type === "github:readBoard") return { ok: true, data: remoteScene };
      return unexpected();
    });
    applyScene.mockRejectedValueOnce(new Error("canvas write failed"));

    controller.setBoard({ ...board, sha: "stale-sha" });
    await controller.reloadFromRemote();

    expect(controller.state().status).toEqual({
      kind: "error",
      message: "canvas write failed",
    });
    expect(controller.state().board?.sha).toBe("stale-sha");
  });

  it("reloadFromRemote refreshes board.sha from the collection listing", async () => {
    const remoteScene: SceneFile = { ...scene, elements: [{ id: "remote" }] };
    const { controller, send, applyScene } = make(async (req) => {
      if (req.type === "github:readBoard") return { ok: true, data: remoteScene };
      if (req.type === "github:listBoards") {
        return {
          ok: true,
          data: [{ collection: "design", name: "flow", path: board.path, sha: "fresh-sha" }],
        };
      }
      return unexpected();
    });

    controller.setBoard({ ...board, sha: "stale-sha" });
    await controller.reloadFromRemote();

    expect(send).toHaveBeenNthCalledWith(1, {
      type: "github:readBoard",
      path: board.path,
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      type: "github:listBoards",
      collection: "design",
    });
    expect(applyScene).toHaveBeenCalledWith(remoteScene);
    expect(controller.state().board?.sha).toBe("fresh-sha");
    expect(controller.state().dirty).toBe(false);
    expect(controller.state().status.kind).toBe("synced");
  });

  it("reloadFromRemote keeps the previous sha when the listing is unavailable", async () => {
    const { controller } = make(async (req) => {
      if (req.type === "github:readBoard") return { ok: true, data: scene };
      if (req.type === "github:listBoards") return { ok: false, error: "listing failed" };
      return unexpected();
    });

    controller.setBoard({ ...board, sha: "stale-sha" });
    await controller.reloadFromRemote();

    expect(controller.state().board?.sha).toBe("stale-sha");
    expect(controller.state().dirty).toBe(false);
  });

  it("keepLocal/keepRemote are no-ops when not in conflict", async () => {
    const { controller, send } = make(async (req) =>
      req.type === "github:saveBoard"
        ? { ok: true, data: { status: "created", sha: "s", commit: "c" } }
        : unexpected(),
    );
    controller.setBoard(board);
    await controller.save();
    const callsAfterSave = send.mock.calls.length;

    await controller.keepLocal();
    await controller.keepRemote();
    expect(send.mock.calls.length).toBe(callsAfterSave);
  });
});

describe("syncController.snapshot/restore", () => {
  it("restores a dirty conflict exactly after an intervening setBoard", async () => {
    // A failed create/switch rolls back with `restore`. The flow calls
    // `setBoard(target)` first, which clears dirty/status, so the snapshot must
    // carry the previous board's dirty flag and status *across* that reset —
    // otherwise the rollback silently marks the unsaved work saved (F3).
    const { controller } = make(async (req) =>
      req.type === "github:saveBoard"
        ? { ok: true, data: { status: "conflict", remoteSha: "remote", baseSha: null } }
        : unexpected(),
    );

    controller.setBoard(board);
    controller.markDirty();
    await controller.save();
    const snapshot = controller.snapshot();
    expect(snapshot.dirty).toBe(true);

    // Pointing at the target for a write clears dirty/status.
    controller.setBoard({
      ...board,
      name: "other",
      path: "excalidraw/design/other.excalidraw",
    });
    expect(controller.state().dirty).toBe(false);
    expect(controller.state().status).toEqual({ kind: "idle" });

    controller.restore(snapshot);

    expect(controller.state().board).toEqual(board);
    expect(controller.state().dirty).toBe(true);
    expect(controller.state().status).toEqual({
      kind: "conflict",
      remoteSha: "remote",
      baseSha: null,
    });
  });

  it("keeps a synced status when rolling a failed switch back", async () => {
    const { controller } = make(async (req) =>
      req.type === "github:saveBoard"
        ? { ok: true, data: { status: "created", sha: "s1", commit: "c" } }
        : unexpected(),
    );

    controller.setBoard(board);
    await controller.save();
    const snapshot = controller.snapshot();
    expect(controller.state().status).toEqual({ kind: "synced", at: 1000 });

    controller.setBoard({
      ...board,
      name: "other",
      path: "excalidraw/design/other.excalidraw",
    });
    controller.restore(snapshot);

    expect(controller.state().board).toEqual({ ...board, sha: "s1" });
    expect(controller.state().status).toEqual({ kind: "synced", at: 1000 });
    expect(controller.state().dirty).toBe(false);
  });
});
