// The indented axis block (#2116): `format` / `unit` / `locale` indented under
// an axis line set that axis only.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseVisualization } from '../src/visualizations/parse';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';
import { render } from '../src/render';
import { summarizeDiagram } from '../src/utils/diagram-summary';
import { mergeNumberFormat } from '../src/utils/axis-format';

const palette = getPalette('nord').light;
const texts = (svg: string): string[] =>
  [
    ...new JSDOM(svg, {
      contentType: 'image/svg+xml',
    }).window.document.querySelectorAll('text'),
  ].map((t) => t.textContent ?? '');
const codes = (r: { diagnostics: { code?: string }[] }) =>
  r.diagnostics.map((d) => d.code).filter(Boolean);

const dual = [
  'line Oil Price vs Reserve',
  'y-axis Price 0..',
  '  format currency USD',
  'y-right-axis Reserve',
  '  unit bbl',
  'series',
  '  y-axis',
  '    Oil Price blue',
  '  y-right-axis',
  '    SPR Size green',
  '2020 40 640',
  '2021 68 620',
  '2022 95 372',
].join('\n');

describe('axis block — parse', () => {
  it('a block on the value axis folds into the chart format', () => {
    const p = parseChart('bar X\ny-axis Sales\n  format currency EUR\nA 1');
    expect(p.numberFormat).toEqual({ kind: 'currency', currency: 'EUR' });
    expect(p.axisFormats).toBeUndefined();
    expect(p.ylabel).toBe('Sales');
    expect(p.data).toHaveLength(1);
    expect(codes(p)).toEqual([]);
  });

  it('a block replaces only the parts it names, wherever the chart line sits', () => {
    const p = parseChart(
      'bar X\ny-axis\n  unit ms\nformat compact\nlocale de-DE\nA 1'
    );
    expect(p.numberFormat).toEqual({
      kind: 'compact',
      unit: 'ms',
      locale: 'de-DE',
    });
  });

  it('dual-axis line: the right axis keeps its own format', () => {
    const p = parseChart(dual);
    expect(codes(p)).toEqual([]);
    expect(p.numberFormat).toEqual({ kind: 'currency', currency: 'USD' });
    expect(p.axisFormats?.['y-right']).toEqual({ unit: 'bbl' });
  });

  it('the right axis starts from the chart format, not the left block', () => {
    const p = parseChart(
      [
        'line X',
        'format compact',
        'y-axis',
        '  format currency USD',
        'series',
        '  y-axis',
        '    A',
        '  y-right-axis',
        '    B',
        '2020 1 2',
      ].join('\n')
    );
    expect(p.numberFormat).toEqual({ kind: 'currency', currency: 'USD' });
    expect(p.axisFormats?.['y-right']).toEqual({ kind: 'compact' });
  });

  it('a setting under a series-block header sets that axis', () => {
    const p = parseChart(
      [
        'line X',
        'series',
        '  y-axis $ / barrel',
        '    format currency USD',
        '    Oil Price',
        '  y-right-axis Million barrels',
        '    unit bbl',
        '    SPR Size',
        '2020 40 640',
      ].join('\n')
    );
    expect(codes(p)).toEqual([]);
    expect(p.seriesNames).toEqual(['Oil Price', 'SPR Size']);
    expect(p.numberFormat).toEqual({ kind: 'currency', currency: 'USD' });
    expect(p.axisFormats?.['y-right']).toEqual({ unit: 'bbl' });
  });

  it('scatter x keeps a block of its own; it does not inherit the chart format', () => {
    const p = parseExtendedChart(
      'scatter S\nformat percent\nx-axis Cost\n  format currency USD\nA 10 20'
    );
    expect(codes(p)).toEqual([]);
    expect(p.numberFormat).toEqual({ kind: 'percent' });
    expect(p.axisFormats?.x).toEqual({ kind: 'currency', currency: 'USD' });
    expect(p.xlabel).toBe('Cost');
    expect(p.scatterPoints).toHaveLength(1);
  });

  it('slope: a y-axis block folds into the chart format', () => {
    const p = parseVisualization(
      'slope Fleet\ny-axis 0..100\n  format currency GBP\nperiod 2020 2024\nNassau 40 52'
    );
    expect(p.numberFormat).toEqual({ kind: 'currency', currency: 'GBP' });
    expect(codes(p)).toEqual([]);
  });

  it('warns on a child that is not a setting, and drops it', () => {
    const p = parseChart('bar X\ny-axis\n  ticks 5\nA 1');
    expect(codes(p)).toEqual(['W_AXIS_SETTING_INVALID']);
    expect(p.data.map((d) => d.label)).toEqual(['A']);
  });

  it('warns on a format for an axis that prints no numbers', () => {
    const p = parseChart('bar X\nx-axis Quarter\n  format currency USD\nA 1');
    expect(codes(p)).toEqual(['W_AXIS_SETTING_INVALID']);
    expect(p.numberFormat).toBeUndefined();
    expect(p.xlabel).toBe('Quarter');
  });

  it('a bad setting under an axis warns as a bad format', () => {
    const p = parseChart('bar X\ny-axis\n  format money\nA 1');
    expect(codes(p)).toEqual(['W_NUMBER_FORMAT_INVALID']);
  });

  it('a blank line ends the block', () => {
    const p = parseChart('bar X\ny-axis\n\n  format compact\nA 1');
    // The indented line after the blank is no longer the axis's child.
    expect(p.numberFormat).toEqual({ kind: 'compact' });
  });

  it('mergeNumberFormat replaces the format whole, and keeps the rest', () => {
    expect(
      mergeNumberFormat(
        { kind: 'currency', currency: 'USD', decimals: 2, unit: 'x' },
        { kind: 'compact' }
      )
    ).toEqual({ kind: 'compact', unit: 'x' });
  });
});

describe('axis block — render', () => {
  it('dual-axis line: $ on the left, bbl on the right title', async () => {
    const t = texts(await renderDataChartD3(dual, 'light', palette));
    expect(t.some((s) => /^\$\d/.test(s))).toBe(true);
    // The word unit is stated once, on the right axis title.
    expect(t).toContain('Reserve (bbl)');
    expect(t.filter((s) => /bbl/.test(s))).toEqual(['Reserve (bbl)']);
    // The right ticks are not dollars.
    expect(t).toContain('640');
    expect(t).not.toContain('$640');
  });

  it('dual-axis line: an untitled right axis is titled with its own unit', async () => {
    const src = dual.replace('y-right-axis Reserve', 'y-right-axis');
    const t = texts(await renderDataChartD3(src, 'light', palette));
    // An untitled axis takes the unit capitalised, as #2088 does (`Votes`).
    expect(t).toContain('Bbl');
  });

  it('scatter: x prints with its block, y with the chart format', async () => {
    const svg = await renderDataChartD3(
      'scatter S\nformat percent\nx-axis\n  format currency USD\nA 10 20\nB 30 40',
      'light',
      palette
    );
    expect(svg).toContain('data-axval-x="$10"');
    expect(svg).toContain('data-axval-y="20%"');
  });

  it('function: x ticks take the x block', async () => {
    const { svg } = await render(
      'function F\nx-axis 0..10\n  format currency USD\nf(x): x'
    );
    expect(texts(svg).some((s) => /^\$\d/.test(s))).toBe(true);
  });

  it('the generated description gives each axis its own range', () => {
    const desc = summarizeDiagram(dual, 'line');
    expect(desc).toContain('left axis');
    expect(desc).toMatch(/\$40/);
    expect(desc).toMatch(/372 bbl/);
  });
});
