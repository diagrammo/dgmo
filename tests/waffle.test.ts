// `pie` + bare `waffle` (#1983): the pie's rows as a 10×10 grid, one cell
// per percent of the total.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';
import {
  WAFFLE_MAX_LABELS,
  waffleAnchor,
  waffleBands,
  waffleCells,
} from '../src/charts-d3/waffle';

const WAFFLE = `pie Crew Roles
waffle

Sailors 45
Gunners 20
Marines 15
Officers 8
Specialists 7
Cooks 5`;

const cellRects = (svg: string): string[] =>
  svg.match(/<rect[^>]*class="dgmo-datum"[^>]*>/g) ?? [];

describe('waffle — parse', () => {
  it('bare `waffle` on pie sets the mode with no diagnostics', () => {
    const r = parseChart(WAFFLE);
    expect(r.waffle).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.data).toHaveLength(6);
  });

  it('a row named Waffle stays data', () => {
    const r = parseChart('pie Snacks\nWaffle 3\nPancake 2');
    expect(r.waffle).toBeUndefined();
    expect(r.data.map((d) => d.label)).toEqual(['Waffle', 'Pancake']);
  });

  it('warns and ignores `waffle` on a non-pie chart', () => {
    const r = parseChart('bar Hauls\nwaffle\nA 1\nB 2');
    expect(r.waffle).toBeUndefined();
    expect(
      r.diagnostics.some((d) => /only supported on pie/.test(d.message))
    ).toBe(true);
  });

  it('warns that `hole` has no effect on a waffle and drops it', () => {
    const r = parseChart('pie Spend\nwaffle\nhole\nA 1\nB 2');
    expect(r.hole).toBeUndefined();
    expect(r.diagnostics.some((d) => /hole/.test(d.message))).toBe(true);
  });
});

describe('waffleCells — largest remainder', () => {
  it('always sums to 100', () => {
    for (const vs of [
      [1, 1, 1],
      [63.5, 19.8, 6.2, 5.1, 2.8, 1.4, 1.2],
      [7],
      [2, 998],
    ]) {
      expect(waffleCells(vs).reduce((a, c) => a + c, 0)).toBe(100);
    }
  });
  it('gives exact shares when they are whole percents', () => {
    expect(waffleCells([45, 20, 15, 8, 7, 5])).toEqual([45, 20, 15, 8, 7, 5]);
  });
  it('breaks a tie toward the earlier row', () => {
    expect(waffleCells([1, 1, 1])).toEqual([34, 33, 33]);
  });
});

const render = (src: string, width = 800, height = 500) =>
  renderDataChartD3(src, 'light', undefined, { width, height });
const texts = (svg: string): string[] =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
const LRI = '\u2068';
const PDI = '\u2069';
const rows = (vs: number[]) => vs.map((v, i) => `R${i} ${v}`).join('\n');

describe('waffle — band labels (#2104)', () => {
  it('draws 100 cells, no key swatches, and one label per band', async () => {
    const svg = await render(WAFFLE);
    // No pie wedges: the only datum paths are the six leaders, with no arcs.
    const paths = svg.match(/<path[^>]*class="dgmo-datum"[^>]*>/g) ?? [];
    expect(paths).toHaveLength(6);
    expect(paths.some((d) => /d="[^"]*A/.test(d))).toBe(false);
    expect(cellRects(svg)).toHaveLength(100);
    const t = texts(svg);
    expect(t).toContain('45%');
    expect(t).toContain(`${LRI}Sailors${PDI}`);
    expect(svg).not.toContain(' — ');
  });

  it('every cell and its label carry the row as the emphasis key', async () => {
    const svg = await render(WAFFLE);
    expect(svg.match(/<rect[^>]*data-emph-key="Sailors"/g)).toHaveLength(45);
    expect(svg.match(/<text[^>]*data-emph-key="Sailors"/g)).toHaveLength(2);
  });

  it('thirds round 34/33/33 and each third is labelled', async () => {
    const svg = await render('pie T\nwaffle\n\nA 1\nB 1\nC 1');
    const t = texts(svg);
    expect(t.filter((s) => /^3[34]%$/.test(s))).toEqual(['34%', '33%', '33%']);
  });

  it('caps the labels at eight; the rest merge into one grey band', async () => {
    const vs = [9, 6, 5, 4, 3, 3, 2, 2, 2, 2, ...Array(30).fill(1)];
    const svg = await render(`pie Haul\nwaffle\n\n${rows(vs)}`);
    const labelled = texts(svg).filter((s) => s.startsWith(LRI));
    expect(labelled).toHaveLength(WAFFLE_MAX_LABELS);
    expect(labelled.at(-1)).toMatch(/^\u2068\d+ more, each under \d+%\u2069$/);
    expect(cellRects(svg)).toHaveLength(100);
  });

  it('an explicit other-below turns the cap off', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      label: `R${i}`,
      value: 10,
      lineNumber: i + 1,
    }));
    const { bands } = waffleBands(data, false);
    expect(bands).toHaveLength(10);
    expect(bands.some((b) => b.merged)).toBe(false);
    expect(waffleBands(data, true).bands).toHaveLength(WAFFLE_MAX_LABELS);
  });

  it('keeps at most two single-row bands in one grid row', () => {
    const data = [50, 2, 2, 2, 2, 42].map((v, i) => ({
      label: `R${i}`,
      value: v,
      lineNumber: i + 1,
    }));
    const { bands } = waffleBands(data, true);
    const perRow = new Map<number, number>();
    for (const b of bands) {
      if (b.merged) continue;
      const a = waffleAnchor(b);
      if (a.kind === 'within') perRow.set(a.row, (perRow.get(a.row) ?? 0) + 1);
    }
    expect(Math.max(...perRow.values())).toBeLessThanOrEqual(2);
    expect(bands.at(-1)).toMatchObject({
      merged: true,
      label: '2 more, each under 3%',
    });
  });

  it('anchors a multi-row band on its fullest edge row, a one-row band in-row', () => {
    const band = (start: number, cells: number) => ({
      label: 'x',
      value: cells,
      lineNumber: 1,
      merged: false,
      start,
      cells,
    });
    expect(waffleAnchor(band(0, 30))).toEqual({ kind: 'edge', row: 1 });
    expect(waffleAnchor(band(7, 13))).toEqual({ kind: 'edge', row: 1 });
    expect(waffleAnchor(band(3, 4))).toEqual({
      kind: 'within',
      row: 0,
      col: 6,
    });
    expect(waffleAnchor(band(6, 4))).toEqual({ kind: 'edge', row: 0 });
  });

  it('names zero-cell rows on one muted line', async () => {
    const svg = await render(
      'pie C\nwaffle\n\nSpice 61.5\nSilk 24.7\nRum 12.4\nPearls 0.8\nSaffron 0.3\nAmbergris 0.2\nPepper 0.1'
    );
    const t = texts(svg);
    expect(t).toContain(
      'Under half a cell, so no square: Saffron, Ambergris, Pepper'
    );
    expect(t).not.toContain(`${LRI}Saffron${PDI}`);
  });

  it('isolates an RTL name so its brackets cannot scramble', async () => {
    const svg = await render(
      'pie X\nwaffle\nno-value\n\nالقراصنة الشجعان 30\nÅsa 70'
    );
    expect(texts(svg)).toContain(`${LRI}القراصنة الشجعان${PDI}`);
  });

  it('a format directive puts the value in the large slot', async () => {
    const svg = await render(
      'pie Bills\nwaffle\nformat currency GBP\nlocale en-GB\n\nTortuga 5400\nNassau 3100'
    );
    expect(texts(svg)).toContain('£5,400');
  });

  it('no-name with no-percent leaves the grid alone', async () => {
    const svg = await render(
      'pie One\nwaffle\nno-percent\nno-name\nformat compact\n\nLone 1000000000000\nGhost 0'
    );
    expect(cellRects(svg)).toHaveLength(100);
    expect(svg).not.toMatch(/<path d="M/);
    expect(texts(svg).filter((s) => s !== 'One')).toEqual([]);
  });

  it('under the width floor, labels move inside the grid', async () => {
    const svg = await render(WAFFLE, 340, 300);
    expect(cellRects(svg)).toHaveLength(100);
    expect(svg).toMatch(/<text[^>]*paint-order="stroke"[^>]*>45%<\/text>/);
  });

  it('at the floor itself, labels stay beside the grid', async () => {
    const svg = await render(WAFFLE, 360, 300);
    expect(svg).not.toMatch(/paint-order="stroke"[^>]*>45%/);
    expect(texts(svg)).toContain('45%');
  });

  it('keeps the grid on a tiny canvas', async () => {
    const svg = await render(WAFFLE, 160, 130);
    expect(cellRects(svg)).toHaveLength(100);
  });
});
