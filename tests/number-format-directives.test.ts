// Number format (#1831): `format currency USD`, `format percent 1`,
// `format compact`, `format "<d3-format>"`, `unit ms`, `locale de-DE`.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
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

/** Every `<text>`'s content: a tabular label is one tspan per digit (#2035). */
const texts = (svg: string): string[] =>
  [
    ...new JSDOM(svg, {
      contentType: 'image/svg+xml',
    }).window.document.querySelectorAll('text'),
  ].map((t) => t.textContent ?? '');

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
      'function F\nformat compact\nx-axis 0..1\nf: x',
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
    expect(texts(svg)).toContain('$1,200');
    expect(texts(svg)).toContain('$2,500');
    expect(texts(svg)).toContain('$1,000');
  });

  it('line: a symbol unit follows every value label', async () => {
    const svg = await renderDataChartD3(
      'line Heat\nunit °\nMon 21\nTue 18',
      'light',
      palette
    );
    expect(texts(svg)).toContain('21°');
    expect(texts(svg)).toContain('18°');
  });

  it('pie: the centre total takes the format', async () => {
    const svg = await renderDataChartD3(
      'pie Budget\nhole\nformat compact\nRent 1200000\nFood 800000',
      'light',
      palette
    );
    // One unit and one decimal count for the chart (#2036).
    expect(texts(svg)).toContain('2.0M');
  });

  it('scatter: y takes the format, x stays plain', async () => {
    const svg = await renderDataChartD3(
      'scatter S\nformat percent\nA 10 20\nB 30 40',
      'light',
      palette
    );
    expect(texts(svg).some((t) => /^\d+%$/.test(t))).toBe(true);
    expect(svg).toContain('data-axval-x="10"');
    expect(svg).toContain('data-axval-y="20%"');
  });

  it('slope: the end labels take the format', async () => {
    const { svg } = await render(
      'slope Fleet\nformat currency GBP\nperiod 2020 2024\nNassau 40 52'
    );
    expect(texts(svg).join('|')).toContain('£52');
    expect(texts(svg).join('|')).toContain('£40');
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

// One compact unit per axis (#2036, option 1 decided 2026-11-16).
describe('number format — one compact unit per axis', () => {
  const ticks = [0, 200, 400, 600, 800, 1000, 1200];
  const compact = (spec: NumberFormatSpec, basis: number[]) =>
    makeNumberFormatter(spec, fmtNum, basis);

  it('prints every tick in the unit of the largest, with one decimal count', () => {
    const f = compact({ kind: 'compact' }, ticks);
    expect(ticks.map(f)).toEqual([
      '0',
      '0.2K',
      '0.4K',
      '0.6K',
      '0.8K',
      '1.0K',
      '1.2K',
    ]);
  });

  it('value labels follow the axis unit and decimals', () => {
    const f = compact({ kind: 'compact' }, ticks);
    expect([1200, 800, 420, 310].map(f)).toEqual([
      '1.2K',
      '0.8K',
      '0.4K',
      '0.3K',
    ]);
  });

  it('an author decimal count wins', () => {
    const f = compact({ kind: 'compact', decimals: 2 }, ticks);
    expect(f(420)).toBe('0.42K');
  });

  it('an axis below the first unit stays plain', () => {
    const f = compact({ kind: 'compact' }, [0, 250, 500]);
    expect([0, 125, 500].map(f)).toEqual(['0', '125', '500']);
  });

  it('takes the locale unit and keeps a unit suffix', () => {
    expect(
      compact({ kind: 'compact', locale: 'ja-JP' }, [0, 20000, 40000])(30000)
    ).toBe('3万');
    expect(
      compact({ kind: 'compact', unit: 'ms' }, [0, 50000, 100000])(-25000)
    ).toBe('-25K ms');
  });

  it('a value far below the shared unit gets its own unit (#2294)', () => {
    const f = compact({ kind: 'compact' }, [10_000, 1_000_000, 20_000_000_000]);
    expect([10_000, 1_000_000, 3_000_000, 20_000_000_000].map(f)).toEqual([
      '10K',
      '1M',
      '3M',
      '20B',
    ]);
    expect(f(-500_000_000)).toBe('-500M');
    expect(f(0)).toBe('0');
    expect(f(-3_000_000)).toBe('-3M');
    const ja = compact(
      { kind: 'compact', locale: 'ja-JP' },
      [0, 500_000_000_000]
    );
    expect(ja(30_000_000)).toBe('3000万');
  });

  it('bar: the axis and the bar labels share one unit', async () => {
    const svg = await renderDataChartD3(
      'bar Doubloons\nformat compact\nNassau 1200\nPort Royal 800\nTortuga 420\nHavana 310',
      'light',
      palette
    );
    const t = texts(svg);
    for (const s of ['0', '0.4K', '0.8K', '1.2K', '0.3K'])
      expect(t).toContain(s);
    expect(t).not.toContain('800');
    expect(t).not.toContain('1K');
  });
});

// A word unit is stated once, on the value-axis title (#2088, option 1
// decided 2026-11-17); a symbol unit stays on every number.
describe('number format — a word unit goes on the axis title', () => {
  const diverging = [
    'bar Muster',
    'orientation-horizontal',
    'x-axis Question',
    'y-axis Crew votes',
    'unit votes',
    'stack diverging',
    '  Nay red',
    '  Abstain gray neutral',
    'Rum 40 20',
    'Watch rota 70 5',
  ].join('\n');

  it('bar: ticks and segment labels are bare, the word appears once', async () => {
    const t = texts(await renderDataChartD3(diverging, 'light', palette));
    expect(t.filter((s) => /votes/i.test(s))).toEqual(['Crew votes']);
    expect(t).toContain('70');
    expect(t).toContain('40');
  });

  it('bar: a title without the word gains it; no title becomes the word', async () => {
    const titled = texts(
      await renderDataChartD3(
        'bar Votes\ny-axis Crew\nunit votes\nA 40\nB 70',
        'light',
        palette
      )
    );
    expect(titled.filter((s) => /votes/.test(s))).toEqual(['Crew (votes)']);
    const bare = texts(
      await renderDataChartD3(
        'bar Tally\nunit votes\nA 40\nB 70',
        'light',
        palette
      )
    );
    expect(bare.filter((s) => /votes/i.test(s))).toEqual(['Votes']);
  });

  it('line: an abbreviation keeps its case on the axis title', async () => {
    const t = texts(
      await renderDataChartD3(
        'line Latency\nunit ms\nMon 120\nTue 95',
        'light',
        palette
      )
    );
    expect(t).toContain('120');
    expect(t.filter((s) => /ms/.test(s))).toEqual(['ms']);
  });

  it('the generated description keeps the unit on every number', () => {
    expect(summarizeDiagram('bar T\nunit votes\nA 40\nB 70', 'bar')).toContain(
      '70 votes'
    );
  });
});
