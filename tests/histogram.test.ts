import { describe, it, expect } from 'vitest';
import {
  binnedMean,
  binnedMedian,
  countIntoBins,
  edgesForWidth,
  freedmanDiaconisWidth,
  histogramEdges,
  MAX_HISTOGRAM_BINS,
  niceStep,
  roundWidthUp,
} from '../src/stats/binning';
import { quartiles } from '../src/stats/quartiles';
import { parseHistogram } from '../src/data-chart-parser';
import { layoutHistogram, thinEdgeTicks } from '../src/charts-d3/histogram';
import { render as renderRaw } from '../src/render';
import { flattenTabular } from './helpers/tabular-text';

const render = async (src: string) => {
  const r = await renderRaw(src);
  return { ...r, svg: flattenTabular(r.svg) };
};
const codes = (src: string) =>
  parseHistogram(src)
    .diagnostics.filter((d) => d.code)
    .map((d) => d.code);

describe('binning helpers', () => {
  it('quartiles interpolate between ranks (R-7)', () => {
    // 1..8: q1 at rank 1.75 → 2.75, median 4.5, q3 at rank 5.25 → 6.25.
    expect(quartiles([8, 1, 7, 2, 6, 3, 5, 4])).toEqual({
      q1: 2.75,
      median: 4.5,
      q3: 6.25,
    });
    expect(quartiles([5]).median).toBe(5);
  });

  it('rounds a width up to 1, 2, 2.5 or 5 × 10ⁿ', () => {
    expect(roundWidthUp(0.7)).toBe(1);
    expect(roundWidthUp(1)).toBe(1);
    expect(roundWidthUp(1.01)).toBe(2);
    expect(roundWidthUp(2.2)).toBe(2.5);
    expect(roundWidthUp(3)).toBe(5);
    expect(roundWidthUp(5.5)).toBe(10);
    expect(roundWidthUp(0.031)).toBe(0.05);
    expect(roundWidthUp(240)).toBe(250);
  });

  it('Freedman–Diaconis: 2 × IQR ÷ ∛n, rounded up', () => {
    // 1..8: IQR 3.5, n 8 → 2 × 3.5 ÷ 2 = 3.5 → 5.
    expect(freedmanDiaconisWidth([1, 2, 3, 4, 5, 6, 7, 8])).toBe(5);
    // 27 values 0..26: IQR 13, ∛27 = 3 → 8.67 → 10.
    expect(freedmanDiaconisWidth(Array.from({ length: 27 }, (_, i) => i))).toBe(
      10
    );
    // IQR 0: Sturges over the range. 9 values, range 10 → 10 ÷ 5 = 2.
    expect(freedmanDiaconisWidth([5, 5, 5, 5, 5, 5, 5, 0, 10])).toBe(2);
    expect(freedmanDiaconisWidth([3, 3, 3])).toBe(1);
  });

  it('nice steps follow d3: 1, 2 or 5 × 10ⁿ', () => {
    expect(niceStep(0, 100, 10)).toBe(10);
    expect(niceStep(0, 100, 7)).toBe(20);
    expect(niceStep(0, 1, 4)).toBe(0.2);
    expect(niceStep(0, 100, 3)).toBe(50);
  });

  it('edges fall on multiples of the width, or at the start', () => {
    expect(edgesForWidth(12, 31, 5)).toEqual([10, 15, 20, 25, 30, 35]);
    expect(edgesForWidth(10, 30, 5)).toEqual([10, 15, 20, 25, 30]);
    expect(edgesForWidth(12, 31, 5, 11)).toEqual([11, 16, 21, 26, 31]);
    expect(edgesForWidth(0.1, 0.3, 0.1)).toEqual([0.1, 0.2, 0.3]);
    // One distinct value still gets a bin.
    expect(edgesForWidth(5, 5, 1)).toEqual([5, 6]);
  });

  it('an edge value goes right; the last bin takes its right edge', () => {
    const bins = countIntoBins(
      [0, 4.9, 5, 9.99, 10, 15, 20],
      [0, 5, 10, 15, 20]
    );
    expect(bins.map((b) => b.count)).toEqual([2, 2, 1, 2]);
    // Hand count: [0,5) 0 4.9 · [5,10) 5 9.99 · [10,15) 10 · [15,20] 15 20.
  });

  it('floating-point edges do not push an edge value left', () => {
    const { edges } = histogramEdges([0.1, 0.2, 0.3], { width: 0.1 });
    expect(edges).toEqual([0.1, 0.2, 0.3]);
    expect(countIntoBins([0.1, 0.2, 0.3], edges).map((b) => b.count)).toEqual([
      1, 2,
    ]);
  });

  it('pooled groups share edges; bins N gives round edges', () => {
    const vals = [3, 17, 22, 48, 51, 64, 77, 92, 98];
    const { edges, width } = histogramEdges(vals, { count: 10 });
    expect(width).toBe(10);
    expect(edges[0]).toBe(0);
    expect(edges.at(-1)).toBe(100);
  });

  it('pre-counted mean and median read from the bins', () => {
    const bins = [
      { x0: 0, x1: 10, count: 2 },
      { x0: 10, x1: 20, count: 6 },
      { x0: 20, x1: 40, count: 2 },
    ];
    // (5·2 + 15·6 + 30·2) ÷ 10 = 16.
    expect(binnedMean(bins)).toBe(16);
    // Middle count 5: 3 into the 6 of [10,20) → 10 + 3/6·10 = 15.
    expect(binnedMedian(bins)).toBe(15);
  });
});

describe('histogram parser', () => {
  it('reads bare numbers, spaces or commas, any number per line', () => {
    const p = parseHistogram(
      'histogram Delivery time\n17.2 21.5 14.8, 19.0\n23.1\n1,250 7'
    );
    expect(p.error).toBeNull();
    expect(p.histogramGroups).toHaveLength(1);
    expect(p.histogramGroups![0]!.name).toBe('');
    expect(p.histogramGroups![0]!.values).toEqual([
      17.2, 21.5, 14.8, 19, 23.1, 1250, 7,
    ]);
  });

  it('opens a group per [Name color] header; earlier values are unnamed', () => {
    const p = parseHistogram(
      'histogram T\n1 2\n[Downtown] blue\n3 4\n[Suburbs] orange\n5'
    );
    const g = p.histogramGroups!;
    expect(g.map((x) => x.name)).toEqual(['', 'Downtown', 'Suburbs']);
    expect(g[1]!.color).toBeDefined();
    expect(g[2]!.values).toEqual([5]);
  });

  it('reads the bin directives and percent', () => {
    const p = parseHistogram(
      'histogram T\nbin-width 2.5\nbin-start 1\npercent\nmean\nmedian\n1 2 3'
    );
    expect(p.histogramBins).toMatchObject({ width: 2.5, start: 1 });
    expect(p.percent).toBe(true);
    expect(p.overlays!.map((o) => o.kind)).toEqual(['mean', 'median']);
    expect(p.diagnostics).toEqual([]);
  });

  it('reads pre-counted rows, negative ends included', () => {
    const p = parseHistogram('histogram T\n-10--5 3\n-5-0 4\n0-10 31');
    expect(
      p.histogramGroups![0]!.ranges.map((r) => [r.x0, r.x1, r.count])
    ).toEqual([
      [-10, -5, 3],
      [-5, 0, 4],
      [0, 10, 31],
    ]);
    expect(p.diagnostics).toEqual([]);
  });

  it('diagnoses every listed mistake', () => {
    expect(codes('histogram T\n12 late 15')).toEqual([
      'E_HISTOGRAM_NOT_A_NUMBER',
    ]);
    expect(codes('histogram T\n12 15\n10-20 31')).toEqual([
      'E_HISTOGRAM_MIXED_ROWS',
    ]);
    expect(codes('histogram T\n0-10 4\n5-20 31')).toEqual([
      'E_HISTOGRAM_RANGE_OVERLAP',
    ]);
    expect(codes('histogram T\nbin-width 0\n1 2')).toEqual([
      'E_HISTOGRAM_BAD_BIN_WIDTH',
    ]);
    expect(codes('histogram T\nbin-width -3\n1 2')).toEqual([
      'E_HISTOGRAM_BAD_BIN_WIDTH',
    ]);
    expect(codes('histogram T\nbins 0\n1 2')).toEqual(['E_HISTOGRAM_BAD_BINS']);
    expect(codes('histogram T\nbins 10\nbin-width 5\n1 2')).toEqual([
      'E_HISTOGRAM_BINS_AND_WIDTH',
    ]);
    expect(codes('histogram T\n[Downtown]\n[Suburbs]\n1 2')).toEqual([
      'W_HISTOGRAM_EMPTY_GROUP',
    ]);
    expect(codes('histogram T\n20-10 4')).toEqual(['E_HISTOGRAM_BAD_RANGE']);
    expect(codes('histogram T\nbin-start 5\n1 6')).toEqual([
      'W_HISTOGRAM_BELOW_START',
    ]);
  });

  // #2261: a tiny bin-width or a huge bins built millions of edges and ran
  // the heap out. Both are refused, and the binning itself is capped.
  it('refuses more bins than a histogram can draw', () => {
    expect(codes('histogram T\nbin-width 0.001\n0 1000')).toEqual([
      'E_HISTOGRAM_TOO_MANY_BINS',
    ]);
    expect(codes('histogram T\nbins 1000000000\n0 1000')).toEqual([
      'E_HISTOGRAM_TOO_MANY_BINS',
    ]);
    expect(codes(`histogram T\nbins ${MAX_HISTOGRAM_BINS}\n0 1000`)).toEqual(
      []
    );
    expect(codes('histogram T\nbin-width 1\n0 1000')).toEqual([]);
    const p = parseHistogram('histogram T\nbin-width 0.00001\n0 1000');
    expect(p.histogramBins?.width).toBeUndefined();
  });

  it('caps the edge count however the width is asked for', () => {
    const cap = MAX_HISTOGRAM_BINS + 1;
    expect(edgesForWidth(0, 1000, 0.00001).length).toBe(cap);
    expect(
      histogramEdges([0, 1000], { width: 0.00001 }).edges.length
    ).toBeLessThanOrEqual(cap);
    expect(
      histogramEdges([0, 1000], { count: 1e9 }).edges.length
    ).toBeLessThanOrEqual(cap);
    expect(
      histogramEdges([0, 10], { width: 1, start: -1e12 }).edges.length
    ).toBeLessThanOrEqual(cap);
  });

  it('bins and bin-width together keep the exact width', () => {
    const p = parseHistogram('histogram T\nbins 10\nbin-width 5\n1 2');
    expect(p.histogramBins).toEqual({ width: 5, widthLine: 3 });
  });

  it('takes x-axis title and range', () => {
    const p = parseHistogram('histogram T\nx-axis Minutes 0..60\n12 15');
    expect(p.xlabel).toBe('Minutes');
    expect(p.axes?.x).toMatchObject({ min: 0, max: 60 });
  });
});

describe('histogram layout', () => {
  const colors = ['#1', '#2', '#3'];

  it('groups share one set of bins', () => {
    const p = parseHistogram(
      'histogram T\nbin-width 5\n[A]\n1 2 6\n[B]\n7 8 12'
    );
    const l = layoutHistogram(p, colors, '#p');
    expect(l.edges).toEqual([0, 5, 10, 15]);
    expect(l.series.map((s) => s.bins.map((b) => b.count))).toEqual([
      [2, 1, 0],
      [0, 2, 1],
    ]);
  });

  it('percent makes each group sum to 100', () => {
    const p = parseHistogram('histogram T\nbin-width 5\npercent\n1 2 6 7');
    const l = layoutHistogram(p, colors, '#p');
    expect(l.series[0]!.heights).toEqual([50, 50]);
  });

  it('unequal pre-counted widths draw true to area', () => {
    const p = parseHistogram('histogram T\n0-10 20\n10-20 30\n20-50 30');
    const l = layoutHistogram(p, colors, '#p');
    expect(l.perWidth).toBe(10);
    // Per 10 units: 20, 30, and 30 ÷ 30 · 10 = 10.
    expect(l.series[0]!.heights).toEqual([20, 30, 10]);
  });

  it('x-axis range clips the values that are counted', () => {
    const p = parseHistogram(
      'histogram T\nbin-width 10\nx-axis 0..20\n5 15 25'
    );
    const l = layoutHistogram(p, colors, '#p');
    expect(l.series[0]!.bins.reduce((s, b) => s + b.count, 0)).toBe(2);
    expect(l.domain).toEqual([0, 20]);
  });

  it('bin-start moves the first edge; values below it are not counted', () => {
    const p = parseHistogram('histogram T\nbin-width 5\nbin-start 3\n1 4 9 12');
    const l = layoutHistogram(p, colors, '#p');
    expect(l.edges[0]).toBe(3);
    expect(l.belowStart).toBe(1);
  });

  it('thins crowded edge ticks, keeping the first and last', () => {
    const edges = Array.from({ length: 41 }, (_, i) => i * 1000);
    const ticks = thinEdgeTicks(
      edges,
      (v) => v / 100,
      (v) => v.toLocaleString('en-US')
    );
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(40000);
    expect(ticks.length).toBeLessThan(edges.length);
  });
});

describe('histogram render', () => {
  it('draws one rect per non-empty bin, ticks on the edges', async () => {
    const { svg, diagnostics } = await render(
      'histogram Delivery time\nx-axis Minutes\nbin-width 5\n1 2 6 7 8 12'
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(svg.match(/<rect[^>]*dgmo-datum/g)).toHaveLength(3);
    for (const t of ['>0<', '>5<', '>10<', '>15<']) expect(svg).toContain(t);
    expect(svg).toContain('Minutes');
  });

  it('overlaid groups get a legend, outlines and per-group mean lines', async () => {
    const { svg } = await render(
      'histogram T\nbin-width 5\nmean\n[Downtown] blue\n1 2 6\n[Suburbs] orange\n7 8 12'
    );
    expect(svg).toContain('Downtown');
    expect(svg.match(/dgmo-histogram-outline/g)).toHaveLength(2);
    expect(svg.match(/dgmo-overlay-mean"/g)).toHaveLength(2);
  });

  it('unequal widths label the y axis per the smallest width', async () => {
    const { svg } = await render(
      'histogram T\nx-axis minutes\n0-10 20\n10-20 30\n20-50 30'
    );
    expect(svg).toContain('Count per 10 minutes');
  });
});
