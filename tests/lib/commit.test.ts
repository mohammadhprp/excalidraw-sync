import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMIT_MESSAGE_TEMPLATE,
  renderCommitMessage,
} from "../../src/lib/commit";

describe("renderCommitMessage", () => {
  it("renders the default template with all four variables", () => {
    const message = renderCommitMessage(DEFAULT_COMMIT_MESSAGE_TEMPLATE, {
      board: "flow",
      collection: "design",
      action: "update",
      timestamp: "2026-09-24T12:00:00.000Z",
    });
    expect(message).toBe("sync(design/flow): update from Excalidraw");
  });

  it("renders a custom template", () => {
    const message = renderCommitMessage(
      "chore: {collection}/{board} {action} at {timestamp}",
      {
        board: "roadmap",
        collection: "product",
        action: "create",
        timestamp: "2026-01-02T03:04:05.000Z",
      },
    );
    expect(message).toBe(
      "chore: product/roadmap create at 2026-01-02T03:04:05.000Z",
    );
  });

  it("replaces repeated placeholders and leaves unknown ones untouched", () => {
    const message = renderCommitMessage("{board}-{board}: {unknown}", {
      board: "x",
      collection: "c",
      action: "update",
      timestamp: "t",
    });
    expect(message).toBe("x-x: {unknown}");
  });
});
