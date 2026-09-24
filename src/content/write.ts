/**
 * WRITE — replace the live canvas with a scene, in the proven preference order:
 *
 *  1. `drop`     — synthetic `DragEvent("drop")` carrying a `.excalidraw`
 *                  `File` on `.excalidraw`; replaces in place, no reload.
 *  2. `paste`    — select-all + Delete, then a synthetic `paste` carrying
 *                  `{ type:"excalidraw/clipboard", elements, files }` (paste
 *                  appends, hence the clear first).
 *  3. `reload`   — write `localStorage` elements/appState, bump
 *                  `version-dataState`, then `location.reload()`.
 *
 * `runWriteStrategies` owns the fallback order and is unit-tested with fakes;
 * `createDomWriteTarget` is the browser implementation of the three verbs.
 */

import type { SceneFile } from "../lib";

export const SCENE_FILE_NAME = "scene.excalidraw";
export const SCENE_MIME = "application/vnd.excalidraw+json";
export const CLIPBOARD_MIME = "text/plain";

export type WriteStrategy = "drop" | "paste" | "reload";

export interface WriteResult {
  strategy: WriteStrategy | null;
  ok: boolean;
  error?: string;
}

/** Build the `.excalidraw` JSON payload. */
export function serializeScene(scene: SceneFile): string {
  return JSON.stringify(scene);
}

/** Build the `excalidraw/clipboard` payload (elements + files only). */
export function buildClipboardText(scene: SceneFile): string {
  return JSON.stringify({
    type: "excalidraw/clipboard",
    elements: scene.elements,
    files: scene.files,
  });
}

export interface WriteTarget {
  drop(scene: SceneFile): Promise<void>;
  paste(scene: SceneFile): Promise<void>;
  reload(scene: SceneFile): Promise<void>;
}

/** Try each strategy in order, stopping at the first that does not throw. */
export async function runWriteStrategies(
  target: WriteTarget,
  scene: SceneFile,
): Promise<WriteResult> {
  const attempts: Array<{ name: WriteStrategy; run: () => Promise<void> }> = [
    { name: "drop", run: () => target.drop(scene) },
    { name: "paste", run: () => target.paste(scene) },
    { name: "reload", run: () => target.reload(scene) },
  ];

  let lastError = "";
  for (const attempt of attempts) {
    try {
      await attempt.run();
      return { strategy: attempt.name, ok: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { strategy: null, ok: false, error: lastError || "All write strategies failed." };
}

/* -------------------------------------------------------------------------- */
/* Browser implementation                                                     */
/* -------------------------------------------------------------------------- */

export interface DomWriteDeps {
  document: Document;
  localStorage: Storage;
  location: { reload(): void };
  DataTransfer: new () => DataTransfer;
  File: new (parts: BlobPart[], name: string, options?: FilePropertyBag) => File;
  DragEvent: new (type: string, init?: DragEventInit) => DragEvent;
  ClipboardEvent: new (type: string, init?: ClipboardEventInit) => ClipboardEvent;
  KeyboardEvent: new (type: string, init?: KeyboardEventInit) => KeyboardEvent;
  PointerEvent: new (type: string, init?: PointerEventInit) => PointerEvent;
  waitForElement: (selector: string, timeoutMs: number) => Promise<Element | null>;
}

const CONTAINER_SELECTOR = ".excalidraw";

/** Poll + observe until `selector` exists, or resolve `null` on timeout. */
export function waitForElement(
  doc: Document,
  selector: string,
  timeoutMs: number,
): Promise<Element | null> {
  const existing = doc.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      const found = doc.querySelector(selector);
      if (found) {
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        resolve(found);
      }
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    timer = setTimeout(() => {
      observer.disconnect();
      resolve(doc.querySelector(selector));
    }, timeoutMs);
  });
}

/** Build the browser-backed write target. */
export function createDomWriteTarget(deps: DomWriteDeps): WriteTarget {
  async function drop(scene: SceneFile): Promise<void> {
    const container = await deps.waitForElement(CONTAINER_SELECTOR, 8000);
    if (!container) {
      throw new Error("Excalidraw container .excalidraw not found (drop).");
    }

    const file = new deps.File([serializeScene(scene)], SCENE_FILE_NAME, {
      type: SCENE_MIME,
    });
    const dataTransfer = new deps.DataTransfer();
    dataTransfer.items.add(file);

    const rect = container.getBoundingClientRect();
    const event = new deps.DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });

    // Excalidraw's onDrop calls preventDefault(); dispatchEvent returns false
    // when a listener did. A still-true result means nothing handled it.
    const unhandled = container.dispatchEvent(event);
    if (unhandled) {
      throw new Error("Drop event was not handled by Excalidraw.");
    }
  }

  function seedPointer(container: Element): void {
    const rect = container.getBoundingClientRect();
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    container.dispatchEvent(new deps.PointerEvent("pointermove", init));
  }

  function dispatchKey(container: Element, init: KeyboardEventInit): void {
    container.dispatchEvent(
      new deps.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  }

  async function paste(scene: SceneFile): Promise<void> {
    const container = (await deps.waitForElement(CONTAINER_SELECTOR, 4000)) as HTMLElement | null;
    if (!container) {
      throw new Error("Excalidraw container .excalidraw not found (paste).");
    }

    // Paste's guards test the active element and last pointer position.
    container.focus();
    seedPointer(container);

    // Paste APPENDS, so clear the current selection first.
    dispatchKey(container, { key: "a", code: "KeyA", ctrlKey: true, metaKey: true });
    dispatchKey(container, { key: "Delete", code: "Delete" });

    const dataTransfer = new deps.DataTransfer();
    dataTransfer.setData(CLIPBOARD_MIME, buildClipboardText(scene));

    deps.document.dispatchEvent(
      new deps.ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      }),
    );
  }

  async function reload(scene: SceneFile): Promise<void> {
    deps.localStorage.setItem("excalidraw", JSON.stringify(scene.elements));
    deps.localStorage.setItem("excalidraw-state", JSON.stringify(scene.appState));
    // Bump the version so Excalidraw's boot/sync path treats it as newer.
    deps.localStorage.setItem("version-dataState", String(Date.now()));
    deps.location.reload();
  }

  return { drop, paste, reload };
}
