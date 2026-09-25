/**
 * Pure onboarding-wizard logic for the extension options page.
 *
 * The options page is the only place the PAT is entered. This module holds the
 * step model — which step is which, what counts as complete, and what "next"
 * and "previous" mean — plus the repo-picker helpers. It has no DOM and no
 * `chrome` API, so the entire step machine is unit-testable; the page only
 * wires these decisions to elements.
 */

import { DEFAULT_SETTINGS } from "../lib";
import type { PublicSettings, RepoSummary, Settings } from "../lib";

/** The three onboarding steps, in order. */
export type WizardStepId = "connect" | "repository" | "verify";

export interface WizardStepDef {
  id: WizardStepId;
  /** Short label shown in the stepper. */
  title: string;
}

/** The ordered steps of the wizard. */
export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: "connect", title: "Connect" },
  { id: "repository", title: "Repository" },
  { id: "verify", title: "Verify" },
];

export const FIRST_STEP: WizardStepId = "connect";
export const LAST_STEP: WizardStepId = "verify";

/** Index of a step in `WIZARD_STEPS` (0-based; -1 only for bad input). */
export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((step) => step.id === id);
}

/** The step at `index`, clamped to the ends of the list. */
export function stepAt(index: number): WizardStepId {
  if (index <= 0) return FIRST_STEP;
  if (index >= WIZARD_STEPS.length) return LAST_STEP;
  return WIZARD_STEPS[index]?.id ?? LAST_STEP;
}

export function nextStepId(id: WizardStepId): WizardStepId {
  return stepAt(stepIndex(id) + 1);
}

export function previousStepId(id: WizardStepId): WizardStepId {
  return stepAt(stepIndex(id) - 1);
}

/**
 * What counts as "done" for a step from persisted settings alone.
 *
 * Verification is a runtime action whose result is not persisted, so `verify`
 * is never "complete" from settings — the page folds in its own `verified`
 * flag via `stepStatuses`.
 */
export function isStepComplete(
  id: WizardStepId,
  settings: PublicSettings,
): boolean {
  switch (id) {
    case "connect":
      return settings.hasToken;
    case "repository":
      return settings.owner.trim() !== "" && settings.repo.trim() !== "";
    case "verify":
      return false;
  }
}

/** Whether the wizard may move forward from `id` with these settings. */
export function canAdvance(
  id: WizardStepId,
  settings: PublicSettings,
): boolean {
  return isStepComplete(id, settings);
}

/** Runtime state the page owns, layered over persisted settings. */
export interface WizardRuntime {
  /** The step currently on screen. */
  step: WizardStepId;
  /** True once "Test connection" has succeeded this session. */
  verified: boolean;
}

/** One stepper entry, ready to render. */
export interface StepStatus {
  id: WizardStepId;
  index: number;
  title: string;
  complete: boolean;
  current: boolean;
}

/** Stepper state: each step's `complete` (with a check) and `current`. */
export function stepStatuses(
  settings: PublicSettings,
  runtime: WizardRuntime,
): StepStatus[] {
  return WIZARD_STEPS.map((step, index) => ({
    id: step.id,
    index,
    title: step.title,
    complete:
      step.id === "verify"
        ? runtime.verified
        : isStepComplete(step.id, settings),
    current: step.id === runtime.step,
  }));
}

/** The first step still missing something; `verify` once the rest is set. */
export function initialStep(settings: PublicSettings): WizardStepId {
  if (!isStepComplete("connect", settings)) return "connect";
  if (!isStepComplete("repository", settings)) return "repository";
  return "verify";
}

/**
 * Case-insensitive substring filter over `owner/name`. An empty query keeps
 * every repo.
 */
export function filterRepos(
  repos: RepoSummary[],
  query: string,
): RepoSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return repos;
  return repos.filter((repo) => repo.fullName.toLowerCase().includes(needle));
}

/** Label for a repo option: `owner/name`, tagged when private. */
export function repoLabel(repo: RepoSummary): string {
  return repo.private ? `${repo.fullName} (private)` : repo.fullName;
}

/** Selecting a repo fills the owner + repo fields. */
export function repoPatch(repo: RepoSummary): Partial<Settings> {
  return { owner: repo.owner, repo: repo.name };
}

/** `owner/repo @ branch`, with placeholders while the target is unset. */
export function connectionSummary(settings: PublicSettings): string {
  const owner = settings.owner.trim();
  const repo = settings.repo.trim();
  const target =
    owner !== "" && repo !== "" ? `${owner}/${repo}` : "(repository not set)";
  return `${target} @ ${settings.branch.trim() || DEFAULT_SETTINGS.branch}`;
}

export interface RepositoryFormValues {
  owner: string;
  repo: string;
  branch: string;
  rootPath: string;
  authorName: string;
  authorEmail: string;
}

/**
 * Non-secret `settings:set` patch for the Repository step. It emits only the
 * fields the step owns and NEVER a `token` key — the token is written solely by
 * the Connect step via `buildTokenPatch`.
 */
export function buildRepositoryPatch(
  values: RepositoryFormValues,
): Partial<Settings> {
  return {
    owner: values.owner.trim(),
    repo: values.repo.trim(),
    branch: values.branch.trim() || DEFAULT_SETTINGS.branch,
    rootPath: values.rootPath.trim() || DEFAULT_SETTINGS.rootPath,
    author: {
      name: values.authorName.trim(),
      email: values.authorEmail.trim(),
    },
  };
}
