/**
 * Pure presentation + settings-form helpers. Kept out of the DOM so they are
 * unit-testable.
 *
 * `buildSettingsPatch` emits only non-secret fields: the panel never carries a
 * secret, and `settings:get` never returns one.
 */

import { DEFAULT_SETTINGS, type Settings } from "../lib";
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

/**
 * The branch name shipped as the built-in default. Read from
 * `DEFAULT_SETTINGS.branch` so `main` has a single source of truth.
 */
export const BUILT_IN_BRANCH: string = DEFAULT_SETTINGS.branch;

export interface AdoptBranchInput {
  /** The branch currently configured (may be empty or the built-in default). */
  configuredBranch: string;
  /** The repository's default branch, as reported by the GitHub API. */
  defaultBranch: string;
  /** The built-in default branch name. Defaults to `"main"`. */
  builtInDefault?: string;
}

export interface AdoptBranchResult {
  /** The branch in effect after connecting. */
  branch: string;
  /** True when the repository default was adopted and must be persisted. */
  adopted: boolean;
  /** A user-facing notice when the default was adopted, else `null`. */
  notice: string | null;
}

/**
 * Decide whether a successful Test connection should adopt the repository's
 * default branch.
 *
 * The repo default is adopted **only** when the configured branch is empty or
 * still the built-in default (`"main"`). A branch the user deliberately typed
 * is never overridden, and when the repo reports the same branch there is no
 * change to persist. Pure, so the adopt / keep-custom / no-change cases are
 * unit-testable without the DOM or the network.
 */
export function resolveAdoptedBranch(input: AdoptBranchInput): AdoptBranchResult {
  const builtIn = input.builtInDefault ?? BUILT_IN_BRANCH;
  const configured = input.configuredBranch.trim();
  const repoDefault = input.defaultBranch.trim();
  const effective = configured || builtIn;
  const isDefaultish = configured === "" || configured === builtIn;
  if (isDefaultish && repoDefault !== "" && repoDefault !== effective) {
    return {
      branch: repoDefault,
      adopted: true,
      notice: `Using repository default branch: ${repoDefault}`,
    };
  }
  return { branch: effective, adopted: false, notice: null };
}

export interface FieldReconcileInput {
  /** The last confirmed value persisted in settings. */
  persisted: string;
  /** The value currently shown in the field. */
  displayed: string;
  /** The field currently has keyboard focus. */
  editing: boolean;
  /** The field has an edit not yet confirmed by a successful submit. */
  edited: boolean;
}

export interface FieldReconcileResult {
  /** The value a render should display in the field. */
  value: string;
  /** The updated "unconfirmed edit" marker for the field. */
  edited: boolean;
}

/**
 * Decide what a render should display in one settings field, and whether the
 * field still carries an unconfirmed edit.
 *
 * A render must never overwrite text the user is editing or has edited but not
 * yet submitted — otherwise a render that lands while the field is momentarily
 * unfocused (for example, the `render()` a save performs before its async
 * `settings:set` resolves) can replace the user's text with a stale persisted
 * value and desync the display from what was submitted. Only when the field is
 * neither focused nor carrying an unconfirmed edit may it adopt the persisted
 * value. Once the field's text equals the persisted value the edit marker
 * clears, so a confirmed submit re-converges the display.
 */
export function reconcileField(input: FieldReconcileInput): FieldReconcileResult {
  if (input.editing || (input.edited && input.displayed !== input.persisted)) {
    return { value: input.displayed, edited: input.edited };
  }
  return { value: input.persisted, edited: false };
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
    branch: values.branch.trim() || BUILT_IN_BRANCH,
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
