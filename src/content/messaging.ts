/**
 * `chrome.runtime.sendMessage` wrapper.
 *
 * The content script is the only page-side actor; every GitHub call is relayed
 * to the service worker through here. The runtime is injected so the wrapper
 * (including the `lastError` / no-response paths) is unit-testable without
 * `chrome`.
 */

import type { Req, Res } from "../lib";

export interface RuntimeLike {
  lastError?: { message?: string };
  sendMessage(message: unknown, callback: (response: unknown) => void): void;
}

export type Sender = <T>(req: Req) => Promise<Res<T>>;

export function createMessageSender(runtime: RuntimeLike): Sender {
  return <T>(req: Req): Promise<Res<T>> =>
    new Promise((resolve) => {
      try {
        runtime.sendMessage(req, (response: unknown) => {
          const lastError = runtime.lastError;
          if (lastError) {
            resolve({
              ok: false,
              error: lastError.message ?? "Extension context invalidated.",
            });
            return;
          }
          if (response === undefined || response === null) {
            resolve({ ok: false, error: "No response from the service worker." });
            return;
          }
          resolve(response as Res<T>);
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
}
