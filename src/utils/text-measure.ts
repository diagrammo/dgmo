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
    w += (table[text.charAt(i)] ?? DEFAULT_W) * fontSize;
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
  // measureText(text.slice(0, i), fontSize) exactly (same fold order), so the
  // bisection below never re-measures slices.
  const prefix: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    prefix.push(extendWidth(prefix[i]!, text.charAt(i), fontSize, opts));
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (prefix[mid]! + ellipsisW <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

/**
 * Greedy word-wrap to a pixel width using accurate glyph measurement.
 *
 * - Splits on whitespace; a word that alone exceeds `maxWidth` is kept
 *   whole unless `hardBreak` is set, in which case it is broken at the
 *   character boundary that fits.
 * - Returns at least one line (`['']` for empty input).
 */
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
  const pushWord = (word: string) => {
    const testW = extendWidth(
      current ? currentW + spaceW : 0,
      word,
      fontSize,
      opts
    );
    if (testW <= maxWidth || !current) {
      current = current ? `${current} ${word}` : word;
      currentW = testW;
    } else {
      lines.push(current);
      current = word;
      currentW = extendWidth(0, word, fontSize, opts);
    }
  };
  for (const word of words) {
    if (hardBreak && measureText(word, fontSize, opts) > maxWidth) {
      // Break the over-long word into width-fitting chunks.
      if (current) {
        lines.push(current);
        current = '';
        currentW = 0;
      }
      let chunk = '';
      let chunkW = 0;
      for (const ch of word) {
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
    pushWord(word);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
