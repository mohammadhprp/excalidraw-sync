/**
 * Pure presentation + settings-form helpers. Kept out of the DOM so they are
 * unit-testable.
 *
 * `buildSettingsPatch` emits only non-secret fields: the panel never carries a
 * secret, and `settings:get` never returns one.
 */

import type { Settings } from "../lib";
import type { BoardView, SyncStatus } from "../content/syncController";

export type Tone = "green" | "amber" | "red" | "grey";

export function formatClock(at: number): string {
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function statusLabel(status: SyncStatus): string {
  switch (status.kind) {
    case "idle":
      return "Idle";
    case "syncing":
      return "Syncing…";
    case "synced":
      return `Synced ${formatClock(status.at)}`;
    case "conflict":
      return "Conflict";
    case "error":
      return `Error: ${status.message}`;
  }
}

/** green = synced, amber = unsaved/in-flight, red = error/conflict, grey = unset. */
export function statusTone(state: {
  configured: boolean;
  status: SyncStatus;
  dirty: boolean;
}): Tone {
  if (!state.configured) return "grey";
  if (state.status.kind === "error" || state.status.kind === "conflict") {
    return "red";
  }
  if (state.dirty || state.status.kind === "syncing") return "amber";
  return "green";
}

/**
 * Colours/labels for the persistent header indicator. Distinct from the Sync
 * tab's `statusLabel` so the header can show `dirty`/`unconfigured` too.
 */
export type HeaderStatus =
  | "unconfigured"
  | "error"
  | "conflict"
  | "syncing"
  | "dirty"
  | "synced";

/** Priority: unconfigured > error > conflict > syncing > dirty > synced. */
export function headerStatus(input: {
  configured: boolean;
  status: SyncStatus;
  dirty: boolean;
}): HeaderStatus {
  if (!input.configured) return "unconfigured";
  if (input.status.kind === "error") return "error";
  if (input.status.kind === "conflict") return "conflict";
  if (input.status.kind === "syncing") return "syncing";
  if (input.dirty) return "dirty";
  return "synced";
}

export function headerStatusText(status: HeaderStatus): string {
  switch (status) {
    case "unconfigured":
      return "Not configured";
    case "error":
      return "Error";
    case "conflict":
      return "Conflict";
    case "syncing":
      return "Syncing…";
    case "dirty":
      return "Unsaved changes";
    case "synced":
      return "Synced";
  }
}

export function headerTone(status: HeaderStatus): Tone {
  switch (status) {
    case "unconfigured":
      return "grey";
    case "error":
    case "conflict":
      return "red";
    case "syncing":
    case "dirty":
      return "amber";
    case "synced":
      return "green";
  }
}

export function formatBoardTarget(board: BoardView | null): string {
  if (!board) return "No board selected";
  return `${board.collection}/${board.name}`;
}

export function shortSha(sha: string | null): string {
  if (!sha) return "not synced";
  return sha.slice(0, 7);
}

export interface SettingsFormValues {
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  commitMessageTemplate: string;
  authorName: string;
  authorEmail: string;
  smartSync: boolean;
  smartSyncDelayMs: number;
}

/**
 * Build the non-secret settings patch submitted by the panel. It emits only
 * fields the panel owns; the access token is handled by the options page.
 */
export function buildSettingsPatch(values: SettingsFormValues): Partial<Settings> {
  return {
    owner: values.owner.trim(),
    repo: values.repo.trim(),
    branch: values.branch.trim() || "main",
    rootPath: values.rootPath.trim() || "excalidraw",
    commitMessageTemplate: values.commitMessageTemplate,
    author: {
      name: values.authorName.trim(),
      email: values.authorEmail.trim(),
    },
    smartSync: values.smartSync,
    smartSyncDelayMs: Math.max(0, Math.round(values.smartSyncDelayMs)),
  };
}
