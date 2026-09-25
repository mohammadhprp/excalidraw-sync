import { describe, expect, it } from "vitest";

import {
  nextStep,
  onboardingComplete,
  onboardingSteps,
  type OnboardingInput,
} from "../../src/ui/onboarding";

/** Everything done, so each test overrides only what it exercises. */
const complete: OnboardingInput = {
  hasToken: true,
  owner: "acme",
  repo: "boards",
  collectionCount: 1,
  hasBoard: true,
  boardSaved: true,
};

function steps(overrides: Partial<OnboardingInput> = {}) {
  return onboardingSteps({ ...complete, ...overrides });
}

function stepById(id: string) {
  const found = steps().find((step) => step.id === id);
  if (!found) throw new Error(`missing step ${id}`);
  return found;
}

describe("onboardingSteps", () => {
  it("returns the four steps in order", () => {
    expect(onboardingSteps({ ...complete, hasToken: false, owner: "", repo: "", collectionCount: 0, hasBoard: false, boardSaved: false }).map((s) => s.id)).toEqual([
      "connect-github",
      "create-collection",
      "create-board",
      "save-board",
    ]);
    expect(steps().map((s) => s.label)).toEqual([
      "Connect GitHub",
      "Create a collection",
      "Create a board",
      "Save it",
    ]);
  });

  it("marks nothing done when nothing is configured", () => {
    const result = onboardingSteps({
      hasToken: false,
      owner: "",
      repo: "",
      collectionCount: 0,
      hasBoard: false,
      boardSaved: false,
    });
    expect(result.every((step) => !step.done)).toBe(true);
  });

  it("gives every step a short description", () => {
    for (const step of steps()) {
      expect(step.description).toBeTruthy();
      expect(step.description?.length).toBeGreaterThan(0);
    }
  });

  describe("connect-github", () => {
    it("is done only when token, owner and repo are all present", () => {
      expect(stepById("connect-github").done).toBe(true);
      expect(steps({ hasToken: false }).find((s) => s.id === "connect-github")?.done).toBe(false);
      expect(steps({ owner: "" }).find((s) => s.id === "connect-github")?.done).toBe(false);
      expect(steps({ repo: "" }).find((s) => s.id === "connect-github")?.done).toBe(false);
    });

    it("treats whitespace-only owner or repo as missing", () => {
      expect(steps({ owner: "   " }).find((s) => s.id === "connect-github")?.done).toBe(false);
      expect(steps({ repo: "  " }).find((s) => s.id === "connect-github")?.done).toBe(false);
    });

    it("accepts values padded with whitespace", () => {
      expect(steps({ owner: "  acme  " }).find((s) => s.id === "connect-github")?.done).toBe(true);
    });

    it("does not depend on the later steps", () => {
      const result = steps({ collectionCount: 0, hasBoard: false, boardSaved: false });
      expect(result.find((s) => s.id === "connect-github")?.done).toBe(true);
    });
  });

  describe("create-collection", () => {
    it("is done once at least one collection exists", () => {
      expect(steps({ collectionCount: 1 }).find((s) => s.id === "create-collection")?.done).toBe(true);
      expect(steps({ collectionCount: 0 }).find((s) => s.id === "create-collection")?.done).toBe(false);
    });

    it("does not depend on the other steps", () => {
      const result = steps({ hasToken: false, owner: "", repo: "", hasBoard: false, boardSaved: false });
      expect(result.find((s) => s.id === "create-collection")?.done).toBe(true);
    });
  });

  describe("create-board", () => {
    it("is done exactly when a board is active", () => {
      expect(steps({ hasBoard: true }).find((s) => s.id === "create-board")?.done).toBe(true);
      expect(steps({ hasBoard: false }).find((s) => s.id === "create-board")?.done).toBe(false);
    });
  });

  describe("save-board", () => {
    it("is done exactly when the board is saved", () => {
      expect(steps({ boardSaved: true }).find((s) => s.id === "save-board")?.done).toBe(true);
      expect(steps({ boardSaved: false }).find((s) => s.id === "save-board")?.done).toBe(false);
    });

    it("stays open for a newly created board with no remote sha", () => {
      // A created-but-unsaved board: hasBoard true, boardSaved false.
      expect(steps({ hasBoard: true, boardSaved: false }).map((s) => s.done)).toEqual([
        true,
        true,
        true,
        false,
      ]);
    });
  });
});

describe("onboardingComplete", () => {
  it("is false while any step is undone", () => {
    expect(onboardingComplete(steps({ hasToken: false }))).toBe(false);
    expect(onboardingComplete(steps({ collectionCount: 0 }))).toBe(false);
    expect(onboardingComplete(steps({ hasBoard: false }))).toBe(false);
    expect(onboardingComplete(steps({ boardSaved: false }))).toBe(false);
  });

  it("is true only when every step is done", () => {
    expect(onboardingComplete(steps())).toBe(true);
  });

  it("treats an empty checklist as complete", () => {
    expect(onboardingComplete([])).toBe(true);
  });
});

describe("nextStep", () => {
  it("returns the first undone step", () => {
    expect(nextStep(steps({ hasToken: false }))?.id).toBe("connect-github");
    expect(nextStep(steps({ collectionCount: 0 }))?.id).toBe("create-collection");
    expect(nextStep(steps({ hasBoard: false }))?.id).toBe("create-board");
    expect(nextStep(steps({ boardSaved: false }))?.id).toBe("save-board");
  });

  it("skips steps that are already done", () => {
    // Collection done, board not: the next step is the board, not the collection.
    expect(nextStep(steps({ hasBoard: false }))?.id).toBe("create-board");
    expect(nextStep(steps({ boardSaved: false }))?.id).toBe("save-board");
  });

  it("returns null when the checklist is complete or empty", () => {
    expect(nextStep(steps())).toBeNull();
    expect(nextStep([])).toBeNull();
  });
});
