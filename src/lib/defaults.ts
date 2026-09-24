import { DEFAULT_COMMIT_MESSAGE_TEMPLATE } from "./commit";
import type { Settings } from "./types";

/** Default persisted settings; stored values are merged over these. */
export const DEFAULT_SETTINGS: Settings = {
  token: null,
  owner: "",
  repo: "",
  branch: "main",
  rootPath: "excalidraw",
  commitMessageTemplate: DEFAULT_COMMIT_MESSAGE_TEMPLATE,
  author: {
    name: "Excalidraw Sync",
    email: "excalidraw-sync@users.noreply.github.com",
  },
  smartSync: true,
  smartSyncDelayMs: 3000,
};
