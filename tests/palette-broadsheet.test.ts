import { describe, expect, it } from 'vitest';
import { broadsheetPalette } from '../src/palettes/broadsheet';
import {
  getSeriesColors,
  relativeLuminance,
} from '../src/palettes/color-utils';

// Broadsheet is a newspaper-chart palette on warm paper (#1977, 2026-11-13).
// Its upstream hues (o-colors' mandarin, lemon, org-b2c) sit under 3:1 on
// the paper, so this pins the darkened values: every series must read as a
// mark (WCAG 1.4.11, 3:1) and both text tokens as text (4.5:1) in both modes.

function ratio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  );
  return (hi + 0.05) / (lo + 0.05);
}

describe('broadsheet palette', () => {
  for (const mode of ['light', 'dark'] as const) {
    const p = broadsheetPalette[mode];

    it(`${mode}: every series colour reaches 3:1 on bg`, () => {
      for (const hex of getSeriesColors(p)) {
        expect(ratio(hex, p.bg), hex).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${mode}: text and muted text reach 4.5:1 on bg`, () => {
      expect(ratio(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.textMuted, p.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('carries no newspaper brand in its id or name', () => {
    const label = `${broadsheetPalette.id} ${broadsheetPalette.name}`;
    expect(label).not.toMatch(/\bft\b|financial times/i);
  });
});
