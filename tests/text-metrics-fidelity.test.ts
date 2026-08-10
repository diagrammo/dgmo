import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
// The generator, imported rather than run: it exports its TTF readers and
// only writes the file when invoked as a script.
// @ts-expect-error — plain .mjs build script, no types
import { ratios } from '../scripts/build-text-metrics.mjs';
import {
  INTER_BOLD_W,
  INTER_DEFAULT_W,
  INTER_REGULAR_W,
} from '../src/utils/inter-metrics';
import { measureText } from '../src/utils/text-measure';

// This is the test the layout tests cannot be. Anything that renders a diagram
// and then checks the text fits measures with the SAME measureText the wrapper
// used, so it proves the two agree with each other and nothing about whether
// either agrees with the font. Shrink the whole model by 8% and every one of
// them still passes — which is exactly how the Helvetica table survived for as
// long as it did (issue 147).
//
// So: compare the committed table against the advances in the shipped TTFs.

const FONTS = resolve(__dirname, '../fonts');

describe('the width model matches the font that is actually drawn', () => {
  it('reproduces Inter Regular advances for every covered codepoint', () => {
    const { table } = ratios(resolve(FONTS, 'Inter-Regular.ttf'));
    const drift: string[] = [];
    for (const [cp, expected] of table) {
      const ch = String.fromCodePoint(cp);
      const actual = INTER_REGULAR_W[ch];
      if (actual !== expected) {
        drift.push(`${JSON.stringify(ch)}: table ${actual}, font ${expected}`);
      }
    }
    expect(drift).toEqual([]);
    expect(Object.keys(INTER_REGULAR_W).length).toBe(table.size);
  });

  it('reproduces Inter Bold advances for every covered codepoint', () => {
    const { table } = ratios(resolve(FONTS, 'Inter-Bold.ttf'));
    const drift: string[] = [];
    for (const [cp, expected] of table) {
      const ch = String.fromCodePoint(cp);
      const actual = INTER_BOLD_W[ch];
      if (actual !== expected) {
        drift.push(`${JSON.stringify(ch)}: table ${actual}, font ${expected}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('measures a real string within a rounding error of the font', () => {
    // The exact string that overflowed its card on the ecosystem docs page.
    const s = 'Sign in with the invited address';
    const { table, upem } = ratios(resolve(FONTS, 'Inter-Regular.ttf'));
    void upem;
    const fromFont = [...s].reduce(
      (a, c) => a + table.get(c.codePointAt(0)!)!,
      0
    );

    // Per-glyph rounding is 3 decimals, so a 32-character string can differ by
    // at most 32 × 0.0005 em.
    expect(Math.abs(measureText(s, 1) - fromFont)).toBeLessThan(
      s.length * 5e-4
    );

    // And it is meaningfully wider than the Helvetica table this replaced,
    // which measured the same string at 13.684 em. That gap is the bug.
    expect(measureText(s, 1)).toBeGreaterThan(14.5);
  });

  it('is bolder in bold — the two faces are not the same table', () => {
    const s = 'Sign in with the invited address';
    expect(measureText(s, 13, { bold: true })).toBeGreaterThan(
      measureText(s, 13)
    );
  });

  it('falls back to a ratio inside the range of real advances', () => {
    const widths = Object.values(INTER_REGULAR_W);
    expect(INTER_DEFAULT_W).toBeGreaterThan(Math.min(...widths));
    expect(INTER_DEFAULT_W).toBeLessThan(Math.max(...widths));
  });
});
