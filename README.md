# Excalidraw Sync

A Chrome (Manifest V3) extension that saves [Excalidraw](https://excalidraw.com)
boards to a GitHub repository and keeps them in sync — collections, manual and
smart sync, and a configurable commit author. Setup is a guided three-step
onboarding wizard, and the panel walks you through your first board.

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

Setup is a guided three-step wizard on the extension's **options page**,
followed by a short first-run walkthrough in the panel.

**1. Connect.** Open the extension's **options page** (**Details → Extension
options**, or the panel's "Set up GitHub" / "Open token settings" button). Paste
a **fine-grained personal access token**. The page links to
<https://github.com/settings/personal-access-tokens/new> and includes a "How do
I create a token?" walkthrough: GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained tokens; under **Repository access** choose
**Only select repositories**; under **Permissions → Repository permissions** set
**Contents: Read and write**; then set an expiration. The token is stored only
by the extension in `chrome.storage.local`; it is never sent to the
excalidraw.com page, and the panel only ever learns whether a token is
configured.

**2. Repository.** With a token saved, the wizard lists the repositories the
token can access (`GET /user/repos`), searchable by owner/name and labelled
`(private)` where relevant. Pick one — or type **Owner** and **Repository name**
by hand — then set the **Branch**, **Root path** (default `excalidraw/`), and
the **Author name** / **Author email** used for each commit.

**3. Verify.** Click **Test connection**. On success the wizard adopts the
repository's default branch (a branch you typed yourself is kept) and shows the
`owner/repo @ branch` target plus a link to open Excalidraw.

**First run in the panel.** On <https://excalidraw.com>, open the Excalidraw
Sync panel. Its **Boards** tab shows a **Get started** checklist — **Connect
GitHub → Create a collection → Create a board → Save it** — with a **Set up
GitHub** button that opens the options wizard and clear empty states that promote
the next action ("Create your first collection", then "Create your first
board"). The checklist and card disappear once every step is done. All other
configuration stays editable in the panel's **Settings** tab.

## Where to get builds

Prebuilt extension zips are attached to [GitHub Releases](../../releases). Each
release unpacks to a ready-to-load build. CI produces them on every `v*` tag,
and runs the test + build workflow on every push and pull request.
