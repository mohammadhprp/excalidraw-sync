import { describe, expect, it } from "vitest";

import * as lib from "../../src/lib/index";
import type {
  AuthorIdentity,
  BoardRef,
  Collection,
  PublicSettings,
  Req,
  Res,
  SceneFile,
  Settings,
  SyncOutcome,
} from "../../src/lib/index";

/**
 * Compile-time guard: this tuple fails `tsc` if any frozen type stops being
 * re-exported from `src/lib`.
 */
export type FrozenTypeExports = [
  SceneFile,
  BoardRef,
  Collection,
  SyncOutcome,
  AuthorIdentity,
  Settings,
  PublicSettings,
  Req,
  Res<unknown>,
];

const FROZEN_FUNCTIONS = [
  "readBoard",
  "saveBoard",
  "listCollections",
  "listBoards",
  "createCollection",
  "renderCommitMessage",
] as const;

describe("src/lib frozen interface", () => {
  it("re-exports every frozen function", () => {
    const surface = lib as Record<string, unknown>;
    for (const name of FROZEN_FUNCTIONS) {
      expect(typeof surface[name], `${name} should be exported`).toBe("function");
    }
  });

  it("exposes the pure renderCommitMessage helper from the package root", () => {
    expect(
      lib.renderCommitMessage("{collection}/{board}:{action}", {
        board: "flow",
        collection: "design",
        action: "update",
        timestamp: "t",
      }),
    ).toBe("design/flow:update");
  });
});
