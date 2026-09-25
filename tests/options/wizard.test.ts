import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, type PublicSettings } from "../../src/lib";
import {
  buildRepositoryPatch,
  canAdvance,
  connectionSummary,
  filterRepos,
  FIRST_STEP,
  initialStep,
  isStepComplete,
  LAST_STEP,
  nextStepId,
  previousStepId,
  repoLabel,
  repoPatch,
  stepAt,
  stepIndex,
  stepStatuses,
  WIZARD_STEPS,
} from "../../src/options/wizard";

/** A PublicSettings fixture (no token), with overrides applied. */
function settings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  const base: PublicSettings = {
    owner: "",
    repo: "",
    branch: DEFAULT_SETTINGS.branch,
    rootPath: DEFAULT_SETTINGS.rootPath,
    commitMessageTemplate: DEFAULT_SETTINGS.commitMessageTemplate,
    author: DEFAULT_SETTINGS.author,
    smartSync: DEFAULT_SETTINGS.smartSync,
    smartSyncDelayMs: DEFAULT_SETTINGS.smartSyncDelayMs,
    hasToken: false,
  };
  return {
    ...base,
    ...overrides,
    author: { ...base.author, ...overrides.author },
  };
}

const repo = {
  owner: "acme",
  name: "boards",
  fullName: "acme/boards",
  private: false,
  defaultBranch: "main",
};

describe("step order", () => {
  it("is Connect -> Repository -> Verify", () => {
    expect(WIZARD_STEPS.map((step) => step.id)).toEqual([
      "connect",
      "repository",
      "verify",
    ]);
    expect(stepIndex("connect")).toBe(0);
    expect(stepIndex("verify")).toBe(2);
    expect(FIRST_STEP).toBe("connect");
    expect(LAST_STEP).toBe("verify");
  });

  it("clamps stepAt to the ends", () => {
    expect(stepAt(-1)).toBe("connect");
    expect(stepAt(0)).toBe("connect");
    expect(stepAt(1)).toBe("repository");
    expect(stepAt(2)).toBe("verify");
    expect(stepAt(99)).toBe("verify");
  });

  it("moves forward and backward with clamping", () => {
    expect(nextStepId("connect")).toBe("repository");
    expect(nextStepId("repository")).toBe("verify");
    expect(nextStepId("verify")).toBe("verify");
    expect(previousStepId("verify")).toBe("repository");
    expect(previousStepId("repository")).toBe("connect");
    expect(previousStepId("connect")).toBe("connect");
  });
});

describe("completion and advancement", () => {
  it("connect is complete only once a token exists", () => {
    expect(isStepComplete("connect", settings())).toBe(false);
    expect(isStepComplete("connect", settings({ hasToken: true }))).toBe(true);
  });

  it("repository needs both owner and repo (trimmed)", () => {
    expect(isStepComplete("repository", settings({ owner: "acme" }))).toBe(false);
    expect(
      isStepComplete("repository", settings({ owner: "  ", repo: " boards " })),
    ).toBe(false);
    expect(
      isStepComplete("repository", settings({ owner: "acme", repo: "boards" })),
    ).toBe(true);
  });

  it("never treats verify as complete from settings alone", () => {
    expect(
      isStepComplete(
        "verify",
        settings({ hasToken: true, owner: "acme", repo: "boards" }),
      ),
    ).toBe(false);
  });

  it("canAdvance mirrors completion", () => {
    expect(canAdvance("connect", settings())).toBe(false);
    expect(canAdvance("connect", settings({ hasToken: true }))).toBe(true);
    expect(canAdvance("repository", settings({ owner: "a", repo: "b" }))).toBe(true);
  });

  it("initialStep is the first incomplete step", () => {
    expect(initialStep(settings())).toBe("connect");
    expect(initialStep(settings({ hasToken: true }))).toBe("repository");
    expect(
      initialStep(settings({ hasToken: true, owner: "acme", repo: "boards" })),
    ).toBe("verify");
  });
});

describe("stepStatuses", () => {
  it("marks the current step and completed steps (verify from runtime)", () => {
    const statuses = stepStatuses(
      settings({ hasToken: true }),
      { step: "repository", verified: false },
    );

    expect(statuses.map((s) => s.id)).toEqual(["connect", "repository", "verify"]);
    expect(statuses.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(statuses.map((s) => s.complete)).toEqual([true, false, false]);
    expect(statuses.map((s) => s.current)).toEqual([false, true, false]);
    expect(statuses[0]?.title).toBe("Connect");
  });

  it("reflects the runtime verified flag for the verify step", () => {
    const statuses = stepStatuses(
      settings({ hasToken: true, owner: "acme", repo: "boards" }),
      { step: "verify", verified: true },
    );
    expect(statuses[2]?.complete).toBe(true);
    expect(statuses[2]?.current).toBe(true);
  });
});

describe("repo picker helpers", () => {
  const repos = [
    { owner: "acme", name: "boards", fullName: "acme/boards", private: false, defaultBranch: "main" },
    { owner: "acme", name: "secret", fullName: "acme/secret", private: true, defaultBranch: "trunk" },
    { owner: "other", name: "notes", fullName: "other/notes", private: false, defaultBranch: "main" },
  ];

  it("filters case-insensitively and returns all for an empty query", () => {
    expect(filterRepos(repos, "")).toHaveLength(3);
    expect(filterRepos(repos, "   ")).toHaveLength(3);
    expect(filterRepos(repos, "ACME")).toHaveLength(2);
    expect(filterRepos(repos, "notes").map((r) => r.fullName)).toEqual([
      "other/notes",
    ]);
    expect(filterRepos(repos, "zzz")).toEqual([]);
  });

  it("labels private repos", () => {
    expect(repoLabel(repo)).toBe("acme/boards");
    expect(repoLabel(repos[1]!)).toBe("acme/secret (private)");
  });

  it("selecting a repo fills owner + name only", () => {
    const patch = repoPatch(repo);
    expect(patch).toEqual({ owner: "acme", repo: "boards" });
    expect("token" in patch).toBe(false);
  });

  it("summarises the connection target", () => {
    expect(connectionSummary(settings())).toBe("(repository not set) @ main");
    expect(
      connectionSummary(settings({ owner: "acme", repo: "boards", branch: "trunk" })),
    ).toBe("acme/boards @ trunk");
    expect(
      connectionSummary(settings({ owner: " acme ", repo: " boards ", branch: " " })),
    ).toBe("acme/boards @ main");
  });
});

describe("buildRepositoryPatch", () => {
  it("trims values and applies defaults", () => {
    expect(
      buildRepositoryPatch({
        owner: "  acme  ",
        repo: " boards ",
        branch: " ",
        rootPath: " ",
        authorName: "  Ada  ",
        authorEmail: " ada@example.com ",
      }),
    ).toEqual({
      owner: "acme",
      repo: "boards",
      branch: DEFAULT_SETTINGS.branch,
      rootPath: DEFAULT_SETTINGS.rootPath,
      author: { name: "Ada", email: "ada@example.com" },
    });
  });

  it("NEVER includes a token key", () => {
    const patch = buildRepositoryPatch({
      owner: "acme",
      repo: "boards",
      branch: "main",
      rootPath: "excalidraw",
      authorName: "Ada",
      authorEmail: "ada@example.com",
    });
    expect("token" in patch).toBe(false);
    expect(JSON.stringify(patch)).not.toContain("token");
  });
});
