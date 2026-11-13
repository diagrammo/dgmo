// Number format (#1831): `format currency USD`, `format percent 1`,
// `format compact`, `format "<d3-format>"`, `unit ms`, `locale de-DE`.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseVisualization } from '../src/visualizations/parse';
import { renderDataChartD3 } from '../src/charts-d3';
import { fmtNum } from '../src/charts-d3/shared';
import {
  makeNumberFormatter,
  type NumberFormatSpec,
} from '../src/utils/number-format';
import { getPalette } from '../src/palettes';
import { render } from '../src/render';
import { summarizeDiagram } from '../src/utils/diagram-summary';

const palette = getPalette('nord').light;

const fmtOf = (src: string) =>
  makeNumberFormatter(parseChart(`bar X\n${src}\nA 1`).numberFormat, fmtNum);
const codes = (r: { diagnostics: { code?: string }[] }) =>
  r.diagnostics.map((d) => d.code).filter(Boolean);

describe('number format — parse', () => {
  it('reads the named formats, unit and locale', () => {
    expect(parseChart('bar X\nformat currency usd\nA 1').numberFormat).toEqual({
      kind: 'currency',
      currency: 'USD',
    });
    expect(parseChart('bar X\nformat percent 1\nA 1').numberFormat).toEqual({
      kind: 'percent',
      decimals: 1,
    });
    expect(
      parseChart('bar X\nformat compact\nunit ms\nlocale de-DE\nA 1')
        .numberFormat
    ).toEqual({ kind: 'compact', unit: 'ms', locale: 'de-DE' });
    expect(parseChart('bar X\nformat "$,.2f"\nA 1').numberFormat).toEqual({
      kind: 'pattern',
      pattern: '$,.2f',
    });
  });

  it('lets the last format line win and keeps unit and locale', () => {
    const r = parseChart(
      'bar X\nunit kg\nformat percent\nformat compact 2\nA 1'
    );
    expect(r.numberFormat).toEqual({
      kind: 'compact',
      decimals: 2,
      unit: 'kg',
    });
  });

  it('warns and ignores a line it cannot read', () => {
    for (const bad of [
      'format money',
      'format currency',
      'format currency DOLLARS',
      'format percent one',
      'format "%%%"',
      'locale not_a_locale!',
      'unit',
    ]) {
      const r = parseChart(`bar X\n${bad}\nA 1`);
      expect(codes(r), bad).toContain('W_NUMBER_FORMAT_INVALID');
      expect(r.data).toHaveLength(1);
    }
  });

  it('leaves a capitalised data row named Format alone', () => {
    const r = parseChart('bar X\nFormat 5\nA 1');
    expect(r.numberFormat).toBeUndefined();
    expect(r.data.map((d) => d.label)).toContain('Format');
  });

  it('is read by scatter, function, heatmap, funnel and slope', () => {
    for (const src of [
      'scatter S\nformat compact\nA 1 2',
      'function F\nformat compact\nx 0 to 1\nf: x',
      'heatmap H\nformat compact\ncolumns\n  A\nR 1',
      'funnel F\nformat compact\nA 10\nB 5',
    ])
      expect(parseExtendedChart(src).numberFormat?.kind, src).toBe('compact');
    const slope = parseVisualization(
      'slope S\nformat compact\nperiod 2020 2024\nA 1 2'
    ) as { numberFormat?: NumberFormatSpec };
    expect(slope.numberFormat?.kind).toBe('compact');
  });

  it('does not take a sankey flow that starts with the word', () => {
    const r = parseExtendedChart('sankey S\nformat -> Done 5');
    expect(r.numberFormat).toBeUndefined();
  });
});

describe('number format — output', () => {
  it('formats currency, trimming cents unless asked', () => {
    expect(fmtOf('format currency USD')(1200)).toBe('$1,200');
    expect(fmtOf('format currency USD')(12.5)).toBe('$12.5');
    expect(fmtOf('format currency USD 2')(12.5)).toBe('$12.50');
    expect(fmtOf('format currency EUR\nlocale de-DE')(1200)).toMatch(
      /^1\.200\s€$/
    );
  });

  it('reads percent values as written', () => {
    expect(fmtOf('format percent')(12.5)).toBe('12.5%');
    expect(fmtOf('format percent 0')(12.5)).toBe('13%');
  });

  it('compacts large numbers', () => {
    expect(fmtOf('format compact')(1_234_000)).toBe('1.2M');
    expect(fmtOf('format compact')(950)).toBe('950');
  });

  it('runs a d3-format pattern with the locale separators', () => {
    expect(fmtOf('format ",.2f"')(1234.5)).toBe('1,234.50');
    expect(fmtOf('format ",.2f"\nlocale de-DE')(1234.5)).toBe('1.234,50');
    expect(fmtOf('format ".1%"')(0.125)).toBe('12.5%');
  });

  it('puts a space before a word unit and none before a symbol', () => {
    expect(fmtOf('unit ms')(3)).toBe('3 ms');
    expect(fmtOf('unit °')(21)).toBe('21°');
  });

  it('applies the locale alone to plain numbers', () => {
    expect(fmtOf('locale de-DE')(1234.5)).toBe('1.234,5');
  });

  it('is the old formatter when nothing is set', () => {
    const f = makeNumberFormatter(undefined, fmtNum);
    expect(f).toBe(fmtNum);
  });
});

describe('number format — render', () => {
  it('bar: ticks and value labels take the currency', async () => {
    const svg = await renderDataChartD3(
      'bar Sales\nformat currency USD\nQ1 1200\nQ2 2500',
      'light',
      palette
    );
    expect(svg).toContain('>$1,200<');
    expect(svg).toContain('>$2,500<');
    expect(svg).toMatch(/>\$1,000</);
  });

  it('line: the unit follows every value label', async () => {
    const svg = await renderDataChartD3(
      'line Latency\nunit ms\nMon 120\nTue 95',
      'light',
      palette
    );
    expect(svg).toContain('>120 ms<');
    expect(svg).toContain('>95 ms<');
  });

  it('pie: the centre total takes the format', async () => {
    const svg = await renderDataChartD3(
      'pie Budget\nhole\nformat compact\nRent 1200000\nFood 800000',
      'light',
      palette
    );
    expect(svg).toContain('>2M<');
  });

  it('scatter: y takes the format, x stays plain', async () => {
    const svg = await renderDataChartD3(
      'scatter S\nformat percent\nA 10 20\nB 30 40',
      'light',
      palette
    );
    expect(svg).toMatch(/>\d+%</);
    expect(svg).toContain('data-axval-x="10"');
    expect(svg).toContain('data-axval-y="20%"');
  });

  it('slope: the end labels take the format', async () => {
    const { svg } = await render(
      'slope Fleet\nformat currency GBP\nperiod 2020 2024\nNassau 40 52'
    );
    expect(svg).toContain('£52');
    expect(svg).toContain('£40');
  });

  it('the generated description uses the format', () => {
    const desc = summarizeDiagram(
      'bar Sales\nformat currency USD\nQ1 1200\nQ2 2500',
      'bar'
    );
    expect(desc).toContain('$1,200');
    expect(desc).toContain('$2,500');
  });
});
