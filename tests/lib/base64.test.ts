import { describe, expect, it } from "vitest";

import { decodeBase64Utf8, encodeBase64Utf8 } from "../../src/lib/base64";

describe("base64 helpers", () => {
  it("round-trips UTF-8 including non-ASCII characters", () => {
    const input = '{"text":"héllo — 世界 🎨","emoji":"✅"}';
    expect(decodeBase64Utf8(encodeBase64Utf8(input))).toBe(input);
  });

  it("decodes GitHub's whitespace-wrapped base64", () => {
    const encoded = encodeBase64Utf8("hello");
    const wrapped = `${encoded.slice(0, 4)}\n${encoded.slice(4)}`;
    expect(decodeBase64Utf8(wrapped)).toBe("hello");
  });
});
