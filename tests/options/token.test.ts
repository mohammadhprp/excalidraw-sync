import { describe, expect, it } from "vitest";

import { buildTokenPatch } from "../../src/options/token";

describe("buildTokenPatch", () => {
  it("returns null for empty input", () => {
    expect(buildTokenPatch("")).toBeNull();
    expect(buildTokenPatch("   ")).toBeNull();
  });

  it("returns a token-only patch for non-empty input", () => {
    expect(buildTokenPatch("  ghp_secret  ")).toEqual({ token: "ghp_secret" });
  });
});
