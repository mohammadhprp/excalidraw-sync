import { describe, expect, it } from "vitest";

import type { Collection } from "../../src/lib";
import type { BoardView } from "../../src/content/syncController";
import { reconcileCollectionsView } from "../../src/content/collectionRefresh";

const board: BoardView = {
  collection: "design",
  name: "flow",
  path: "excalidraw/design/flow.excalidraw",
  sha: "s1",
};

const collections: Collection[] = [
  { slug: "design", name: "Design", boards: [board] },
  { slug: "work", name: "Work", boards: [] },
];

describe("reconcileCollectionsView", () => {
  it("adopts the refreshed listing while preserving the expanded and active collections", () => {
    const view = reconcileCollectionsView(
      { expandedCollection: "work", activeCollection: "design", board },
      collections,
    );

    expect(view.collections).toBe(collections);
    expect(view.expandedCollection).toBe("work");
    expect(view.activeCollection).toBe("design");
  });

  it("drops an expanded collection that no longer exists and falls back to the first active", () => {
    const view = reconcileCollectionsView(
      { expandedCollection: "gone", activeCollection: "gone", board: null },
      collections,
    );

    expect(view.expandedCollection).toBeNull();
    expect(view.activeCollection).toBe("design");
  });

  it("preserves the open board's path through a refresh", () => {
    const view = reconcileCollectionsView(
      { expandedCollection: "design", activeCollection: "design", board },
      collections,
    );

    expect(view.board).toBe(board);
    expect(view.board?.path).toBe("excalidraw/design/flow.excalidraw");
  });

  it("handles an empty refreshed listing", () => {
    const view = reconcileCollectionsView(
      { expandedCollection: "design", activeCollection: "design", board },
      [],
    );

    expect(view.collections).toEqual([]);
    expect(view.expandedCollection).toBeNull();
    expect(view.activeCollection).toBeNull();
    expect(view.board).toBe(board);
  });
});
