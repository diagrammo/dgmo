// ============================================================
// Whiteboard — ink stroke codec (spec §39.6)
// ============================================================
//
// cspell:ignore Ramer Peucker varint Varint unzigzag quantised
//
// One stroke ⇄ one short ASCII token, so a 200-stroke board stays a few tens
// of kilobytes of source. Public API: the app's canvas encodes with the same
// function the parser decodes with, so the two cannot drift.
//
// Pipeline (encode):
//   1. Ramer–Douglas–Peucker simplification on x/y (tolerance `tolerance`, px)
//   2. round x/y to integer canvas pixels; drop consecutive duplicates
//   3. optional pressure channel, quantised to 0..PRESSURE_LEVELS
//   4. delta-encode every channel against the previous point
//   5. zigzag + LEB128 varint each number
//   6. base64url (RFC 4648 §5, no padding)
//
// Byte layout before base64url:
//   [flags] [x0 y0 (p0)] [dx dy (dp)] …
//   flags bit 0 = pressure channel present; bits 1-7 = format version (0).
// The first point is absolute (zigzag, so negative canvas coordinates work).
//
// The output alphabet is [A-Za-z0-9_-]: no spaces, no backticks, nothing a
// markdown code fence or a DGMO line reader treats specially.

/** One sampled pen position. `pressure` is 0..1 when the device reports it. */
export interface InkPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface EncodeInkOptions {
  /**
   * RDP tolerance in canvas px. Points closer than this to the simplified
   * polyline are dropped. Default {@link INK_DEFAULT_TOLERANCE}.
   */
  readonly tolerance?: number;
}

export interface InkDecodeResult {
  /** Decoded points; empty when `error` is set. */
  readonly points: InkPoint[];
  /** Why the payload could not be read, or null when it decoded cleanly. */
  readonly error: string | null;
}

/** Default RDP tolerance, px. Measured in `tests/whiteboard-ink-codec.test.ts`. */
export const INK_DEFAULT_TOLERANCE = 0.75;
/** Pressure is stored as an integer 0..PRESSURE_LEVELS. */
export const INK_PRESSURE_LEVELS = 31;

const FLAG_PRESSURE = 1;
const FORMAT_VERSION = 0;
/** A stroke longer than this many points is refused on decode (corrupt input). */
const MAX_DECODED_POINTS = 100_000;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX: Record<string, number> = Object.fromEntries(
  [...B64].map((c, i) => [c, i])
);

// ── RDP ─────────────────────────────────────────────────────

function perpDistSq(p: InkPoint, a: InkPoint, b: InkPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const ex = p.x - (a.x + t * dx);
  const ey = p.y - (a.y + t * dy);
  return ex * ex + ey * ey;
}

/** Ramer–Douglas–Peucker, iterative (a long stroke must not blow the stack). */
function simplify(points: readonly InkPoint[], tolerance: number): InkPoint[] {
  if (points.length <= 2 || tolerance <= 0) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const tolSq = tolerance * tolerance;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistSq(points[i]!, points[first]!, points[last]!);
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (index !== -1 && maxD > tolSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

// ── varint ──────────────────────────────────────────────────

function zigzag(n: number): number {
  return n >= 0 ? n * 2 : -n * 2 - 1;
}

function unzigzag(n: number): number {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

function pushVarint(out: number[], value: number): void {
  // Plain arithmetic, not bit ops: a coordinate's zigzag can exceed 2^31.
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

// ── base64url ───────────────────────────────────────────────

function toBase64Url(bytes: readonly number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    s += B64[b0 >> 2]!;
    s += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) s += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) s += B64[b2 & 63]!;
  }
  return s;
}

function fromBase64Url(s: string): number[] | null {
  if (s.length % 4 === 1) return null;
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64_INDEX[ch];
    if (v === undefined) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

// ── public API ──────────────────────────────────────────────

/**
 * Encode one stroke. Coordinates are canvas px; they are rounded to integers.
 * The pressure channel is written only when EVERY point carries `pressure`
 * (a device either reports it or it does not).
 */
export function encodeInk(
  points: readonly InkPoint[],
  opts: EncodeInkOptions = {}
): string {
  const tolerance = opts.tolerance ?? INK_DEFAULT_TOLERANCE;
  const finite = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  const hasPressure =
    finite.length > 0 &&
    finite.every((p) => typeof p.pressure === 'number' && isFinite(p.pressure));
  const simplified = simplify(finite, tolerance);

  const rounded: InkPoint[] = [];
  for (const p of simplified) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const prev = rounded[rounded.length - 1];
    if (prev?.x === x && prev.y === y) continue;
    rounded.push(
      hasPressure
        ? {
            x,
            y,
            pressure: Math.round(
              Math.max(0, Math.min(1, p.pressure!)) * INK_PRESSURE_LEVELS
            ),
          }
        : { x, y }
    );
  }

  const bytes: number[] = [
    (FORMAT_VERSION << 1) | (hasPressure ? FLAG_PRESSURE : 0),
  ];
  let px = 0;
  let py = 0;
  let pp = 0;
  for (const p of rounded) {
    pushVarint(bytes, zigzag(p.x - px));
    pushVarint(bytes, zigzag(p.y - py));
    px = p.x;
    py = p.y;
    if (hasPressure) {
      pushVarint(bytes, zigzag(p.pressure! - pp));
      pp = p.pressure!;
    }
  }
  return toBase64Url(bytes);
}

/**
 * Decode one stroke. Never throws: a corrupt payload comes back as
 * `{ points: [], error }` so the parser can turn it into a diagnostic.
 * Decoded pressure is back on the 0..1 scale.
 */
export function decodeInk(encoded: string): InkDecodeResult {
  const fail = (error: string): InkDecodeResult => ({ points: [], error });
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return fail('empty ink payload');
  }
  const bytes = fromBase64Url(encoded);
  if (!bytes?.length) {
    return fail('ink payload is not base64url');
  }
  const flags = bytes[0]!;
  if (flags >> 1 !== FORMAT_VERSION) {
    return fail(`unknown ink format version ${String(flags >> 1)}`);
  }
  const hasPressure = (flags & FLAG_PRESSURE) !== 0;

  let pos = 1;
  const readVarint = (): number | null => {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      if (pos >= bytes.length) return null;
      const b = bytes[pos++]!;
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return unzigzag(result);
      mul *= 0x80;
    }
    return null;
  };

  const points: InkPoint[] = [];
  let x = 0;
  let y = 0;
  let p = 0;
  while (pos < bytes.length) {
    const dx = readVarint();
    const dy = readVarint();
    const dp = hasPressure ? readVarint() : 0;
    if (dx === null || dy === null || dp === null) {
      return fail('ink payload is truncated');
    }
    x += dx;
    y += dy;
    p += dp;
    if (hasPressure && (p < 0 || p > INK_PRESSURE_LEVELS)) {
      return fail('ink pressure out of range');
    }
    points.push(
      hasPressure ? { x, y, pressure: p / INK_PRESSURE_LEVELS } : { x, y }
    );
    if (points.length > MAX_DECODED_POINTS) {
      return fail('ink payload is too long');
    }
  }
  return { points, error: null };
}
