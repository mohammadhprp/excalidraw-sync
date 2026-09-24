/**
 * Extension options page — the only place the PAT is entered.
 *
 * This is an extension-origin document (`chrome-extension://…`), not a content
 * script, so the token never enters the excalidraw.com page realm or a
 * content-script message. It talks to the service worker via the frozen
 * `settings:get` / `settings:set` protocol.
 */

import type { PublicSettings, Req, Res } from "../lib";
import { buildTokenPatch } from "./token";

function send<T>(req: Req): Promise<Res<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(req, (response: unknown) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message ?? "Extension context error.",
          });
          return;
        }
        if (response === undefined || response === null) {
          resolve({ ok: false, error: "No response from the service worker." });
          return;
        }
        resolve(response as Res<T>);
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Options page is missing #${id}`);
  return element as T;
}

function setStatus(message: string, isError = false): void {
  const status = el("status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function render(settings: PublicSettings): void {
  el("summary").textContent = `${settings.owner || "(no owner)"} / ${
    settings.repo || "(no repo)"
  } @ ${settings.branch}`;
  el("token-state").textContent = settings.hasToken
    ? "A token is configured."
    : "No token configured.";
}

async function refresh(): Promise<void> {
  const res = await send<PublicSettings>({ type: "settings:get" });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }
  render(res.data);
}

async function saveToken(): Promise<void> {
  const input = el<HTMLInputElement>("token");
  const patch = buildTokenPatch(input.value);
  if (!patch) {
    setStatus("Enter a token first.", true);
    return;
  }

  const res = await send<PublicSettings>({ type: "settings:set", patch });
  if (!res.ok) {
    setStatus(res.error, true);
    return;
  }

  input.value = "";
  render(res.data);
  setStatus("Token saved.");
}

el<HTMLButtonElement>("save-token").addEventListener("click", () => void saveToken());
void refresh();
