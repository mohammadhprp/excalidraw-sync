# AGENTS.md — working in `excalidraw-sync`

Instructions for anyone (human or agent) changing this repo. Read this first,
then `CONTEXT.md` for the architecture and rationale.

## What this is

A Chrome **Manifest V3** extension that injects a sync panel into
`https://excalidraw.com` and syncs boards to a GitHub repo through a
fine-grained PAT.

## Stack

- **TypeScript** (strict, `verbatimModuleSyntax`) — pinned in `package.json`.
- **Vite 8** + **`@crxjs/vite-plugin` 2.7.1** for the MV3 bundle.
- **Vitest 5** for unit tests (Node environment, mocked HTTP — no network).
- **npm** with exact pinned versions (no ranges). Node 24 / npm 11.

## Commands

```bash
npm install        # install pinned deps
npm run dev        # Vite dev server with HMR for the extension
npm run build      # emits dist/ incl. dist/manifest.json
npm run typecheck  # tsc --noEmit
npm test           # vitest run (single pass)
npm run test:watch # vitest in watch mode
```

`npm run build` and `npm test` must be green before any handoff. Run
`npm run typecheck` too.

## Source layout

```
manifest.config.ts     MV3 manifest via CRXJS defineManifest()
vite.config.ts         Vite + CRXJS build config
vitest.config.ts       test config (deliberately separate from Vite)
public/
  icons/               generated 16/32/48/128 extension icons (Vite copies
                       these to the dist root; referenced by the manifest)
src/
  lib/                 frozen sync library: types, GitHub Contents client, pure helpers
  background/          MV3 service worker: message router, settings storage, GitHub I/O
  content/             injected script for excalidraw.com (ISOLATED world)
    content.ts         entry point booted at document_idle
    app.ts             panel state + wiring (frozen protocol, smart sync, theme)
    scene.ts           READ: assemble a SceneFile from localStorage + IDB
    files.ts           IndexedDB `files-db`/`files-store` image reader
    write.ts           WRITE: drop -> paste -> localStorage+reload strategies
    syncController.ts  conflict-aware save / keep-local / keep-remote state machine
    smartSync.ts       interval detection + debounce (pure)
    debounce.ts        debouncer (pure)
    hash.ts            cheap local-edit hash (pure)
    messaging.ts       `chrome.runtime.sendMessage` wrapper
    automation.ts      opt-in postMessage bridge for live verification
  assets/logo.png      source logo (512x512; not shipped at full size)
  ui/                  Shadow-DOM panel (dependency-free)
    host.ts            fixed host + open shadow root on document.body
    panel.ts           tabbed panel view (Boards | Sync | Settings) + header
    tabs.ts            pure tab state machine (roving tabindex)
    setupState.ts      pure "needs setup" state (missing token/owner/repo)
    badgePosition.ts   draggable badge geometry + persistence (pure)
    styles.ts          panel CSS, scoped to the shadow root
    dom.ts             tiny hyperscript helper
    format.ts          pure status/settings-form helpers
  options/             extension-origin options page (hosts the PAT)
    index.html         options page markup
    options.ts         loads/saves settings via the frozen protocol
    options.css        options page styles
    token.ts           `buildTokenPatch` (token value handling lives ONLY here)
tests/                 unit tests mirroring the src/ layout (lib/ background/
                       content/ ui/ options/); vitest targets `tests/**/*.test.ts`
```

**The PAT never enters `src/content/**` or `src/ui/**`.** Those modules only
ever see `hasToken`. The token is entered on the options page (an
extension-origin document) and sent to the worker by that page. The panel's
"Open token settings" button relays `ui:openOptions` to the worker, because
content scripts cannot call `chrome.runtime.openOptionsPage` (their
`chrome.runtime` surface omits it).

**Do not rename `src/content/content.ts` back to `index.ts`.** Two entries both
named `index` collide under the custom `entryFileNames` and CRXJS emits loaders
that both reference the content chunk, so the service worker never loads the
background code and `settings:get` hangs. The distinct basename is load-bearing.

## GitHub repo layout, as written by this extension

- Root path is configurable, default `excalidraw/`.
- A **collection** is a directory: `excalidraw/<collection-slug>/`.
- A **board** is a file: `excalidraw/<collection-slug>/<board-slug>.excalidraw`.
- Creating a collection writes a per-collection marker
  `excalidraw/<collection-slug>/.collection.json` containing
  `{"name":"<display name>"}`. It materialises the directory (the Contents API
  cannot create an empty directory) and persists the user-facing name; it is
  non-empty by construction, avoiding the API's empty-body `422`.
- There is **no shared manifest file**: collections are discovered by listing
  the root directory, and each collection's display name is read from its own
  `.collection.json` (falling back to the directory slug if absent/unreadable).
  Boards are enumerated by listing the collection directory
  (`GET /repos/{owner}/{repo}/contents/{path}`).

## Conventions and hard rules

1. **The frozen interface in `src/lib/types.ts` is a contract.** Both the
   service-worker stream and the UI stream depend on the exact names. Do not
   rename or reshape them; add new exports instead. Import from `../lib`.
2. **All GitHub I/O lives in `src/background/**` and `src/lib/**`.** Never call
   `api.github.com` from `src/content/**`. Content-script cross-origin requests
   are always CORS-bound to the page origin, even with `host_permissions`.
   The content script relays via `chrome.runtime.sendMessage`.
3. **The PAT is service-worker-only.** It lives in `chrome.storage.local`.
   `settings:get` must never return `token`; it returns `hasToken: boolean`.
   Never put the token in the page realm or a content-script message.
4. **Content script runs in the default ISOLATED world.** It has
   `chrome.runtime` (a MAIN-world script does not). Do not use `world: "MAIN"`.
5. **Message protocol strings are exact** (see `Req` in `src/lib/types.ts`).
6. **Unit tests never touch the network.** Inject the HTTP layer
   (`createGitHubClient(config, { fetch })`) or mock a client; do not hit
   `api.github.com`.
7. **Use the project's commands**, not ad-hoc substitutes, and keep dependencies
   pinned to exact versions.
8. **No secrets in the repo.** Do not create `.env` files or commit tokens.
9. **Do not commit** unless a task explicitly authorizes it.
