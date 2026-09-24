import { describe, expect, it } from "vitest";

import { computeSceneHash, fnv1a } from "../../src/content/hash";

describe("fnv1a", () => {
  it("matches the FNV-1a offset basis for the empty string", () => {
    expect(fnv1a("")).toBe("811c9dc5");
  });

  it("is deterministic and sensitive to input", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });
});

describe("computeSceneHash", () => {
  it("changes when elements change", () => {
    expect(computeSceneHash("[1]", "{}")).not.toBe(computeSceneHash("[2]", "{}"));
  });

  it("changes when appState changes", () => {
    expect(computeSceneHash("[1]", "{}")).not.toBe(computeSceneHash("[1]", '{"a":1}'));
  });

  it("treats null as empty", () => {
    expect(computeSceneHash(null, null)).toBe(computeSceneHash("", ""));
  });
});
