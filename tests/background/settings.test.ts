import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../../src/lib/defaults";
import {
  createMemorySettingsStore,
  mergeSettings,
  toPublicSettings,
} from "../../src/background/settings";

describe("mergeSettings", () => {
  it("merges a patch and deep-merges the author identity", () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      owner: "acme",
      author: { name: "Ada", email: "ada@example.com" },
    });
    expect(next.owner).toBe("acme");
    expect(next.author).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(next.rootPath).toBe("excalidraw");
    expect(next.smartSync).toBe(true);
  });
});

describe("toPublicSettings", () => {
  it("replaces the token with a hasToken boolean", () => {
    const publicSettings = toPublicSettings({ ...DEFAULT_SETTINGS, token: "ghp_secret" });
    expect(publicSettings.hasToken).toBe(true);
    expect(publicSettings).not.toHaveProperty("token");
    expect(JSON.stringify(publicSettings)).not.toContain("ghp_secret");
  });

  it("reports hasToken false for an empty or missing token", () => {
    expect(toPublicSettings({ ...DEFAULT_SETTINGS, token: null }).hasToken).toBe(false);
    expect(toPublicSettings({ ...DEFAULT_SETTINGS, token: "" }).hasToken).toBe(false);
  });
});

describe("createMemorySettingsStore", () => {
  it("returns defaults, applies patches, and does not mutate callers", async () => {
    const store = createMemorySettingsStore();
    const first = await store.get();
    expect(first.owner).toBe("");

    const second = await store.set({ owner: "acme", token: "secret" });
    expect(second.owner).toBe("acme");

    const third = await store.get();
    expect(third.token).toBe("secret");
    // Mutating a returned object must not affect the store.
    third.owner = "tampered";
    expect((await store.get()).owner).toBe("acme");
  });
});
