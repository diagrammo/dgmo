// ============================================================
// Whiteboard diagram — Parser (spec §39)
// ============================================================
//
// One source line = one element, led by its kind keyword:
//
//   rectangle Sign in at: 60 60, size: 180 70
//   ellipse OAuth? at: 345 53, size: 170 84, color: blue
//   arrow from: 240 95, to: 340 95
//   text keep it to ONE screen at: 62 184
//   image login-ideas.assets/9f3c2a71.webp at: 420 200, size: 250 170
//   ink red 3 <encoded path>
//
// The label (or image ref) is the bare-name region before the first `key:`;
// metadata is the same-line `key: value, key: value` idiom every DGMO type
// uses. `color:` is always the long form — it rides with `at:`/`size:` on
// every line, which is when §1.5 asks for the long form. Ink is the one
// positional line, because it is written by a pen and read by nobody.
//
// Leniency: a malformed line is a warning and is skipped. Only a non-
// whiteboard first line or a board with no elements is fatal.

import type { PaletteColors } from '../palettes';
import {
  makeDgmoError,
  makeFail,
  suggest,
  formatDgmoError,
} from '../diagnostics';
import type { Writable } from '../utils/brand';
import { parseFirstLine, recognizeGlobalBoolean } from '../utils/parsing';
import {
  WHITEBOARD_DIAGNOSTIC_CODES as CODES,
  whiteboardMessage,
} from './diagnostics';
import { decodeInk } from './ink-codec';
import type {
  ParsedWhiteboard,
  WhiteboardColor,
  WhiteboardElement,
} from './types';
import {
  WHITEBOARD_COLORS,
  WHITEBOARD_ELEMENT_KEYWORDS,
  isWhiteboardColor,
  isWhiteboardShapeKind,
} from './types';

/**
 * Coordinates and sizes stay within this many px of the origin. Far past any
 * real board, and small enough that a runaway value cannot blow the SVG
 * viewBox up past what a browser draws.
 */
const WHITEBOARD_COORD_MAX = 1_000_000;

/** A metadata key: lowercase word + colon + whitespace or end of line. */
const META_KEY_RE = /(^|\s)([a-z][a-z-]*):(?=\s|$)/;
const INT_PAIR_RE = /^(-?\d+)\s+(-?\d+)$/;
const INK_LINE_RE = /^(\S+)\s+(\S+)\s+(\S+)$/;
const INK_WIDTH_RE = /^\d+(\.\d+)?$/;
/** Largest pen width accepted; a wider stroke is a corrupt line. */
const INK_WIDTH_MAX = 200;

const KEYS_BY_KIND: Record<string, readonly string[]> = {
  shape: ['at', 'size', 'color'],
  arrow: ['from', 'to', 'color'],
  text: ['at', 'color'],
  image: ['at', 'size'],
};

interface Split {
  readonly name: string;
  readonly meta: Map<string, string>;
}

/**
 * Split `rest` (the line after its keyword) into the name region and the
 * metadata map. A name wrapped in quotes is taken verbatim, so a label that
 * itself contains `word:` survives.
 */
function splitLine(rest: string): Split {
  let name: string;
  let metaRegion: string;
  const q = rest[0];
  const close = q === '"' || q === "'" ? rest.indexOf(q, 1) : -1;
  if (close > 0) {
    name = rest.slice(1, close);
    metaRegion = rest.slice(close + 1);
  } else {
    const m = META_KEY_RE.exec(rest);
    if (m) {
      const cut = m.index + m[1]!.length;
      name = rest.slice(0, cut).trim();
      metaRegion = rest.slice(cut);
    } else {
      name = rest.trim();
      metaRegion = '';
    }
  }
  const meta = new Map<string, string>();
  for (const part of metaRegion.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const colon = t.indexOf(':');
    if (colon <= 0) {
      // A comma-split fragment with no key — treat as part of the previous
      // value so `meta` stays well-formed; the geometry check reports it.
      meta.set('', t);
      continue;
    }
    meta.set(t.slice(0, colon).trim().toLowerCase(), t.slice(colon + 1).trim());
  }
  return { name: name.trim(), meta };
}

/** Is `ref` a relative path or an https URL (the only two image forms)? */
export function isWhiteboardImageRef(ref: string): boolean {
  if (/^https:\/\/\S+$/i.test(ref)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false; // any other scheme
  if (ref.startsWith('/') || ref.startsWith('\\')) return false;
  return ref.length > 0;
}

export function parseWhiteboard(
  content: string,
  _palette?: PaletteColors
): ParsedWhiteboard {
  const options = { noTitle: false };
  const elements: WhiteboardElement[] = [];
  const result: Writable<ParsedWhiteboard> = {
    type: 'whiteboard',
    title: null,
    titleLineNumber: null,
    elements,
    options,
    diagnostics: [],
    error: null,
  };
  const fail = makeFail(result);
  const warn = (
    line: number,
    code: (typeof CODES)[keyof typeof CODES],
    params: Record<string, unknown>
  ): void => {
    result.diagnostics.push(
      makeDgmoError(line, whiteboardMessage(code, params), 'warning', code)
    );
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const readColor = (
    raw: string | undefined,
    line: number
  ): WhiteboardColor => {
    if (raw === undefined) return 'ink';
    const c = raw.trim().toLowerCase();
    if (isWhiteboardColor(c)) return c;
    warn(line, CODES.UNKNOWN_COLOR, {
      color: raw,
      hint: suggest(c, WHITEBOARD_COLORS) ?? '',
    });
    return 'ink';
  };

  /** Two integers, in range; null (with a warning) otherwise. */
  const readPair = (
    meta: Map<string, string>,
    key: string,
    element: string,
    line: number,
    positive: boolean
  ): [number, number] | null => {
    const raw = meta.get(key);
    const m = raw === undefined ? null : INT_PAIR_RE.exec(raw);
    if (!m) {
      warn(line, CODES.BAD_GEOMETRY, {
        element,
        need: `${key}: <x> <y> as two whole numbers`,
        got: raw === undefined ? `no ${key}:` : `"${raw}"`,
      });
      return null;
    }
    const a = Number(m[1]);
    const b = Number(m[2]);
    const bad = (v: number): boolean =>
      Math.abs(v) > WHITEBOARD_COORD_MAX || (positive && v < 1);
    if (bad(a) || bad(b)) {
      warn(line, CODES.OUT_OF_RANGE, {
        key,
        raw,
        max: WHITEBOARD_COORD_MAX,
      });
      return null;
    }
    return [a, b];
  };

  const checkKeys = (
    meta: Map<string, string>,
    kind: string,
    element: string,
    line: number
  ): void => {
    const valid = KEYS_BY_KIND[kind]!;
    for (const key of meta.keys()) {
      if (key === '' || valid.includes(key)) continue;
      warn(line, CODES.UNKNOWN_KEY, {
        key,
        element,
        valid: valid.map((k) => `${k}:`).join(', '),
        hint: suggest(key, valid) ?? '',
      });
    }
  };

  const lines = content.split('\n');
  let firstLineSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const trimmed = lines[i]!.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!firstLineSeen) {
      firstLineSeen = true;
      const first = parseFirstLine(trimmed);
      if (first?.chartType !== 'whiteboard') {
        let msg = `Expected chart type "whiteboard", got "${first?.chartType ?? trimmed.split(/\s+/)[0]}"`;
        const hint = suggest(first?.chartType ?? '', ['whiteboard']);
        if (hint) msg += `. ${hint}`;
        return fail(lineNumber, msg);
      }
      result.title = first.title ?? null;
      result.titleLineNumber = lineNumber;
      continue;
    }

    // §1.9 universal flags — `no-title` means something here, the rest are
    // harmless no-ops rather than unknown elements.
    const shared = recognizeGlobalBoolean(trimmed);
    if (shared !== null) {
      if (shared === 'no-title') options.noTitle = true;
      continue;
    }

    const sp = trimmed.search(/\s/);
    const word = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? '' : trimmed.slice(sp + 1).trim();

    if (word === 'ink') {
      const m = INK_LINE_RE.exec(rest);
      if (!m) {
        warn(lineNumber, CODES.BAD_INK, {
          reason: 'expected `ink <colour> <width> <encoded path>`',
        });
        continue;
      }
      const color = readColor(m[1], lineNumber);
      const widthRaw = m[2]!;
      const width = Number(widthRaw);
      if (!INK_WIDTH_RE.test(widthRaw) || width <= 0 || width > INK_WIDTH_MAX) {
        warn(lineNumber, CODES.BAD_INK, {
          reason: `width "${widthRaw}" must be a number above 0 and at most ${INK_WIDTH_MAX}`,
        });
        continue;
      }
      const decoded = decodeInk(m[3]!);
      if (decoded.error !== null || decoded.points.length === 0) {
        warn(lineNumber, CODES.BAD_INK, {
          reason: decoded.error ?? 'the stroke has no points',
        });
        continue;
      }
      if (
        decoded.points.some(
          (p) =>
            Math.abs(p.x) > WHITEBOARD_COORD_MAX ||
            Math.abs(p.y) > WHITEBOARD_COORD_MAX
        )
      ) {
        warn(lineNumber, CODES.BAD_INK, {
          reason: `a point lies beyond ±${WHITEBOARD_COORD_MAX} px`,
        });
        continue;
      }
      elements.push({
        kind: 'ink',
        color,
        width,
        encoded: m[3]!,
        points: decoded.points,
        lineNumber,
      });
      continue;
    }

    if (isWhiteboardShapeKind(word)) {
      const { name, meta } = splitLine(rest);
      checkKeys(meta, 'shape', word, lineNumber);
      const at = readPair(meta, 'at', word, lineNumber, false);
      if (!at) continue;
      const size = readPair(meta, 'size', word, lineNumber, true);
      if (!size) continue;
      elements.push({
        kind: 'shape',
        shape: word,
        x: at[0],
        y: at[1],
        width: size[0],
        height: size[1],
        label: name,
        color: readColor(meta.get('color'), lineNumber),
        lineNumber,
      });
      continue;
    }

    if (word === 'arrow') {
      const { name, meta } = splitLine(rest);
      checkKeys(meta, 'arrow', 'arrow', lineNumber);
      const from = readPair(meta, 'from', 'arrow', lineNumber, false);
      if (!from) continue;
      const to = readPair(meta, 'to', 'arrow', lineNumber, false);
      if (!to) continue;
      elements.push({
        kind: 'arrow',
        x1: from[0],
        y1: from[1],
        x2: to[0],
        y2: to[1],
        label: name,
        color: readColor(meta.get('color'), lineNumber),
        lineNumber,
      });
      continue;
    }

    if (word === 'text') {
      const { name, meta } = splitLine(rest);
      checkKeys(meta, 'text', 'text', lineNumber);
      if (!name) {
        warn(lineNumber, CODES.EMPTY_TEXT, {});
        continue;
      }
      const at = readPair(meta, 'at', 'text', lineNumber, false);
      if (!at) continue;
      elements.push({
        kind: 'text',
        x: at[0],
        y: at[1],
        text: name,
        color: readColor(meta.get('color'), lineNumber),
        lineNumber,
      });
      continue;
    }

    if (word === 'image') {
      const { name, meta } = splitLine(rest);
      checkKeys(meta, 'image', 'image', lineNumber);
      if (!isWhiteboardImageRef(name)) {
        warn(lineNumber, CODES.BAD_IMAGE_REF, { ref: name });
        continue;
      }
      const at = readPair(meta, 'at', 'image', lineNumber, false);
      if (!at) continue;
      const size = readPair(meta, 'size', 'image', lineNumber, true);
      if (!size) continue;
      elements.push({
        kind: 'image',
        ref: name,
        x: at[0],
        y: at[1],
        width: size[0],
        height: size[1],
        lineNumber,
      });
      continue;
    }

    warn(lineNumber, CODES.UNKNOWN_ELEMENT, {
      word,
      hint: suggest(word, WHITEBOARD_ELEMENT_KEYWORDS) ?? '',
    });
  }

  if (!firstLineSeen) return fail(0, 'No content provided');

  if (elements.length === 0 && !result.error) {
    const diag = makeDgmoError(1, 'No elements found in whiteboard');
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }
  return result;
}
