// A line chart whose notes cannot all sit clear draws them as numbered discs
// with a key (#2390). In a facet grid each panel keeps its plot at the size
// it would have without notes, and its key sits under it, in room the grid
// adds. The fixture is the reporter's source, byte for byte.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDataChartD3 } from '../src/charts-d3';
import { noteBudget } from '../src/charts-d3/line';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;
const src = readFileSync(
  join(__dirname, 'fixtures', 'line-notes-2390.dgmo'),
  'utf8'
);
const bare = src
  .split('\n')
  .filter((l) => !/^\s+note /.test(l))
  .join('\n');
const dims = { width: 951, height: 716 };

const parse = (svg: string) =>
  new DOMParser().parseFromString(svg, 'image/svg+xml');
const panel = (doc: Document, name: string) =>
  doc.querySelector(`g.dgmo-facet-panel[data-series="${name}"]`)!;
const num = (e: Element | null, a: string) => Number(e?.getAttribute(a));

describe('line notes that go to a key (#2390)', () => {
  it('numbers the crowded and the covered panels, and only those', async () => {
    const doc = parse(await renderDataChartD3(src, 'light', palette, dims));
    const rows = (name: string) =>
      panel(doc, name).querySelectorAll('.dgmo-note-key-row').length;
    expect(rows('dgmo library')).toBe(6);
    expect(rows('remark-dgmo')).toBe(1);
    expect(rows('Desktop app (Mac)')).toBe(0);
    // One panel never mixes the two forms.
    expect(
      panel(doc, 'dgmo library').querySelectorAll('.dgmo-chart-note-leader')
    ).toHaveLength(0);
  });

  it('keeps every plot the size it has without notes', async () => {
    const withNotes = parse(
      await renderDataChartD3(src, 'light', palette, dims)
    );
    const without = parse(
      await renderDataChartD3(bare, 'light', palette, dims)
    );
    for (const name of ['dgmo library', 'remark-dgmo', 'MCP server']) {
      const cell = (d: Document) => panel(d, name).querySelector('svg')!;
      expect(num(cell(withNotes), 'height')).toBe(num(cell(without), 'height'));
      const line = (d: Document) =>
        panel(d, name).querySelector('.dgmo-series-line')!.getAttribute('d');
      expect(line(withNotes)).toBe(line(without));
    }
  });

  it('draws each key under its own panel, clear of the next row', async () => {
    const doc = parse(await renderDataChartD3(src, 'light', palette, dims));
    const lib = panel(doc, 'dgmo library');
    const cell = lib.querySelector('svg')!;
    const keyYs = [...lib.querySelectorAll('.dgmo-note-key-text')].map(
      (t) => num(cell, 'y') + num(t, 'y')
    );
    const keyXs = [...lib.querySelectorAll('.dgmo-note-key-text')].map(
      (t) => num(cell, 'x') + num(t, 'x')
    );
    // Below its own plot's month labels …
    const months = [...cell.querySelectorAll('text')]
      .filter((t) => /^(Mar|May|Jul|Sep|Nov)$/.test(t.textContent ?? ''))
      .map((t) => num(cell, 'y') + num(t, 'y'));
    expect(months.length).toBeGreaterThan(0);
    expect(Math.min(...keyYs)).toBeGreaterThan(Math.max(...months));
    // … above the next row's heading …
    const below = panel(doc, 'MCP server').querySelector(
      '.dgmo-facet-heading'
    )!;
    expect(Math.max(...keyYs)).toBeLessThan(num(below, 'y') - 10);
    // … and inside its own column.
    const next = panel(doc, 'Desktop app (Mac)').querySelector('svg')!;
    expect(Math.max(...keyXs)).toBeLessThan(num(next, 'x'));
  });

  it('scopes hover numbers to the panel', async () => {
    const doc = parse(await renderDataChartD3(src, 'light', palette, dims));
    const keys = (name: string) =>
      [...panel(doc, name).querySelectorAll('[data-note-key]')].map((e) =>
        e.getAttribute('data-note-key')
      );
    const lib = keys('dgmo library');
    const remark = keys('remark-dgmo');
    expect(lib.length).toBeGreaterThan(0);
    expect(remark.length).toBeGreaterThan(0);
    expect(lib.filter((k) => remark.includes(k))).toEqual([]);
  });

  it('gives a bigger plot a bigger note budget', () => {
    expect(noteBudget(250, 130)).toBe(2);
    expect(noteBudget(40, 40)).toBe(1);
    expect(noteBudget(1100, 650)).toBeGreaterThan(20);
  });
});
