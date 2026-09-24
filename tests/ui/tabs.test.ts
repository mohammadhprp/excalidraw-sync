import { describe, expect, it } from "vitest";

import {
  firstTab,
  isTabId,
  lastTab,
  nextTabId,
  TAB_IDS,
  TAB_LABELS,
  tabIdAt,
  tabIndex,
} from "../../src/ui/tabs";

describe("tab ids", () => {
  it("has exactly three tabs in a stable order", () => {
    expect(TAB_IDS).toEqual(["boards", "sync", "settings"]);
    expect(TAB_LABELS.boards).toBe("Boards");
    expect(TAB_LABELS.sync).toBe("Sync");
    expect(TAB_LABELS.settings).toBe("Settings");
  });

  it("guards unknown tab ids", () => {
    expect(isTabId("boards")).toBe(true);
    expect(isTabId("sync")).toBe(true);
    expect(isTabId("settings")).toBe(true);
    expect(isTabId("collections")).toBe(false);
    expect(isTabId(3)).toBe(false);
    expect(isTabId(undefined)).toBe(false);
  });

  it("reports the index and bounds", () => {
    expect(tabIndex("boards")).toBe(0);
    expect(tabIndex("sync")).toBe(1);
    expect(tabIndex("settings")).toBe(2);
    expect(firstTab()).toBe("boards");
    expect(lastTab()).toBe("settings");
    expect(tabIdAt(1)).toBe("sync");
    expect(tabIdAt(-5)).toBe("boards");
    expect(tabIdAt(99)).toBe("settings");
  });
});

describe("nextTabId (roving tabindex)", () => {
  it("moves forward and wraps", () => {
    expect(nextTabId("boards", 1)).toBe("sync");
    expect(nextTabId("sync", 1)).toBe("settings");
    expect(nextTabId("settings", 1)).toBe("boards");
  });

  it("moves backward and wraps", () => {
    expect(nextTabId("boards", -1)).toBe("settings");
    expect(nextTabId("settings", -1)).toBe("sync");
    expect(nextTabId("sync", -1)).toBe("boards");
  });
});
