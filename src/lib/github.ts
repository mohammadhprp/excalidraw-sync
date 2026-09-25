import { decodeBase64Utf8, encodeBase64Utf8 } from "./base64";
import { renderCommitMessage } from "./commit";
import {
  BOARD_EXTENSION,
  collectionMarkerPath,
  joinPath,
  parseBoardPath,
  parseCollectionName,
  slugify,
} from "./paths";
import type {
  AuthorIdentity,
  BoardRef,
  Collection,
  CollectionDeleteResult,
  RepoSummary,
  SceneFile,
  Settings,
  SyncOutcome,
} from "./types";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";

/** Read GitHub's JSON `{ message }` error detail, when the body carries one. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message : "";
  } catch {
    return "";
  }
}

/** The standard client error: `GitHub <method> <path> failed: <status> [detail]`. */
async function apiError(
  method: string,
  path: string,
  res: Response,
): Promise<Error> {
  const detail = await errorDetail(res);
  return new Error(
    `GitHub ${method} ${path} failed: ${res.status}${detail ? ` ${detail}` : ""}`,
  );
}

/** Render an unknown thrown value as a message string. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The GitHub Contents API rejects files larger than 1 MB. Checked before the
 * PUT so the caller gets a clear error instead of a raw `422`.
 */
export const MAX_CONTENT_BYTES = 1024 * 1024;

/** Everything the client needs to talk to one repo. */
export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  /** Root directory in the repo, default `"excalidraw"`. */
  rootPath: string;
  author: AuthorIdentity;
  commitMessageTemplate: string;
}

/** Injectable side effects, so unit tests never touch the network. */
export interface GitHubDeps {
  fetch: typeof fetch;
  now: () => Date;
}

export interface ConnectionInfo {
  owner: string;
  repo: string;
  branch: string;
  private: boolean;
}

export interface GitHubClient {
  readBoard(path: string): Promise<SceneFile>;
  saveBoard(
    path: string,
    scene: SceneFile,
    baseSha: string | null,
    message?: string,
  ): Promise<SyncOutcome>;
  listCollections(): Promise<Collection[]>;
  listBoards(collection: string): Promise<BoardRef[]>;
  createCollection(name: string): Promise<Collection>;
  /** DELETE one board file by path + blob sha. A missing file is a no-op. */
  deleteBoard(path: string, sha: string): Promise<void>;
  /**
   * Delete every board in a collection, then its `.collection.json` marker.
   * The marker is left in place when any board fails, so a partially deleted
   * collection keeps its display name instead of orphaning boards under a
   * slug-only directory.
   */
  deleteCollection(slug: string): Promise<CollectionDeleteResult>;
  testConnection(): Promise<ConnectionInfo>;
}

/** Shape of a Contents API entry (`GET .../contents/{path}`). */
interface ContentItem {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  sha: string;
  size?: number;
  content?: string;
  encoding?: string;
}

interface PutFileResult {
  status: number;
  ok: boolean;
  sha: string;
  commit: string;
}

/** Build a client bound to a single repo/config. */
export function createGitHubClient(
  config: GitHubConfig,
  deps: Partial<GitHubDeps> = {},
): GitHubClient {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available for the GitHub client.");
  }
  const now = deps.now ?? ((): Date => new Date());

  function contentUrl(path: string, withRef = true): string {
    const encodedPath = path
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = new URL(
      `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(
        config.repo,
      )}/contents/${encodedPath}`,
    );
    if (withRef) url.searchParams.set("ref", config.branch);
    return url.toString();
  }

  function headers(withBody = false): Record<string, string> {
    const result: Record<string, string> = {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    if (withBody) result["Content-Type"] = "application/json";
    return result;
  }

  /** GET a path; returns a single item, a directory array, or `null` on 404. */
  async function getContent(
    path: string,
  ): Promise<ContentItem | ContentItem[] | null> {
    const res = await fetchImpl(contentUrl(path), {
      method: "GET",
      headers: headers(),
      // Authenticated Contents GETs are cacheable (`cache-control:
      // private, max-age=60`); without this a GET shortly after a PUT can
      // return the previous blob sha and produce a spurious conflict.
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await apiError("GET", path, res);
    return (await res.json()) as ContentItem | ContentItem[];
  }

  /** GET a file (never a directory); `null` if absent or a directory. */
  async function getFile(path: string): Promise<ContentItem | null> {
    const data = await getContent(path);
    if (data === null || Array.isArray(data)) return null;
    return data;
  }

  async function putFile(
    path: string,
    content: string,
    sha: string | null,
    message: string,
  ): Promise<PutFileResult> {
    // The JSON Contents API caps a file at 1 MB; fail clearly instead of
    // letting GitHub answer with an opaque 422.
    const byteLength = new TextEncoder().encode(content).length;
    if (byteLength > MAX_CONTENT_BYTES) {
      throw new Error(
        `File ${path} is ${byteLength} bytes, over the GitHub Contents API 1 MB limit (${MAX_CONTENT_BYTES} bytes).`,
      );
    }

    const body: Record<string, unknown> = {
      message,
      content: encodeBase64Utf8(content),
      branch: config.branch,
      author: { name: config.author.name, email: config.author.email },
      committer: { name: config.author.name, email: config.author.email },
    };
    // `sha` is required only when replacing an existing file.
    if (sha) body.sha = sha;

    const res = await fetchImpl(contentUrl(path, false), {
      method: "PUT",
      headers: headers(true),
      body: JSON.stringify(body),
    });

    if (res.status === 201 || res.status === 200) {
      const data = (await res.json()) as {
        content?: { sha?: string };
        commit?: { sha?: string };
      };
      return {
        status: res.status,
        ok: true,
        sha: data.content?.sha ?? "",
        commit: data.commit?.sha ?? "",
      };
    }
    if (res.status === 409) {
      return { status: 409, ok: false, sha: "", commit: "" };
    }
    throw await apiError("PUT", path, res);
  }

  /** Read the display name out of a collection marker, else `fallback`. */
  function collectionNameFromItem(
    item: ContentItem | null,
    fallback: string,
  ): string {
    if (!item || item.encoding !== "base64" || typeof item.content !== "string") {
      return fallback;
    }
    try {
      return parseCollectionName(decodeBase64Utf8(item.content)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function listBoardsInternal(collection: string): Promise<BoardRef[]> {
    const dir = joinPath(config.rootPath, collection);
    const data = await getContent(dir);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (item) =>
          item.type === "file" &&
          // Require a non-empty stem so a bare `.excalidraw` file is never
          // surfaced as a board with an empty name.
          item.name.length > BOARD_EXTENSION.length &&
          item.name.endsWith(BOARD_EXTENSION),
      )
      .map((item) => ({
        collection,
        name: item.name.slice(0, -BOARD_EXTENSION.length),
        path: item.path,
        sha: item.sha ?? null,
      }));
  }

  async function readBoard(path: string): Promise<SceneFile> {
    const file = await getFile(path);
    if (!file) throw new Error(`Board not found: ${path}`);
    if (file.encoding !== "base64" || typeof file.content !== "string") {
      throw new Error(`Unexpected GitHub response for ${path}: no base64 content`);
    }
    return JSON.parse(decodeBase64Utf8(file.content)) as SceneFile;
  }

  async function saveBoard(
    path: string,
    scene: SceneFile,
    baseSha: string | null,
    message?: string,
  ): Promise<SyncOutcome> {
    // 1. Conflict detection: compare the remote blob sha to the caller's base.
    const remote = await getFile(path);
    const remoteSha = remote?.sha ?? null;
    if (remoteSha !== baseSha) {
      // Diverged (or the file was deleted remotely) -> never blind-push.
      return { status: "conflict", remoteSha: remoteSha ?? "", baseSha };
    }

    const serialized = JSON.stringify(scene);

    // 2. No-op guard: identical content already on the branch.
    if (
      baseSha !== null &&
      remote?.encoding === "base64" &&
      typeof remote.content === "string" &&
      decodeBase64Utf8(remote.content) === serialized
    ) {
      return { status: "unchanged", sha: remoteSha };
    }

    // 3. Render the commit message and PUT.
    const parsed = parseBoardPath(path);
    const action = remoteSha === null ? "create" : "update";
    const commitMessage =
      message ??
      renderCommitMessage(config.commitMessageTemplate, {
        board: parsed.board,
        collection: parsed.collection,
        action,
        timestamp: now().toISOString(),
      });

    const result = await putFile(path, serialized, remoteSha, commitMessage);
    if (result.status === 409) {
      // Lost a race: re-read to report the now-current remote sha.
      const fresh = await getFile(path);
      return { status: "conflict", remoteSha: fresh?.sha ?? "", baseSha };
    }

    return result.status === 201
      ? { status: "created", sha: result.sha, commit: result.commit }
      : { status: "updated", sha: result.sha, commit: result.commit };
  }

  async function listCollections(): Promise<Collection[]> {
    const data = await getContent(joinPath(config.rootPath));
    if (!Array.isArray(data)) return [];
    const dirs = data.filter((item) => item.type === "dir");
    return Promise.all(
      dirs.map(async (dir) => {
        const marker = await getFile(
          collectionMarkerPath(config.rootPath, dir.name),
        );
        return {
          slug: dir.name,
          // Each collection persists its own display name; fall back to the
          // directory slug when the marker is missing or unreadable.
          name: collectionNameFromItem(marker, dir.name),
          boards: await listBoardsInternal(dir.name),
        };
      }),
    );
  }

  async function createCollection(name: string): Promise<Collection> {
    const slug = slugify(name);
    if (!slug) {
      throw new Error(`Cannot create a collection from an empty name: "${name}"`);
    }
    const markerPath = collectionMarkerPath(config.rootPath, slug);

    // Idempotent: an existing collection is returned untouched, never rewritten.
    const existing = await getFile(markerPath);
    if (existing) {
      return {
        slug,
        name: collectionNameFromItem(existing, name),
        boards: await listBoardsInternal(slug),
      };
    }

    // Non-empty JSON marker: also materialises the directory and carries the
    // user-facing name.
    const marker = JSON.stringify({ name });
    const result = await putFile(
      markerPath,
      marker,
      null,
      `chore: create collection ${slug}`,
    );
    if (!result.ok) {
      // Lost a race: another create won; adopt the stored collection.
      const fresh = await getFile(markerPath);
      if (!fresh) {
        throw new Error(`Failed to create collection: ${slug}`);
      }
      return {
        slug,
        name: collectionNameFromItem(fresh, name),
        boards: await listBoardsInternal(slug),
      };
    }
    return { slug, name, boards: [] };
  }

  /**
   * DELETE one file by path + blob sha.
   *
   * `200`/`204` resolve; `404` also resolves because the file is already gone
   * (the caller's intent — the board is not in the repo — is satisfied). Any
   * other status throws the standard client error.
   */
  async function deleteFile(
    path: string,
    sha: string,
    message: string,
  ): Promise<void> {
    const body = {
      message,
      sha,
      branch: config.branch,
      author: { name: config.author.name, email: config.author.email },
      committer: { name: config.author.name, email: config.author.email },
    };
    const res = await fetchImpl(contentUrl(path, false), {
      method: "DELETE",
      headers: headers(true),
      body: JSON.stringify(body),
    });
    if (res.status === 200 || res.status === 204 || res.status === 404) return;
    throw await apiError("DELETE", path, res);
  }

  /** DELETE a board, with a message naming its collection and board. */
  async function deleteBoard(path: string, sha: string): Promise<void> {
    const parsed = parseBoardPath(path);
    await deleteFile(
      path,
      sha,
      `chore: delete board ${parsed.collection}/${parsed.board}`,
    );
  }

  async function deleteCollection(
    slug: string,
  ): Promise<CollectionDeleteResult> {
    const boards = await listBoardsInternal(slug);
    let deletedBoards = 0;
    const failures: string[] = [];

    for (const board of boards) {
      try {
        if (!board.sha) {
          throw new Error("missing blob sha");
        }
        await deleteBoard(board.path, board.sha);
        deletedBoards += 1;
      } catch (error) {
        failures.push(`${board.path}: ${errorMessage(error)}`);
      }
    }

    // A failed board means the collection is only partially deleted. Keep the
    // name marker so the collection is not orphaned under a slug-only
    // directory, and report what remains.
    if (failures.length > 0) {
      return { deletedBoards, failures };
    }

    const markerPath = collectionMarkerPath(config.rootPath, slug);
    const marker = await getFile(markerPath);
    // A missing marker is fine: the boards are gone and the name was implicit.
    if (marker) {
      try {
        await deleteFile(
          markerPath,
          marker.sha,
          `chore: delete collection ${slug}`,
        );
      } catch (error) {
        failures.push(`${markerPath}: ${errorMessage(error)}`);
      }
    }

    return { deletedBoards, failures };
  }

  async function testConnection(): Promise<ConnectionInfo> {
    const url = `${API_ROOT}/repos/${encodeURIComponent(
      config.owner,
    )}/${encodeURIComponent(config.repo)}`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw await apiError("GET", `${config.owner}/${config.repo}`, res);
    }
    const data = (await res.json()) as {
      private?: boolean;
      default_branch?: string;
      owner?: { login?: string };
    };
    return {
      owner: data.owner?.login ?? config.owner,
      repo: config.repo,
      branch: data.default_branch ?? config.branch,
      private: Boolean(data.private),
    };
  }

  return {
    readBoard,
    saveBoard,
    listCollections,
    listBoards: listBoardsInternal,
    createCollection,
    deleteBoard,
    deleteCollection,
    testConnection,
  };
}

/** Shape of one `GET /user/repos` entry (only the fields the picker needs). */
interface RepoApiItem {
  name?: string;
  full_name?: string;
  private?: boolean;
  default_branch?: string;
  owner?: { login?: string };
}

/**
 * List the repositories the given token can access, newest-updated first.
 *
 * Unlike the per-repo client this needs only a token — the repo picker runs
 * before an owner/repo is configured. `deps` is injectable so unit tests never
 * touch the network.
 */
export async function listAccessibleRepos(
  token: string,
  deps: Partial<GitHubDeps> = {},
): Promise<RepoSummary[]> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available for the GitHub client.");
  }

  const res = await fetchImpl(
    `${API_ROOT}/user/repos?per_page=100&sort=updated`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      cache: "no-store",
    },
  );
  if (!res.ok) throw await apiError("GET", "/user/repos", res);

  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [];
  return (data as RepoApiItem[]).map((item) => ({
    owner: item.owner?.login ?? "",
    name: item.name ?? "",
    fullName: item.full_name ?? "",
    private: Boolean(item.private),
    defaultBranch: item.default_branch ?? "",
  }));
}

/** Project persisted `Settings` onto the subset the client consumes. */
export function toGitHubConfig(settings: Settings): GitHubConfig {
  return {
    token: settings.token ?? "",
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch || "main",
    rootPath: settings.rootPath || "excalidraw",
    author: {
      name: settings.author.name,
      email: settings.author.email,
    },
    commitMessageTemplate:
      settings.commitMessageTemplate || "sync({collection}/{board}): {action} from Excalidraw",
  };
}
