import { describe, expect, it, vi } from "vitest";

import {
  assembleScene,
  buildScene,
  collectReferencedFileIds,
  parseAppState,
  parseElements,
  readScene,
  readTheme,
} from "../../src/content/scene";

const elements = [
  { id: "e1", type: "rectangle", x: 10, y: 20, width: 100, height: 50, version: 3 },
  { id: "e2", type: "image", fileId: "file-1", x: 0, y: 0 },
  { id: "e3", type: "image", fileId: "file-1", x: 0, y: 0 },
  { id: "e4", type: "text", x: 5, y: 5 },
];

const appState = { viewBackgroundColor: "#ffffff", gridSize: null, theme: "light" };

const files = {
  "file-1": {
    id: "file-1",
    mimeType: "image/png",
    dataURL: "data:image/png;base64,AAAA",
    created: 0,
    lastRetrieved: 0,
  },
};

describe("scene assembly", () => {
  it("assembles a valid SceneFile from raw fixtures + a files map", () => {
    const scene = assembleScene({
      origin: "https://excalidraw.com",
      elementsRaw: JSON.stringify(elements),
      appStateRaw: JSON.stringify(appState),
      files,
    });

    expect(scene).toEqual({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements,
      appState,
      files,
    });
  });

  it("degrades malformed storage to empty scene parts", () => {
    expect(parseElements("{not json")).toEqual([]);
    expect(parseElements('{"not":"an array"}')).toEqual([]);
    expect(parseElements(null)).toEqual([]);
    expect(parseAppState("[1,2,3]")).toEqual({});
    expect(parseAppState("nope")).toEqual({});
    expect(parseAppState(null)).toEqual({});
  });

  it("builds a scene from parsed pieces", () => {
    expect(buildScene([], { theme: "dark" }, {}, "https://excalidraw.com")).toEqual({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [],
      appState: { theme: "dark" },
      files: {},
    });
  });

  it("collects unique referenced fileIds only", () => {
    expect(collectReferencedFileIds(elements)).toEqual(["file-1"]);
    expect(collectReferencedFileIds([{ fileId: "" }, null, "x", 3])).toEqual([]);
  });
});

describe("readScene", () => {
  const storage = (map: Record<string, string>) => ({
    getItem: (key: string) => map[key] ?? null,
  });

  it("reads elements + appState and resolves referenced images", async () => {
    const readFiles = vi.fn(async () => files);
    const scene = await readScene(
      storage({ excalidraw: JSON.stringify(elements), "excalidraw-state": JSON.stringify(appState) }),
      "https://excalidraw.com",
      readFiles,
    );

    expect(readFiles).toHaveBeenCalledWith(["file-1"]);
    expect(scene.elements).toEqual(elements);
    expect(scene.appState).toEqual(appState);
    expect(scene.files).toEqual(files);
  });

  it("does not touch IndexedDB when nothing references a file", async () => {
    const readFiles = vi.fn(async () => ({}));
    await readScene(storage({ excalidraw: JSON.stringify([elements[0]]) }), "o", readFiles);
    expect(readFiles).not.toHaveBeenCalled();
  });

  it("degrades to no files when the image read fails", async () => {
    const readFiles = vi.fn(async () => {
      throw new Error("idb unavailable");
    });
    const scene = await readScene(
      storage({ excalidraw: JSON.stringify(elements) }),
      "o",
      readFiles,
    );
    expect(scene.files).toEqual({});
  });

  it("reads the panel theme", () => {
    expect(readTheme(storage({ "excalidraw-theme": "dark" }))).toBe("dark");
    expect(readTheme(storage({ "excalidraw-theme": "light" }))).toBe("light");
    expect(readTheme(storage({}))).toBe("light");
  });
});
