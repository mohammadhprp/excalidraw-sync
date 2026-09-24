import { describe, expect, it } from "vitest";

import {
  buildSettingsPatch,
  formatBoardTarget,
  headerStatus,
  headerStatusText,
  headerTone,
  reconcileField,
  resolveAdoptedBranch,
  shortSha,
  statusLabel,
  statusTone,
  type SettingsFormValues,
} from "../../src/ui/format";

const values: SettingsFormValues = {
  owner: "  acme  ",
  repo: " boards ",
  branch: " ",
  rootPath: " ",
  commitMessageTemplate: "sync {board}",
  authorName: "  Ada  ",
  authorEmail: " ada@example.com ",
  smartSync: true,
  smartSyncDelayMs: 1234.6,
};

describe("statusTone", () => {
  it("is grey when not configured and red on error/conflict", () => {
    expect(statusTone({ configured: false, status: { kind: "idle" }, dirty: false })).toBe("grey");
    expect(statusTone({ configured: true, status: { kind: "error", message: "x" }, dirty: false })).toBe("red");
    expect(
      statusTone({ configured: true, status: { kind: "conflict", remoteSha: "a", baseSha: null }, dirty: true }),
    ).toBe("red");
  });

  it("is amber while dirty or syncing, green once clean", () => {
    expect(statusTone({ configured: true, status: { kind: "idle" }, dirty: true })).toBe("amber");
    expect(statusTone({ configured: true, status: { kind: "syncing" }, dirty: false })).toBe("amber");
    expect(statusTone({ configured: true, status: { kind: "synced", at: 0 }, dirty: false })).toBe("green");
  });
});

describe("statusLabel", () => {
  it("formats each status kind", () => {
    expect(statusLabel({ kind: "idle" })).toBe("Idle");
    expect(statusLabel({ kind: "syncing" })).toBe("Syncing…");
    expect(statusLabel({ kind: "conflict", remoteSha: "a", baseSha: null })).toBe("Conflict");
    expect(statusLabel({ kind: "error", message: "boom" })).toBe("Error: boom");
    const at = new Date(2026, 0, 1, 9, 5).getTime();
    expect(statusLabel({ kind: "synced", at })).toBe("Synced 09:05");
  });
});

describe("board formatting", () => {
  it("names the board target", () => {
    expect(formatBoardTarget(null)).toBe("No board selected");
    expect(
      formatBoardTarget({ collection: "design", name: "flow", path: "x", sha: null }),
    ).toBe("design/flow");
  });

  it("shortens shas", () => {
    expect(shortSha(null)).toBe("not synced");
    expect(shortSha("abcdef1234567890")).toBe("abcdef1");
  });
});

describe("header status", () => {
  it("prioritises unconfigured > error > conflict > syncing > dirty > synced", () => {
    expect(headerStatus({ configured: false, status: { kind: "error", message: "x" }, dirty: true })).toBe(
      "unconfigured",
    );
    expect(headerStatus({ configured: true, status: { kind: "error", message: "x" }, dirty: false })).toBe("error");
    expect(
      headerStatus({ configured: true, status: { kind: "conflict", remoteSha: "a", baseSha: null }, dirty: true }),
    ).toBe("conflict");
    expect(headerStatus({ configured: true, status: { kind: "syncing" }, dirty: true })).toBe("syncing");
    expect(headerStatus({ configured: true, status: { kind: "idle" }, dirty: true })).toBe("dirty");
    expect(headerStatus({ configured: true, status: { kind: "idle" }, dirty: false })).toBe("synced");
  });

  it("maps statuses to labels and tones", () => {
    expect(headerStatusText("synced")).toBe("Synced");
    expect(headerStatusText("dirty")).toBe("Unsaved changes");
    expect(headerStatusText("syncing")).toBe("Syncing…");
    expect(headerStatusText("conflict")).toBe("Conflict");
    expect(headerStatusText("error")).toBe("Error");
    expect(headerStatusText("unconfigured")).toBe("Not configured");

    expect(headerTone("synced")).toBe("green");
    expect(headerTone("dirty")).toBe("amber");
    expect(headerTone("syncing")).toBe("amber");
    expect(headerTone("conflict")).toBe("red");
    expect(headerTone("error")).toBe("red");
    expect(headerTone("unconfigured")).toBe("grey");
  });
});

describe("resolveAdoptedBranch", () => {
  it("adopts the repository default when the configured branch is the built-in default", () => {
    const result = resolveAdoptedBranch({
      configuredBranch: "main",
      defaultBranch: "master",
    });
    expect(result).toEqual({
      branch: "master",
      adopted: true,
      notice: "Using repository default branch: master",
    });
  });

  it("adopts the repository default when the configured branch is empty", () => {
    expect(
      resolveAdoptedBranch({ configuredBranch: "   ", defaultBranch: "master" }),
    ).toMatchObject({ branch: "master", adopted: true });
  });

  it("NEVER overrides a branch the user deliberately typed", () => {
    expect(
      resolveAdoptedBranch({ configuredBranch: "develop", defaultBranch: "master" }),
    ).toEqual({ branch: "develop", adopted: false, notice: null });
  });

  it("makes no change when the repo default equals the branch in effect", () => {
    expect(
      resolveAdoptedBranch({ configuredBranch: "main", defaultBranch: "main" }),
    ).toEqual({ branch: "main", adopted: false, notice: null });
    expect(
      resolveAdoptedBranch({ configuredBranch: "main", defaultBranch: "" }),
    ).toEqual({ branch: "main", adopted: false, notice: null });
  });

  it("honours a custom built-in default", () => {
    expect(
      resolveAdoptedBranch({
        configuredBranch: "trunk",
        defaultBranch: "master",
        builtInDefault: "trunk",
      }),
    ).toMatchObject({ branch: "master", adopted: true });
  });
});

describe("reconcileField", () => {
  it("keeps the typed text while the field is focused, even if persisted differs", () => {
    expect(
      reconcileField({ persisted: "master", displayed: "develop", editing: true, edited: true }),
    ).toEqual({ value: "develop", edited: true });
  });

  it("keeps an unconfirmed edit when the field is momentarily unfocused (the save-render window)", () => {
    // A render runs after the Save click blurred the field but before the async
    // settings:set resolved; the stale persisted value must not win.
    expect(
      reconcileField({ persisted: "master", displayed: "develop", editing: false, edited: true }),
    ).toEqual({ value: "develop", edited: true });
  });

  it("adopts the persisted value for an untouched field", () => {
    expect(
      reconcileField({ persisted: "master", displayed: "", editing: false, edited: false }),
    ).toEqual({ value: "master", edited: false });
  });

  it("never overwrites a focused field's text with the persisted value", () => {
    expect(
      reconcileField({ persisted: "master", displayed: "", editing: true, edited: false }),
    ).toEqual({ value: "", edited: false });
  });

  it("re-converges and clears the edit marker once a submit confirms the value", () => {
    expect(
      reconcileField({ persisted: "develop", displayed: "develop", editing: false, edited: true }),
    ).toEqual({ value: "develop", edited: false });
  });
});

describe("buildSettingsPatch", () => {
  it("trims values and applies defaults", () => {
    expect(buildSettingsPatch(values)).toEqual({
      owner: "acme",
      repo: "boards",
      branch: "main",
      rootPath: "excalidraw",
      commitMessageTemplate: "sync {board}",
      author: { name: "Ada", email: "ada@example.com" },
      smartSync: true,
      smartSyncDelayMs: 1235,
    });
  });

  it("NEVER includes a token key", () => {
    const patch = buildSettingsPatch(values);
    expect("token" in patch).toBe(false);
    expect(JSON.stringify(patch)).not.toContain("token");
  });
});
