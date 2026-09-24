import {
  createGitHubClient,
  toGitHubConfig,
  type GitHubClient,
  type GitHubConfig,
  type GitHubDeps,
} from "./github";
import type {
  BoardRef,
  Collection,
  SceneFile,
  Settings,
  SyncOutcome,
} from "./types";

/**
 * Module-level configured client backing the frozen top-level functions.
 * The service worker calls `configureSync()` whenever settings change, then the
 * message handlers call `readBoard` / `saveBoard` / etc.
 */
let activeClient: GitHubClient | null = null;

/** Point the frozen functions at a repo config. Safe to call repeatedly. */
export function configureSync(
  config: GitHubConfig,
  deps: Partial<GitHubDeps> = {},
): GitHubClient {
  activeClient = createGitHubClient(config, deps);
  return activeClient;
}

/** Convenience overload: configure directly from persisted settings. */
export function configureFromSettings(settings: Settings): GitHubClient {
  return configureSync(toGitHubConfig(settings));
}

/** Drop the configured client (used between tests / on sign-out). */
export function resetSync(): void {
  activeClient = null;
}

function client(): GitHubClient {
  if (!activeClient) {
    throw new Error(
      "Sync library is not configured. Call configureSync() before use.",
    );
  }
  return activeClient;
}

/** GET + base64 decode a board. */
export function readBoard(path: string): Promise<SceneFile> {
  return client().readBoard(path);
}

/** Conflict-aware save (create or update) of a board. */
export function saveBoard(
  path: string,
  scene: SceneFile,
  baseSha: string | null,
  message?: string,
): Promise<SyncOutcome> {
  return client().saveBoard(path, scene, baseSha, message);
}

/** Enumerate collections (directories under the root path). */
export function listCollections(): Promise<Collection[]> {
  return client().listCollections();
}

/** Enumerate the boards inside one collection. */
export function listBoards(collection: string): Promise<BoardRef[]> {
  return client().listBoards(collection);
}

/** Create a collection (a directory with a `.collection.json` marker). */
export function createCollection(name: string): Promise<Collection> {
  return client().createCollection(name);
}
