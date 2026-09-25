import { defineManifest } from "@crxjs/vite-plugin";

/**
 * MV3 manifest for the Excalidraw Sync extension.
 *
 * `host_permissions` for `api.github.com` are required so the *service worker*
 * can call the GitHub Contents API. The content script never talks to GitHub
 * directly (content-script cross-origin requests are always CORS-bound to the
 * page origin), it relays every GitHub call through the worker via
 * `chrome.runtime.sendMessage`.
 */
export default defineManifest({
  manifest_version: 3,
  name: "Excalidraw Sync",
  version: "0.1.2",
  description: "Save and sync Excalidraw boards to a GitHub repository.",
  minimum_chrome_version: "120",
  permissions: ["storage"],
  host_permissions: ["https://excalidraw.com/*", "https://api.github.com/*"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://excalidraw.com/*"],
      js: ["src/content/content.ts"],
      run_at: "document_idle",
    },
  ],
  // The PAT is entered here, on an extension-origin page. It never passes
  // through the content script or the page realm (AGENTS.md rule 3).
  options_page: "src/options/index.html",
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  action: {
    default_title: "Excalidraw Sync",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
  },
  // The panel header loads the packaged logo from a content script, so the
  // icon must be web-accessible to the excalidraw.com page.
  web_accessible_resources: [
    {
      matches: ["https://excalidraw.com/*"],
      resources: ["icons/*.png"],
    },
  ],
});
