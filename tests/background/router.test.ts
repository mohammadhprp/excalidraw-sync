import { describe, expect, it, vi } from "vitest";

import type { GitHubClient } from "../../src/lib/github";
import type { SceneFile } from "../../src/lib/types";
import { handleMessage } from "../../src/background/router";
import { createMemorySettingsStore } from "../../src/background/settings";

const scene: SceneFile = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [],
  appState: {},
  files: {},
};

function fakeClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  const base: GitHubClient = {
    readBoard: vi.fn(),
    saveBoard: vi.fn(),
    listCollections: vi.fn(async () => []),
    listBoards: vi.fn(async () => []),
    createCollection: vi.fn(),
    deleteBoard: vi.fn(),
    deleteCollection: vi.fn(),
    testConnection: vi.fn(),
  };
  return Object.assign(base, overrides);
}

describe("handleMessage: settings", () => {
  it("settings:get returns hasToken and NEVER the token", async () => {
    const settings = createMemorySettingsStore({
      token: "ghp_super_secret",
      owner: "acme",
      repo: "boards",
    });
    const res = await handleMessage(
      { type: "settings:get" },
      { settings, createClient: () => fakeClient() },
    );

    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ hasToken: true, owner: "acme", repo: "boards" }),
    });
    const data = res.ok ? (res.data as Record<string, unknown>) : {};
    expect("token" in data).toBe(false);
    expect(JSON.stringify(res)).not.toContain("ghp_super_secret");
  });

  it("settings:set persists a token but never echoes it back", async () => {
    const store = createMemorySettingsStore();
    const deps = { settings: store, createClient: () => fakeClient() };

    const setRes = await handleMessage(
      { type: "settings:set", patch: { token: "ghp_new_secret", branch: "dev" } },
      deps,
    );
    expect(setRes.ok).toBe(true);
    expect(JSON.stringify(setRes)).not.toContain("ghp_new_secret");

    const getRes = await handleMessage({ type: "settings:get" }, deps);
    expect(getRes.ok).toBe(true);
    expect(getRes.ok ? (getRes.data as Record<string, unknown>) : {}).toMatchObject({
      hasToken: true,
      branch: "dev",
    });
    expect(JSON.stringify(getRes)).not.toContain("ghp_new_secret");
  });
});

describe("handleMessage: github relay", () => {
  it("requires a token before reaching GitHub", async () => {
    const settings = createMemorySettingsStore({ owner: "acme", repo: "boards" });
    const res = await handleMessage(
      { type: "github:listCollections" },
      { settings, createClient: () => fakeClient() },
    );
    expect(res).toEqual({ ok: false, error: "No GitHub token configured." });
  });

  it("requires owner and repo once a token is present", async () => {
    const settings = createMemorySettingsStore({ token: "t" });
    const res = await handleMessage(
      { type: "github:testConnection" },
      { settings, createClient: () => fakeClient() },
    );
    expect(res).toEqual({
      ok: false,
      error: "GitHub owner and repo must be configured.",
    });
  });

  it("delegates github:saveBoard with all arguments and returns the outcome", async () => {
    const settings = createMemorySettingsStore({
      token: "t",
      owner: "acme",
      repo: "boards",
    });
    const saveBoard = vi.fn(async () => ({
      status: "created" as const,
      sha: "s",
      commit: "c",
    }));
    const res = await handleMessage(
      {
        type: "github:saveBoard",
        path: "excalidraw/design/flow.excalidraw",
        scene,
        baseSha: null,
        message: "custom",
      },
      { settings, createClient: () => fakeClient({ saveBoard }) },
    );

    expect(saveBoard).toHaveBeenCalledWith(
      "excalidraw/design/flow.excalidraw",
      scene,
      null,
      "custom",
    );
    expect(res).toEqual({
      ok: true,
      data: { status: "created", sha: "s", commit: "c" },
    });
  });

  it("ui:openOptions opens the options page on the extension side", async () => {
    const openOptionsPage = vi.fn();
    const res = await handleMessage(
      { type: "ui:openOptions" },
      {
        settings: createMemorySettingsStore(),
        createClient: () => fakeClient(),
        openOptionsPage,
      },
    );

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, data: null });
  });

  it("serializes thrown client errors as ok:false", async () => {
    const settings = createMemorySettingsStore({
      token: "t",
      owner: "acme",
      repo: "boards",
    });
    const res = await handleMessage(
      { type: "github:readBoard", path: "missing.excalidraw" },
      {
        settings,
        createClient: () =>
          fakeClient({
            readBoard: vi.fn(async () => {
              throw new Error("Board not found: missing.excalidraw");
            }),
          }),
      },
    );
    expect(res).toEqual({
      ok: false,
      error: "Board not found: missing.excalidraw",
    });
  });
});

describe("handleMessage: github deletion", () => {
  it("delegates github:deleteBoard with path and sha and returns null", async () => {
    const settings = createMemorySettingsStore({
      token: "t",
      owner: "acme",
      repo: "boards",
    });
    const deleteBoard = vi.fn(async () => undefined);
    const res = await handleMessage(
      { type: "github:deleteBoard", path: "excalidraw/design/flow.excalidraw", sha: "blob-1" },
      { settings, createClient: () => fakeClient({ deleteBoard }) },
    );

    expect(deleteBoard).toHaveBeenCalledWith(
      "excalidraw/design/flow.excalidraw",
      "blob-1",
    );
    expect(res).toEqual({ ok: true, data: null });
  });

  it("delegates github:deleteCollection with the slug and returns the result", async () => {
    const settings = createMemorySettingsStore({
      token: "t",
      owner: "acme",
      repo: "boards",
    });
    const result = { deletedBoards: 2, failures: [] };
    const deleteCollection = vi.fn(async () => result);
    const res = await handleMessage(
      { type: "github:deleteCollection", slug: "design" },
      { settings, createClient: () => fakeClient({ deleteCollection }) },
    );

    expect(deleteCollection).toHaveBeenCalledWith("design");
    expect(res).toEqual({ ok: true, data: result });
  });

  it("refuses both delete calls without a token, before reaching the client", async () => {
    const settings = createMemorySettingsStore({ owner: "acme", repo: "boards" });
    const deleteBoard = vi.fn();
    const deleteCollection = vi.fn();
    const deps = {
      settings,
      createClient: () => fakeClient({ deleteBoard, deleteCollection }),
    };

    const boardRes = await handleMessage(
      { type: "github:deleteBoard", path: "excalidraw/design/flow.excalidraw", sha: "s" },
      deps,
    );
    const collectionRes = await handleMessage(
      { type: "github:deleteCollection", slug: "design" },
      deps,
    );

    expect(boardRes).toEqual({ ok: false, error: "No GitHub token configured." });
    expect(collectionRes).toEqual({
      ok: false,
      error: "No GitHub token configured.",
    });
    expect(deleteBoard).not.toHaveBeenCalled();
    expect(deleteCollection).not.toHaveBeenCalled();
  });
});

describe("handleMessage: github:listRepos", () => {
  const repos = [
    {
      owner: "acme",
      name: "boards",
      fullName: "acme/boards",
      private: false,
      defaultBranch: "main",
    },
  ];

  it("lists repos with only a token (owner/repo may be empty)", async () => {
    const listRepos = vi.fn(async () => repos);
    const settings = createMemorySettingsStore({ token: "t" });
    const res = await handleMessage(
      { type: "github:listRepos" },
      { settings, createClient: () => fakeClient(), listRepos },
    );

    expect(listRepos).toHaveBeenCalledWith("t");
    expect(res).toEqual({ ok: true, data: repos });
  });

  it("fails without a token, before calling the lister", async () => {
    const listRepos = vi.fn(async () => repos);
    const settings = createMemorySettingsStore({ owner: "acme", repo: "boards" });
    const res = await handleMessage(
      { type: "github:listRepos" },
      { settings, createClient: () => fakeClient(), listRepos },
    );

    expect(listRepos).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: "No GitHub token configured." });
  });
});
