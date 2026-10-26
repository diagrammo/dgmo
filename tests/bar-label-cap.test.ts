import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scaleLinear } from 'd3-scale';
import { renderDataChartD3 } from '../src/charts-d3/index';

// Long category names must not size a bar chart (#1422): their region is
// capped and the names end in `…`, keeping their full text as a hover title.

const FIXTURE = readFileSync(
  resolve(__dirname, '../stress/bar/long-labels--category-names.dgmo'),
  'utf8'
);
const NAMES = [
  'Password reset and account recovery requests',
  'Billing disputes, refunds and invoice corrections',
  'Integration errors from third-party webhooks',
  'Feature requests that are really bug reports',
];

function attr(svg: string, re: RegExp): number {
  return Number(svg.match(re)![1]);
}

/**
 * Height of a vertical bar chart's plot, read off the SVG: the zero gridline
 * is its bottom, and the value scale (from two gridlines) reaches the nice
 * maximum of `maxValue` at its top.
 */
function plotHeight(svg: string, maxValue: number): number {
  const grid = [
    ...svg.matchAll(/<line[^>]*y1="([\d.]+)"[^>]*y2="([\d.]+)"/g),
  ].map((m) => Number(m[1]));
  const ys = [...new Set(grid)].sort((a, b) => b - a);
  const [y0, y1] = [ys[0]!, ys[1]!];
  const ticks = scaleLinear().domain([0, maxValue]).nice().ticks(6);
  const niceMax = scaleLinear().domain([0, maxValue]).nice().domain()[1]!;
  const pxPerUnit = (y0 - y1) / ticks[1]!;
  return niceMax * pxPerUnit;
}

/** The text each `<text>` element draws, its hover title excluded. */
function drawn(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)/g)].map((m) => m[1]!);
}

/** Text of every `<title>` hover in the SVG. */
function titles(svg: string): string[] {
  return [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]!);
}

describe('bar chart long category names (#1422)', () => {
  it('leaves the stress fixture at least 60% of the height for the plot', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light');
    const H = attr(svg, /<svg[^>]*height="([\d.]+)"/);
    expect(plotHeight(svg, 412) / H).toBeGreaterThanOrEqual(0.6);
  });

  it('cuts the long names with … and keeps each full name as a hover title', async () => {
    const svg = await renderDataChartD3(FIXTURE, 'light');
    for (const n of NAMES) {
      expect(drawn(svg)).not.toContain(n);
      expect(titles(svg)).toContain(n);
    }
    // A short name is drawn whole, with no title.
    expect(drawn(svg)).toContain('Other');
    expect(titles(svg)).not.toContain('Other');
  });

  it('caps the name column beside horizontal bars at 35% of the width', async () => {
    const svg = await renderDataChartD3(
      FIXTURE.replace(/^bar .*$/m, '$&\norientation-horizontal'),
      'light'
    );
    const W = attr(svg, /<svg[^>]*width="([\d.]+)"/);
    // The plot starts after the name column; the column holds at most 35% of
    // the width plus its fixed padding.
    const plotLeft = Math.min(
      ...[...svg.matchAll(/<line[^>]*x1="([\d.]+)"/g)].map((m) => Number(m[1]))
    );
    expect(plotLeft).toBeLessThanOrEqual(W * 0.35 + 30);
    // A name is drawn whole, or cut with its full text kept as a title.
    for (const n of NAMES) {
      expect(drawn(svg).includes(n) !== titles(svg).includes(n)).toBe(true);
    }
  });

  it('cuts a horizontal name longer than 35% of the width', async () => {
    const long = `${NAMES.join(' / ')} and more`;
    const svg = await renderDataChartD3(
      `bar Tickets\norientation-horizontal\n\n"${long}" 5\nOther 3`,
      'light'
    );
    const W = attr(svg, /<svg[^>]*width="([\d.]+)"/);
    expect(drawn(svg)).not.toContain(long);
    expect(titles(svg)).toEqual([long]);
    const plotLeft = Math.min(
      ...[...svg.matchAll(/<line[^>]*x1="([\d.]+)"/g)].map((m) => Number(m[1]))
    );
    expect(plotLeft).toBeLessThanOrEqual(W * 0.35 + 30);
  });

  it('leaves a chart whose rotated names already fit unchanged', async () => {
    const body = ['Edge CDN', 'API gateway', 'Auth service', 'Billing worker']
      .map((s, i) => `${s} ${10 * (i + 1)}`)
      .join('\n');
    const svg = await renderDataChartD3(
      `bar Requests\n\n${body}`,
      'light',
      undefined,
      { width: 300, height: 400 }
    );
    expect(svg).toContain('rotate(-40)');
    expect(titles(svg)).toEqual([]);
  });
});
