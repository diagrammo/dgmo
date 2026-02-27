import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';

const DEFAULT_BASE_URL = 'https://diagrammo.app/view';
const COMPRESSED_SIZE_LIMIT = 8192; // 8 KB

export interface DiagramViewState {
  activeTagGroup?: string;
}

export interface DecodedDiagramUrl {
  dsl: string;
  viewState: DiagramViewState;
}

export interface EncodeDiagramUrlOptions {
  baseUrl?: string;
  viewState?: DiagramViewState;
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

  let hash = `dgmo=${compressed}`;

  if (options?.viewState?.activeTagGroup) {
    hash += `&tag=${encodeURIComponent(options.viewState.activeTagGroup)}`;
  }

  // Encode in both query param AND hash fragment — some share mechanisms
  // strip one or the other (iOS share sheet strips #, AirDrop strips ?)
  return { url: `${baseUrl}?${hash}#${hash}` };
}

/**
 * Decode a DGMO DSL string and view state from a URL query string or hash.
 * Accepts any of:
 *   - `?dgmo=<payload>&tag=<name>`
 *   - `#dgmo=<payload>&tag=<name>` (backwards compat)
 *   - `dgmo=<payload>`
 *   - `<bare payload>`
 *
 * Returns `{ dsl, viewState }`. The DSL is empty string on invalid input.
 */
export function decodeDiagramUrl(hash: string): DecodedDiagramUrl {
  const empty: DecodedDiagramUrl = { dsl: '', viewState: {} };
  if (!hash) return empty;

  let raw = hash;

  // Strip leading '#' or '?'
  if (raw.startsWith('#') || raw.startsWith('?')) {
    raw = raw.slice(1);
  }

  // Split on '&' to separate dgmo payload from extra params.
  // lz-string's compressToEncodedURIComponent alphabet (A-Za-z0-9+-$) never
  // produces '&', so this split is safe.
  const parts = raw.split('&');
  let payload = parts[0];

  // Parse extra params (e.g. tag=Location)
  const viewState: DiagramViewState = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    const key = parts[i].slice(0, eq);
    const val = decodeURIComponent(parts[i].slice(eq + 1));
    if (key === 'tag' && val) {
      viewState.activeTagGroup = val;
    }
  }

  // Strip 'dgmo=' prefix
  if (payload.startsWith('dgmo=')) {
    payload = payload.slice(5);
  }

  if (!payload) return { dsl: '', viewState };

  try {
    const result = decompressFromEncodedURIComponent(payload);
    return { dsl: result ?? '', viewState };
  } catch {
    return { dsl: '', viewState };
  }
}
