/** Path and slug helpers for the repo layout: `<rootPath>/<collection>/<board>.excalidraw`. */

/** Extension used for every board file. */
export const BOARD_EXTENSION = ".excalidraw";

/**
 * Stem used when a board name sanitizes to nothing (e.g. `".."`, `"."` or an
 * empty string), so a board file is never written as a bare `.excalidraw`.
 */
export const FALLBACK_BOARD_SLUG = "board";

/**
 * Per-collection marker file, holding `{"name":"<display name>"}`.
 *
 * One marker per collection directory (never a shared manifest), so there are
 * no cross-collection write conflicts. It also materialises the directory —
 * the Contents API cannot create an empty directory — and is non-empty by
 * construction, avoiding the API's empty-body `422`.
 */
export const COLLECTION_MARKER = ".collection.json";

/**
 * Turn a display name into a safe directory/file slug.
 *
 * Preserves Unicode letters and digits (so non-Latin names stay meaningful and
 * round-trip) while collapsing everything else — path separators, dots and
 * whitespace included — to a single hyphen. The result never contains `/`,
 * `.` or a leading/trailing hyphen; it may be empty when the input has no
 * letters or digits at all.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Join non-empty path segments with a single slash. */
export function joinPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0)
    .join("/");
}

/**
 * Repo path for a board file.
 *
 * The board name is always sanitized through `slugify`, including when it
 * already carries the `.excalidraw` extension, so no name — however
 * adversarial — can escape `<rootPath>/<collection>/`. A name whose stem
 * sanitizes to nothing falls back to `FALLBACK_BOARD_SLUG`.
 */
export function boardFilePath(
  rootPath: string,
  collectionSlug: string,
  boardName: string,
): string {
  const stem = boardName.endsWith(BOARD_EXTENSION)
    ? boardName.slice(0, -BOARD_EXTENSION.length)
    : boardName;
  const slug = slugify(stem) || FALLBACK_BOARD_SLUG;
  return joinPath(rootPath, collectionSlug, `${slug}${BOARD_EXTENSION}`);
}

export interface ParsedBoardPath {
  collection: string;
  file: string;
  board: string;
}

/**
 * Split a board repo path into its collection slug and board name.
 * The root path may itself be nested; only the last two segments matter.
 */
export function parseBoardPath(path: string): ParsedBoardPath {
  const parts = path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((part) => part.length > 0);
  const file = parts.at(-1) ?? "";
  const collection = parts.length >= 2 ? (parts.at(-2) ?? "") : "";
  const board = file.endsWith(BOARD_EXTENSION)
    ? file.slice(0, -BOARD_EXTENSION.length)
    : file;
  return { collection, file, board };
}

/** Repo path for a collection's marker file. */
export function collectionMarkerPath(
  rootPath: string,
  collectionSlug: string,
): string {
  return joinPath(rootPath, collectionSlug, COLLECTION_MARKER);
}

/**
 * Parse a collection marker's JSON and return its display name, or `null` when
 * the payload is malformed or carries no usable non-empty string name.
 */
export function parseCollectionName(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "name" in parsed) {
      const name = (parsed as { name?: unknown }).name;
      if (typeof name === "string" && name.trim().length > 0) {
        return name;
      }
    }
  } catch {
    // Malformed marker: caller falls back to the slug.
  }
  return null;
}
