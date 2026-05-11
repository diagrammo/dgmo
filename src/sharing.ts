import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';

const DEFAULT_BASE_URL = 'https://online.diagrammo.app';
const COMPRESSED_SIZE_LIMIT = 8192; // 8 KB

/**
 * Compact view state schema (ADR-6).
 * All fields optional. Only non-default values are encoded.
 * `tag: null` means "user chose none"; absent `tag` means "use DSL default" (ADR-5).
 */
export interface CompactViewState {
  tag?: string | null; // active tag override (null = "none")
  cs?: number[]; // collapsed sections (sequence line numbers)
  cg?: string[]; // collapsed groups/nodes (IDs or names)
  swim?: string | null; // swimlane tag group
  cl?: string[]; // collapsed lanes
  cc?: string[]; // collapsed columns (kanban)
  rm?: string; // render mode override
  htv?: Record<string, string[]>; // hidden tag values
  ha?: string[]; // hidden attributes
  sem?: boolean; // semantic colors (ER)
  cm?: boolean; // compact meta (kanban)
  c4l?: string; // C4 level
  c4s?: string; // C4 system
  c4c?: string; // C4 container
  rps?: number; // RPS multiplier (infra)
  spd?: number; // playback speed (infra)
  io?: Record<string, number>; // instance overrides (infra)
  hd?: boolean; // hide descriptions (mindmap)
  cbd?: boolean; // color by depth (mindmap)
  rq?: string; // radar quadrant focus (tech-radar position)
  an?: boolean; // analysis layer on (PERT: tornado + S-curve)
  fl?: boolean; // field-labels reference card included (PERT)
}

export interface DecodedDiagramUrl {
  dsl: string;
  viewState: CompactViewState;
  palette?: string;
  theme?: 'light' | 'dark';
  filename?: string;
}

export interface EncodeDiagramUrlOptions {
  baseUrl?: string;
  viewState?: CompactViewState;
  palette?: string;
  theme?: 'light' | 'dark';
  filename?: string;
}

export type EncodeDiagramUrlResult =
  | { url: string; error?: undefined }
  | {
      url?: undefined;
      error: 'too-large';
      compressedSize: number;
      limit: number;
    };

/**
 * Encode a CompactViewState to a compressed string for URL embedding.
 * Returns empty string if state has no keys (ADR-4).
 */
export function encodeViewState(state: CompactViewState): string {
  const keys = Object.keys(state);
  if (keys.length === 0) return '';
  return compressToEncodedURIComponent(JSON.stringify(state));
}

/**
 * Decode a compressed view state string back to CompactViewState.
 * Returns empty object on failure (no crash).
 */
export function decodeViewState(encoded: string): CompactViewState {
  if (!encoded) return {};
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return {};
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return {};
    return parsed as CompactViewState;
  } catch {
    return {};
  }
}

/**
 * Compress a DGMO DSL string into a shareable URL.
 * Returns `{ url }` on success, or `{ error: 'too-large', compressedSize, limit }` if the
 * compressed payload exceeds the 8 KB limit.
 */
export function encodeDiagramUrl(
  dsl: string,
  options?: EncodeDiagramUrlOptions
): EncodeDiagramUrlResult {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  const compressed = compressToEncodedURIComponent(dsl);
  const byteSize = new TextEncoder().encode(compressed).byteLength;

  if (byteSize > COMPRESSED_SIZE_LIMIT) {
    return {
      error: 'too-large',
      compressedSize: byteSize,
      limit: COMPRESSED_SIZE_LIMIT,
    };
  }

  let hash = `dgmo=${compressed}`;

  // View state as single compressed blob (ADR-1)
  if (options?.viewState) {
    const vsEncoded = encodeViewState(options.viewState);
    if (vsEncoded) {
      hash += `&vs=${vsEncoded}`;
    }
  }

  // Palette and theme are app-level, kept as separate params
  if (options?.palette && options.palette !== 'nord') {
    hash += `&pal=${encodeURIComponent(options.palette)}`;
  }

  if (options?.theme && options.theme !== 'dark') {
    hash += `&th=${encodeURIComponent(options.theme)}`;
  }

  if (options?.filename) {
    hash += `&fn=${encodeURIComponent(options.filename)}`;
  }

  // Encode in both query param AND hash fragment — some share mechanisms
  // strip one or the other (iOS share sheet strips #, AirDrop strips ?)
  return { url: `${baseUrl}?${hash}#${hash}` };
}

/**
 * Decode a DGMO DSL string and view state from a URL query string or hash.
 * Accepts any of:
 *   - `?dgmo=<payload>&vs=<state>`
 *   - `#dgmo=<payload>&vs=<state>` (backwards compat)
 *   - `dgmo=<payload>`
 *   - `<bare payload>`
 *
 * Returns `{ dsl, viewState }`. The DSL is empty string on invalid input.
 */
export function decodeDiagramUrl(hash: string): DecodedDiagramUrl {
  const empty: DecodedDiagramUrl = { dsl: '', viewState: {} };
  let filename: string | undefined;
  let palette: string | undefined;
  let theme: 'light' | 'dark' | undefined;
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

  // Parse extra params
  let viewState: CompactViewState = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    const key = parts[i].slice(0, eq);
    const val = parts[i].slice(eq + 1);
    if (key === 'vs' && val) {
      viewState = decodeViewState(val);
    }
    if (key === 'pal' && val) palette = decodeURIComponent(val);
    if (key === 'th') {
      const decoded = decodeURIComponent(val);
      if (decoded === 'light' || decoded === 'dark') theme = decoded;
    }
    if (key === 'fn' && val) filename = decodeURIComponent(val);
  }

  // Strip 'dgmo=' prefix
  if (payload.startsWith('dgmo=')) {
    payload = payload.slice(5);
  }

  if (!payload) return { dsl: '', viewState, palette, theme, filename };

  try {
    const result = decompressFromEncodedURIComponent(payload);
    return { dsl: result ?? '', viewState, palette, theme, filename };
  } catch {
    return { dsl: '', viewState, palette, theme, filename };
  }
}
