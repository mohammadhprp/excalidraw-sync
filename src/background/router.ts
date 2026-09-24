import {
  toGitHubConfig,
  type GitHubClient,
  type GitHubConfig,
} from "../lib/github";
import type { Req, Res } from "../lib/types";
import { toPublicSettings, type SettingsStore } from "./settings";

/** Everything the router needs; injected so tests avoid chrome + network. */
export interface BackgroundDeps {
  settings: SettingsStore;
  createClient: (config: GitHubConfig) => GitHubClient;
  /**
   * Opens the extension options page. Content scripts cannot call
   * `chrome.runtime.openOptionsPage` (their `chrome.runtime` surface omits it),
   * so the panel relays `ui:openOptions` and the worker performs it.
   */
  openOptionsPage?: () => void | Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pure message router. `src/background/index.ts` wires this to
 * `chrome.runtime.onMessage`; tests call it directly.
 */
export async function handleMessage(
  req: Req,
  deps: BackgroundDeps,
): Promise<Res<unknown>> {
  async function client(): Promise<GitHubClient> {
    const settings = await deps.settings.get();
    if (!settings.token) {
      throw new Error("No GitHub token configured.");
    }
    if (!settings.owner || !settings.repo) {
      throw new Error("GitHub owner and repo must be configured.");
    }
    return deps.createClient(toGitHubConfig(settings));
  }

  try {
    switch (req.type) {
      case "settings:get":
        return { ok: true, data: toPublicSettings(await deps.settings.get()) };

      case "settings:set": {
        const next = await deps.settings.set(req.patch);
        return { ok: true, data: toPublicSettings(next) };
      }

      case "ui:openOptions":
        await deps.openOptionsPage?.();
        return { ok: true, data: null };

      case "github:testConnection":
        return { ok: true, data: await (await client()).testConnection() };

      case "github:listCollections":
        return { ok: true, data: await (await client()).listCollections() };

      case "github:createCollection":
        return { ok: true, data: await (await client()).createCollection(req.name) };

      case "github:listBoards":
        return { ok: true, data: await (await client()).listBoards(req.collection) };

      case "github:readBoard":
        return { ok: true, data: await (await client()).readBoard(req.path) };

      case "github:saveBoard":
        return {
          ok: true,
          data: await (
            await client()
          ).saveBoard(req.path, req.scene, req.baseSha, req.message),
        };

      default: {
        const unexpected: never = req;
        return { ok: false, error: `Unknown message: ${JSON.stringify(unexpected)}` };
      }
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
