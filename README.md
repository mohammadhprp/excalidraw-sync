# Excalidraw Sync

A Chrome (Manifest V3) extension that saves [Excalidraw](https://excalidraw.com)
boards to a GitHub repository and keeps them in sync — collections, manual and
smart sync, and a configurable commit author.

## Load it in Chrome

1. Download the latest `.zip` from [GitHub Releases](../../releases/latest).
2. Unzip it into a folder. The folder must contain `manifest.json` at its root.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode** (top-right).
5. Click **Load unpacked** and select the unzipped folder.
6. Open <https://excalidraw.com>; the Excalidraw Sync panel appears.

To update later, replace the folder's contents and click **Reload** on the
extension card.

## Configure

**Step 1 — options page: add the token.** Open the extension's **options page**
(**Details → Extension options**, or the panel's "Open token settings" button).
Create a **fine-grained personal access token** at
<https://github.com/settings/tokens?type=beta> with **Repository access** to the
single target repo and **Contents: Read and write**, then paste it there. It is
stored only by the extension and never sent to the Excalidraw page; the panel
shows just whether a token is configured.

**Step 2 — sync panel: set the repository and author.** On
<https://excalidraw.com>, open the Excalidraw Sync panel and use its **Settings**
tab to set **Owner**, **Repo**, **Branch**, and **Author name** /
**Author email** (the git author and committer for each commit). The root path
defaults to `excalidraw/`. Save, then use the panel to save or sync a board.

## Where to get builds

Prebuilt extension zips are attached to [GitHub Releases](../../releases). Each
release unpacks to a ready-to-load build. CI produces them on every `v*` tag,
and runs the test + build workflow on every push and pull request.
