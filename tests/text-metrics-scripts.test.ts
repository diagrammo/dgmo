import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { INTER_DEFAULT_W, INTER_REGULAR_W } from '../src/utils/inter-metrics';
import { measureText, truncateText } from '../src/utils/text-measure';
import { graphemeClusters } from '../src/utils/script-metrics';

/**
 * The test tests/text-metrics-fidelity.test.ts structurally cannot be.
 *
 * That one compares the committed table against the shipped TTFs — and the
 * TTFs have no glyphs for CJK, Hangul, Devanagari, Thai, Arabic or Hebrew, so
 * it can say nothing at all about how those measure. A layout test cannot see
 * it either: it wraps and checks with the same measureText, so the two agree
 * with each other and with nothing else (issue 167).
 *
 * So this one RASTERISES. It draws each sample through resvg with the bundled
 * fonts plus system fallback — the configuration `dgmo` 0.63.0 onward uses —
 * and takes the advance as `ink(s + s) − ink(s)`, which is exactly one copy's
 * advance whatever the ink boxes' own bearings are.
 *
 * ⚠️ A machine with no font for a script draws nothing at all — silently, with
 * a clean exit — and a bare CI container is exactly such a machine. Every row
 * therefore skips rather than fails when no ink appears, and says so out loud.
 * A red gate here would be worse than no gate, because a red gate stops being
 * read.
 */

const FONTS = resolve(__dirname, '..', 'fonts');

/** The bundled faces, when `prebuild` has produced them. CI runs before it. */
const fontFiles = ['Inter-Regular.ttf', 'Inter-Bold.ttf']
  .map((f) => resolve(FONTS, f))
  .filter((f) => existsSync(f));

const FONT_SIZE = 100;

const svgFor = (text: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="400">` +
  `<text x="10" y="250" font-family="Inter, system-ui, sans-serif" ` +
  `font-size="${FONT_SIZE}" fill="#000">${text}</text></svg>`;

/** Ink width of one drawn string, or undefined when nothing drew. */
function ink(text: string): number | undefined {
  const box = new Resvg(svgFor(text), {
    font: { fontFiles, loadSystemFonts: true, defaultFontFamily: 'Inter' },
  }).getBBox();
  if (!box || box.width <= 0) return undefined;
  return box.width;
}

/**
 * The real advance of `sample`, in pixels at FONT_SIZE — the growth of the ink
 * box when the string is drawn twice. Undefined when this machine has no font
 * for the script, which is a skip and not a failure.
 */
function advance(sample: string): number | undefined {
  const one = ink(sample);
  const two = ink(sample + sample);
  if (one === undefined || two === undefined) return undefined;
  const delta = two - one;
  // Nothing drew for the sample itself: both boxes are whatever ink the
  // fallback produced for neither string, so the difference is meaningless.
  if (delta <= 1) return undefined;
  return delta;
}

/** What the model said before per-script ratios existed: one flat number. */
const flatModel = (s: string) =>
  [...s].reduce(
    (a, c) => a + (INTER_REGULAR_W[c] ?? INTER_DEFAULT_W) * FONT_SIZE,
    0
  );

const SAMPLES: readonly {
  script: string;
  text: string;
  /** Tolerance on model ÷ real. */
  band: number;
  /** Must the new model beat the flat 0.603 it replaced? */
  beatsFlat: boolean;
}[] = [
  // Full-width by design of the writing system, not by accident of which font
  // answered — every font that draws these agrees on 1.000 em, so they are
  // pinned tight and must beat the flat number by a mile.
  {
    script: 'Japanese',
    text: '日本語',
    band: 0.05,
    beatsFlat: true,
  },
  {
    script: 'Chinese',
    text: '数据可视化',
    band: 0.05,
    beatsFlat: true,
  },
  { script: 'Korean', text: '한국어', band: 0.05, beatsFlat: true },
  {
    script: 'Kana',
    text: 'ひらがな',
    band: 0.05,
    beatsFlat: true,
  },
  // Estimates: which face draws these is the machine's choice, so the advance
  // moves with it. Wide band, and the assertion that does not depend on the
  // font at all — closer than charging 0.603 per codepoint was.
  {
    script: 'Devanagari',
    text: 'नमस्ते',
    band: 0.25,
    beatsFlat: true,
  },
  {
    script: 'Thai',
    text: 'สวัสดี',
    band: 0.25,
    beatsFlat: true,
  },
  {
    script: 'Arabic',
    text: 'مرحبا',
    band: 0.25,
    beatsFlat: true,
  },
  {
    script: 'Hebrew',
    text: 'שלום',
    band: 0.25,
    beatsFlat: true,
  },
  // Greek and Cyrillic are the two scripts the flat fallback was ALREADY right
  // for — 0.603 is a Latin/Cyrillic number — which is exactly why nobody
  // reading Latin or Russian ever saw this bug. Their per-script ratios are a
  // small correction, not a fix, and on a given string either can come out the
  // nearer. So: band only, no beats-flat claim that would be a coin toss.
  {
    script: 'Cyrillic',
    text: 'Диаграмма',
    band: 0.25,
    beatsFlat: false,
  },
  {
    script: 'Greek',
    text: 'Διάγραμμα',
    band: 0.25,
    beatsFlat: false,
  },
];

describe('the width model against rasterised advances, per script', () => {
  for (const { script, text, band, beatsFlat } of SAMPLES) {
    it(`measures ${script} (${text}) close to what actually draws`, ({
      skip,
    }) => {
      const real = advance(text);
      if (real === undefined) {
        skip(`no font for ${script} on this machine — nothing drew`);
        return;
      }

      const off = Math.abs(measureText(text, FONT_SIZE) / real - 1);
      expect(off).toBeLessThan(band);
      if (beatsFlat) {
        expect(off).toBeLessThan(Math.abs(flatModel(text) / real - 1));
      }
    });
  }

  it('rasterises at all — the harness itself is not measuring nothing', () => {
    // If this fails, every skip above is a lie: the samples are not skipping
    // for want of a font, the rasteriser is not drawing.
    expect(advance('Client')).toBeGreaterThan(0);
  });

  it('lands on Latin exactly, which the fidelity test already pins', () => {
    const real = advance('Client');
    if (real === undefined) return;
    expect(Math.abs(measureText('Client', FONT_SIZE) / real - 1)).toBeLessThan(
      0.01
    );
  });
});

describe('Latin measurement did not move', () => {
  // The covered path lands within 0.3% of the real advance and three passes of
  // fixes landed on it (#147, #167, #168). This asserts the new code reproduces
  // the OLD fold bit for bit — same order, same values, same accumulation — so
  // a Latin snapshot moving means a bug, not a number needing regenerating.
  const LATIN = [
    'Client',
    'Sign in with the invited address',
    'Łódź — čeština, ñandú, 5 × 3 ≤ 20 €',
    'Sailing & Rigging (v0.64.1) …',
    'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',
  ];

  for (const s of LATIN) {
    it(`is byte-identical to the flat fold for ${JSON.stringify(s.slice(0, 24))}`, () => {
      for (const size of [11, 13, 24, 100]) {
        const old = [...s].reduce(
          (a, c) => a + (INTER_REGULAR_W[c] ?? INTER_DEFAULT_W) * size,
          0
        );
        expect(measureText(s, size)).toBe(old);
      }
    });
  }

  it('truncates Latin at exactly the same character as before', () => {
    const s = 'Sign in with the invited address';
    const full = measureText(s, 13);
    // Fractions of the full width, so every one of these really does truncate.
    for (const f of [0.2, 0.4, 0.6, 0.8, 0.95]) {
      const w = full * f;
      const cut = truncateText(s, 13, w);
      expect(cut.endsWith('…')).toBe(true);
      expect(measureText(cut, 13)).toBeLessThanOrEqual(w);
      // The kept part is a prefix of the original — nothing rejoined.
      expect(s.startsWith(cut.slice(0, -1))).toBe(true);
      // And it is the LONGEST prefix that fits: one more character overflows.
      const oneMore = s.slice(0, cut.length) + '…';
      if (oneMore.length <= s.length) {
        expect(measureText(oneMore, 13)).toBeGreaterThan(w);
      }
    }
  });

  it('leaves text that already fits completely alone', () => {
    const s = 'Sign in with the invited address';
    expect(truncateText(s, 13, measureText(s, 13) + 1)).toBe(s);
  });
});

describe('clusters, not codepoints', () => {
  it('charges a combining mark nothing, so a decomposed word is not wider', () => {
    // "cafe" plus a combining acute is the same word as the precomposed one,
    // and must not buy an extra fallback width for the accent. It did before.
    expect(measureText('café', 13)).toBe(measureText('cafe', 13));
    expect(measureText('café', 13)).toBe(measureText('café', 13));
  });

  it('charges CJK a full em per character', () => {
    expect(measureText('日本語', 100)).toBeCloseTo(300, 6);
  });

  it('measures a surrogate pair once, not twice', () => {
    // U+20000, a CJK Extension B ideograph — two UTF-16 units, one character.
    expect(measureText('\u{20000}', 100)).toBeCloseTo(100, 6);
  });

  it('never cuts a Devanagari cluster in half', () => {
    const s = 'नमस्ते नमस्ते नमस्ते';
    const clusters = graphemeClusters(s);
    // Every prefix the truncator is allowed to produce, precomputed.
    const legal = new Set(
      clusters.map((_, i) => clusters.slice(0, i + 1).join(''))
    );
    legal.add('');
    for (let w = 10; w < 200; w += 7) {
      const cut = truncateText(s, 13, w);
      const kept = cut.endsWith('…') ? cut.slice(0, -1) : cut;
      // A cut anywhere else lands between a consonant and its vowel sign.
      expect(legal.has(kept)).toBe(true);
    }
  });

  it('folds incrementally to the same number however the text is split', () => {
    // The promise extendWidth's doc comment makes, checked on the text most
    // likely to break it.
    for (const s of ['नमस्ते', 'สวัสดี', '日本語テキスト', 'Diagram']) {
      for (let i = 1; i < s.length; i++) {
        expect(
          measureText(s.slice(0, i), 7) + measureText(s.slice(i), 7)
        ).toBeCloseTo(measureText(s, 7), 9);
      }
    }
  });
});
