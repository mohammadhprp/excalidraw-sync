import { describe, expect, it } from "vitest";

import { decodeBase64Utf8, encodeBase64Utf8 } from "../../src/lib/base64";
import {
  MAX_CONTENT_BYTES,
  createGitHubClient,
  listAccessibleRepos,
  type GitHubConfig,
} from "../../src/lib/github";
import type { SceneFile } from "../../src/lib/types";

const config: GitHubConfig = {
  token: "test-token",
  owner: "acme",
  repo: "boards",
  branch: "main",
  rootPath: "excalidraw",
  author: { name: "Ada Lovelace", email: "ada@example.com" },
  commitMessageTemplate: "sync({collection}/{board}): {action} from Excalidraw",
};

const scene: SceneFile = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [{ id: "el-1", type: "rectangle", x: 1, y: 2 }],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
};

const PATH = "excalidraw/design/flow.excalidraw";
const fixedNow = (): Date => new Date("2026-09-24T12:00:00.000Z");

interface RecordedCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  cache: string | null;
  headers: Record<string, string>;
}

type Handler = (
  method: string,
  url: URL,
  body: Record<string, unknown> | null,
) => Response;

/** A recording fetch stub: no network, every call captured. */
function mockFetch(handler: Handler): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw =
      input instanceof URL
        ? input.toString()
        : typeof input === "string"
          ? input
          : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    calls.push({
      method,
      url: url.toString(),
      body,
      cache: init?.cache ?? null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(handler(method, url, body));
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientFrom(handler: Handler) {
  const { fetchImpl, calls } = mockFetch(handler);
  const client = createGitHubClient(config, { fetch: fetchImpl, now: fixedNow });
  return { client, calls };
}

function putCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((call) => call.method === "PUT");
}

describe("saveBoard", () => {
  it("creates a new file (404 -> PUT without sha -> created)", async () => {
    const { client, calls } = clientFrom((method) =>
      method === "GET"
        ? jsonResponse(404, { message: "Not Found" })
        : jsonResponse(201, {
            content: { sha: "blob-created" },
            commit: { sha: "commit-created" },
          }),
    );

    const outcome = await client.saveBoard(PATH, scene, null);

    expect(outcome).toEqual({
      status: "created",
      sha: "blob-created",
      commit: "commit-created",
    });

    const get = calls.find((call) => call.method === "GET");
    expect(get?.url).toContain("ref=main");
    // A read after a write must be fresh: authenticated Contents GETs opt out
    // of the HTTP cache (GitHub sends `cache-control: private, max-age=60`).
    expect(get?.cache).toBe("no-store");

    const put = putCalls(calls);
    expect(put).toHaveLength(1);
    const body = put[0]?.body;
    expect(body).toBeTruthy();
    expect("sha" in (body ?? {})).toBe(false);
    expect(body?.message).toBe("sync(design/flow): create from Excalidraw");
    expect(decodeBase64Utf8(String(body?.content))).toBe(
      JSON.stringify(scene),
    );
    expect(body?.branch).toBe("main");
  });

  it("updates an existing file (matching sha -> PUT with sha -> updated)", async () => {
    const remoteScene: SceneFile = { ...scene, elements: [] };
    const { client, calls } = clientFrom((method) =>
      method === "GET"
        ? jsonResponse(200, {
            type: "file",
            sha: "blob-remote",
            encoding: "base64",
            content: encodeBase64Utf8(JSON.stringify(remoteScene)),
          })
        : jsonResponse(200, {
            content: { sha: "blob-updated" },
            commit: { sha: "commit-updated" },
          }),
    );

    const outcome = await client.saveBoard(PATH, scene, "blob-remote");

    expect(outcome).toEqual({
      status: "updated",
      sha: "blob-updated",
      commit: "commit-updated",
    });

    const put = putCalls(calls);
    expect(put).toHaveLength(1);
    expect(put[0]?.body?.sha).toBe("blob-remote");
    expect(put[0]?.body?.message).toBe(
      "sync(design/flow): update from Excalidraw",
    );
  });

  it("reports a conflict when the remote sha differs, and issues NO PUT", async () => {
    const { client, calls } = clientFrom(() =>
      jsonResponse(200, {
        type: "file",
        sha: "blob-remote",
        encoding: "base64",
        content: encodeBase64Utf8("{}"),
      }),
    );

    const outcome = await client.saveBoard(PATH, scene, "blob-stale");

    expect(outcome).toEqual({
      status: "conflict",
      remoteSha: "blob-remote",
      baseSha: "blob-stale",
    });
    expect(putCalls(calls)).toHaveLength(0);
  });

  it("conflicts when baseSha is null but a remote file already exists (no PUT)", async () => {
    const { client, calls } = clientFrom(() =>
      jsonResponse(200, {
        type: "file",
        sha: "blob-remote",
        encoding: "base64",
        content: encodeBase64Utf8(JSON.stringify(scene)),
      }),
    );

    const outcome = await client.saveBoard(PATH, scene, null);

    expect(outcome).toEqual({
      status: "conflict",
      remoteSha: "blob-remote",
      baseSha: null,
    });
    expect(putCalls(calls)).toHaveLength(0);
  });

  it("conflicts when baseSha is set but the remote file is gone (404, no PUT)", async () => {
    const { client, calls } = clientFrom(() =>
      jsonResponse(404, { message: "Not Found" }),
    );

    const outcome = await client.saveBoard(PATH, scene, "blob-x");

    expect(outcome).toEqual({
      status: "conflict",
      remoteSha: "",
      baseSha: "blob-x",
    });
    expect(putCalls(calls)).toHaveLength(0);
  });

  it("re-reads the remote sha when the server wins the race (409)", async () => {
    let gets = 0;
    const { client, calls } = clientFrom((method) => {
      if (method === "GET") {
        gets += 1;
        return jsonResponse(200, {
          type: "file",
          sha: gets === 1 ? "blob-base" : "blob-moved",
          encoding: "base64",
          content: encodeBase64Utf8("{}"),
        });
      }
      return jsonResponse(409, { message: `${PATH} does not match blob-base` });
    });

    const outcome = await client.saveBoard(PATH, scene, "blob-base");

    expect(outcome).toEqual({
      status: "conflict",
      remoteSha: "blob-moved",
      baseSha: "blob-base",
    });
    expect(gets).toBe(2);
    expect(putCalls(calls)).toHaveLength(1);
  });

  it("carries message + author{name,email} + committer{name,email} in the PUT body", async () => {
    const remoteScene: SceneFile = { ...scene, elements: [] };
    const { client, calls } = clientFrom((method) =>
      method === "GET"
        ? jsonResponse(200, {
            type: "file",
            sha: "blob-remote",
            encoding: "base64",
            content: encodeBase64Utf8(JSON.stringify(remoteScene)),
          })
        : jsonResponse(200, {
            content: { sha: "blob-updated" },
            commit: { sha: "commit-updated" },
          }),
    );

    await client.saveBoard(PATH, scene, "blob-remote", "custom: my message");

    const body = putCalls(calls)[0]?.body;
    expect(body?.message).toBe("custom: my message");
    expect(body?.author).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(body?.committer).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("returns unchanged (no PUT) when remote content already matches", async () => {
    const { client, calls } = clientFrom(() =>
      jsonResponse(200, {
        type: "file",
        sha: "blob-same",
        encoding: "base64",
        content: encodeBase64Utf8(JSON.stringify(scene)),
      }),
    );

    const outcome = await client.saveBoard(PATH, scene, "blob-same");

    expect(outcome).toEqual({ status: "unchanged", sha: "blob-same" });
    expect(putCalls(calls)).toHaveLength(0);
  });

  it("rejects an oversized scene before PUT, naming the 1 MB Contents API limit", async () => {
    const oversized: SceneFile = {
      ...scene,
      elements: [{ id: "huge", padding: "x".repeat(MAX_CONTENT_BYTES + 1) }],
    };
    const { client, calls } = clientFrom((method) =>
      method === "GET"
        ? jsonResponse(404, { message: "Not Found" })
        : jsonResponse(201, {
            content: { sha: "blob-created" },
            commit: { sha: "commit-created" },
          }),
    );

    await expect(client.saveBoard(PATH, oversized, null)).rejects.toThrow(
      /GitHub Contents API 1 MB limit/,
    );
    expect(putCalls(calls)).toHaveLength(0);
  });
});

describe("readBoard", () => {
  it("GETs and base64-decodes a scene", async () => {
    const { client, calls } = clientFrom(() =>
      jsonResponse(200, {
        type: "file",
        sha: "blob-1",
        encoding: "base64",
        content: encodeBase64Utf8(JSON.stringify(scene)),
      }),
    );

    await expect(client.readBoard(PATH)).resolves.toEqual(scene);
    expect(calls[0]?.cache).toBe("no-store");
  });

  it("throws a clear error when the board is missing", async () => {
    const { client } = clientFrom(() => jsonResponse(404, { message: "Not Found" }));
    await expect(client.readBoard(PATH)).rejects.toThrow("Board not found");
  });
});

describe("listBoards / listCollections", () => {
  it("lists only .excalidraw files as boards", async () => {
    const { client } = clientFrom((_method, url) => {
      if (url.pathname.endsWith("/contents/excalidraw/design")) {
        return jsonResponse(200, [
          { type: "file", name: "flow.excalidraw", path: "excalidraw/design/flow.excalidraw", sha: "s1" },
          { type: "file", name: ".collection.json", path: "excalidraw/design/.collection.json", sha: "s2" },
          { type: "dir", name: "nested", path: "excalidraw/design/nested", sha: "s3" },
        ]);
      }
      return jsonResponse(404, { message: "Not Found" });
    });

    await expect(client.listBoards("design")).resolves.toEqual([
      {
        collection: "design",
        name: "flow",
        path: "excalidraw/design/flow.excalidraw",
        sha: "s1",
      },
    ]);
  });

  it("never lists a board with an empty name (bare .excalidraw file)", async () => {
    const { client } = clientFrom((_method, url) => {
      if (url.pathname.endsWith("/contents/excalidraw/design")) {
        return jsonResponse(200, [
          {
            type: "file",
            name: ".excalidraw",
            path: "excalidraw/design/.excalidraw",
            sha: "s0",
          },
          {
            type: "file",
            name: "flow.excalidraw",
            path: "excalidraw/design/flow.excalidraw",
            sha: "s1",
          },
        ]);
      }
      return jsonResponse(404, { message: "Not Found" });
    });

    const boards = await client.listBoards("design");
    expect(boards.map((board) => board.name)).toEqual(["flow"]);
    expect(boards.every((board) => board.name.length > 0)).toBe(true);
  });

  it("reads each collection's display name from its .collection.json marker", async () => {
    const { client } = clientFrom((_method, url) => {
      if (url.pathname.endsWith("/contents/excalidraw")) {
        return jsonResponse(200, [
          { type: "dir", name: "design-system", path: "excalidraw/design-system", sha: "d1" },
          { type: "file", name: "README.md", path: "excalidraw/README.md", sha: "f1" },
        ]);
      }
      if (url.pathname.endsWith("/contents/excalidraw/design-system/.collection.json")) {
        return jsonResponse(200, {
          type: "file",
          name: ".collection.json",
          path: "excalidraw/design-system/.collection.json",
          sha: "m1",
          encoding: "base64",
          content: encodeBase64Utf8(JSON.stringify({ name: "Design System" })),
        });
      }
      if (url.pathname.endsWith("/contents/excalidraw/design-system")) {
        return jsonResponse(200, [
          { type: "file", name: "flow.excalidraw", path: "excalidraw/design-system/flow.excalidraw", sha: "s1" },
        ]);
      }
      return jsonResponse(404, { message: "Not Found" });
    });

    await expect(client.listCollections()).resolves.toEqual([
      {
        slug: "design-system",
        name: "Design System",
        boards: [
          {
            collection: "design-system",
            name: "flow",
            path: "excalidraw/design-system/flow.excalidraw",
            sha: "s1",
          },
        ],
      },
    ]);
  });

  it("falls back to the slug when a collection has no marker", async () => {
    const { client } = clientFrom((_method, url) => {
      if (url.pathname.endsWith("/contents/excalidraw")) {
        return jsonResponse(200, [
          { type: "dir", name: "legacy", path: "excalidraw/legacy", sha: "d1" },
        ]);
      }
      if (url.pathname.endsWith("/contents/excalidraw/legacy")) {
        return jsonResponse(200, []);
      }
      return jsonResponse(404, { message: "Not Found" });
    });

    await expect(client.listCollections()).resolves.toEqual([
      { slug: "legacy", name: "legacy", boards: [] },
    ]);
  });

  it("falls back to the slug when the marker is unreadable", async () => {
    const { client } = clientFrom((_method, url) => {
      if (url.pathname.endsWith("/contents/excalidraw")) {
        return jsonResponse(200, [
          { type: "dir", name: "broken", path: "excalidraw/broken", sha: "d1" },
        ]);
      }
      if (url.pathname.endsWith("/contents/excalidraw/broken/.collection.json")) {
        return jsonResponse(200, {
          type: "file",
          name: ".collection.json",
          path: "excalidraw/broken/.collection.json",
          sha: "m1",
          encoding: "base64",
          content: encodeBase64Utf8("not json"),
        });
      }
      if (url.pathname.endsWith("/contents/excalidraw/broken")) {
        return jsonResponse(200, []);
      }
      return jsonResponse(404, { message: "Not Found" });
    });

    await expect(client.listCollections()).resolves.toEqual([
      { slug: "broken", name: "broken", boards: [] },
    ]);
  });
});

describe("createCollection", () => {
  it("writes a non-empty .collection.json marker carrying the display name", async () => {
    const { client, calls } = clientFrom((method) =>
      method === "GET"
        ? jsonResponse(404, { message: "Not Found" })
        : jsonResponse(201, {
            content: { sha: "marker-sha" },
            commit: { sha: "commit-sha" },
          }),
    );

    await expect(client.createCollection("My Notes")).resolves.toEqual({
      slug: "my-notes",
      name: "My Notes",
      boards: [],
    });

    const put = putCalls(calls);
    expect(put).toHaveLength(1);
    expect(put[0]?.url).toContain(
      "/contents/excalidraw/my-notes/.collection.json",
    );
    const content = String(put[0]?.body?.content);
    expect(content.length).toBeGreaterThan(0);
    expect(decodeBase64Utf8(content)).toBe('{"name":"My Notes"}');
    expect(put[0]?.body?.message).toBe("chore: create collection my-notes");
  });

  it("is idempotent: an existing collection is returned untouched with no PUT", async () => {
    const { client, calls } = clientFrom((_method, url) => {
      if (
        url.pathname.endsWith(
          "/contents/excalidraw/new-name/.collection.json",
        )
      ) {
        return jsonResponse(200, {
          type: "file",
          name: ".collection.json",
          path: "excalidraw/new-name/.collection.json",
          sha: "m1",
          encoding: "base64",
          content: encodeBase64Utf8(JSON.stringify({ name: "Original Name" })),
        });
      }
      if (url.pathname.endsWith("/contents/excalidraw/new-name")) {
        return jsonResponse(200, []);
      }
      return jsonResponse(404, { message: "Not Found" });
    });

    await expect(client.createCollection("New Name")).resolves.toEqual({
      slug: "new-name",
      name: "Original Name",
      boards: [],
    });
    expect(putCalls(calls)).toHaveLength(0);
  });
});

describe("deleteBoard", () => {
  it("DELETEs the board with sha, branch, author/committer and a naming message", async () => {
    const { client, calls } = clientFrom(() => new Response(null, { status: 200 }));

    await expect(client.deleteBoard(PATH, "blob-1")).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe("DELETE");
    expect(call?.url).toBe(
      "https://api.github.com/repos/acme/boards/contents/excalidraw/design/flow.excalidraw",
    );
    expect(call?.headers["Content-Type"]).toBe("application/json");
    expect(call?.body).toEqual({
      message: "chore: delete board design/flow",
      sha: "blob-1",
      branch: "main",
      author: { name: "Ada Lovelace", email: "ada@example.com" },
      committer: { name: "Ada Lovelace", email: "ada@example.com" },
    });
  });

  it("resolves silently on 204", async () => {
    const { client } = clientFrom(() => new Response(null, { status: 204 }));
    await expect(client.deleteBoard(PATH, "blob-1")).resolves.toBeUndefined();
  });

  it("resolves silently when the file is already gone (404)", async () => {
    const { client } = clientFrom(() =>
      jsonResponse(404, { message: "Not Found" }),
    );
    await expect(client.deleteBoard(PATH, "blob-1")).resolves.toBeUndefined();
  });

  it("throws the standard client error on any other status (500)", async () => {
    const { client } = clientFrom(() =>
      jsonResponse(500, { message: "Server Error" }),
    );
    await expect(client.deleteBoard(PATH, "blob-1")).rejects.toThrow(
      "GitHub DELETE excalidraw/design/flow.excalidraw failed: 500 Server Error",
    );
  });
});

describe("deleteCollection", () => {
  it("deletes every board, then the marker, and reports the count", async () => {
    const { client, calls } = clientFrom((method, url) => {
      if (method === "GET" && url.pathname.endsWith("/contents/excalidraw/design")) {
        return jsonResponse(200, [
          { type: "file", name: "a.excalidraw", path: "excalidraw/design/a.excalidraw", sha: "sa" },
          { type: "file", name: "b.excalidraw", path: "excalidraw/design/b.excalidraw", sha: "sb" },
        ]);
      }
      if (
        method === "GET" &&
        url.pathname.endsWith("/contents/excalidraw/design/.collection.json")
      ) {
        return jsonResponse(200, {
          type: "file",
          name: ".collection.json",
          path: "excalidraw/design/.collection.json",
          sha: "sm",
          encoding: "base64",
          content: encodeBase64Utf8(JSON.stringify({ name: "Design" })),
        });
      }
      if (method === "DELETE") return new Response(null, { status: 200 });
      return jsonResponse(404, { message: "Not Found" });
    });

    await expect(client.deleteCollection("design")).resolves.toEqual({
      deletedBoards: 2,
      failures: [],
    });

    // Order: list dir -> delete each board -> read marker -> delete marker.
    expect(calls.map((call) => call.method)).toEqual([
      "GET",
      "DELETE",
      "DELETE",
      "GET",
      "DELETE",
    ]);
    const deletes = calls.filter((call) => call.method === "DELETE");
    expect(deletes.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/acme/boards/contents/excalidraw/design/a.excalidraw",
      "https://api.github.com/repos/acme/boards/contents/excalidraw/design/b.excalidraw",
      "https://api.github.com/repos/acme/boards/contents/excalidraw/design/.collection.json",
    ]);
    expect(deletes[2]?.body?.sha).toBe("sm");
    expect(deletes[2]?.body?.message).toBe("chore: delete collection design");
  });

  it("leaves the marker untouched and reports the path when a board delete fails", async () => {
    const { client, calls } = clientFrom((method, url) => {
      if (method === "GET" && url.pathname.endsWith("/contents/excalidraw/design")) {
        return jsonResponse(200, [
          { type: "file", name: "a.excalidraw", path: "excalidraw/design/a.excalidraw", sha: "sa" },
          { type: "file", name: "b.excalidraw", path: "excalidraw/design/b.excalidraw", sha: "sb" },
        ]);
      }
      if (method === "DELETE" && url.pathname.endsWith("/a.excalidraw")) {
        return jsonResponse(500, { message: "boom" });
      }
      if (method === "DELETE") return new Response(null, { status: 200 });
      return jsonResponse(404, { message: "Not Found" });
    });

    const result = await client.deleteCollection("design");

    expect(result).toEqual({
      deletedBoards: 1,
      failures: [
        "excalidraw/design/a.excalidraw: GitHub DELETE excalidraw/design/a.excalidraw failed: 500 boom",
      ],
    });
    // The marker must never be read or deleted when a board survives.
    expect(calls.some((call) => call.url.includes(".collection.json"))).toBe(false);
  });
});

describe("testConnection", () => {
  it("reports the repo default branch and sends a no-store GET", async () => {
    const { client, calls } = clientFrom(() =>
      jsonResponse(200, {
        private: true,
        default_branch: "master",
        owner: { login: "acme" },
      }),
    );

    await expect(client.testConnection()).resolves.toEqual({
      owner: "acme",
      repo: "boards",
      branch: "master",
      private: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/repos/acme/boards");
    expect(calls[0]?.cache).toBe("no-store");
  });

  it("falls back to the configured branch when the repo omits default_branch", async () => {
    const { client } = clientFrom(() =>
      jsonResponse(200, { private: false }),
    );
    await expect(client.testConnection()).resolves.toMatchObject({
      repo: "boards",
      branch: "main",
      private: false,
    });
  });
});

describe("listAccessibleRepos", () => {
  it("maps GET /user/repos into RepoSummary[] with the required headers", async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      jsonResponse(200, [
        {
          name: "boards",
          full_name: "acme/boards",
          private: false,
          default_branch: "main",
          owner: { login: "acme" },
        },
        {
          name: "secret",
          full_name: "acme/secret",
          private: true,
          default_branch: "trunk",
          owner: { login: "acme" },
        },
      ]),
    );

    const repos = await listAccessibleRepos("test-token", { fetch: fetchImpl });

    expect(repos).toEqual([
      {
        owner: "acme",
        name: "boards",
        fullName: "acme/boards",
        private: false,
        defaultBranch: "main",
      },
      {
        owner: "acme",
        name: "secret",
        fullName: "acme/secret",
        private: true,
        defaultBranch: "trunk",
      },
    ]);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.method).toBe("GET");
    expect(call?.url).toBe(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
    );
    expect(call?.cache).toBe("no-store");
    expect(call?.headers.Authorization).toBe("Bearer test-token");
    expect(call?.headers.Accept).toBe("application/vnd.github+json");
    expect(call?.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("throws a clear GitHub error on a non-2xx response", async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(401, { message: "Bad credentials" }),
    );

    await expect(
      listAccessibleRepos("bad-token", { fetch: fetchImpl }),
    ).rejects.toThrow("GitHub GET /user/repos failed: 401 Bad credentials");
  });
});
