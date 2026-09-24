import { createGitHubClient } from "../lib/github";
import type { Req } from "../lib/types";
import { handleMessage, type BackgroundDeps } from "./router";
import { createChromeSettingsStore } from "./settings";

/**
 * MV3 background service worker.
 *
 * All GitHub I/O happens here: content-script cross-origin requests are always
 * CORS-bound to the page origin, so the panel relays every call through
 * `chrome.runtime.sendMessage` and this worker performs the fetch under the
 * extension's `host_permissions`.
 */

const deps: BackgroundDeps = {
  settings: createChromeSettingsStore(),
  createClient: (config) => createGitHubClient(config),
  openOptionsPage: () => chrome.runtime.openOptionsPage(),
};

chrome.runtime.onMessage.addListener(
  (message: Req, _sender, sendResponse: (response: unknown) => void) => {
    void handleMessage(message, deps).then(sendResponse);
    // Return true to keep the message channel open for the async response.
    return true;
  },
);
