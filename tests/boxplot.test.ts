import { describe, it, expect } from 'vitest';
import { boxSummary, quartiles } from '../src/stats/quartiles';
import { parseBoxplot } from '../src/data-chart-parser';
import { layoutBoxplot, pointJitter } from '../src/charts-d3/boxplot';
import { render as renderRaw } from '../src/render';
import { flattenTabular } from './helpers/tabular-text';

const render = async (src: string) => {
  const r = await renderRaw(src);
  return { ...r, svg: flattenTabular(r.svg) };
};
const codes = (src: string) =>
  parseBoxplot(src)
    .diagnostics.filter((d) => d.code)
    .map((d) => d.code);

// The mockup's hand-checked Platform group (mockups/2026-11-12-boxplot.md).
const PLATFORM =
  '2 2 2 2 3 3 3 3 3 3 3 3 3 4 4 5 5 5 5 5 5 5 6 6 7 8 8 10 21 26';

describe('Tukey box', () => {
  it('matches the hand-checked Platform group', () => {
    const b = boxSummary(PLATFORM.split(' ').map(Number))!;
    expect(b.n).toBe(30);
    expect(b.q1).toBe(3);
    expect(b.median).toBe(4.5);
    expect(b.q3).toBe(5.75);
    expect(b.whiskerLo).toBe(2);
    expect(b.whiskerHi).toBe(8);
    expect(b.outliers).toEqual([10, 21, 26]);
  });

  it('interpolates quartiles between ranks (R-7, QUARTILE.INC)', () => {
    expect(quartiles([8, 1, 7, 2, 6, 3, 5, 4])).toEqual({
      q1: 2.75,
      median: 4.5,
      q3: 6.25,
    });
  });

  it('a group with no spread has whiskers on the box and no outliers', () => {
    const b = boxSummary([4, 4, 4, 4, 4])!;
    expect([b.q1, b.median, b.q3, b.whiskerLo, b.whiskerHi]).toEqual([
      4, 4, 4, 4, 4,
    ]);
    expect(b.outliers).toEqual([]);
  });

  it('an empty group has no box', () => {
    expect(boxSummary([])).toBeNull();
  });
});

describe('parseBoxplot', () => {
  it('opens a group per [Name] color header; earlier values are unnamed', () => {
    const p = parseBoxplot(
      'boxplot T\n1 2 3 4 5\n[Platform]\n1 2 3, 4 5\n[Payments] red\n2 3 4 4 5'
    );
    const g = p.boxplotGroups!;
    expect(g.map((x) => x.name)).toEqual(['', 'Platform', 'Payments']);
    expect(g[1]!.values).toEqual([1, 2, 3, 4, 5]);
    expect(g[2]!.color).toBeDefined();
    expect(g[1]!.color).toBeUndefined();
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('reads points, mean and orientation-horizontal', () => {
    const p = parseBoxplot(
      'boxplot T\npoints\nmean\norientation-horizontal\n1 2 3 4 5'
    );
    expect(p.points).toBe(true);
    expect(p.showMean).toBe(true);
    expect(p.horizontal).toBe(true);
  });

  it('reads negative values as values, not a link', () => {
    const p = parseBoxplot('boxplot T\n-3 -2 -1 0 1');
    expect(p.boxplotGroups![0]!.values).toEqual([-3, -2, -1, 0, 1]);
  });

  it('a word among values errors and the numbers still count', () => {
    const src = 'boxplot T\n1 2 late 3 4 5';
    expect(codes(src)).toContain('E_BOXPLOT_NOT_A_NUMBER');
    expect(parseBoxplot(src).boxplotGroups![0]!.values).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('warns on an empty group and on fewer than 5 values', () => {
    expect(codes('boxplot T\n[A]\n[B]\n1 2 3 4 5')).toEqual([
      'W_BOXPLOT_EMPTY_GROUP',
    ]);
    expect(codes('boxplot T\n[A]\n1 2 3')).toEqual(['W_BOXPLOT_FEW_VALUES']);
  });

  it('takes y-axis as the value axis and x-axis as a title only', () => {
    const p = parseBoxplot(
      'boxplot T\nx-axis Team\ny-axis Days 0..30\n1 2 3 4 5'
    );
    expect(p.xlabel).toBe('Team');
    expect(p.ylabel).toBe('Days');
    expect(p.axes?.y?.max).toBe(30);
    expect(
      parseBoxplot('boxplot T\nx-axis Team 0..5\n1 2 3 4 5').diagnostics.some(
        (d) => /numeric x-axis/.test(d.message)
      )
    ).toBe(true);
  });
});

describe('layout and render', () => {
  it('every box takes one colour unless its header names one', () => {
    const p = parseBoxplot(
      'boxplot T\n[A]\n1 2 3 4 5\n[B]\n1 2 3 4 5\n[C] red\n1 2 3 4 5'
    );
    const s = layoutBoxplot(p, 'PRIMARY');
    expect(s[0]!.color).toBe('PRIMARY');
    expect(s[1]!.color).toBe('PRIMARY');
    expect(s[2]!.color).not.toBe('PRIMARY');
  });

  it('jitter is fixed by group, index and value', () => {
    const a = pointJitter('A', 3, 7);
    expect(pointJitter('A', 3, 7)).toBe(a);
    expect(pointJitter('B', 3, 7)).not.toBe(a);
    expect(Math.abs(a)).toBeLessThanOrEqual(1);
  });

  it('draws a box, median, whiskers, outliers and n per group', async () => {
    const { svg } = await render(
      `boxplot Cycle time\n[Platform]\n${PLATFORM}\n[Payments]\n3 3 4 4 5 5 6`
    );
    expect(svg.match(/dgmo-boxplot-box/g)).toHaveLength(2);
    expect(svg.match(/dgmo-boxplot-median/g)).toHaveLength(2);
    expect(svg.match(/class="dgmo-boxplot-outlier/g)).toHaveLength(3);
    expect(svg).toContain('n = 30');
    expect(svg).toContain('n = 7');
    expect(svg).not.toContain('dgmo-boxplot-mean');
  });

  it('points draws every value; mean draws a diamond', async () => {
    const { svg } = await render(`boxplot T\npoints\nmean\n${PLATFORM}`);
    expect(svg.match(/dgmo-boxplot-point/g)).toHaveLength(30);
    expect(svg.match(/dgmo-boxplot-mean/g)).toHaveLength(1);
  });

  it('the same source draws the same picture', async () => {
    const src = `boxplot T\npoints\n${PLATFORM}`;
    expect((await render(src)).svg).toBe((await render(src)).svg);
  });

  it('renders horizontally', async () => {
    const { svg } = await render(
      `boxplot T\norientation-horizontal\n[Platform]\n${PLATFORM}`
    );
    expect(svg).toContain('dgmo-boxplot-box');
    expect(svg).toContain('Platform');
  });
});
