// `pie` + bare `waffle` (#1983): the pie's rows as a 10×10 grid, one cell
// per percent of the total.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { waffleCells } from '../src/charts-d3/waffle';

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

describe('waffle — render', () => {
  it('draws 100 cells plus one key swatch per row, and no wedges', async () => {
    const svg = await renderDataChartD3(WAFFLE, 'light', undefined, {
      width: 800,
      height: 500,
    });
    expect(svg).not.toMatch(/<path[^>]*class="dgmo-datum"/);
    // 100 grid cells + 6 key swatches.
    expect(cellRects(svg)).toHaveLength(106);
    expect(svg).toContain('Sailors — 45 (45%)');
  });

  it('every cell carries its row as the emphasis key', async () => {
    const svg = await renderDataChartD3(WAFFLE, 'light', undefined, {
      width: 800,
      height: 500,
    });
    const sailors = svg.match(/<rect[^>]*data-emph-key="Sailors"[^>]*>/g) ?? [];
    expect(sailors).toHaveLength(46); // 45 cells + 1 swatch
  });

  it('drops the key on a tiny canvas but keeps the grid', async () => {
    const svg = await renderDataChartD3(WAFFLE, 'light', undefined, {
      width: 160,
      height: 130,
    });
    expect(cellRects(svg)).toHaveLength(100);
  });
});
