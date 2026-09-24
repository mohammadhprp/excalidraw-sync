import { describe, expect, it } from "vitest";

import {
  clampBadgePosition,
  defaultBadgePosition,
  isDragDistance,
  parseBadgePosition,
  placePanel,
  serializeBadgePosition,
  type Placement,
  type Size,
} from "../../src/ui/badgePosition";

const badge: Size = { width: 100, height: 40 };
const viewport: Size = { width: 1000, height: 800 };

describe("clampBadgePosition", () => {
  it("leaves an in-bounds position unchanged", () => {
    expect(clampBadgePosition({ x: 500, y: 400 }, badge, viewport)).toEqual({ x: 500, y: 400 });
  });

  it("keeps the badge on-screen at the top-left edge", () => {
    expect(clampBadgePosition({ x: -50, y: -50 }, badge, viewport)).toEqual({ x: 16, y: 16 });
  });

  it("keeps the badge on-screen at the bottom-right edge", () => {
    expect(clampBadgePosition({ x: 9999, y: 9999 }, badge, viewport)).toEqual({
      x: 1000 - 100 - 16,
      y: 800 - 40 - 16,
    });
  });

  it("re-clamps into a smaller viewport (resize)", () => {
    expect(
      clampBadgePosition({ x: 884, y: 744 }, badge, { width: 600, height: 400 }),
    ).toEqual({ x: 600 - 100 - 16, y: 400 - 40 - 16 });
  });

  it("pins to the margin when the viewport is smaller than the badge", () => {
    expect(
      clampBadgePosition({ x: 500, y: 500 }, { width: 900, height: 900 }, { width: 400, height: 300 }),
    ).toEqual({ x: 16, y: 16 });
  });

  it("treats non-finite input as the minimum", () => {
    expect(clampBadgePosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, badge, viewport)).toEqual({
      x: 16,
      y: 16,
    });
  });
});

describe("defaultBadgePosition", () => {
  it("is bottom-right inside the margin", () => {
    expect(defaultBadgePosition(badge, viewport)).toEqual({ x: 884, y: 744 });
  });
});

describe("isDragDistance", () => {
  it("is false below the threshold and true at/above it", () => {
    expect(isDragDistance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(isDragDistance({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(isDragDistance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  });
});

describe("badge position persistence", () => {
  it("round-trips a finite point", () => {
    const stored = serializeBadgePosition({ x: 12.4, y: 30.6 });
    expect(stored).toEqual({ x: 12, y: 31 });
    expect(parseBadgePosition(stored)).toEqual({ x: 12, y: 31 });
  });

  it("rejects missing or malformed values", () => {
    expect(parseBadgePosition(null)).toBeNull();
    expect(parseBadgePosition(undefined)).toBeNull();
    expect(parseBadgePosition("nope")).toBeNull();
    expect(parseBadgePosition({ x: "1", y: 2 })).toBeNull();
    expect(parseBadgePosition({ x: Number.NaN, y: 0 })).toBeNull();
    expect(parseBadgePosition({ x: 0, y: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("placePanel (panel follows the badge)", () => {
  const panel: Size = { width: 360, height: 300 };

  function assertOnScreen(pos: Placement): void {
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.left + panel.width).toBeLessThanOrEqual(1000 - 8);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(800 - 8);
  }

  it("opens below a badge near the top-left", () => {
    const pos = placePanel({ x: 16, y: 16, ...badge }, panel, viewport);
    expect(pos).toEqual({ left: 16, top: 64, maxHeight: 300 });
    assertOnScreen(pos);
  });

  it("flips above and left for a badge near the bottom-right", () => {
    const pos = placePanel({ x: 884, y: 744, ...badge }, panel, viewport);
    expect(pos.top).toBe(436); // above the badge
    expect(pos.left).toBe(624); // right-aligned to the badge
    assertOnScreen(pos);
  });

  it("opens below a mid-screen badge without covering it", () => {
    const pos = placePanel({ x: 400, y: 400, ...badge }, panel, viewport);
    expect(pos).toEqual({ left: 400, top: 448, maxHeight: 300 });
    expect(pos.top).toBeGreaterThanOrEqual(400 + badge.height); // below the badge
    assertOnScreen(pos);
  });

  it("caps a panel that fits neither side to the roomier one, still on-screen", () => {
    const tall: Size = { width: 360, height: 780 };
    const pos = placePanel({ x: 900, y: 500, ...badge }, tall, viewport);
    expect(pos.maxHeight).toBeLessThan(tall.height); // capped to the side's room
    assertOnScreen(pos);
  });
});
