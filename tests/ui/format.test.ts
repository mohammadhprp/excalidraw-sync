import { describe, expect, it } from "vitest";

import {
  buildSettingsPatch,
  formatBoardTarget,
  headerStatus,
  headerStatusText,
  headerTone,
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
