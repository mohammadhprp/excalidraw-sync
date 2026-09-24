/**
 * "Needs setup" state — what is still missing for sync to work.
 *
 * Pure and unit-testable. Drives the Settings-tab dot and the banner that lists
 * exactly which of token / owner / repo are missing. All three present means
 * configured, so both the dot and the banner disappear.
 */

export interface MissingConfig {
  token: boolean;
  owner: boolean;
  repo: boolean;
}

export interface SetupState {
  configured: boolean;
  missing: MissingConfig;
  /** Human-readable list, e.g. `["a GitHub token", "an owner"]`. */
  missingLabels: string[];
  count: number;
}

export function setupState(input: {
  hasToken: boolean;
  owner: string;
  repo: string;
}): SetupState {
  const missing: MissingConfig = {
    token: !input.hasToken,
    owner: input.owner.trim().length === 0,
    repo: input.repo.trim().length === 0,
  };

  const missingLabels: string[] = [];
  if (missing.token) missingLabels.push("a GitHub token");
  if (missing.owner) missingLabels.push("an owner");
  if (missing.repo) missingLabels.push("a repository");

  return {
    configured: missingLabels.length === 0,
    missing,
    missingLabels,
    count: missingLabels.length,
  };
}
