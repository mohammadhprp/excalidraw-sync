/**
 * READ — assemble a `.excalidraw` `SceneFile` from the live page.
 *
 * Source of truth (proven in the investigation):
 *  - `localStorage["excalidraw"]`       → non-deleted elements (JSON array)
 *  - `localStorage["excalidraw-state"]` → filtered appState (JSON object)
 *  - IndexedDB `files-db` / `files-store` → binary images keyed by fileId
 *
 * The assembly is pure so it can be unit-tested against raw fixtures; the
 * IndexedDB read is injected (`files.ts` provides the browser implementation).
 */

import type { SceneFile } from "../lib";

export const ELEMENTS_KEY = "excalidraw";
export const APP_STATE_KEY = "excalidraw-state";
export const THEME_KEY = "excalidraw-theme";

export interface SceneStorage {
  getItem(key: string): string | null;
}

export interface RawSceneInput {
  origin: string;
  elementsRaw: string | null;
  appStateRaw: string | null;
  files: Record<string, unknown>;
}

/** Parse JSON, tolerating corrupt/absent values instead of throwing. */
export function parseElements(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseAppState(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Build a SceneFile from already-parsed pieces. */
export function buildScene(
  elements: unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
  origin: string,
): SceneFile {
  return {
    type: "excalidraw",
    version: 2,
    source: origin,
    elements,
    appState,
    files,
  };
}

/** Pure assembly from raw localStorage strings + a preloaded file map. */
export function assembleScene(input: RawSceneInput): SceneFile {
  return buildScene(
    parseElements(input.elementsRaw),
    parseAppState(input.appStateRaw),
    input.files,
    input.origin,
  );
}

/** Every `fileId` referenced by a (non-deleted) element. */
export function collectReferencedFileIds(elements: unknown[]): string[] {
  const ids = new Set<string>();
  for (const element of elements) {
    if (element && typeof element === "object") {
      const fileId = (element as { fileId?: unknown }).fileId;
      if (typeof fileId === "string" && fileId.length > 0) ids.add(fileId);
    }
  }
  return [...ids];
}

/**
 * Read the live scene: localStorage for elements/appState, an injected reader
 * for the referenced images. A failed image read degrades to `files: {}` so a
 * board without reachable images still syncs its geometry.
 */
export async function readScene(
  storage: SceneStorage,
  origin: string,
  readFiles: (ids: string[]) => Promise<Record<string, unknown>>,
): Promise<SceneFile> {
  const elements = parseElements(storage.getItem(ELEMENTS_KEY));
  const appState = parseAppState(storage.getItem(APP_STATE_KEY));

  let files: Record<string, unknown> = {};
  const ids = collectReferencedFileIds(elements);
  if (ids.length > 0) {
    try {
      files = await readFiles(ids);
    } catch {
      files = {};
    }
  }

  return buildScene(elements, appState, files, origin);
}

/** Panel theme, from the page's stored preference. */
export function readTheme(storage: SceneStorage): "light" | "dark" {
  return storage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}
