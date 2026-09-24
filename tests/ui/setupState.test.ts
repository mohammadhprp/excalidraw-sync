import { describe, expect, it } from "vitest";

import { setupState } from "../../src/ui/setupState";

describe("setupState", () => {
  it("reports everything missing when nothing is configured", () => {
    const state = setupState({ hasToken: false, owner: "", repo: "" });
    expect(state.configured).toBe(false);
    expect(state.missing).toEqual({ token: true, owner: true, repo: true });
    expect(state.missingLabels).toEqual(["a GitHub token", "an owner", "a repository"]);
    expect(state.count).toBe(3);
  });

  it("lists only the missing pieces, in token/owner/repo order", () => {
    expect(setupState({ hasToken: true, owner: "", repo: "boards" }).missingLabels).toEqual([
      "an owner",
    ]);
    expect(setupState({ hasToken: false, owner: "acme", repo: "boards" }).missingLabels).toEqual([
      "a GitHub token",
    ]);
    expect(setupState({ hasToken: true, owner: "acme", repo: "" }).missingLabels).toEqual([
      "a repository",
    ]);
  });

  it("treats whitespace-only values as missing", () => {
    const state = setupState({ hasToken: true, owner: "   ", repo: "  " });
    expect(state.configured).toBe(false);
    expect(state.missingLabels).toEqual(["an owner", "a repository"]);
  });

  it("is configured with no missing labels once all three are present", () => {
    const state = setupState({ hasToken: true, owner: "acme", repo: "boards" });
    expect(state.configured).toBe(true);
    expect(state.missingLabels).toEqual([]);
    expect(state.count).toBe(0);
  });
});
