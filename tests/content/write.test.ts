import { describe, expect, it, vi } from "vitest";

import type { SceneFile } from "../../src/lib";
import {
  buildClipboardText,
  runWriteStrategies,
  serializeScene,
  type WriteTarget,
} from "../../src/content/write";

const scene: SceneFile = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [{ id: "a" }],
  appState: { theme: "light" },
  files: { f: { id: "f" } },
};

function fakeTarget(overrides: Partial<WriteTarget> = {}): WriteTarget {
  return {
    drop: vi.fn(async () => {}),
    paste: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("scene serialization", () => {
  it("round-trips the SceneFile as JSON", () => {
    expect(JSON.parse(serializeScene(scene))).toEqual(scene);
  });

  it("builds the excalidraw/clipboard payload (elements + files only)", () => {
    expect(JSON.parse(buildClipboardText(scene))).toEqual({
      type: "excalidraw/clipboard",
      elements: scene.elements,
      files: scene.files,
    });
  });
});

describe("runWriteStrategies fallback order", () => {
  it("uses drop first and stops", async () => {
    const target = fakeTarget();
    const result = await runWriteStrategies(target, scene);
    expect(result).toEqual({ strategy: "drop", ok: true });
    expect(target.drop).toHaveBeenCalledWith(scene);
    expect(target.paste).not.toHaveBeenCalled();
    expect(target.reload).not.toHaveBeenCalled();
  });

  it("falls back to paste when drop throws", async () => {
    const target = fakeTarget({
      drop: vi.fn(async () => {
        throw new Error("no container");
      }),
    });
    const result = await runWriteStrategies(target, scene);
    expect(result).toEqual({ strategy: "paste", ok: true });
    expect(target.paste).toHaveBeenCalledWith(scene);
    expect(target.reload).not.toHaveBeenCalled();
  });

  it("falls back to reload when drop and paste throw", async () => {
    const target = fakeTarget({
      drop: vi.fn(async () => {
        throw new Error("no container");
      }),
      paste: vi.fn(async () => {
        throw new Error("paste guards failed");
      }),
    });
    const result = await runWriteStrategies(target, scene);
    expect(result).toEqual({ strategy: "reload", ok: true });
    expect(target.reload).toHaveBeenCalledWith(scene);
  });

  it("reports failure with the last error when every strategy throws", async () => {
    const target = fakeTarget({
      drop: vi.fn(async () => {
        throw new Error("drop failed");
      }),
      paste: vi.fn(async () => {
        throw new Error("paste failed");
      }),
      reload: vi.fn(async () => {
        throw new Error("reload failed");
      }),
    });
    const result = await runWriteStrategies(target, scene);
    expect(result).toEqual({ strategy: null, ok: false, error: "reload failed" });
  });
});

describe("runWriteStrategies allow option", () => {
  it("skips strategies the predicate rejects", async () => {
    const target = fakeTarget();
    const result = await runWriteStrategies(target, scene, {
      allow: (strategy) => strategy === "reload",
    });

    expect(result).toEqual({ strategy: "reload", ok: true });
    expect(target.drop).not.toHaveBeenCalled();
    expect(target.paste).not.toHaveBeenCalled();
    expect(target.reload).toHaveBeenCalledWith(scene);
  });

  it("reports the last allowed strategy's error when none can run", async () => {
    const target = fakeTarget({
      drop: vi.fn(async () => {
        throw new Error("drop failed");
      }),
    });
    const result = await runWriteStrategies(target, scene, {
      allow: (strategy) => strategy === "drop",
    });

    expect(result).toEqual({ strategy: null, ok: false, error: "drop failed" });
    expect(target.paste).not.toHaveBeenCalled();
    expect(target.reload).not.toHaveBeenCalled();
  });

  it("allows every strategy by default (unchanged fallback order)", async () => {
    const target = fakeTarget({
      drop: vi.fn(async () => {
        throw new Error("drop failed");
      }),
    });
    const result = await runWriteStrategies(target, scene);
    expect(result).toEqual({ strategy: "paste", ok: true });
  });
});
