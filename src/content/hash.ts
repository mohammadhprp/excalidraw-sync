/**
 * Cheap local-edit detection.
 *
 * FNV-1a over the raw localStorage strings. Good enough to notice "the scene
 * changed" without parsing or diffing a large board on every tick.
 */

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function computeSceneHash(
  elementsRaw: string | null,
  appStateRaw: string | null,
): string {
  return fnv1a(`${elementsRaw ?? ""}\u0000${appStateRaw ?? ""}`);
}
