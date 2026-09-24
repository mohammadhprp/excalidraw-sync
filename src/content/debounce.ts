/**
 * Minimal debouncer with a mutable delay. Uses the ambient timers so tests can
 * drive it with Vitest fake timers.
 */

export interface Debouncer {
  schedule(): void;
  cancel(): void;
  flush(): void;
  setDelay(ms: number): void;
  pending(): boolean;
}

export function createDebouncer(delayMs: number, fire: () => void): Debouncer {
  let delay = delayMs;
  let handle: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  };

  return {
    schedule(): void {
      cancel();
      handle = setTimeout(() => {
        handle = null;
        fire();
      }, delay);
    },
    cancel,
    flush(): void {
      if (handle === null) return;
      cancel();
      fire();
    },
    setDelay(ms: number): void {
      delay = Math.max(0, ms);
    },
    pending: (): boolean => handle !== null,
  };
}
