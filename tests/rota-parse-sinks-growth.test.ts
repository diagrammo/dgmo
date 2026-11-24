// Per-line scans that rebuilt or rescanned a structure growing with the input
// (#2272, #2273). Each asserts the growth exponent between two sizes, never a
// wall-clock budget.
import { describe, expect, it } from 'vitest';
import { parseVisualization } from '../src/visualizations/parse';
import { parseChart } from '../src/chart';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { measureGrowth } from './perf-helpers';

const LIMIT = 1.5;

describe('adversarial-line growth (#2272, #2273)', () => {
  it('wordcloud freeform apostrophe run stays linear', () => {
    const g = measureGrowth({
      small: 2000,
      large: 8000,
      prepare: (n) => `wordcloud\nfoo a${"'".repeat(n)}b`,
      run: (src) => parseVisualization(src),
      limit: LIMIT,
    });
    expect(g).toBeLessThan(LIMIT);
  });

  it('venn intersection last segment stays linear', () => {
    const g = measureGrowth({
      small: 2000,
      large: 8000,
      prepare: (n) => `venn\nA\nB\nA + B ${'x '.repeat(n)}`,
      run: (src) => parseVisualization(src),
      limit: LIMIT,
    });
    expect(g).toBeLessThan(LIMIT);
  });

  it('line-chart band series split stays linear', () => {
    const g = measureGrowth({
      small: 100,
      large: 400,
      prepare: (n) => `line\nA 1\nB 2\nband ${'x '.repeat(n)}`,
      run: (src) => parseChart(src),
      limit: LIMIT,
    });
    expect(g).toBeLessThan(LIMIT);
  });

  it('annotation marker category match stays linear', () => {
    const g = measureGrowth({
      small: 2000,
      large: 8000,
      prepare: (n) => `bar\nA 1\nB 2\nmarker ${'a '.repeat(n)}`,
      run: (src) => parseChart(src),
      limit: LIMIT,
    });
    expect(g).toBeLessThan(LIMIT);
  });

  it('boxes-and-lines group-reference edges stay linear', () => {
    const g = measureGrowth({
      small: 2000,
      large: 8000,
      prepare: (n) => {
        const lines: string[] = [];
        for (let i = 0; i < n; i++) lines.push(`[G${i}]`, `  N${i}`);
        for (let i = 0; i < n - 1; i++) lines.push(`[G${i}] -> [G${i + 1}]`);
        return lines.join('\n');
      },
      run: (src) => parseBoxesAndLines(src),
      limit: LIMIT,
    });
    expect(g).toBeLessThan(LIMIT);
  });

  it('boxes-and-lines one same-rank line stays linear', () => {
    const g = measureGrowth({
      small: 500,
      large: 2000,
      prepare: (n) => {
        const names = Array.from({ length: n }, (_, i) => `B${i}`);
        return `${names.join('\n')}\nsame-rank ${names.join(', ')}`;
      },
      run: (src) => parseBoxesAndLines(src),
      limit: LIMIT,
    });
    expect(g).toBeLessThan(LIMIT);
  });
});
