# CONTEXT.md — `excalidraw-sync`

Architecture and rationale for the Excalidraw → GitHub sync extension. For
commands and rules, see `AGENTS.md`.

## Goal

Save Excalidraw boards to a GitHub repository and keep them in sync:
save board, create/switch collections, manual sync, conflict-aware "smart"
sync, a custom commit-message template, and a configurable commit author
name + email.

## Architecture

```
excalidraw.com page
      │  (ISOLATED-world content script — reads localStorage scene, writes via
      │   synthetic drop; owns the Shadow-DOM panel)
      ▼
chrome.runtime.sendMessage  ──►  MV3 service worker
                                   │  settings (chrome.storage.local, incl. PAT)
                                   │  GitHub Contents API fetch (host_permissions)
                                   ▼
                              api.github.com
```

### Why GitHub I/O is service-worker-side

Chrome treats content-script cross-origin requests as cross-origin **even with
`host_permissions`**, so a content-script `fetch("https://api.github.com/...")`
is CORS-bound to `excalidraw.com` and fails. The worker performs every GitHub
call under the extension origin; the content script only sends messages.

### Why the token never reaches the page

The fine-grained PAT is stored in `chrome.storage.local` and read only by the
worker. `settings:get` returns a `hasToken` boolean instead of the token. The
token is entered on the extension **options page** (`src/options/**`, an
extension-origin document), never in the injected panel: `src/content/**` and
`src/ui/**` only ever see `hasToken`. The panel's "Open token settings"
affordance relays `ui:openOptions` to the worker, which calls
`chrome.runtime.openOptionsPage()` — content scripts cannot call it directly,
as their `chrome.runtime` surface omits it.

### Scene read/write (proven by the investigation)

- **Read:** page-origin `localStorage` keys `excalidraw` (elements) and
  `excalidraw-state` (appState); binary images come from IndexedDB
  `files-db` / `files-store`.
- **Write:** a synthetic `DragEvent("drop")` carrying a `.excalidraw` `File`
  replaces the live scene in place, no reload. Fallbacks: select-all + delete +
  paste, then `localStorage` + reload.
- The injected panel must live in **Shadow DOM** because excalidraw.com ships
  many unscoped global CSS selectors.

The injected panel lives in an **open** Shadow DOM attached to a fixed
`document.body` host, so excalidraw.com's unscoped global CSS cannot reach it.
The host carries `all: initial` inline; all panel CSS is inside the shadow root.
The panel is dependency-free (no UI framework) to keep the content-script bundle
small (~43 kB / ~12 kB gzip).

**Panel shape (Excalidraw-native).** Three tabs — **Boards | Sync | Settings** —
with `role="tablist"`/`tab`/`tabpanel`, `aria-selected`/`aria-controls`/
`aria-labelledby`, and roving tabindex (Arrow keys wrap; the pure state machine
is `ui/tabs.ts`). A **persistent header** (board name + collection + live status
badge) and the tab bar never scroll; each tab panel scrolls. Exactly one
**primary action** per tab — Save / Sync now / Save settings — with disabled,
loading (spinner) and error states. All configuration lives in the **Settings
tab**; when it is incomplete, the Settings tab label shows an amber dot and the
tab opens with a banner listing exactly what is missing (token / owner / repo),
derived by the pure `ui/setupState.ts`. A near-token **inline help** disclosure
explains creating a fine-grained PAT, scoping it to one repository, granting
Contents: Read and write, and setting an expiration. The palette follows
`localStorage["excalidraw-theme"]` (light/dark): resolved synchronously before
the first paint (no light flash when loading into dark) and polled + observed so
a runtime theme toggle updates the panel live.

**Floating badge.** The launcher is draggable by pointer: total travel below a
4px threshold is a click (toggles the panel), otherwise it is a drag (the click
is suppressed). Pointer events are stopped from reaching the page so the
Excalidraw canvas never pans; the badge is clamped on-screen and re-clamped on
window resize. Its top-left position is persisted in `chrome.storage.local`
under its own `badgePosition` key (the frozen `Settings` interface is untouched)
and re-read on load; **Reset position** in Settings clears it back to the
default bottom-right. The panel opens adjacent to the badge — below, or flipped
above / right-aligned when that side has more room — and is always fully
on-screen (geometry + persistence are pure in `ui/badgePosition.ts`).

**Logo/icons.** `src/assets/logo.png` is the source; 16/32/48/128 PNGs live in
`public/icons/` (committed, generated with `sips` — no runtime dependency),
referenced by the manifest `icons` + `action.default_icon` and web-accessible so
the panel header can load `icons/icon-48.png` with no remote URL.

**Smart sync.** When enabled, an interval (1.5 s) hashes
`localStorage.excalidraw` + `excalidraw-state` (FNV-1a) and, on a change,
debounces a save by `smartSyncDelayMs`; saves are skipped while
`document.hidden`, and `visibilitychange`/`focus` re-check on return. The
detection + debounce are pure modules (`smartSync.ts`, `debounce.ts`).

**Conflict semantics.** A `{status:"conflict", remoteSha, baseSha}` outcome
never triggers a further write. The panel shows a banner with exactly two
actions: **Keep local** re-saves with `baseSha = remoteSha` (matching the
remote, so the PUT overwrites it with the local scene), and **Keep remote**
reads the path, replaces the live canvas, and adopts `remoteSha` as the base.
`reloadFromRemote()` (manual "Reload from GitHub") also refreshes the base: it
re-lists the board's collection via `github:listBoards` and adopts the matching
board's sha, so a save right after a reload is `unchanged` (or a real conflict),
never a false conflict from a stale sha.

**Automation bridge.** For live verification, `content/automation.ts` installs a
`window.postMessage` bridge (`__excalidrawSync`, ops `read`/`write`/`state`)
only when `localStorage["excalidraw-sync:automation"] === "1"`. It exposes only
the scene read/write the page can already perform itself; never settings or the
PAT.

## Tests

Unit tests live in `tests/**`, mirroring the `src/**` layout one-to-one
(`tests/lib/github.test.ts` tests `src/lib/github.ts`, and so on). A moved test
imports its subject via `../../src/<area>/<module>`. `vitest.config.ts` targets
`tests/**/*.test.ts`, and `tsconfig.json` typechecks both `src` and `tests`. No
test file lives under `src/`.

## The frozen interface (`src/lib/types.ts`)

- `SceneFile`, `BoardRef`, `Collection`, `SyncOutcome`, `AuthorIdentity`,
  `Settings`, `PublicSettings`.
- Functions (exported from `src/lib/index.ts`): `readBoard`, `saveBoard`,
  `listCollections`, `listBoards`, `createCollection`, `renderCommitMessage`.
- Message protocol types: `Req`, `Res<T>`.

`src/lib/config.ts` holds the module-level configured client that the frozen
top-level functions delegate to (`configureSync` / `configureFromSettings`).

## GitHub Contents API contract

- `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` → `200` with
  `{ type, sha, content(base64), encoding, size }`, or `404` if absent.
- `PUT /repos/{owner}/{repo}/contents/{path}` body:
  `{ message, content(base64), sha?, branch, author{name,email}, committer{name,email} }`
  → `201` created / `200` updated / `409` conflict / `422` validation.
- `author` and `committer` require **both** name and email.
- **Conflict detection:** `GET` first and compare the remote `sha` to the
  caller's `baseSha`. Equal (or `404` with `baseSha === null`) → `PUT`; differ →
  return `{ status: "conflict", remoteSha, baseSha }` and issue **no** `PUT`.
- Fine-grained PAT permission: **Contents: Read and write**. JSON Contents API
  caps `content` at 1 MB.

## Key decisions

- **Per-collection marker, no shared manifest.** `createCollection` writes
  `<rootPath>/<slug>/.collection.json` containing `{"name":"<display name>"}`
  (never an empty body, so the Contents API's empty-body `422` cannot occur).
  `listCollections` reads each collection's own marker for its display name,
  falling back to the directory slug when the marker is absent or unreadable,
  and lists the collection's boards. One file per collection means no
  cross-collection write conflicts. Boards derive their display name from the
  filename.
- **`unchanged` outcome:** if the remote content already equals the scene being
  saved (and `baseSha` matches), no commit is made.
- **Slugify** display names to directory/file slugs (`slugify` in
  `src/lib/paths.ts`).
- **Base64 helpers are UTF-8-safe** so non-ASCII board text round-trips.

## Status / roadmap

Implemented:

- Build tooling, MV3 manifest, service worker + message router, settings
  storage, and the frozen `src/lib` library.
- Injected Shadow-DOM panel (`src/content/**`, `src/ui/**`): launcher + status
  dot, a persistent header, three tabs (Boards | Sync | Settings) with full
  ARIA + roving tabindex, one primary action per tab with disabled/loading/error
  states, the conflict banner, an unsaved-changes guard, a "needs setup" badge +
  banner and inline token help in Settings, and a light/dark theme.
- Draggable floating badge: pointer drag (click vs drag threshold), on-screen
  clamping + resize re-clamp, position persisted in `chrome.storage.local` and
  restored on load, a "Reset position" control, keyboard Enter/Space toggle, and
  a panel that opens adjacent to the badge and stays fully on-screen.
- Extension icons generated from `src/assets/logo.png` into `public/icons/`
  (16/32/48/128), wired into the manifest `icons` + `action.default_icon`, and
  the logo shown in the panel header from the packaged asset.
- Extension options page (`src/options/**`) that is the only place the PAT is
  entered; the panel shows `hasToken` and relays `ui:openOptions`.
- READ (localStorage + IndexedDB `files-db`) and WRITE (synthetic `drop`, then
  paste, then localStorage+reload), with the active strategy surfaced in the
  panel.
- Smart-sync debounce + conflict state machine, and manual sync outcomes
  (created / updated / unchanged / conflict / error).
- Collections create+switch and boards list+switch through the frozen protocol.

Not yet exercised end-to-end:

- A real GitHub round-trip (no token was used in development). Collections and
  board switching are implemented and unit-tested at the state-machine level but
  the live `api.github.com` path is unverified here.
- The `paste` and `reload` write fallbacks (only `drop` was exercised live; the
  fallback order is unit-tested).
- IndexedDB image round-trip from a real image drawn in the UI (the reader was
  verified against a seeded `files-store` record).
