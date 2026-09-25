import { describe, expect, it, vi } from "vitest";

import type { SceneFile } from "../../src/lib";
import type { BoardView, SyncControllerState } from "../../src/content/syncController";
import {
  applyBoardCreate,
  applyBoardSwitch,
  createEmptyScene,
  decideCreateFlow,
  missingParts,
  sceneMatches,
  strategyCarriedParts,
  strategyCompletesSwitch,
  strategyFullyApplies,
  waitForAppliedScene,
  type BoardFlowDeps,
} from "../../src/content/boardFlow";
import { runWriteStrategies, type WriteTarget } from "../../src/content/write";

const origin = "https://excalidraw.com";

const oldBoard: BoardView = {
  collection: "design",
  name: "flow",
  path: "excalidraw/design/flow.excalidraw",
  sha: "s1",
};

const newBoard: BoardView = {
  collection: "design",
  name: "fresh",
  path: "excalidraw/design/fresh.excalidraw",
  sha: null,
};

function sceneWith(overrides: Partial<SceneFile> = {}): SceneFile {
  return {
    type: "excalidraw",
    version: 2,
    source: origin,
    elements: [{ id: "a" }],
    appState: {},
    files: {},
    ...overrides,
  };
}

describe("createEmptyScene", () => {
  it("is a valid, genuinely empty drawing", () => {
    expect(createEmptyScene(origin)).toEqual({
      type: "excalidraw",
      version: 2,
      source: origin,
      elements: [],
      appState: {},
      files: {},
    });
  });
});

describe("decideCreateFlow", () => {
  it("proceeds when nothing is open and the canvas is empty", () => {
    expect(
      decideCreateFlow({
        boardOpen: false,
        dirty: false,
        conflicted: false,
        hasLocalDrawing: false,
      }),
    ).toEqual({ kind: "proceed" });
  });

  it("proceeds when an open board has no unsaved changes", () => {
    expect(
      decideCreateFlow({
        boardOpen: true,
        dirty: false,
        conflicted: false,
        hasLocalDrawing: true,
      }),
    ).toEqual({ kind: "proceed" });
  });

  it("prompts for an open board with unsaved changes", () => {
    expect(
      decideCreateFlow({
        boardOpen: true,
        dirty: true,
        conflicted: false,
        hasLocalDrawing: true,
      }),
    ).toEqual({ kind: "confirm", reason: "dirty-board" });
  });

  it("prompts for a board-less drawing so it cannot be silently discarded", () => {
    expect(
      decideCreateFlow({
        boardOpen: false,
        dirty: false,
        conflicted: false,
        hasLocalDrawing: true,
      }),
    ).toEqual({ kind: "confirm", reason: "boardless-drawing" });
  });

  it("blocks while a conflict must be resolved, ahead of every prompt", () => {
    expect(
      decideCreateFlow({
        boardOpen: true,
        dirty: true,
        conflicted: true,
        hasLocalDrawing: true,
      }),
    ).toEqual({ kind: "blocked", reason: "conflict" });
    expect(
      decideCreateFlow({
        boardOpen: false,
        dirty: false,
        conflicted: true,
        hasLocalDrawing: true,
      }),
    ).toEqual({ kind: "blocked", reason: "conflict" });
  });
});

describe("strategy capability", () => {
  it("drop carries every part", () => {
    expect(strategyCarriedParts("drop")).toEqual(["elements", "appState", "files"]);
    expect(strategyFullyApplies("drop", sceneWith({ appState: { theme: "light" } }))).toBe(true);
    expect(strategyFullyApplies("drop", sceneWith({ files: { f: {} } }))).toBe(true);
  });

  it("paste cannot carry appState", () => {
    expect(missingParts("paste", sceneWith())).toEqual([]);
    expect(missingParts("paste", sceneWith({ appState: { theme: "light" } }))).toEqual([
      "appState",
    ]);
  });

  it("paste carries files when appState is not needed", () => {
    expect(missingParts("paste", sceneWith({ files: { f: {} } }))).toEqual([]);
  });

  it("reload cannot carry files", () => {
    expect(missingParts("reload", sceneWith())).toEqual([]);
    expect(missingParts("reload", sceneWith({ files: { f: {} } }))).toEqual(["files"]);
  });

  it("a scene needing appState and files is carried only by drop", () => {
    const both = sceneWith({ appState: { theme: "light" }, files: { f: {} } });
    expect(strategyFullyApplies("drop", both)).toBe(true);
    expect(strategyFullyApplies("paste", both)).toBe(false);
    expect(strategyFullyApplies("reload", both)).toBe(false);
  });

  it("only drop/paste complete a switch; reload navigates away", () => {
    expect(strategyCompletesSwitch("drop")).toBe(true);
    expect(strategyCompletesSwitch("paste")).toBe(true);
    expect(strategyCompletesSwitch("reload")).toBe(false);
  });
});

describe("write-strategy routing with the capability predicate", () => {
  function fakeTarget(overrides: Partial<WriteTarget> = {}): WriteTarget {
    return {
      drop: vi.fn(async () => {}),
      paste: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("routes an appState scene through reload, never the appState-less paste", async () => {
    const scene = sceneWith({ appState: { theme: "light" } });
    const target = fakeTarget({
      drop: vi.fn(async () => {
        throw new Error("no container");
      }),
    });

    const result = await runWriteStrategies(target, scene, {
      allow: (strategy) => strategyFullyApplies(strategy, scene),
    });

    expect(result).toEqual({ strategy: "reload", ok: true });
    expect(target.paste).not.toHaveBeenCalled();
    expect(target.reload).toHaveBeenCalledWith(scene);
  });

  it("fails instead of applying a scene that only drop can carry", async () => {
    const scene = sceneWith({ appState: { theme: "light" }, files: { f: {} } });
    const target = fakeTarget({
      drop: vi.fn(async () => {
        throw new Error("no container");
      }),
    });

    const result = await runWriteStrategies(target, scene, {
      allow: (strategy) => strategyFullyApplies(strategy, scene),
    });

    expect(result.ok).toBe(false);
    expect(target.paste).not.toHaveBeenCalled();
    expect(target.reload).not.toHaveBeenCalled();
  });
});

describe("sceneMatches", () => {
  it("matches identical scenes regardless of element order", () => {
    const a = sceneWith({ elements: [{ id: "a" }, { id: "b" }] });
    const b = sceneWith({ elements: [{ id: "b" }, { id: "a" }] });
    expect(sceneMatches(a, b)).toBe(true);
  });

  it("does not match a different drawing", () => {
    expect(
      sceneMatches(sceneWith({ elements: [{ id: "a" }] }), sceneWith({ elements: [{ id: "z" }] })),
    ).toBe(false);
  });

  it("does not match a merged canvas that kept a stale element", () => {
    // The defect symptom: the previous board's element is still on screen.
    const requested = sceneWith({ elements: [{ id: "new" }] });
    const actual = sceneWith({ elements: [{ id: "new" }, { id: "old" }] });
    expect(sceneMatches(requested, actual)).toBe(false);
  });

  it("requires every expected image to be present on the canvas", () => {
    expect(sceneMatches(sceneWith({ files: { f: {} } }), sceneWith({ files: {} }))).toBe(false);
    expect(sceneMatches(sceneWith({ files: { f: {} } }), sceneWith({ files: { f: {} } }))).toBe(
      true,
    );
  });
});

describe("waitForAppliedScene", () => {
  it("resolves immediately when the scene is already observable", async () => {
    const target = createEmptyScene(origin);
    let delayed = false;
    await waitForAppliedScene(target, async () => target, {
      delay: async () => {
        delayed = true;
      },
    });
    expect(delayed).toBe(false);
  });

  it("resolves only once the scene becomes observable", async () => {
    const target = createEmptyScene(origin);
    const reads: SceneFile[] = [
      sceneWith({ elements: [{ id: "old" }] }),
      sceneWith({ elements: [{ id: "old" }] }),
      target,
    ];
    let index = 0;
    let clock = 0;
    const delays: number[] = [];

    await waitForAppliedScene(target, async () => reads[index++] ?? target, {
      pollMs: 10,
      timeoutMs: 1000,
      now: () => clock,
      delay: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
    });

    expect(index).toBe(3);
    expect(delays).toEqual([10, 10]);
  });

  it("stops polling at the timeout when the scene never lands", async () => {
    const target = createEmptyScene(origin);
    let reads = 0;
    let clock = 0;

    await waitForAppliedScene(
      target,
      async () => {
        reads += 1;
        return sceneWith({ elements: [{ id: "old" }] });
      },
      {
        pollMs: 100,
        timeoutMs: 300,
        now: () => clock,
        delay: async (ms) => {
          clock += ms;
        },
      },
    );

    expect(reads).toBe(4);
  });

  it("treats a failed read as not-yet-observable rather than throwing", async () => {
    const target = createEmptyScene(origin);
    let calls = 0;
    let clock = 0;

    await waitForAppliedScene(
      target,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("read failed");
        return target;
      },
      {
        pollMs: 10,
        timeoutMs: 1000,
        now: () => clock,
        delay: async (ms) => {
          clock += ms;
        },
      },
    );

    expect(calls).toBe(2);
  });
});

describe("applyBoardCreate", () => {
  it("points at the new board before clearing, applies an empty scene, then marks it dirty", async () => {
    const order: string[] = [];
    const applied: SceneFile[] = [];
    let current: BoardView | null = oldBoard;
    const deps: BoardFlowDeps = {
      snapshot: () => ({ board: current, status: { kind: "idle" }, dirty: false }),
      setBoard: (board) => {
        current = board;
        order.push(`setBoard:${board?.path ?? "null"}`);
      },
      restore: (snapshot) => {
        current = snapshot.board;
        order.push(`restore:${snapshot.board?.path ?? "null"}`);
      },
      applyScene: async (scene) => {
        applied.push(scene);
        order.push("applyScene");
      },
      awaitSceneApplied: async () => {
        order.push("awaitSceneApplied");
      },
      markDirty: () => order.push("markDirty"),
      markSynced: () => order.push("markSynced"),
    };

    await applyBoardCreate(deps, newBoard, origin);

    // `awaitSceneApplied` sits between marking dirty and the final baseline: the
    // baseline must observe the applied scene, not the outgoing drawing.
    expect(order).toEqual([
      `setBoard:${newBoard.path}`,
      "markSynced",
      "applyScene",
      "markDirty",
      "awaitSceneApplied",
      "markSynced",
    ]);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual(createEmptyScene(origin));
    // The drawing that was on screen is never written to the new board.
    expect(applied.some((scene) => scene.elements.length > 0)).toBe(false);
    expect(current).toEqual(newBoard);
  });

  it("baselines smart sync only after the applied scene is observable", async () => {
    // F1 regression pin: `drop` only dispatches, so the create flow must not
    // baseline until the empty scene has actually landed. Under the old timing
    // the final `markSynced` ran immediately after `markDirty`, while the canvas
    // still held the outgoing drawing.
    const order: string[] = [];
    let observable = false;
    let live: SceneFile = sceneWith({ elements: [{ id: "old" }] });
    let pending: SceneFile | null = null;
    const deps: BoardFlowDeps = {
      snapshot: () => ({ board: oldBoard, status: { kind: "idle" }, dirty: false }),
      setBoard: () => order.push("setBoard"),
      restore: () => order.push("restore"),
      applyScene: async (scene) => {
        // The write is dispatched but has not landed yet.
        order.push("applyScene");
        pending = scene;
      },
      awaitSceneApplied: async (scene) => {
        // Resolve only once the scene is actually on the canvas.
        order.push("awaitSceneApplied");
        live = pending ?? live;
        observable = sceneMatches(scene, live);
      },
      markDirty: () => order.push("markDirty"),
      markSynced: () => order.push(`markSynced:observable=${observable}`),
    };

    await applyBoardCreate(deps, newBoard, origin);

    expect(order).toEqual([
      "setBoard",
      // The pre-clear baseline is taken before the write, while the old
      // drawing is still observable.
      "markSynced:observable=false",
      "applyScene",
      "markDirty",
      "awaitSceneApplied",
      // The post-apply baseline observes the empty scene.
      "markSynced:observable=true",
    ]);
    expect(observable).toBe(true);
  });

  it("restores the previous selection's dirty flag and status when the clear fails", async () => {
    // `setBoard` points at the new board and clears dirty/status (it opens a
    // board clean), so the rollback must restore the captured snapshot exactly —
    // otherwise the previous board's unsaved work is silently marked saved (F3).
    const previous: SyncControllerState = {
      board: oldBoard,
      dirty: true,
      status: { kind: "conflict", remoteSha: "remote", baseSha: null },
    };
    let state: SyncControllerState = { ...previous };
    const setBoard = vi.fn((board: BoardView | null) => {
      state = { board, status: { kind: "idle" }, dirty: false };
    });
    const restore = vi.fn((snapshot: SyncControllerState) => {
      state = snapshot;
    });
    const markDirty = vi.fn();
    const markSynced = vi.fn();
    const deps: BoardFlowDeps = {
      snapshot: () => ({ ...state }),
      setBoard,
      restore,
      applyScene: async () => {
        throw new Error("all write strategies failed");
      },
      awaitSceneApplied: async () => {},
      markDirty,
      markSynced,
    };

    await expect(applyBoardCreate(deps, newBoard, origin)).rejects.toThrow(
      "all write strategies failed",
    );

    expect(setBoard).toHaveBeenCalledTimes(1);
    expect(setBoard).toHaveBeenCalledWith(newBoard);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(previous);
    expect(state.board).toEqual(oldBoard);
    expect(state.dirty).toBe(true);
    expect(state.status).toEqual({ kind: "conflict", remoteSha: "remote", baseSha: null });
    expect(markDirty).not.toHaveBeenCalled();
    expect(markSynced).toHaveBeenCalled();
  });
});

describe("applyBoardSwitch", () => {
  it("points at the target board around the write and marks synced afterwards", async () => {
    const order: string[] = [];
    const selected = sceneWith({ elements: [{ id: "selected" }] });
    let current: BoardView | null = oldBoard;
    const applyScene = vi.fn(async (scene: SceneFile) => {
      // The controller must already point at the target when the scene lands.
      order.push(`applyScene:${current?.path === newBoard.path ? "target" : "previous"}`);
      expect(scene).toBe(selected);
    });
    const deps: BoardFlowDeps = {
      snapshot: () => ({ board: current, status: { kind: "idle" }, dirty: false }),
      setBoard: (board) => {
        current = board;
        order.push(`setBoard:${board?.path ?? "null"}`);
      },
      restore: (snapshot) => {
        current = snapshot.board;
        order.push(`restore:${snapshot.board?.path ?? "null"}`);
      },
      applyScene,
      awaitSceneApplied: vi.fn(async () => {}),
      markDirty: vi.fn(),
      markSynced: () => order.push("markSynced"),
    };

    await applyBoardSwitch(deps, newBoard, selected);

    expect(order).toEqual([`setBoard:${newBoard.path}`, "applyScene:target", "markSynced"]);
    expect(current).toEqual(newBoard);
    // A switch must only use in-place strategies so it never navigates away and
    // drops the just-adopted selection (F2).
    expect(applyScene).toHaveBeenCalledWith(selected, { inPlaceOnly: true });
  });

  it("never routes a switch through reload (the only strategy that navigates)", async () => {
    // A real remote board carries appState, so `paste` cannot carry it and
    // `reload` was the only fallback. Reload discards the selection, so a switch
    // must fail clearly instead (F2).
    const scene = sceneWith({ appState: { theme: "light" } });
    const target: WriteTarget = {
      drop: vi.fn(async () => {
        throw new Error("no container");
      }),
      paste: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
    };

    const result = await runWriteStrategies(target, scene, {
      allow: (strategy) => strategyFullyApplies(strategy, scene) && strategyCompletesSwitch(strategy),
    });

    expect(strategyCompletesSwitch("reload")).toBe(false);
    expect(result.ok).toBe(false);
    expect(target.paste).not.toHaveBeenCalled();
    expect(target.reload).not.toHaveBeenCalled();
  });

  it("restores the previous board's dirty flag/status when the write fails", async () => {
    // The switch points at the target (clearing dirty/status) before writing; a
    // failure must put the previous selection and its status back exactly (F3).
    const previous: SyncControllerState = {
      board: oldBoard,
      dirty: false,
      status: { kind: "synced", at: 1000 },
    };
    let state: SyncControllerState = { ...previous };
    const setBoard = vi.fn((board: BoardView | null) => {
      state = { board, status: { kind: "idle" }, dirty: false };
    });
    const restore = vi.fn((snapshot: SyncControllerState) => {
      state = snapshot;
    });
    const markSynced = vi.fn();
    const deps: BoardFlowDeps = {
      snapshot: () => ({ ...state }),
      setBoard,
      restore,
      applyScene: async () => {
        throw new Error("canvas write failed");
      },
      awaitSceneApplied: async () => {},
      markDirty: vi.fn(),
      markSynced,
    };

    await expect(applyBoardSwitch(deps, newBoard, sceneWith())).rejects.toThrow(
      "canvas write failed",
    );

    expect(setBoard).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(previous);
    expect(state.board).toEqual(oldBoard);
    expect(state.dirty).toBe(false);
    expect(state.status).toEqual({ kind: "synced", at: 1000 });
    expect(markSynced).toHaveBeenCalled();
  });
});
