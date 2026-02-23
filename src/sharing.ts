import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';

const DEFAULT_BASE_URL = 'https://diagrammo.app/view';
const COMPRESSED_SIZE_LIMIT = 8192; // 8 KB

export interface EncodeDiagramUrlOptions {
  baseUrl?: string;
}

export type EncodeDiagramUrlResult =
  | { url: string; error?: undefined }
  | { url?: undefined; error: 'too-large'; compressedSize: number; limit: number };

/**
 * Compress a DGMO DSL string into a shareable URL.
 * Returns `{ url }` on success, or `{ error: 'too-large', compressedSize, limit }` if the
 * compressed payload exceeds the 8 KB limit.
 */
export function encodeDiagramUrl(
  dsl: string,
  options?: EncodeDiagramUrlOptions,
): EncodeDiagramUrlResult {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  const compressed = compressToEncodedURIComponent(dsl);
  const byteSize = new TextEncoder().encode(compressed).byteLength;

  if (byteSize > COMPRESSED_SIZE_LIMIT) {
    return { error: 'too-large', compressedSize: byteSize, limit: COMPRESSED_SIZE_LIMIT };
  }

  return { url: `${baseUrl}#dgmo=${compressed}` };
}

/**
 * Decode a DGMO DSL string from a URL hash.
 * Accepts any of:
 *   - `#dgmo=<payload>`
 *   - `dgmo=<payload>`
 *   - `<bare payload>`
 *
 * Returns the decoded DSL string, or empty string on invalid input.
 */
export function decodeDiagramUrl(hash: string): string {
  if (!hash) return '';

  let payload = hash;

  // Strip leading '#'
  if (payload.startsWith('#')) {
    payload = payload.slice(1);
  }

  // Strip 'dgmo=' prefix
  if (payload.startsWith('dgmo=')) {
    payload = payload.slice(5);
  }

  if (!payload) return '';

  try {
    const result = decompressFromEncodedURIComponent(payload);
    return result ?? '';
  } catch {
    return '';
  }
}
