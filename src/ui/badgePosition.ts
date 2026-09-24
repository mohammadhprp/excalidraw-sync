/**
 * Floating-badge geometry and persistence — pure and unit-testable.
 *
 * The badge (launcher) is positioned by its top-left corner in viewport pixels.
 * `null` means "no stored position" → the default bottom-right placement is
 * recomputed from the live viewport, so a resize keeps it bottom-right.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Cap for the panel height on the chosen side (keeps it adjacent). */
  maxHeight: number;
}

/** `chrome.storage.local` key for the badge position. */
export const BADGE_STORAGE_KEY = "badgePosition";
/** Keep the badge this far from the viewport edges when clamping. */
export const BADGE_MARGIN = 16;
/** Pointer travel (px) before a press is treated as a drag, not a click. */
export const DRAG_THRESHOLD = 4;
/** Gap between the badge and the panel when the panel follows the badge. */
export const PANEL_GAP = 8;
/** Keep the panel this far from the viewport edges. */
export const PANEL_MARGIN = 8;

function clampAxis(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a badge top-left so the badge stays on-screen. The `margin` is kept on
 * every side; when the viewport is smaller than the badge, the top-left is
 * pinned to `margin` so the badge is at least partly reachable.
 */
export function clampBadgePosition(
  position: Point,
  badge: Size,
  viewport: Size,
  margin = BADGE_MARGIN,
): Point {
  const maxX = Math.max(margin, viewport.width - badge.width - margin);
  const maxY = Math.max(margin, viewport.height - badge.height - margin);
  return {
    x: clampAxis(position.x, margin, maxX),
    y: clampAxis(position.y, margin, maxY),
  };
}

/** Default placement: bottom-right, inside the margin. */
export function defaultBadgePosition(
  badge: Size,
  viewport: Size,
  margin = BADGE_MARGIN,
): Point {
  return clampBadgePosition(
    { x: viewport.width - badge.width - margin, y: viewport.height - badge.height - margin },
    badge,
    viewport,
    margin,
  );
}

/** True once pointer travel from `start` to `current` crosses the threshold. */
export function isDragDistance(
  start: Point,
  current: Point,
  threshold = DRAG_THRESHOLD,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

/** Parse a stored value; `null` for anything that is not a finite point. */
export function parseBadgePosition(value: unknown): Point | null {
  if (value === null || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** Round-trippable storage shape. */
export function serializeBadgePosition(position: Point): Point {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}

/**
 * Place the panel adjacent to the badge: prefer below, flip above when that
 * side has more room, align with the badge horizontally and flip to the badge's
 * right edge when it would overflow, then clamp fully on-screen. `maxHeight` is
 * capped to the room on the chosen side so the panel never covers the badge
 * (it scrolls instead); it is only clamped over the badge when neither side has
 * meaningful room.
 */
export function placePanel(
  badge: Rect,
  panel: Size,
  viewport: Size,
  gap = PANEL_GAP,
  margin = PANEL_MARGIN,
): Placement {
  const below = badge.y + badge.height + gap;
  const above = badge.y - gap - panel.height;
  const spaceBelow = viewport.height - below - margin;
  const spaceAbove = badge.y - gap - margin;
  const useBelow = spaceBelow >= panel.height || spaceBelow >= spaceAbove;
  const top = useBelow ? below : above;
  const available = useBelow ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(
    160,
    Math.min(panel.height, available, viewport.height - 2 * margin),
  );

  let left = badge.x;
  if (left + panel.width > viewport.width - margin) {
    left = badge.x + badge.width - panel.width;
  }

  return {
    left: clampAxis(left, margin, Math.max(margin, viewport.width - panel.width - margin)),
    top: clampAxis(top, margin, Math.max(margin, viewport.height - maxHeight - margin)),
    maxHeight,
  };
}
