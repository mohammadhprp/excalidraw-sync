import { DEFAULT_SETTINGS } from "../lib/defaults";
import type { PublicSettings, Settings } from "../lib/types";

/** Key under which the full settings object is persisted. */
export const SETTINGS_KEY = "settings";

/** Storage abstraction so the router can be tested without `chrome`. */
export interface SettingsStore {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<Settings>;
}

/** Shallow-merge a patch, deep-merging the nested `author` identity. */
export function mergeSettings(
  current: Settings,
  patch: Partial<Settings>,
): Settings {
  return {
    ...current,
    ...patch,
    author: { ...current.author, ...patch.author },
  };
}

/**
 * Content-script-safe view of the settings: every field except `token`, with a
 * boolean `hasToken` in its place. The token can never cross this boundary.
 */
export function toPublicSettings(settings: Settings): PublicSettings {
  const rest: Omit<Settings, "token"> = {
    owner: settings.owner,
    repo: settings.repo,
    branch: settings.branch,
    rootPath: settings.rootPath,
    commitMessageTemplate: settings.commitMessageTemplate,
    author: settings.author,
    smartSync: settings.smartSync,
    smartSyncDelayMs: settings.smartSyncDelayMs,
  };
  return {
    ...rest,
    hasToken: typeof settings.token === "string" && settings.token.length > 0,
  };
}

function cloneSettings(settings: Settings): Settings {
  return { ...settings, author: { ...settings.author } };
}

/** In-memory store, primarily for tests. */
export function createMemorySettingsStore(
  initial: Partial<Settings> = {},
): SettingsStore {
  let current = mergeSettings(DEFAULT_SETTINGS, initial);
  return {
    async get() {
      return cloneSettings(current);
    },
    async set(patch) {
      current = mergeSettings(current, patch);
      return cloneSettings(current);
    },
  };
}

/** `chrome.storage.local`-backed store used by the real service worker. */
export function createChromeSettingsStore(): SettingsStore {
  const area = chrome.storage.local;

  const get = async (): Promise<Settings> => {
    const stored = await area.get(SETTINGS_KEY);
    const raw = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
    return raw ? mergeSettings(DEFAULT_SETTINGS, raw) : cloneSettings(DEFAULT_SETTINGS);
  };

  const set = async (patch: Partial<Settings>): Promise<Settings> => {
    const next = mergeSettings(await get(), patch);
    await area.set({ [SETTINGS_KEY]: next });
    return cloneSettings(next);
  };

  return { get, set };
}
