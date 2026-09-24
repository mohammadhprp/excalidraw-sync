/** UTF-8-safe Base64 helpers usable in both the service worker and Node tests. */

/** Encode a string as Base64, preserving non-ASCII characters. */
export function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Decode a Base64 string as UTF-8. Whitespace (GitHub wraps content) is ignored. */
export function decodeBase64Utf8(input: string): string {
  const normalized = input.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
