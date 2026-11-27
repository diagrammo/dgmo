import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { parseExtendedChart } from '../src/data-chart-parser';
import { MAX_SANKEY_NODES_PER_COLUMN } from '../src/charts-d3/sankey-limits';
import { getPalette } from '../src/palettes';
import { measureText, MIN_READABLE_TYPE_PX } from '../src/utils/text-measure';

// #2462: one source sending to 300 targets was laid out far taller than the
// canvas; most targets and the title fell off it.
const fan = (n: number) =>
  `sankey Fan\n\n` +
  Array.from({ length: n }, (_, i) => `Src -> Target ${i + 1} ${i + 1}`).join(
    '\n'
  );

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

function canvas(svg: string) {
  const root = /<svg[^>]*>/.exec(svg)![0];
  return { w: Number(attr(root, 'width')), h: Number(attr(root, 'height')) };
}

function assertInside(svg: string, nodes: number) {
  const { w, h } = canvas(svg);
  const rects = [...svg.matchAll(/<rect[^>]*data-emph-key="node:[^>]*>/g)].map(
    (m) => m[0]
  );
  expect(rects.length).toBe(nodes);
  for (const r of rects) {
    const x = Number(attr(r, 'x'));
    const y = Number(attr(r, 'y'));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y + Number(attr(r, 'height'))).toBeLessThanOrEqual(h);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + Number(attr(r, 'width'))).toBeLessThanOrEqual(w);
  }
  const texts = [...svg.matchAll(/<text([^>]*)>(.*?)<\/text>/g)];
  const labels = texts.filter((t) => /^(Target \d+|Src)/.test(t[2]!));
  expect(labels.length).toBe(nodes);
  for (const t of labels) {
    const size = Number(attr(t[1]!, 'font-size'));
    const y = Number(attr(t[1]!, 'y'));
    expect(size).toBeGreaterThanOrEqual(MIN_READABLE_TYPE_PX);
    expect(y - size).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(h);
    const name = t[2]!.replace(/<[^>]*>/g, '');
    expect(
      Number(attr(t[1]!, 'x')) + measureText(name, size)
    ).toBeLessThanOrEqual(w);
  }
  // No two names in the target column overprint.
  const ys = labels
    .filter((t) => /^Target/.test(t[2]!))
    .map((t) => Number(attr(t[1]!, 'y')))
    .sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++)
    expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(MIN_READABLE_TYPE_PX);
  // The title is on the canvas and above every node bar.
  const title = texts.find((t) => t[2] === 'Fan');
  expect(title).toBeDefined();
  const ty = Number(attr(title![1]!, 'y'));
  expect(ty).toBeGreaterThan(0);
  const top = Math.min(...rects.map((r) => Number(attr(r, 'y'))));
  expect(ty).toBeLessThan(top);
  const tx = Number(attr(title![1]!, 'x'));
  expect(tx).toBeGreaterThanOrEqual(0);
  expect(tx + measureText('Fan', 20)).toBeLessThanOrEqual(w);
}

describe('sankey column limit (#2462)', () => {
  it('fits a fan at the limit inside the default canvas', async () => {
    const svg = await renderDataChartD3(
      fan(MAX_SANKEY_NODES_PER_COLUMN),
      'light'
    );
    assertInside(svg, MAX_SANKEY_NODES_PER_COLUMN + 1);
  });

  it('fits a fan at the limit inside a short preview pane', async () => {
    const svg = await renderDataChartD3(
      fan(MAX_SANKEY_NODES_PER_COLUMN),
      'light',
      undefined,
      { width: 700, height: 400 }
    );
    assertInside(svg, MAX_SANKEY_NODES_PER_COLUMN + 1);
  });

  it('a fan at the limit raises no error', () => {
    const parsed = parseExtendedChart(
      fan(MAX_SANKEY_NODES_PER_COLUMN),
      getPalette('nord').light
    );
    expect(
      parsed.diagnostics.filter((d) => d.code === 'E_SANKEY_TOO_MANY_NODES')
    ).toHaveLength(0);
  });

  it('errors on the first link over the limit and draws the first 50', async () => {
    const parsed = parseExtendedChart(
      fan(MAX_SANKEY_NODES_PER_COLUMN + 1),
      getPalette('nord').light
    );
    const errs = parsed.diagnostics.filter(
      (d) => d.code === 'E_SANKEY_TOO_MANY_NODES'
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.message).toContain(String(MAX_SANKEY_NODES_PER_COLUMN));
    expect(errs[0]!.message).toContain(String(MAX_SANKEY_NODES_PER_COLUMN + 1));
    expect(errs[0]!.message).toMatch(/Group the small targets/);
    // title, blank line, then one link per line: the 51st link is line 53
    expect(errs[0]!.line).toBe(MAX_SANKEY_NODES_PER_COLUMN + 3);
    expect(parsed.type === 'sankey' && parsed.links).toHaveLength(
      MAX_SANKEY_NODES_PER_COLUMN
    );
  });

  it('draws the first 50 of a 300-target fan inside the canvas', async () => {
    const svg = await renderDataChartD3(fan(300), 'light');
    assertInside(svg, MAX_SANKEY_NODES_PER_COLUMN + 1);
  });
});
