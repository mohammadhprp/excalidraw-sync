import { describe, expect, it, vi } from "vitest";

import { createMessageSender, type RuntimeLike } from "../../src/content/messaging";

describe("createMessageSender", () => {
  it("resolves the worker response", async () => {
    const runtime: RuntimeLike = {
      sendMessage: (_message, callback) => callback({ ok: true, data: { value: 1 } }),
    };
    await expect(createMessageSender(runtime)({ type: "settings:get" })).resolves.toEqual({
      ok: true,
      data: { value: 1 },
    });
  });

  it("turns chrome.runtime.lastError into an error result", async () => {
    const runtime: RuntimeLike = {
      lastError: { message: "Extension context invalidated." },
      sendMessage: (_message, callback) => callback(undefined),
    };
    await expect(createMessageSender(runtime)({ type: "settings:get" })).resolves.toEqual({
      ok: false,
      error: "Extension context invalidated.",
    });
  });

  it("errors when the worker returns nothing", async () => {
    const runtime: RuntimeLike = { sendMessage: (_message, callback) => callback(undefined) };
    await expect(createMessageSender(runtime)({ type: "settings:get" })).resolves.toEqual({
      ok: false,
      error: "No response from the service worker.",
    });
  });

  it("catches a throwing runtime (e.g. invalidated context)", async () => {
    const runtime: RuntimeLike = {
      sendMessage: vi.fn(() => {
        throw new Error("Receiving end does not exist.");
      }),
    };
    await expect(createMessageSender(runtime)({ type: "settings:get" })).resolves.toEqual({
      ok: false,
      error: "Receiving end does not exist.",
    });
  });
});
