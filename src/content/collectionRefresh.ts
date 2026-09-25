/**
 * Pure reconciliation of the collection/board navigator against a freshly
 * listed set of collections — no DOM, no `chrome`.
 *
 * A listing refresh must never discard the user's place in the navigator: the
 * expanded collection survives as long as it still exists (so the collection
 * the user just opened does not collapse), the active collection falls back to
 * the first available collection, and the open board is carried through
 * untouched (a refresh is a listing refresh, not a board switch).
 */

import type { Collection } from "../lib";
import type { BoardView } from "./syncController";

/** The panel's collection/board pointers, without the listed collections. */
export interface CollectionSelection {
  expandedCollection: string | null;
  activeCollection: string | null;
  board: BoardView | null;
}

/** The reconciled navigator view: the refreshed listing plus the selections. */
export interface CollectionsView extends CollectionSelection {
  collections: Collection[];
}

export function reconcileCollectionsView(
  current: CollectionSelection,
  refreshed: Collection[],
): CollectionsView {
  const slugs = new Set(refreshed.map((collection) => collection.slug));

  let expandedCollection = current.expandedCollection;
  if (expandedCollection !== null && !slugs.has(expandedCollection)) {
    expandedCollection = null;
  }

  let activeCollection = current.activeCollection;
  if (activeCollection === null || !slugs.has(activeCollection)) {
    activeCollection = refreshed[0]?.slug ?? null;
  }

  return {
    collections: refreshed,
    expandedCollection,
    activeCollection,
    board: current.board,
  };
}
