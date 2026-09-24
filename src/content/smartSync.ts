/**
 * Smart sync — detect local edits on an interval and debounce-save.
 *
 * The pure detection + debounce lives here; the panel wires `save` to the sync
 * controller. Rules:
 *  - a changed scene hash triggers `onChange` (so the UI shows "unsaved"),
 *  - the debounced save is skipped while `document.hidden`,
 *  - `markSynced()` records the current hash and cancels any pending save.
 */

import { createDebouncer, type Debouncer } from "./debounce";

export interface SmartSyncDeps {
  /** Cheap hash of the current local scene. */
  hash: () => string;
  /** True while the tab is hidden (local saves are paused then). */
  isHidden: () => boolean;
  /** Fire a save (usually `syncController.save`). */
  save: () => void;
  /** Called once per detected change (mark dirty, refresh counts). */
  onChange?: () => void;
  delayMs: number;
  intervalMs?: number;
}

export interface SmartSync {
  start(): void;
  stop(): void;
  check(): void;
  markSynced(): void;
  setDelay(ms: number): void;
}

const DEFAULT_INTERVAL_MS = 1500;

export function createSmartSync(deps: SmartSyncDeps): SmartSync {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  // `handledHash` is the last hash that was scheduled (or synced); advancing it
  // when a save is scheduled is what stops the interval from re-scheduling the
  // same change on every tick, which would starve the debounce.
  let handledHash = deps.hash();
  // `notifiedHash` de-dupes `onChange` so a change is reported once, not on
  // every tick while the tab is hidden.
  let notifiedHash = handledHash;
  let timer: ReturnType<typeof setInterval> | null = null;

  const debouncer: Debouncer = createDebouncer(deps.delayMs, () => {
    if (deps.isHidden()) return;
    deps.save();
  });

  function check(): void {
    const current = deps.hash();
    if (current === handledHash) return;

    if (current !== notifiedHash) {
      notifiedHash = current;
      deps.onChange?.();
    }

    // While hidden, do not consume the change: leave `handledHash` behind so
    // the next visible tick re-detects it and schedules the save.
    if (deps.isHidden()) return;

    handledHash = current;
    debouncer.schedule();
  }

  return {
    start(): void {
      handledHash = deps.hash();
      notifiedHash = handledHash;
      if (timer === null) {
        timer = setInterval(check, intervalMs);
      }
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      debouncer.cancel();
    },
    check,
    markSynced(): void {
      handledHash = deps.hash();
      notifiedHash = handledHash;
      debouncer.cancel();
    },
    setDelay(ms: number): void {
      debouncer.setDelay(ms);
    },
  };
}
