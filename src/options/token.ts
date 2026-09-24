/**
 * Token patch helper for the extension options page.
 *
 * This module lives outside `src/content/**` and `src/ui/**` on purpose: the
 * content script and panel never handle a PAT. The options page is an
 * extension-origin document that talks to the worker via the frozen protocol.
 */

import type { Settings } from "../lib";

/** Write-only token patch; `null` for an empty field (nothing to persist). */
export function buildTokenPatch(token: string): Partial<Settings> | null {
  const trimmed = token.trim();
  return trimmed.length > 0 ? { token: trimmed } : null;
}
