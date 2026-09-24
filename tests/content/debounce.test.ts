import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebouncer } from "../../src/content/debounce";

describe("createDebouncer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the delay and resets on re-schedule", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const debouncer = createDebouncer(1000, fire);

    debouncer.schedule();
    expect(debouncer.pending()).toBe(true);
    vi.advanceTimersByTime(600);
    debouncer.schedule();
    vi.advanceTimersByTime(600);
    expect(fire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(debouncer.pending()).toBe(false);
  });

  it("flush fires immediately and clears the timer", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const debouncer = createDebouncer(1000, fire);

    debouncer.schedule();
    debouncer.flush();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(debouncer.pending()).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents the pending fire", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const debouncer = createDebouncer(1000, fire);

    debouncer.schedule();
    debouncer.cancel();
    vi.advanceTimersByTime(2000);
    expect(fire).not.toHaveBeenCalled();
  });

  it("honours a changed delay", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const debouncer = createDebouncer(1000, fire);

    debouncer.setDelay(200);
    debouncer.schedule();
    vi.advanceTimersByTime(200);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
