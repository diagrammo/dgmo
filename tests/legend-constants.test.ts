import { describe, it, expect } from 'vitest';
import {
  measureLegendText,
  truncateLegendText,
} from '../src/utils/legend-constants';

describe('truncateLegendText', () => {
  it('returns text unchanged when it fits', () => {
    const text = 'Phase 1';
    const w = measureLegendText(text, 10);
    expect(truncateLegendText(text, 10, w)).toBe(text);
    expect(truncateLegendText(text, 10, w + 100)).toBe(text);
  });

  it('appends an ellipsis when text overflows', () => {
    const out = truncateLegendText('Final tune-up time trial', 11, 60);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan('Final tune-up time trial'.length);
    expect(measureLegendText(out, 11)).toBeLessThanOrEqual(60);
  });

  it('returns just the ellipsis when at least the ellipsis fits but no characters do', () => {
    // Derive the budget rather than hard-coding one: this used to say
    // "ellipsis ≈ 5.6, 'A' ≈ 6.7, so 7 sits between them", which was true of
    // the Helvetica table the measurement no longer uses. In Inter the
    // ellipsis is the WIDER of the two, so a literal 7 now fits neither.
    const ellipsisW = measureLegendText('…', 10);
    const firstCharW = measureLegendText('A', 10);
    const budget = ellipsisW + firstCharW / 2;
    expect(budget).toBeGreaterThanOrEqual(ellipsisW);
    expect(budget).toBeLessThan(ellipsisW + firstCharW);

    expect(truncateLegendText('Anything', 10, budget)).toBe('…');
  });

  it('returns empty string when even an ellipsis would not fit', () => {
    expect(truncateLegendText('Hello', 10, 0)).toBe('');
    expect(truncateLegendText('Hello', 10, 4)).toBe('');
  });

  it('produces output that always fits within maxWidth', () => {
    const samples = [
      'First 20-min continuous run',
      'Race Day',
      'Phase 3 — Peak',
      'Taper & Race',
    ];
    for (const text of samples) {
      for (const maxW of [0, 10, 30, 60, 120, 1000]) {
        const out = truncateLegendText(text, 11, maxW);
        expect(measureLegendText(out, 11)).toBeLessThanOrEqual(maxW);
      }
    }
  });

  it('selects the longest prefix that fits with the ellipsis', () => {
    // "Final tune-up time trial" — for a budget of ~60 at fontSize 11,
    // the binary search should keep more than 4 characters but fewer than
    // the full string. We don't pin an exact prefix (the budget is
    // sensitive to character widths), but verify the search isn't
    // prematurely cutting.
    const text = 'Final tune-up time trial';
    const out = truncateLegendText(text, 11, 60);
    const prefix = out.slice(0, -1); // strip ellipsis
    expect(prefix.length).toBeGreaterThan(3);
    expect(text.startsWith(prefix)).toBe(true);
  });
});
