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
`src/ui/**` only ever see `hasToken`. The options page hosts a three-step
onboarding wizard — **Connect** (paste the PAT) → **Repository** (pick a repo
the token can access, plus branch, root path and author) → **Verify** (test the
connection) — and the repo picker runs there too, listing repositories via
`github:listRepos`. The token is written only by the wizard's Connect step
(`buildTokenPatch`); the Repository step submits a non-secret patch
(`buildRepositoryPatch`) that never emits a `token` key. The panel's "Open token
settings" affordance (and the Boards-tab "Set up GitHub" button) relays
`ui:openOptions` to the worker, which calls `chrome.runtime.openOptionsPage()` —
content scripts cannot call it directly, as their `chrome.runtime` surface omits
it.

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
Contents: Read and write, and setting an expiration. The **Boards tab** opens
with a first-run **Get started** card: a checklist (**Connect GitHub → Create a
collection → Create a board → Save it**, from the pure `ui/onboarding.ts`) that
hides once every step is done. The board steps track the repository's content,
not the local selection: **Create a board** and **Save it** read done as soon as
**any** board exists anywhere in the repo, so an already-populated repo skips
them even with nothing open. While a step is next, its form becomes the
prominent empty state — with no collections the **New collection** section is
promoted to "Create your first collection", and when the repo holds no boards
and none is selected the **New board** section reads "Create your first board
in «collection»" — and the current-board card (and its Save) stays hidden until
a board is active.

**Inline collection/board navigator.** The Boards tab lists collections, each a
row with a chevron toggle (a `button` carrying `aria-expanded` / `aria-controls`)
that expands its boards indented beneath it and a board count. The open board is
highlighted (`aria-current="true"`) and clicked to open it (behind the
unsaved-changes guard); opening a board loads that board's drawing and points the
controller at it *around* the canvas write, so an in-flight smart-sync tick can
never attribute the incoming scene to the previous board. **Creating a board
always opens a genuinely empty canvas** — never a copy of what is on screen — and
when there is unsaved work (an open board with edits, or a drawing not saved to
any board) the create confirms first, offering to save or discard explicitly
rather than silently discarding. The New board form targets the active
collection, whose
display name its heading carries ("New board in «collection»" / "Create your
first board in «collection»"), so the navigator is the single source of that
choice. Every board and collection row has a compact trash control (an inline
SVG with an `aria-label`): a board delete removes only that one file; a
collection delete cascades (see the Contents API contract below). A non-empty
collection's delete confirm renders a text field and keeps its confirm button
disabled until the typed value matches the collection's display name; an empty
collection confirms without the phrase. The palette follows
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

- `SceneFile`, `BoardRef`, `Collection`, `RepoSummary`, `SyncOutcome`,
  `CollectionDeleteResult`, `AuthorIdentity`, `Settings`, `PublicSettings`.
- Functions (exported from `src/lib/index.ts`): `readBoard`, `saveBoard`,
  `listCollections`, `listBoards`, `createCollection`, `renderCommitMessage`,
  plus `listAccessibleRepos` (the token-only repo lister for the options
  picker).
- Message protocol types: `Req`, `Res<T>`. Besides the collection/board calls,
  `Req` carries `github:listRepos`, the token-only message that returns
  `RepoSummary[]` for the options-page repo picker, and the delete messages
  `github:deleteBoard` (`{ path, sha }` → `null`) and `github:deleteCollection`
  (`{ slug }` → `CollectionDeleteResult`). The `GitHubClient` interface carries
  the corresponding `deleteBoard(path, sha)` and `deleteCollection(slug)`
  methods; like the rest of `src/lib`, they are reached through the worker, not
  as top-level configured functions.

`CollectionDeleteResult` is `{ deletedBoards: number; failures: string[] }` —
the number of board files removed and one `"<path>: <error>"` entry per board
(or marker) that could not be deleted.

`src/lib/config.ts` holds the module-level configured client that the frozen
top-level functions delegate to (`configureSync` / `configureFromSettings`).

## GitHub Contents API contract

- `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` → `200` with
  `{ type, sha, content(base64), encoding, size }`, or `404` if absent.
- `PUT /repos/{owner}/{repo}/contents/{path}` body:
  `{ message, content(base64), sha?, branch, author{name,email}, committer{name,email} }`
  → `201` created / `200` updated / `409` conflict / `422` validation.
- `DELETE /repos/{owner}/{repo}/contents/{path}` body:
  `{ message, sha, branch, author{name,email}, committer{name,email} }` — the
  `sha` is the blob sha of the file being removed. `200`/`204` resolve; `404`
  is treated as already-gone and also resolves (the caller's intent — the file
  is not in the repo — is satisfied); any other status throws the standard
  client error.
- **Collection delete is cascade-then-marker.** `deleteBoard` deletes one board
  file by path + blob sha. `deleteCollection` lists the collection's boards,
  deletes each board first, and only when **every** board succeeded reads and
  deletes the `.collection.json` marker. If any board delete fails, the marker
  is **left in place** and each failure is reported as `"<path>: <error>"` in
  `CollectionDeleteResult.failures`, so a partial delete keeps the collection's
  display name instead of orphaning the surviving boards under a slug-only
  directory. A collection with no marker is fine: the boards are gone and the
  name was implicit.
- `author` and `committer` require **both** name and email.
- **Conflict detection:** `GET` first and compare the remote `sha` to the
  caller's `baseSha`. Equal (or `404` with `baseSha === null`) → `PUT`; differ →
  return `{ status: "conflict", remoteSha, baseSha }` and issue **no** `PUT`.
- `GET /user/repos?per_page=100&sort=updated` (`listAccessibleRepos`) → `200`
  with the repositories the token can access, newest-updated first, mapped to
  `RepoSummary { owner, name, fullName, private, defaultBranch }`. It needs
  **only** a token (no owner/repo), because the picker runs before a repository
  is configured; the worker relays it over the token-only `github:listRepos`
  message. Single page, 100 repositories max.
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
  entered; the panel shows `hasToken` and relays `ui:openOptions`. The page is a
  guided three-step onboarding wizard — Connect → Repository → Verify — with an
  inline token walkthrough, a searchable repo picker (`github:listRepos` /
  `listAccessibleRepos`, `GET /user/repos`), and a Test connection step that
  adopts the repository's default branch.
- Panel first-run flow: a Boards-tab **Get started** checklist (Connect GitHub →
  Create a collection → Create a board → Save it; pure `ui/onboarding.ts`) plus
  guided empty states that promote the next action until setup is complete.
- READ (localStorage + IndexedDB `files-db`) and WRITE (synthetic `drop`, then
  paste, then localStorage+reload), with the active strategy surfaced in the
  panel.
- Smart-sync debounce + conflict state machine, and manual sync outcomes
  (created / updated / unchanged / conflict / error).
- Collections create+switch and boards list+switch through the frozen protocol.
- Inline collection/board navigator: expand/collapse with `aria-expanded` /
  `aria-controls`, a board count per collection, the open board highlighted
  (`aria-current`), click-to-open behind the unsaved-changes guard, and a
  compact trash control on every board and collection row.
- Board create/switch canvas flow (`content/boardFlow.ts`): creating a board
  opens an empty canvas and prompts first when unsaved work would be lost;
  switching applies the selected board's scene with the controller pointed at
  the target around the write, and a switch never routes through the
  `reload` fallback (which navigates and would drop the in-memory selection). A
  failed write restores the previous selection, preserving its dirty flag and
  status.
- Board and collection deletion: board delete removes one file; collection
  delete cascades every board then the `.collection.json` marker, is
  irreversible, and gates a non-empty collection behind a typed-name confirm.
  A partial board failure keeps the marker and reports the failures.
- Onboarding skips steps the repository already satisfies: **Create a board**
  and **Save it** read done once any board exists anywhere in the repo, so an
  already-populated repo skips them with nothing locally selected.

Not yet exercised end-to-end:

- A real GitHub round-trip (no token was used in development). Collections and
  board switching are implemented and unit-tested at the state-machine level but
  the live `api.github.com` path is unverified here.
- The create-fresh and switch canvas flows: the pure decisions and write routing
  are unit-tested, but the live Excalidraw `drop` landing (whether the canvas
  actually empties on create / replaces on switch) has no browser harness here.
- The `paste` and `reload` write fallbacks (only `drop` was exercised live; the
  fallback order is unit-tested).
- IndexedDB image round-trip from a real image drawn in the UI (the reader was
  verified against a seeded `files-store` record).
