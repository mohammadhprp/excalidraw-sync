/**
 * Frozen shared interface for the Excalidraw Sync extension.
 *
 * Both the service-worker stream and the injected-panel stream depend on these
 * names. Do not rename or reshape them without coordinating both streams.
 */

/** A `.excalidraw` scene file, as produced by Excalidraw's `serializeAsJSON`. */
export interface SceneFile {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** A board that lives in the GitHub repo. */
export interface BoardRef {
  /** Collection slug = the directory name under the root path. */
  collection: string;
  /** Board display name. */
  name: string;
  /** Repo path, e.g. `excalidraw/design/flow.excalidraw`. */
  path: string;
  /** Last-known blob sha, `null` if never synced. */
  sha: string | null;
  /** ISO timestamp of the last remote change, when known. */
  updatedAt?: string;
}

/** A collection = a directory of boards under the root path. */
export interface Collection {
  slug: string;
  name: string;
  boards: BoardRef[];
}

/**
 * A GitHub repository the token can access, as returned by `listAccessibleRepos`
 * and relayed over `github:listRepos` for the options-page repo picker.
 */
export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

/** Result of a conflict-aware save. */
export type SyncOutcome =
  | { status: "created"; sha: string; commit: string }
  | { status: "updated"; sha: string; commit: string }
  | { status: "conflict"; remoteSha: string; baseSha: string | null }
  | { status: "unchanged"; sha: string | null };

/**
 * Outcome of deleting a whole collection. `deletedBoards` counts the board
 * files removed; `failures` holds one `"<path>: <error>"` entry per board (or
 * name marker) that could not be deleted.
 */
export interface CollectionDeleteResult {
  deletedBoards: number;
  failures: string[];
}

/** Commit author/committer identity. GitHub requires both name and email. */
export interface AuthorIdentity {
  name: string;
  email: string;
}

/** Full persisted settings. The `token` is service-worker-only. */
export interface Settings {
  token: string | null;
  owner: string;
  repo: string;
  branch: string;
  /** Root directory in the repo, default `"excalidraw"`. */
  rootPath: string;
  /** Default `"sync({collection}/{board}): {action} from Excalidraw"`. */
  commitMessageTemplate: string;
  author: AuthorIdentity;
  smartSync: boolean;
  smartSyncDelayMs: number;
}

/**
 * Service-worker message protocol (content script <-> worker).
 * Keep these exact `type` strings.
 */
export type Req =
  | { type: "settings:get" }
  | { type: "settings:set"; patch: Partial<Settings> }
  | { type: "github:listRepos" }
  | { type: "ui:openOptions" }
  | { type: "github:testConnection" }
  | { type: "github:listCollections" }
  | { type: "github:createCollection"; name: string }
  | { type: "github:listBoards"; collection: string }
  | { type: "github:readBoard"; path: string }
  | {
      type: "github:saveBoard";
      path: string;
      scene: SceneFile;
      baseSha: string | null;
      message?: string;
    }
  | { type: "github:deleteBoard"; path: string; sha: string }
  | { type: "github:deleteCollection"; slug: string };

export type Res<T> = { ok: true; data: T } | { ok: false; error: string };

/** Settings as seen by the content script: no token, only `hasToken`. */
export type PublicSettings = Omit<Settings, "token"> & { hasToken: boolean };
