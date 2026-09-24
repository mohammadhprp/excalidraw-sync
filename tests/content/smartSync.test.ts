import { afterEach, describe, expect, it, vi } from "vitest";

import { createSmartSync } from "../../src/content/smartSync";

describe("createSmartSync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects a change on the interval and debounce-saves after the delay", () => {
    vi.useFakeTimers();
    let hash = "a";
    let hidden = false;
    const save = vi.fn();
    const onChange = vi.fn();

    const smart = createSmartSync({
      hash: () => hash,
      isHidden: () => hidden,
      save,
      onChange,
      delayMs: 3000,
      intervalMs: 1000,
    });

    smart.start();
    hash = "b";
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(save).toHaveBeenCalledTimes(1);

    smart.stop();
  });

  it("skips the save while hidden and saves once visible again", () => {
    vi.useFakeTimers();
    let hash = "a";
    let hidden = true;
    const save = vi.fn();

    const smart = createSmartSync({
      hash: () => hash,
      isHidden: () => hidden,
      save,
      delayMs: 500,
      intervalMs: 1000,
    });
    smart.start();

    hash = "b";
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();

    hidden = false;
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);

    smart.stop();
  });

  it("markSynced resets the baseline so the same scene is not re-saved", () => {
    vi.useFakeTimers();
    let hash = "a";
    const save = vi.fn();

    const smart = createSmartSync({
      hash: () => hash,
      isHidden: () => false,
      save,
      delayMs: 500,
      intervalMs: 1000,
    });
    smart.start();

    hash = "b";
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);

    smart.markSynced();
    vi.advanceTimersByTime(10_000);
    expect(save).toHaveBeenCalledTimes(1);

    smart.stop();
  });

  it("stop cancels a pending save", () => {
    vi.useFakeTimers();
    let hash = "a";
    const save = vi.fn();

    const smart = createSmartSync({
      hash: () => hash,
      isHidden: () => false,
      save,
      delayMs: 5000,
      intervalMs: 1000,
    });
    smart.start();

    hash = "b";
    vi.advanceTimersByTime(1000);
    smart.stop();
    vi.advanceTimersByTime(10_000);
    expect(save).not.toHaveBeenCalled();
  });
});
