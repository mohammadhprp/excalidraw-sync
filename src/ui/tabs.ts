/**
 * Panel tab state — pure and unit-testable.
 *
 * Order defines both the visual order and the arrow-key traversal order.
 */

export type TabId = "boards" | "sync" | "settings";

export const TAB_IDS: readonly TabId[] = ["boards", "sync", "settings"];

export const TAB_LABELS: Record<TabId, string> = {
  boards: "Boards",
  sync: "Sync",
  settings: "Settings",
};

export function isTabId(value: unknown): value is TabId {
  return typeof value === "string" && (TAB_IDS as readonly string[]).includes(value);
}

/** Index of a tab in `TAB_IDS`; unknown ids fall back to the first tab. */
export function tabIndex(id: TabId): number {
  const index = TAB_IDS.indexOf(id);
  return index === -1 ? 0 : index;
}

export function tabIdAt(index: number): TabId {
  const clamped = Math.max(0, Math.min(TAB_IDS.length - 1, index));
  return TAB_IDS[clamped] ?? "boards";
}

/** Cycle to the next/previous tab, wrapping at both ends (roving tabindex). */
export function nextTabId(current: TabId, direction: 1 | -1): TabId {
  const count = TAB_IDS.length;
  const index = (tabIndex(current) + direction + count) % count;
  return tabIdAt(index);
}

export function firstTab(): TabId {
  return TAB_IDS[0] ?? "boards";
}

export function lastTab(): TabId {
  return TAB_IDS[TAB_IDS.length - 1] ?? "boards";
}
