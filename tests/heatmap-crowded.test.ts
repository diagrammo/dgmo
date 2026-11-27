// heatmap-crowded.test.ts — a heatmap draws at most HEATMAP_MAX_ROWS rows and
// HEATMAP_MAX_COLS columns, its row and column names never overprint, and a
// hovered cell marks its row and column names (#2445).

import { describe, it, expect, afterEach } from 'vitest';
import { parseHeatmap } from '../src/data-chart-parser';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { attachDataChartInteractions } from '../src/charts-d3/interactions';
import {
  HEATMAP_MAX_COLS,
  HEATMAP_MAX_ROWS,
} from '../src/charts-d3/heatmap-limits';

const CODE = 'E_HEATMAP_TOO_LARGE';
/** An r × c grid named R0… and C0…, like the owner's pressure file. */
const grid = (r: number, c: number) =>
  [
    'heatmap Pressure',
    `columns ${Array.from({ length: c }, (_, i) => `C${i}`).join(', ')}`,
    '',
    ...Array.from(
      { length: r },
      (_, i) =>
        `R${i} ${Array.from({ length: c }, (_, k) => (i * 7 + k * 3) % 11).join(' ')}`
    ),
  ].join('\n');

const errors = (src: string) =>
  parseHeatmap(src).diagnostics.filter((d) => d.code === CODE);

let host: HTMLDivElement | undefined;
let detach: { destroy: () => void } | undefined;
afterEach(() => {
  detach?.destroy();
  host?.remove();
  host = undefined;
  detach = undefined;
});

async function mount(src: string, width = 1200, height = 800) {
  host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = await renderDataChartD3(src, 'light', undefined, {
    width,
    height,
  });
  const svg = host.querySelector('svg')!;
  detach = attachDataChartInteractions(svg, {});
  return svg;
}

const names = (svg: SVGSVGElement, attr: 'data-row-key' | 'data-col-key') => [
  ...svg.querySelectorAll<SVGTextElement>(
    `.dgmo-axis-label[data-filter-attr="${attr}"]`
  ),
];
const shown = (els: SVGTextElement[]) =>
  els.filter((e) => e.getAttribute('visibility') !== 'hidden');
/** A name's anchor: x/y, or the translate of a rotated one. */
const anchor = (t: SVGTextElement) => {
  const tr = /translate\(([-\d.]+),([-\d.]+)\)/.exec(
    t.getAttribute('transform') ?? ''
  );
  return tr
    ? { x: +tr[1]!, y: +tr[2]!, rotated: true }
    : { x: +t.getAttribute('x')!, y: +t.getAttribute('y')!, rotated: false };
};
const fontOf = (t: SVGTextElement) => +t.getAttribute('font-size')!;

describe('heatmap size limit (#2445)', () => {
  it(`${HEATMAP_MAX_ROWS} rows × ${HEATMAP_MAX_COLS} columns raise nothing`, () => {
    expect(errors(grid(HEATMAP_MAX_ROWS, HEATMAP_MAX_COLS))).toHaveLength(0);
  });

  it('one row too many raises one error on the first row left out', () => {
    const src = grid(HEATMAP_MAX_ROWS + 1, 5);
    const r = parseHeatmap(src);
    const errs = errors(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.message).toContain(`${HEATMAP_MAX_ROWS + 1} rows`);
    expect(errs[0]!.line).toBe(3 + HEATMAP_MAX_ROWS + 1);
    expect(r.heatmapRows).toHaveLength(HEATMAP_MAX_ROWS);
  });

  it('one column too many raises one error on the columns line', () => {
    const src = grid(3, HEATMAP_MAX_COLS + 1);
    const r = parseHeatmap(src);
    const errs = errors(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain(`${HEATMAP_MAX_COLS + 1} columns`);
    expect(errs[0]!.line).toBe(2);
    expect(r.columns).toHaveLength(HEATMAP_MAX_COLS);
    for (const row of r.heatmapRows!)
      expect(row.values).toHaveLength(HEATMAP_MAX_COLS);
  });

  it('100 × 100 draws the first N × M cells with ONE error naming both', async () => {
    const src = grid(100, 100);
    const errs = errors(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('100 rows and 100 columns');
    expect(errs[0]!.message).toContain(
      `${HEATMAP_MAX_ROWS} rows and ${HEATMAP_MAX_COLS} columns`
    );
    const svg = await mount(src);
    expect(svg.querySelectorAll('rect.dgmo-datum[data-row-key]').length).toBe(
      HEATMAP_MAX_ROWS * HEATMAP_MAX_COLS
    );
  });
});

describe('heatmap names never overprint (#2445)', () => {
  it('row names keep at least one line between them; column names one line across the slant', async () => {
    const svg = await mount(grid(100, 100));
    const rows = names(svg, 'data-row-key');
    const cols = names(svg, 'data-col-key');
    expect(rows).toHaveLength(HEATMAP_MAX_ROWS);
    expect(cols).toHaveLength(HEATMAP_MAX_COLS);
    // Thinning happened, and the first and last names survive.
    const r = shown(rows);
    const c = shown(cols);
    expect(r.length).toBeLessThan(rows.length);
    expect(r[0]).toBe(rows[0]);
    expect(r[r.length - 1]).toBe(rows[rows.length - 1]);

    const ys = r.map((t) => anchor(t).y).sort((a, b) => a - b);
    const rowLine = fontOf(r[0]!) * 1.25;
    for (let i = 1; i < ys.length; i++)
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(rowLine - 1e-6);

    const a = c.map(anchor);
    const colLine = fontOf(c[0]!) * 1.25;
    // Rotated names are parallel lines; their spacing across the slant is
    // dx·sin(40°). Flat names would need their widths apart.
    expect(a.every((p) => p.rotated)).toBe(true);
    const sin = Math.sin((40 * Math.PI) / 180);
    const xs = a.map((p) => p.x).sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++)
      expect((xs[i]! - xs[i - 1]!) * sin).toBeGreaterThanOrEqual(
        colLine - 1e-6
      );
  });

  it('a small heatmap hides no name', async () => {
    const svg = await mount(grid(5, 4), 800, 500);
    for (const t of [
      ...names(svg, 'data-row-key'),
      ...names(svg, 'data-col-key'),
    ]) {
      expect(t.hasAttribute('visibility')).toBe(false);
      expect(t.hasAttribute('data-thinned')).toBe(false);
    }
  });
});

describe('heatmap cell hover marks its row and column (#2445)', () => {
  const fire = (el: Element, type: string) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  const cell = (svg: SVGSVGElement, row: string, col: string) =>
    svg.querySelector<SVGRectElement>(
      `rect.dgmo-datum[data-row-key="${row}"][data-col-key="${col}"]`
    )!;
  const name = (svg: SVGSVGElement, value: string) =>
    svg.querySelector<SVGTextElement>(
      `.dgmo-axis-label[data-filter-value="${value}"]`
    )!;

  it('bolds both names, shows a thinned one, fades the others, draws a crosshair; leaving restores', async () => {
    const svg = await mount(grid(100, 100));
    // R1 and C1 are thinned out at this density.
    expect(name(svg, 'R1').getAttribute('visibility')).toBe('hidden');
    expect(name(svg, 'C1').getAttribute('visibility')).toBe('hidden');

    fire(cell(svg, 'R1', 'C1'), 'mousemove');
    for (const v of ['R1', 'C1']) {
      const n = name(svg, v);
      expect(n.classList.contains('dgmo-axis-active')).toBe(true);
      expect(n.getAttribute('visibility')).toBe('visible');
      expect(n.classList.contains('dgmo-faded')).toBe(false);
    }
    expect(name(svg, 'R0').classList.contains('dgmo-faded')).toBe(true);
    expect(name(svg, 'C0').classList.contains('dgmo-faded')).toBe(true);
    const lines = svg.querySelectorAll('.dgmo-overlay line.dgmo-axline');
    expect(lines.length).toBe(2);
    // The hovered cell keeps its own emphasis; others dim.
    expect(cell(svg, 'R1', 'C1').classList.contains('dgmo-dim')).toBe(false);
    expect(cell(svg, 'R0', 'C0').classList.contains('dgmo-dim')).toBe(true);

    fire(svg, 'mouseleave');
    expect(name(svg, 'R1').getAttribute('visibility')).toBe('hidden');
    expect(name(svg, 'R1').classList.contains('dgmo-axis-active')).toBe(false);
    expect(name(svg, 'R0').classList.contains('dgmo-faded')).toBe(false);
    expect(svg.querySelectorAll('.dgmo-overlay line').length).toBe(0);
  });

  it('a cut name shows its full text while its cell is hovered', async () => {
    const long = 'A very long row name that cannot fit the label column at all';
    const src = `heatmap Load\ncolumns Mon, Tue\n\n${long} 1 2\nShort 3 4`;
    const svg = await mount(src, 400, 300);
    const n = name(svg, long);
    const cut = n.firstChild!.textContent!;
    expect(cut).not.toBe(long);
    expect(n.getAttribute('data-full-text')).toBe(long);
    fire(cell(svg, long, 'Mon'), 'mousemove');
    expect(n.firstChild!.textContent).toBe(long);
    fire(svg, 'mouseleave');
    expect(n.firstChild!.textContent).toBe(cut);
  });
});
