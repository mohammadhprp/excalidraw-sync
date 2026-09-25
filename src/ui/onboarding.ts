/**
 * First-run onboarding checklist — pure and unit-testable.
 *
 * Drives the Boards-tab "Get started" card and the guided empty states:
 * Connect GitHub -> Create a collection -> Create a board -> Save. Each step
 * reports whether it is `done`; the panel renders the checklist from this and
 * hides it once complete. No DOM, no `chrome`, no token: the caller only ever
 * passes `hasToken`.
 */

export interface OnboardingStep {
  id: string;
  label: string;
  description?: string;
  done: boolean;
}

export interface OnboardingInput {
  hasToken: boolean;
  owner: string;
  repo: string;
  collectionCount: number;
  /**
   * Total boards across every collection, regardless of which one is selected.
   * The board steps are driven by the repo's content, not the local selection,
   * so a repo that already has boards skips them even with no board open.
   */
  boardCount: number;
  boardSaved: boolean;
}

/**
 * Build the ordered checklist. "Connect GitHub" needs all three of token,
 * owner and repo (matching `setupState`); whitespace-only owner/repo count as
 * missing. "Create a board" and "Save it" are satisfied by any board anywhere
 * in the repo — an already-populated repo is complete for those steps even
 * when no board is locally selected.
 */
export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  const connected =
    input.hasToken &&
    input.owner.trim().length > 0 &&
    input.repo.trim().length > 0;
  const hasAnyBoard = input.boardCount > 0;

  return [
    {
      id: "connect-github",
      label: "Connect GitHub",
      description: "Add a token and point the panel at your repository.",
      done: connected,
    },
    {
      id: "create-collection",
      label: "Create a collection",
      description: "A collection is a folder that groups related boards.",
      done: input.collectionCount > 0,
    },
    {
      id: "create-board",
      label: "Create a board",
      description: "A board is a drawing saved inside a collection.",
      done: hasAnyBoard,
    },
    {
      id: "save-board",
      label: "Save it",
      description: "Save the board to GitHub so it is backed up.",
      done: input.boardSaved || hasAnyBoard,
    },
  ];
}

/** True when every step is done. An empty list is trivially complete. */
export function onboardingComplete(steps: OnboardingStep[]): boolean {
  return steps.every((step) => step.done);
}

/** The first not-done step, or `null` when the checklist is complete. */
export function nextStep(steps: OnboardingStep[]): OnboardingStep | null {
  return steps.find((step) => !step.done) ?? null;
}
