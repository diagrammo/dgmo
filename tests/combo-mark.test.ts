// Combo bar + line (#1852): `mark: bar | line | step` on a line chart's
// series draws that series as bars or a step line, with the dual-axis form.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const DUAL = `line Revenue and margin
series
  y-axis Revenue ($M)
    Revenue blue mark: bar
  y-right-axis Margin (%)
    Margin green

Q1 42 18
Q2 48 21
Q3 51 19
Q4 60 24`;

const ONE_AXIS = `line Actual vs plan
series
  Actual blue mark: bar
  Plan orange mark: bar
  Target mark: step

Q1 40 44 45
Q2 46 47 45
Q3 50 52 55
Q4 58 56 55`;

const errors = (src: string) =>
  parseChart(src, palette).diagnostics.filter((d) => d.severity === 'error');
const warnings = (src: string) =>
  parseChart(src, palette).diagnostics.filter((d) => d.severity === 'warning');

/** Every attribute set of one element class, in document order. */
function elements(svg: string, cls: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<[a-z]+[^>]*class="${cls}"[^>]*>`, 'g');
  for (const tag of svg.match(re) ?? []) {
    const attrs: Record<string, string> = {};
    for (const [, k, v] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[k!] = v!;
    out.push(attrs);
  }
  return out;
}

describe('mark: on a series — parsing', () => {
  it('peels the mark off the name, before the colour', () => {
    const c = parseChart(DUAL, palette);
    expect(c.seriesNames).toEqual(['Revenue', 'Margin']);
    expect(c.seriesMarks).toEqual(['bar', 'line']);
    expect(c.seriesAxes).toEqual(['left', 'right']);
    expect(c.seriesNameColors?.[0]).toBeDefined();
    expect(errors(DUAL)).toEqual([]);
  });

  it('reads the flat form and `step`', () => {
    const c = parseChart(ONE_AXIS, palette);
    expect(c.seriesNames).toEqual(['Actual', 'Plan', 'Target']);
    expect(c.seriesMarks).toEqual(['bar', 'bar', 'step']);
  });

  it('a name ending in a mark word is still a name (decision #22)', () => {
    const c = parseChart(
      'line X\nseries\n  Bottom Line\n  Top Bar mark: bar\n\nA 1 2\nB 3 4',
      palette
    );
    expect(c.seriesNames).toEqual(['Bottom Line', 'Top Bar']);
    expect(c.seriesMarks).toEqual(['line', 'bar']);
  });

  it('tolerates spacing around the colon', () => {
    const c = parseChart(
      'line X\nseries\n  A mark : bar\n  B\n\nQ1 1 2\nQ2 3 4',
      palette
    );
    expect(c.seriesNames).toEqual(['A', 'B']);
    expect(c.seriesMarks).toEqual(['bar', 'line']);
  });

  it('every series a line → no marks recorded', () => {
    const c = parseChart(
      'line X\nseries\n  A mark: line\n  B\n\nQ1 1 2\nQ2 3 4',
      palette
    );
    expect(c.seriesMarks).toBeUndefined();
  });

  it('an unknown mark is an error naming the choices, with a suggestion', () => {
    const src = 'line X\nseries\n  A mark: bars\n  B\n\nQ1 1 2\nQ2 3 4';
    const errs = errors(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.line).toBe(3);
    expect(errs[0]!.message).toContain('bar, line or step');
    expect(errs[0]!.message).toContain("'bar'");
    const c = parseChart(src, palette);
    expect(c.seriesNames).toEqual(['A', 'B']);
    expect(c.seriesMarks).toBeUndefined();
  });

  it('is an error on a stacked area', () => {
    const src = 'line X\nstack\n  A mark: bar\n  B\n\nQ1 1 2\nQ2 3 4';
    const errs = errors(src);
    expect(errs.map((e) => e.message).join(' ')).toContain('stacked area');
    expect(errs[0]!.line).toBe(3);
    expect(parseChart(src, palette).seriesMarks).toBeUndefined();
  });

  it('on a bar chart it warns and is ignored, for now', () => {
    const src = 'bar X\ngroup\n  A\n  B mark: line\n\nQ1 1 2\nQ2 3 4';
    expect(errors(src)).toEqual([]);
    expect(
      warnings(src)
        .map((w) => w.message)
        .join(' ')
    ).toContain('only to line charts');
    const c = parseChart(src, palette);
    expect(c.seriesNames).toEqual(['A', 'B']);
    expect(c.seriesMarks).toBeUndefined();
  });
});

describe('mark: bar — rendering', () => {
  it('draws one bar per row for the bar series, and the line above them', async () => {
    const svg = await renderDataChartD3(DUAL, 'light', palette);
    const bars = elements(svg, 'dgmo-series-bar');
    expect(bars).toHaveLength(4);
    // The bars come first in the document, so the line is drawn over them.
    expect(svg.indexOf('dgmo-series-bar')).toBeLessThan(
      svg.indexOf('dgmo-series-line')
    );
    expect(elements(svg, 'dgmo-series-line')).toHaveLength(1);
  });

  it('stands every bar on the zero line of its axis', async () => {
    const svg = await renderDataChartD3(DUAL, 'light', palette);
    const bars = elements(svg, 'dgmo-series-bar');
    const bottoms = bars.map((b) => Number(b.y) + Number(b.height));
    for (const b of bottoms) expect(b).toBeCloseTo(bottoms[0]!, 1);
    // Taller value, taller bar.
    const h = bars.map((b) => Number(b.height));
    expect(h[3]!).toBeGreaterThan(h[0]!);
    expect(h[0]! / h[3]!).toBeCloseTo(42 / 60, 1);
  });

  it('puts two bar series side by side in each slot', async () => {
    const svg = await renderDataChartD3(ONE_AXIS, 'light', palette);
    const bars = elements(svg, 'dgmo-series-bar');
    expect(bars).toHaveLength(8);
    const [a, b] = [bars.slice(0, 4), bars.slice(4)];
    for (let i = 0; i < 4; i++) {
      // The second series' bar starts where the first's ends.
      expect(Number(b[i]!.x)).toBeCloseTo(
        Number(a[i]!.x) + Number(a[i]!.width) + 1,
        0
      );
    }
  });

  it('draws `mark: step` as a stepped path', async () => {
    const svg = await renderDataChartD3(ONE_AXIS, 'light', palette);
    const d = svg.match(/class="dgmo-series-line" d="([^"]+)"/)![1]!;
    // A step path holds each value: it has horizontal-then-vertical runs, so
    // consecutive vertices share a y, then share an x.
    const pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(pts.length).toBeGreaterThan(4);
    expect(pts[1]![1]).toBeCloseTo(pts[0]![1]!, 5);
    expect(pts[2]![0]).toBeCloseTo(pts[1]![0]!, 5);
  });

  it('keeps hover points on the bar tops', async () => {
    const svg = await renderDataChartD3(DUAL, 'light', palette);
    const pts = elements(svg, 'dgmo-pt').filter(
      (p) => p['data-series-index'] === '0'
    );
    expect(pts).toHaveLength(4);
    expect(pts.map((p) => p['data-value'])).toEqual(['42', '48', '51', '60']);
  });

  it('keeps a category axis when every row is a date', async () => {
    const src = `line X
series
  A mark: bar
  B

2024-01 1 2
2024-02 3 4
2024-06 5 6`;
    const svg = await renderDataChartD3(src, 'light', palette);
    // The row labels are drawn, not time ticks, and the slots are even.
    expect(svg).toContain('>2024-06<');
    const xs = elements(svg, 'dgmo-series-bar').map((b) => Number(b.x));
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 1);
  });

  /** The markup of one legend entry's group. */
  const legendEntry = (svg: string, name: string): string => {
    const legend = svg.slice(svg.indexOf('chart-legend'));
    const at = legend.indexOf(`data-series-name="${name}"`);
    return legend.slice(at, legend.indexOf('</g>', at));
  };

  it('shows each series’ mark in the legend', async () => {
    const svg = await renderDataChartD3(DUAL, 'light', palette);
    const revenue = legendEntry(svg, 'Revenue');
    const margin = legendEntry(svg, 'Margin');
    // Revenue: the hit area and a square chip; Margin: a stroke. No dots.
    expect(revenue.match(/<rect/g)).toHaveLength(2);
    expect(revenue).not.toContain('<circle');
    expect(margin).toContain('<line');
    expect(margin).not.toContain('<circle');
  });

  it('a line-only chart keeps dot swatches', async () => {
    const svg = await renderDataChartD3(
      'line X\nseries\n  A\n  B\n\nQ1 1 2\nQ2 3 4',
      'light',
      palette
    );
    expect(legendEntry(svg, 'A')).toContain('<circle');
    expect(legendEntry(svg, 'A')).not.toContain('<line');
  });
});
