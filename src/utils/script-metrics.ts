// ============================================================
// Width ratios for the scripts the Inter table does not cover
// ============================================================
//
// NOT generated. `src/utils/inter-metrics.ts` is rewritten by
// scripts/build-text-metrics.mjs on every `prebuild`, so a hand-written number
// there is destroyed without a word — which is why these live in their own
// file instead.
//
// The generated table holds 211 codepoints per face: Latin, digits and the
// punctuation real prose carries. Everything else used to measure at one flat
// INTER_DEFAULT_W (0.603), which is a Latin letter's mean advance, and that is
// wrong in both directions at once (issue 170):
//
//   - CJK, Kana and Hangul are FULL-WIDTH — 1.000 em per character — so a
//     Japanese label measured 40% narrow, wrapped a long way past its box and
//     truncated to something that still did not fit.
//   - Devanagari, Thai and Arabic render several codepoints as one cluster, so
//     charging 0.603 per codepoint measured them 45–63% too WIDE: they wrapped
//     far too early and any box sized from the measurement came out huge.
//
// The fix has two halves, and both are needed. This table gives each script its
// own ratio, and a combining mark is charged nothing at all — the ratios below
// are per BASE glyph, with the mark's contribution already folded into them.
//
// ── Where the numbers come from ────────────────────────────────────────────
//
// Measured through resvg with the two bundled TTFs plus system fallback (the
// configuration `dgmo` 0.63.0 onward uses), at font-size 100, 2–4 samples per
// script, taking the advance as `ink(s + s) − ink(s)` — exactly one copy's.
// Measured 2026-08-09 on macOS 15. tests/text-metrics-scripts.test.ts re-runs
// that measurement against these values.
//
// 🔴 Only the full-width row is a FACT, and HANGUL IS THE EXCEPTION INSIDE IT.
// Han and Kana are 1.000 em by design of the writing system, not by accident of
// which font answered, and every font that draws them agrees. Hangul does not:
// measured 2026-09-02 at font-size 100 on both machines, macOS draws 한 at
// 100.00px while Linux's Noto Sans CJK — the fallback on Linux, Android and
// most bare containers — draws it at 92.00px. Exactly 0.920 em, identical at
// one, two and three syllables, while Han *inside that same Korean face* still
// comes out 1.000. So the 1.0 below is the wider of two real faces rather than
// a universal fact, and it is kept at 1.0 deliberately: a width model that
// over-charges wraps a line early, and one that under-charges lets a label run
// out of its box. tests/text-metrics-scripts.test.ts bands Korean accordingly.
// Everything else here is an ESTIMATE that
// depends on the font the machine falls back to: which face draws Arabic or
// Devanagari is decided at draw time and dgmo does not choose it, so those
// advances move with the machine. They are still two to four times closer than
// the flat 0.603 they replace, which is the whole claim being made for them.
//
// Cyrillic measured 0.604 — the flat fallback was already right for it, which
// is why nobody reading Latin or Russian ever saw this bug.

import { INTER_DEFAULT_W } from './inter-metrics';

/** `[start, end, ratio]`, inclusive, ascending, non-overlapping. */
type ScriptWidth = readonly [number, number, number];

/**
 * Per-script advance, as a fraction of font size. Ordered by codepoint so the
 * scan below can stop early; kept coarse on purpose, one entry per Unicode
 * block, because this replaces a single flat guess rather than shaping text.
 */
const SCRIPT_W: readonly ScriptWidth[] = [
  // Greek and Greek Extended — Inter has these glyphs, but the generated
  // table stops at Latin-1, so they arrive here.
  [0x0370, 0x03ff, 0.559],
  // Cyrillic, Cyrillic Supplement. Same story, and the same 0.604 the flat
  // fallback already gave them.
  [0x0400, 0x052f, 0.604],
  [0x0590, 0x05ff, 0.499], // Hebrew
  [0x0600, 0x06ff, 0.447], // Arabic
  [0x0750, 0x077f, 0.447], // Arabic Supplement
  [0x08a0, 0x08ff, 0.447], // Arabic Extended-A
  [0x0900, 0x097f, 0.553], // Devanagari
  [0x0e00, 0x0e7f, 0.589], // Thai
  [0x1100, 0x11ff, 1.0], // Hangul, conjoining letters
  [0x1f00, 0x1fff, 0.559], // Greek Extended
  [0x2e80, 0x2eff, 1.0], // CJK Radicals Supplement
  [0x3000, 0x303f, 1.0], // CJK Symbols and Punctuation
  [0x3040, 0x30ff, 1.0], // Hiragana, Katakana
  [0x3130, 0x318f, 1.0], // Hangul, compatibility letters
  [0x31f0, 0x31ff, 1.0], // Katakana Phonetic Extensions
  [0x3400, 0x4dbf, 1.0], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff, 1.0], // CJK Unified Ideographs
  [0xa640, 0xa69f, 0.604], // Cyrillic Extended-B
  [0xa8e0, 0xa8ff, 0.553], // Devanagari Extended
  [0xa960, 0xa97f, 1.0], // Hangul, extended letters A
  [0xac00, 0xd7ff, 1.0], // Hangul syllables, and extended letters B
  [0xf900, 0xfaff, 1.0], // CJK Compatibility Ideographs
  [0xfb50, 0xfdff, 0.447], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff, 0.447], // Arabic Presentation Forms-B
  // Full-width forms only. The half-width tail (U+FF61 onward) is half an em
  // and is left to the default rather than given a wrong full-width ratio.
  [0xff01, 0xff60, 1.0],
  [0x20000, 0x2fa1f, 1.0], // CJK Unified Ideographs Extension B and later
];

/**
 * Below this there are no combining marks (the first is U+0300) and no
 * surrogates, so every codepoint under it keeps the flat fallback it has
 * always had. Latin Extended-A and -B, IPA and the spacing modifiers all sit
 * here — this is the line that keeps Latin output byte-identical.
 */
const FIRST_INTERESTING_CP = 0x0300;

const COMBINING_MARK = /\p{M}/u;

/**
 * Width ratio for one codepoint that the Inter table does not cover.
 *
 * A combining mark is charged **nothing**: the per-script ratios above are per
 * base glyph and already carry the mark's share. That is what stops a
 * Devanagari word — six codepoints, about three clusters — from buying six full
 * widths, and it makes the fold additive per codepoint, so continuing a running
 * width across calls stays bit-identical however the text is split.
 */
export function uncoveredWidthRatio(cp: number): number {
  if (cp < FIRST_INTERESTING_CP) return INTER_DEFAULT_W;
  if (COMBINING_MARK.test(String.fromCodePoint(cp))) return 0;
  for (const [start, end, ratio] of SCRIPT_W) {
    if (cp < start) break;
    if (cp <= end) return ratio;
  }
  return INTER_DEFAULT_W;
}

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

/**
 * Split text into grapheme clusters — what a reader calls a character.
 *
 * Truncation and hard-breaking cut here and nowhere else, so a Devanagari
 * label is never cut between a consonant and its vowel sign.
 *
 * `Intl.Segmenter` is the real answer (Chrome 87, Safari 14.1, Firefox 125,
 * Node 16 — and this package requires Node >= 20.6), but it is guarded rather
 * than assumed, so an older runtime degrades to cruder clustering instead of
 * throwing. The fallback attaches combining marks to the preceding base, which
 * covers the scripts this change is about; what it cannot see is ZWJ emoji
 * sequences, Indic conjuncts and regional indicators.
 */
export function graphemeClusters(text: string): string[] {
  // Fast path, and the common one: text made entirely of codepoints below
  // U+0300 has no marks and no surrogates, so every UTF-16 unit is its own
  // cluster and no segmentation is needed.
  let simple = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) >= FIRST_INTERESTING_CP) {
      simple = false;
      break;
    }
  }
  if (simple) return text.split('');

  if (segmenter) {
    const out: string[] = [];
    for (const { segment } of segmenter.segment(text)) out.push(segment);
    return out;
  }

  const out: string[] = [];
  for (const ch of text) {
    if (out.length > 0 && COMBINING_MARK.test(ch)) {
      out[out.length - 1] += ch;
    } else {
      out.push(ch);
    }
  }
  return out;
}
