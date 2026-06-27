import { describe, it, expect } from 'vitest';
import { parseVisualization } from '../src/d3';
import { getPalette } from '../src/palettes';
import type { ParsedSlope } from '../src/visualizations/types';

const palette = getPalette('nord').light;

function parseSlopeViz(src: string): ParsedSlope {
  const result = parseVisualization(src, palette);
  expect(result.type).toBe('slope');
  return result as ParsedSlope;
}

function diagnostics(src: string) {
  return parseVisualization(src, palette).diagnostics;
}

describe('slope parser', () => {
  it('parses type, title, periods, and data rows', () => {
    const r = parseSlopeViz(
      [
        'slope Programming Language Popularity',
        'period 2020 2022 2025',
        'Python blue 3 1 1',
        'JavaScript yellow 1 2 2',
      ].join('\n')
    );
    expect(r.title).toBe('Programming Language Popularity');
    expect(r.periods).toEqual(['2020', '2022', '2025']);
    expect(r.data).toHaveLength(2);
    expect(r.data[0].label).toBe('Python');
    expect(r.data[0].values).toEqual([3, 1, 1]);
    expect(r.data[1].label).toBe('JavaScript');
    expect(r.data[1].values).toEqual([1, 2, 2]);
  });

  it('parses an explicit trailing color', () => {
    const r = parseSlopeViz('slope T\nperiod A B\nPython blue 3 1');
    expect(r.data[0].color).toBeTruthy();
  });

  it('value count matches the number of periods', () => {
    const r = parseSlopeViz('slope T\nperiod 2020 2021 2022\nGo green 10 8 7');
    expect(r.periods).toHaveLength(3);
    expect(r.data[0].values).toHaveLength(3);
  });

  it('parses clean (no diagnostics) for canonical space-separated values', () => {
    const errs = diagnostics('slope T\nperiod A B\nGo 10 7').filter(
      (d) => d.severity === 'error'
    );
    expect(errs).toEqual([]);
  });

  it('parses comma-separated values best-effort (no error)', () => {
    const ds = diagnostics('slope T\nperiod A B C\nRust orange 18, 12, 5');
    expect(ds.some((d) => d.severity === 'error')).toBe(false);
  });
});
