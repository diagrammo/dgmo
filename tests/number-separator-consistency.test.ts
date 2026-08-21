// Cross-chart-type consistency for numeric grouping separators.
//
// The language accepts `,` and `_` as thousands-grouping separators, with `.`
// as the decimal point (see `normalizeNumericToken` in `utils/parsing.ts`).
// Users paste values straight out of spreadsheets, so a value that parses on
// one chart type must not silently render as zero on another.

import { describe, it, expect } from 'vitest';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseChart } from '../src/chart';
import { parseTreemap } from '../src/treemap/parser';
import { parseGoal } from '../src/goal/parser';
import { normalizeNumericToken } from '../src/utils/parsing';

function diagCount(diagnostics: readonly unknown[]): number {
  return diagnostics.length;
}

describe('numeric grouping separators are accepted consistently', () => {
  it('normalizeNumericToken treats "," as grouping and "." as the decimal point', () => {
    expect(normalizeNumericToken('1,240,000')).toBe('1240000');
    expect(normalizeNumericToken('1,234.56')).toBe('1234.56');
    expect(normalizeNumericToken('1_240_000')).toBe('1240000');
    expect(normalizeNumericToken('9495,725')).toBe('9495725');
    // Ambiguous / malformed grouping is rejected outright rather than
    // silently truncated by parseFloat.
    expect(normalizeNumericToken('1,24,000')).toBeNull();
    expect(normalizeNumericToken('1,5')).toBeNull();
    expect(normalizeNumericToken('1_000,000')).toBeNull();
  });

  it('pie accepts a long leading group when every comma suffix is three digits', () => {
    const result = parseChart(`pie 2025 Sources of MPV Traffic
Ballpark 9495,725
MLB.com 1610,591
Club.com 28869,376
Email 27466,684
MLBApp 13882,201`);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.data).toEqual([
      { label: 'Ballpark', value: 9495725, lineNumber: 2 },
      { label: 'MLB.com', value: 1610591, lineNumber: 3 },
      { label: 'Club.com', value: 28869376, lineNumber: 4 },
      { label: 'Email', value: 27466684, lineNumber: 5 },
      { label: 'MLBApp', value: 13882201, lineNumber: 6 },
    ]);
  });

  // bar/line/pie/radar go through `parseChart`; funnel through the extended
  // parser — both ultimately share `parseDataRowValues`.
  for (const [type, src] of [
    ['bar', 'bar T\n\nNorth 12,400\n'],
    ['pie', 'pie T\n\nAlpha 12,400\n'],
  ] as [string, string][]) {
    it(`${type} accepts a comma-grouped value with no diagnostics`, () => {
      const r = parseChart(src);
      expect(diagCount(r.diagnostics)).toBe(0);
      expect(r.data[0]!.value).toBe(12400);
    });
  }

  it('funnel accepts a comma-grouped value with no diagnostics', () => {
    const r = parseExtendedChart('funnel T\n\nVisitors 12,400\n');
    expect(diagCount(r.diagnostics)).toBe(0);
    expect(r.data[0]!.value).toBe(12400);
  });

  it('treemap accepts a comma-grouped value with no diagnostics', () => {
    const r = parseTreemap('treemap T\n\nBranch\n  Leaf 1,240,000\n');
    expect(diagCount(r.diagnostics)).toBe(0);
    expect(r.roots[0]!.children[0]!.value).toBe(1240000);
  });

  it('sankey accepts comma-grouped link weights', () => {
    const r = parseExtendedChart('sankey T\n\nA -> B 12,400\n');
    expect(diagCount(r.diagnostics)).toBe(0);
    expect(r.links![0]!.value).toBe(12400);
  });

  it('goal accepts comma-grouped now/target', () => {
    const r = parseGoal('goal T\n\nnow 12,400\ntarget 1,240,000\n');
    expect(r.now).toBe(12400);
    expect(r.target).toBe(1240000);
  });

  it('goal still rejects malformed grouping rather than truncating', () => {
    const r = parseGoal('goal T\n\nnow 1,5\ntarget 100\n');
    expect(r.now).not.toBe(1);
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
});
