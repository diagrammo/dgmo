// Small multiples (#1853): a bare `facet` flag splits a bar or line chart's
// series into one panel each, in declaration order. One test per rule the
// owner decided on 2026-11-12.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { facetColumns, FACET_MIN_PANEL_W } from '../src/charts-d3/facet';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

async function draw(src: string): Promise<HTMLDivElement> {
  host.innerHTML = await renderDataChartD3(src, 'light', palette);
  return host;
}

const LINE = `line Unemployment
facet
series
  North
  South
  East
2019 4 6 3
2020 8 9 6
2021 6 8 5`;

const BAR = `bar Sales
facet
group
  Widgets
  Gadgets
Q1 30 20
Q2 35 25
Q3 40 22`;

const errors = (src: string) =>
  parseChart(src, palette).diagnostics.filter((d) => d.severity === 'error');
const warnings = (src: string) =>
  parseChart(src, palette).diagnostics.filter((d) => d.severity === 'warning');

const panels = (h: HTMLElement) => [
  ...h.querySelectorAll<SVGGElement>('g.dgmo-facet-panel'),
];
const headings = (h: HTMLElement) =>
  [...h.querySelectorAll('text.dgmo-facet-heading')].map((t) => [
    t.textContent,
    t.getAttribute('fill'),
  ]);
/** A line panel's value-axis tick labels: tabular figures, in tspans. */
const valueTicks = (g: Element) =>
  [...g.querySelectorAll('text.dgmo-tick')].filter((t) =>
    t.querySelector('tspan')
  );
const tickTexts = (g: Element) => valueTicks(g).map((t) => t.textContent);
const gridline = (g: Element) => g.querySelectorAll('line').length;

describe('facet parse', () => {
  it('sets the flag and its options on bar and line', () => {
    const c = parseChart(
      `${LINE.replace('facet', 'facet 2\nfacet-free-y\nno-context')}`,
      palette
    );
    expect(c.facet).toBe(true);
    expect(c.facetFreeY).toBe(true);
    expect(c.noContext).toBe(true);
    expect(c.facetColumns).toBe(2);
    expect(errors(LINE)).toEqual([]);
    expect(parseChart(BAR, palette).facet).toBe(true);
    expect(errors(BAR)).toEqual([]);
  });

  it.each([
    ['stack', BAR.replace('group', 'stack'), '`stack`'],
    ['stack 100%', BAR.replace('group', 'stack 100%'), '`stack 100%`'],
    ['mirror', BAR.replace('group', 'mirror'), '`mirror`'],
    ['a line stack', LINE.replace('series', 'stack'), '`stack`'],
    [
      'dual axes',
      `line X
facet
y-axis Left
y-right-axis Right
series
  y-axis
    A
  y-right-axis
    B
Jan 1 100
Feb 2 200`,
      '`y-right-axis`',
    ],
    ['mark:', LINE.replace('  South', '  South\n    mark: bar'), '`mark:`'],
  ])(
    'is an error beside %s, and the chart is drawn as one plot',
    (_, src, what) => {
      const errs = errors(src);
      expect(errs.some((e) => e.message.includes(what))).toBe(true);
      expect(errs.some((e) => e.message.includes('`facet`'))).toBe(true);
      expect(parseChart(src, palette).facet).toBeUndefined();
    }
  );

  it('warns and draws one chart when there is only one series', () => {
    const src = `bar Sales
facet
Q1 30
Q2 35`;
    expect(warnings(src).some((w) => w.message.includes('two or more'))).toBe(
      true
    );
    expect(parseChart(src, palette).facet).toBeUndefined();
  });

  it('warns on the panel options without facet, and on non-data charts', () => {
    const src = LINE.replace('facet', 'facet-free-y\nno-context');
    const ws = warnings(src).map((w) => w.message);
    expect(
      ws.filter((m) => m.includes('only to a `facet` chart'))
    ).toHaveLength(2);
    expect(
      warnings(`pie X\nfacet\nA 1\nB 2`).some((w) =>
        w.message.includes('only to bar and line')
      )
    ).toBe(true);
  });

  it('takes the column count on the facet line (#2306)', () => {
    expect(parseChart(LINE.replace('facet', 'facet 3'), palette)).toMatchObject(
      { facet: true, facetColumns: 3 }
    );
    expect(errors(LINE.replace('facet', 'facet 3'))).toEqual([]);
    expect(
      parseChart(BAR.replace('facet', 'facet 2'), palette).facetColumns
    ).toBe(2);
    // Bare `facet` keeps the width-based default.
    expect(parseChart(LINE, palette).facetColumns).toBeUndefined();
  });

  it.each(['0', 'x', '2 3'])(
    'warns on `facet %s` and keeps the default grid',
    (arg) => {
      const src = LINE.replace('facet', `facet ${arg}`);
      const c = parseChart(src, palette);
      expect(c.facet).toBe(true);
      expect(c.facetColumns).toBeUndefined();
      expect(
        warnings(src).some((w) => w.message.includes('optional column count'))
      ).toBe(true);
    }
  );

  it('no longer reads `columns N` as the facet grid', () => {
    const c = parseChart(LINE.replace('facet', 'facet\ncolumns 3'), palette);
    expect(c.facetColumns).toBeUndefined();
  });

  it('keeps a capitalised `Columns` row as data', () => {
    const c = parseChart(`bar X\nColumns 3\nRows 4`, palette);
    expect(c.data.map((d) => d.label)).toEqual(['Columns', 'Rows']);
  });
});

describe('facet render', () => {
  it('draws one panel per series in declaration order, headed in its colour', async () => {
    const h = await draw(LINE);
    expect(panels(h)).toHaveLength(3);
    const heads = headings(h);
    expect(heads.map(([name]) => name)).toEqual(['North', 'South', 'East']);
    // One colour per series, none repeated, and no legend.
    expect(new Set(heads.map(([, c]) => c)).size).toBe(3);
    expect(h.querySelector('[data-legend-entry]')).toBeNull();
    // Each panel draws exactly its own series.
    for (const [k, g] of panels(h).entries())
      expect(
        [...g.querySelectorAll('g.dgmo-series')].map((s) =>
          s.getAttribute('data-series-name')
        )
      ).toEqual([heads[k]![0]]);
  });

  it('shares one value axis, with tick labels on the first column only', async () => {
    const h = await draw(LINE.replace('facet', 'facet 3'));
    const [first, second, third] = panels(h);
    expect(tickTexts(first!).length).toBeGreaterThan(1);
    expect(tickTexts(second!)).toEqual([]);
    expect(tickTexts(third!)).toEqual([]);
    // The gridlines stay, at the same values in every panel.
    expect(gridline(second!)).toBe(gridline(first!));
  });

  it('starts a new row after N panels under `facet N` (#2306)', async () => {
    // One per row: every panel is in the first column, so each labels its ticks.
    const ps = panels(await draw(LINE.replace('facet', 'facet 1')));
    expect(ps).toHaveLength(3);
    for (const g of ps) expect(tickTexts(g).length).toBeGreaterThan(1);
  });

  it('gives each panel its own range under facet-free-y, with every tick shown', async () => {
    const src = `line X
facet 2
facet-free-y
series
  Small
  Large
A 1 1000
B 2 3000
C 3 2000`;
    const [a, b] = panels(await draw(src));
    expect(tickTexts(a!).length).toBeGreaterThan(1);
    expect(tickTexts(b!).length).toBeGreaterThan(1);
    expect(tickTexts(a!)).not.toEqual(tickTexts(b!));
  });

  it('draws the other series as grey context behind a line panel', async () => {
    const h = await draw(LINE);
    for (const g of panels(h))
      expect(g.querySelectorAll('g.dgmo-facet-context path')).toHaveLength(2);
  });

  it('draws no context under no-context, on bars, or under facet-free-y', async () => {
    for (const src of [
      LINE.replace('facet', 'facet\nno-context'),
      LINE.replace('facet', 'facet\nfacet-free-y'),
      BAR,
    ]) {
      const h = await draw(src);
      expect(h.querySelector('g.dgmo-facet-context')).toBeNull();
    }
  });

  it('draws a bar panel in its series colour', async () => {
    const h = await draw(BAR);
    const heads = headings(h);
    expect(heads.map(([name]) => name)).toEqual(['Widgets', 'Gadgets']);
    for (const [k, g] of panels(h).entries()) {
      const fills = new Set(
        [...g.querySelectorAll('rect[data-line-number]')].map((r) =>
          r.getAttribute('stroke')
        )
      );
      expect([...fills]).toEqual([heads[k]![1]]);
    }
  });

  it('draws one title for the whole grid', async () => {
    const h = await draw(LINE);
    expect(h.querySelectorAll('.chart-title')).toHaveLength(1);
  });
});

describe('facet grid', () => {
  it('fits as many columns as hold the minimum panel width', () => {
    expect(facetColumns(6, FACET_MIN_PANEL_W - 1)).toBe(1);
    expect(facetColumns(6, 3 * FACET_MIN_PANEL_W + 2 * 16)).toBe(3);
    expect(facetColumns(2, 4000)).toBe(2);
  });

  it('takes the author’s columns, capped at the panel count', () => {
    expect(facetColumns(6, 300, 4)).toBe(4);
    expect(facetColumns(2, 300, 4)).toBe(2);
  });
});
