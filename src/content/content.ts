import { startApp } from "./app";

/**
 * Content script for excalidraw.com (ISOLATED world, `document_idle`).
 *
 * Boots the Shadow-DOM sync panel and the READ/WRITE/smart-sync wiring. Every
 * GitHub call is relayed to the MV3 service worker via `chrome.runtime`; this
 * script never calls `api.github.com` and never reads the PAT.
 */
void startApp();
