/**
 * Opt-in automation bridge.
 *
 * Live verification of READ/WRITE needs to drive the real content-script code
 * from outside the ISOLATED world. A DOM expando set in one world is invisible
 * to the page, so the bridge uses `window.postMessage` (shared across worlds)
 * and is only installed when `localStorage["excalidraw-sync:automation"] === "1"`.
 *
 * It exposes the scene read/write the page can already do itself (the scene is
 * the page's own localStorage/IndexedDB). It never exposes settings or the PAT.
 */

import type { SceneFile } from "../lib";

export const AUTOMATION_FLAG = "excalidraw-sync:automation";
export const AUTOMATION_CHANNEL = "__excalidrawSync";

interface AutomationRequest {
  id?: string;
  op?: string;
  scene?: SceneFile;
}

export interface AutomationHandlers {
  readScene(): Promise<SceneFile>;
  writeScene(scene: SceneFile): Promise<{ strategy: string | null; ok: boolean; error?: string }>;
  getState(): unknown;
}

export function readAutomationFlag(storage: Storage): boolean {
  try {
    return storage.getItem(AUTOMATION_FLAG) === "1";
  } catch {
    return false;
  }
}

export function installAutomationBridge(
  win: Window,
  storage: Storage,
  handlers: AutomationHandlers,
): void {
  if (!readAutomationFlag(storage)) return;

  win.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== win) return;
    const payload = event.data as Record<string, AutomationRequest> | null;
    const request = payload?.[AUTOMATION_CHANNEL];
    if (!request || typeof request.id !== "string") return;
    const { id } = request;

    const reply = (body: Record<string, unknown>): void => {
      win.postMessage({ [AUTOMATION_CHANNEL]: { id, ...body } });
    };

    void (async () => {
      try {
        switch (request.op) {
          case "read":
            reply({ ok: true, scene: await handlers.readScene() });
            return;
          case "write": {
            if (!request.scene) {
              reply({ ok: false, error: "Missing scene" });
              return;
            }
            const result = await handlers.writeScene(request.scene);
            reply({ ok: result.ok, result });
            return;
          }
          case "state":
            reply({ ok: true, state: handlers.getState() });
            return;
          default:
            reply({ ok: false, error: `Unknown op: ${String(request.op)}` });
        }
      } catch (error) {
        reply({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
}
