// ============================================================
// Shared text measurement
// ============================================================
// One source of truth for "how wide is this string?" Before this
// module, ~30 renderers/layouts each carried their own char-width
// estimate (7.5px, 7px, 0.6·fontSize, 0.58, 0.55 …). The drift meant
// the same label measured differently per chart type — a label could
// fit inside an org node but overflow an infra node. All sizing,
// wrapping, and truncation now route through the per-glyph table here.

// The table is Inter's own advance widths, generated from the shipped TTFs by
// scripts/build-text-metrics.mjs. It was a hand-copied Helvetica table until
// 2026-08-09, which is not the font any renderer draws: FONT_FAMILY has put
// Inter first for as long as fonts/ has existed, and Inter is the wider face.
// Every chart type therefore under-measured by ~8% and wrapped one word too
// late — visible first on journey-map cards, whose text is real prose in a
// narrow box with nothing clipping it (issue 147).
import {
  INTER_BOLD_W,
  INTER_DEFAULT_W,
  INTER_REGULAR_W,
} from './inter-metrics';
// Anything the table above does not cover — CJK, Hangul, Devanagari, Thai,
// Arabic, Hebrew — used to take one flat fallback ratio per codepoint, which
// measured full-width scripts 40% narrow and combining ones up to 63% wide
// (issue 170). script-metrics.ts is hand-written for a reason: inter-metrics.ts
// is regenerated on every prebuild.
import { graphemeClusters, uncoveredWidthRatio } from './script-metrics';

const DEFAULT_W = INTER_DEFAULT_W;

/**
 * Which of the two shipped faces a run of text is drawn in.
 *
 * Only 400 and 700 exist — `fonts/` ships `Inter-Regular.ttf` and
 * `Inter-Bold.ttf`, and the app declares exactly those two `@font-face`
 * weights. An intermediate weight is therefore not an intermediate width: it
 * lands on one of the two faces, and which one is NOT simply "the nearest".
 * CSS font matching walks *upward* first for any weight above 500, so
 *
 *     400, 500        → the Regular face
 *     600, 700, 800   → the Bold face
 *
 * Verified by rasterising the same string at all four weights through resvg
 * with only these two TTFs loaded: the PNGs come out identical in exactly
 * those two groups. 600 is the most common emphasis weight in this codebase,
 * and reading it as regular is what left ~20 sites mis-measured after the
 * first sweep (issues 167, 168).
 *
 * Pass `bold` wherever the run is drawn at 600 or above — and only there.
 */
export interface MeasureOpts {
  bold?: boolean;
}

const tableFor = (opts?: MeasureOpts): Record<string, number> =>
  opts?.bold ? INTER_BOLD_W : INTER_REGULAR_W;

/**
 * Average glyph-width ratio (fraction of fontSize). Only for the rare
 * call site that needs a single scalar (e.g. estimating a max char count
 * up front). Prefer {@link measureText} / {@link wrapTextToWidth} —
 * they account for actual glyph widths.
 */
export const CHAR_WIDTH_RATIO = DEFAULT_W;

// The width model is a pure left-to-right fold over per-char ratios, and the
// same (text, fontSize) pairs recur heavily across layouts (dagre node sizing
// can run ~89 layouts per render). Memoize whole-string results; capped so
// unbounded distinct labels can't grow the map forever.
const MEASURE_CACHE = new Map<string, number>();
const MEASURE_CACHE_MAX = 10000;

/**
 * Extend a running width `acc` with `text`'s characters, in the same
 * left-to-right fold order `measureText` uses. Continuing the fold this way is
 * bit-identical to measuring the concatenated string whole (per-char additive
 * model, no kerning), which lets wrap/truncate accumulate widths incrementally
 * instead of re-measuring growing strings.
 *
 * That promise survives the per-script fallback because a combining mark is
 * charged zero **wherever it appears** — the fold stays additive per codepoint,
 * so it does not matter whether a cluster arrives whole or in pieces. The one
 * thing a caller must not do is split a surrogate pair; every caller here steps
 * by grapheme cluster, which cannot.
 */
function extendWidth(
  acc: number,
  text: string,
  fontSize: number,
  opts?: MeasureOpts
): number {
  const table = tableFor(opts);
  let w = acc;
  for (let i = 0; i < text.length; i++) {
    // charAt returns '' for out-of-bounds, never undefined.
    const covered = table[text.charAt(i)];
    if (covered !== undefined) {
      w += covered * fontSize;
      continue;
    }
    // Outside the table: read the whole codepoint, since a surrogate pair is
    // one character and charging it twice is what made CJK 40% narrow.
    const cp = text.codePointAt(i);
    if (cp === undefined) continue;
    if (cp > 0xffff) i++;
    w += uncoveredWidthRatio(cp) * fontSize;
  }
  return w;
}

/** Estimate rendered text width using Inter's proportional advance widths. */
export function measureText(
  text: string,
  fontSize: number,
  opts?: MeasureOpts
): number {
  const key = `${opts?.bold ? 'b' : 'r'}|${fontSize}|${text}`;
  const cached = MEASURE_CACHE.get(key);
  if (cached !== undefined) return cached;
  const w = extendWidth(0, text, fontSize, opts);
  if (MEASURE_CACHE.size >= MEASURE_CACHE_MAX) MEASURE_CACHE.clear();
  MEASURE_CACHE.set(key, w);
  return w;
}

/**
 * Truncate text with a trailing ellipsis to fit within maxWidth.
 * Returns the original text if it already fits, or '' if even the
 * ellipsis alone won't fit.
 */
export function truncateText(
  text: string,
  fontSize: number,
  maxWidth: number,
  opts?: MeasureOpts
): string {
  if (measureText(text, fontSize, opts) <= maxWidth) return text;
  const ellipsis = '…';
  const ellipsisW = measureText(ellipsis, fontSize, opts);
  if (ellipsisW > maxWidth) return '';
  // Cumulative prefix widths, computed once: prefix[i] equals
  // measureText(the first i clusters, fontSize) exactly (same fold order), so
  // the bisection below never re-measures slices.
  //
  // The step is a grapheme cluster, not a UTF-16 unit, so the cut can only land
  // between characters a reader would read as separate — never between a
  // Devanagari consonant and its vowel sign, and never inside a surrogate pair.
  const clusters = graphemeClusters(text);
  const prefix: number[] = [0];
  for (let i = 0; i < clusters.length; i++) {
    prefix.push(extendWidth(prefix[i]!, clusters[i]!, fontSize, opts));
  }
  let lo = 0;
  let hi = clusters.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (prefix[mid]! + ellipsisW <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo === 0 ? ellipsis : clusters.slice(0, lo).join('') + ellipsis;
}

/**
 * Greedy word-wrap to a pixel width using accurate glyph measurement.
 *
 * - Splits on whitespace; a word that alone exceeds `maxWidth` is kept
 *   whole unless `hardBreak` is set, in which case it is broken at the
 *   character boundary that fits.
 * - Returns at least one line (`['']` for empty input).
 */
/**
 * Where a single token may be broken, beyond the spaces `wrapTextToWidth`
 * already splits on.
 *
 * Added 2026-08-30 (#586). A label like `SpyglassFeedService` or
 * `powder_store_queue` is ONE word, so the wrapper had nowhere to break it and
 * fell through to `hardBreak`, which chops by grapheme cluster — mid-word, and
 * unreadable. The three opportunities, in the order the request named them:
 *
 * - a space, which the caller has already split on;
 * - `_` or `-`, breaking AFTER the separator so it stays on the end of the
 *   preceding line, the way a hyphenated word reads on paper;
 * - a camelCase boundary, inserting nothing: lower-or-digit followed by upper,
 *   and the last capital of an acronym run before a capitalised word, so
 *   `HTTPServer` gives `HTTP` + `Server` rather than splitting inside the run.
 *
 * 🔴 Atoms CONCATENATE, they are never re-joined with a space. So segmenting a
 * token that fits its line whole is a no-op — the pieces land back together and
 * the output is byte-identical to the unsegmented one. That is why this can run
 * unconditionally rather than only when a word overflows, and why it cannot
 * change what any existing caller renders unless a break was needed anyway.
 */
export function breakAtoms(word: string): string[] {
  const upper = (c: string): boolean => c >= 'A' && c <= 'Z';
  const lowerOrDigit = (c: string): boolean =>
    (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i]!;
    current += c;
    if (c === '_' || c === '-') {
      // After the separator: it belongs to the line it ends.
      out.push(current);
      current = '';
      continue;
    }
    const next = word[i + 1];
    if (next === undefined) continue;
    const boundary =
      (lowerOrDigit(c) && upper(next)) ||
      // An acronym run ending where a capitalised word begins.
      (upper(c) &&
        upper(next) &&
        word[i + 2] !== undefined &&
        lowerOrDigit(word[i + 2]!));
    if (boundary) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out.length > 0 ? out : [word];
}

export function wrapTextToWidth(
  text: string,
  fontSize: number,
  maxWidth: number,
  opts?: MeasureOpts & { hardBreak?: boolean }
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const hardBreak = opts?.hardBreak ?? false;
  const spaceW = (tableFor(opts)[' '] ?? DEFAULT_W) * fontSize;
  const lines: string[] = [];
  let current = '';
  // Running width of `current`, extended incrementally instead of re-measuring
  // the growing line per word (O(n²) → O(n)). Continuing the char fold gives
  // bit-identical widths to measuring the joined string whole.
  let currentW = 0;
  // 🔴 Each word becomes its ATOMS, which concatenate rather than re-joining
  // with a space — see `breakAtoms`. Only the first atom of a word takes the
  // space that separated it from the word before.
  const atoms: { text: string; sep: string }[] = [];
  for (const word of words) {
    const pieces = breakAtoms(word);
    for (let k = 0; k < pieces.length; k++) {
      atoms.push({ text: pieces[k]!, sep: k === 0 ? ' ' : '' });
    }
  }
  const pushAtom = (atom: { text: string; sep: string }) => {
    const glue = current && atom.sep === ' ' ? spaceW : 0;
    const testW = extendWidth(
      current ? currentW + glue : 0,
      atom.text,
      fontSize,
      opts
    );
    if (testW <= maxWidth || !current) {
      current = current
        ? `${current}${atom.sep === ' ' ? ' ' : ''}${atom.text}`
        : atom.text;
      currentW = testW;
    } else {
      lines.push(current);
      current = atom.text;
      currentW = extendWidth(0, atom.text, fontSize, opts);
    }
  };
  for (const atom of atoms) {
    const word = atom.text;
    if (hardBreak && measureText(word, fontSize, opts) > maxWidth) {
      // Break the over-long word into width-fitting chunks.
      if (current) {
        lines.push(current);
        current = '';
        currentW = 0;
      }
      let chunk = '';
      let chunkW = 0;
      // By cluster, for the same reason truncation is: a hard break must not
      // land inside one.
      for (const ch of graphemeClusters(word)) {
        const candW = extendWidth(chunkW, ch, fontSize, opts);
        if (chunk && candW > maxWidth) {
          lines.push(chunk);
          chunk = ch;
          chunkW = extendWidth(0, ch, fontSize, opts);
        } else {
          chunk += ch;
          chunkW = candW;
        }
      }
      current = chunk;
      currentW = chunkW;
      continue;
    }
    pushAtom(atom);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Fit a label into a fixed box: wrap, then shrink, then ellipsize.
 *
 * The ladder, in this order, and the order is the point — a long name stays
 * readable across lines rather than becoming tiny on one:
 *
 * 1. **Wrap** at the opportunities `breakAtoms` gives — a space, a `_` or `-`,
 *    a camelCase boundary — falling back to a hard grapheme break only for a
 *    single atom that cannot fit at all.
 * 2. **Shrink** the font one point at a time from `maxFont` to `minFont`,
 *    re-wrapping at each size.
 * 3. **Ellipsize** the last kept line, once the floor font at the line cap
 *    still will not fit.
 *
 * 🔴 It lived inside `sketch/renderer.ts` until 2026-08-30 (#586), which is why
 * the desktop canvas — the one surface that draws a sketch BY HAND rather than
 * through a renderer — had none of it, and drew node labels at full width
 * straight across their neighbours. A second copy on the app side would be the
 * exact divergence that issue is about, so it moved here and is exported.
 *
 * ⚠️ `opts` defaults to BOLD, because every caller when this moved drew these
 * lines bold — the sketch group band at 800, the two card headers at 700 — and
 * 600 and up resolve to the one Bold face that ships. A caller drawing at 400
 * or 500 must say so, or it reserves more room than its glyphs need.
 */
export function fitWrapped(
  label: string,
  maxWidth: number,
  maxFont: number,
  minFont: number,
  maxLines: number = 2,
  opts: MeasureOpts = { bold: true }
): { lines: string[]; fontSize: number } {
  const wrapOpts = { ...opts, hardBreak: true };
  for (let fs = maxFont; fs >= minFont; fs--) {
    const lines = wrapTextToWidth(label, fs, maxWidth, wrapOpts);
    if (lines.length <= maxLines) return { lines, fontSize: fs };
  }
  const lines = wrapTextToWidth(label, minFont, maxWidth, wrapOpts);
  if (lines.length <= maxLines) return { lines, fontSize: minFont };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (
    last.length > 1 &&
    measureText(`${last}\u2026`, minFont, opts) > maxWidth
  )
    last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}\u2026`;
  return { lines: kept, fontSize: minFont };
}
