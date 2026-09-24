import { describe, expect, it } from "vitest";

import {
  BOARD_EXTENSION,
  FALLBACK_BOARD_SLUG,
  boardFilePath,
  joinPath,
  parseBoardPath,
  slugify,
} from "../../src/lib/paths";

describe("slugify", () => {
  it("lowercases and hyphenates display names", () => {
    expect(slugify("Design Flows!")).toBe("design-flows");
  });

  it("collapses separators and trims edges", () => {
    expect(slugify("  --Hello   World--  ")).toBe("hello-world");
  });

  it("preserves Unicode letters and digits instead of dropping them", () => {
    expect(slugify("世界")).toBe("世界");
    expect(slugify("نقشه من")).toBe("نقشه-من");
  });

  it("strips path separators, dots and leading dots", () => {
    expect(slugify("../../README")).toBe("readme");
    expect(slugify("a/b")).toBe("a-b");
    expect(slugify(".hidden")).toBe("hidden");
  });

  it("returns an empty string when nothing path-safe remains", () => {
    expect(slugify("..")).toBe("");
    expect(slugify(".")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("joinPath", () => {
  it("joins segments with a single slash and skips empties", () => {
    expect(joinPath("/excalidraw/", "", "design", "flow.excalidraw")).toBe(
      "excalidraw/design/flow.excalidraw",
    );
  });
});

describe("boardFilePath", () => {
  it("slugifies the board name and appends the extension", () => {
    expect(boardFilePath("excalidraw", "design", "Design Flow")).toBe(
      "excalidraw/design/design-flow.excalidraw",
    );
  });

  it("does not double the extension", () => {
    expect(boardFilePath("excalidraw", "design", "flow.excalidraw")).toBe(
      "excalidraw/design/flow.excalidraw",
    );
  });

  const prefix = "excalidraw/design/";

  it.each([
    "../../README.excalidraw",
    "a/b",
    "..",
    ".",
    ".hidden",
    "../../x",
    "",
  ])(
    "keeps the adversarial name %j inside <rootPath>/<collection>/",
    (name) => {
      const path = boardFilePath("excalidraw", "design", name);

      // Stays under the collection directory.
      expect(path.startsWith(prefix)).toBe(true);

      // No traversal or hidden segment survives.
      const segments = path.split("/");
      expect(segments).not.toContain("..");
      expect(segments).not.toContain(".");
      expect(path.endsWith(BOARD_EXTENSION)).toBe(true);

      // The resolved Contents URL (as `contentUrl` builds it, which normalizes
      // `..`) also stays inside the collection.
      const resolved = new URL(
        `https://api.github.com/repos/acme/boards/contents/${path}`,
      );
      expect(
        resolved.pathname.startsWith(`/repos/acme/boards/contents/${prefix}`),
      ).toBe(true);
    },
  );

  it("preserves a non-Latin name and round-trips it through parseBoardPath", () => {
    const path = boardFilePath("excalidraw", "design", "世界");
    expect(path).toBe("excalidraw/design/世界.excalidraw");
    expect(parseBoardPath(path).board).toBe("世界");

    const persian = boardFilePath("excalidraw", "design", "نقشه من");
    expect(persian).toBe("excalidraw/design/نقشه-من.excalidraw");
    expect(parseBoardPath(persian).board).toBe("نقشه-من");
  });

  it("falls back to a non-empty stem when the name sanitizes to nothing", () => {
    for (const name of ["..", ".", "", "..."]) {
      const path = boardFilePath("excalidraw", "design", name);
      expect(path).toBe(`excalidraw/design/${FALLBACK_BOARD_SLUG}.excalidraw`);
      expect(parseBoardPath(path).board).not.toBe("");
    }
  });
});

describe("parseBoardPath", () => {
  it("splits collection and board from the last two segments", () => {
    expect(parseBoardPath("nested/root/design/flow.excalidraw")).toEqual({
      collection: "design",
      file: "flow.excalidraw",
      board: "flow",
    });
  });
});
