// Axis directives (#1830): `y-scale log`, `y-min N`, `y-max N`, and the
// `x-` forms on scatter. Parse, the three warnings, the shared axis builder,
// and the rendered ticks on each chart type that takes them.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseVisualization } from '../src/visualizations/parse';
import { renderDataChartD3 } from '../src/charts-d3';
import { buildValueAxis, logTicks } from '../src/charts-d3/value-axis';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

const codes = (r: { diagnostics: { code?: string }[] }) =>
  r.diagnostics.map((d) => d.code).filter(Boolean);

/** Numeric text of every `dgmo-tick` label in the SVG. */
function tickValues(svg: string): number[] {
  const out: number[] = [];
  const re = /class="dgmo-tick"[^>]*>([^<]+)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const n = Number(m[1]!.replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

describe('axis directives — parse', () => {
  it('reads y-scale, y-min and y-max on bar and line', () => {
    const bar = parseChart(
      'bar S\ny-scale log\ny-min 1\ny-max 1000\nA 5\nB 50'
    );
    expect(bar.axes?.y).toMatchObject({ scale: 'log', min: 1, max: 1000 });
    const line = parseChart('line S\ny-min 0\nA 315\nB 395');
    expect(line.axes?.y?.min).toBe(0);
    expect(codes(line)).toEqual([]);
  });

  it('accepts thousands separators and negative bounds', () => {
    const r = parseChart('line S\ny-min -1,000\ny-max 2_000\nA 5\nB 6');
    expect(r.axes?.y).toMatchObject({ min: -1000, max: 2000 });
  });

  it('reads both axes on scatter, y on function and slope', () => {
    const sc = parseExtendedChart(
      'scatter S\nx-scale log\ny-max 10\nA 10 5\nB 1000 7'
    );
    expect(sc.axes?.x?.scale).toBe('log');
    expect(sc.axes?.y?.max).toBe(10);
    const fn = parseExtendedChart('function F\ny-min -5\nx 0 to 10\nf: x');
    expect(fn.axes?.y?.min).toBe(-5);
    const sl = parseVisualization('slope S\nperiod 2020 2024\ny-min 0\nA 4 8');
    expect((sl as { axes?: { y?: { min?: number } } }).axes?.y?.min).toBe(0);
  });

  it('warns on a bad value and on an axis the chart does not have', () => {
    expect(codes(parseChart('bar S\ny-scale cubic\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
    expect(codes(parseChart('bar S\ny-min ten\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
    expect(codes(parseChart('bar S\nx-min 0\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
    expect(codes(parseChart('pie S\ny-max 5\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
  });

  it('drops an inverted min/max pair', () => {
    const r = parseChart('line S\ny-min 10\ny-max 5\nA 6\nB 7');
    expect(codes(r)).toContain('W_AXIS_DIRECTIVE_INVALID');
    expect(r.axes?.y?.min).toBeUndefined();
    expect(r.axes?.y?.max).toBeUndefined();
  });

  it('keeps a log axis linear when a value is zero or negative', () => {
    const r = parseChart('line S\ny-scale log\nA 0\nB 1000');
    expect(codes(r)).toContain('W_AXIS_LOG_NOT_POSITIVE');
    expect(r.axes?.y?.scale).toBeUndefined();
  });

  it('refuses a log scale on a stacked bar', () => {
    const r = parseChart(
      'bar S\ny-scale log\nstack\n  One\n  Two\nA 10 100\nB 20 200'
    );
    expect(codes(r)).toContain('W_AXIS_DIRECTIVE_INVALID');
    expect(r.axes?.y?.scale).toBeUndefined();
  });

  it('warns when a value falls outside the fixed range', () => {
    const r = parseChart('bar S\ny-max 100\nA 50\nB 500');
    expect(codes(r)).toContain('W_AXIS_DATA_OUTSIDE_RANGE');
    const stacked = parseChart(
      'bar S\ny-max 100\nstack\n  One\n  Two\nA 60 60'
    );
    expect(codes(stacked)).toContain('W_AXIS_DATA_OUTSIDE_RANGE');
  });

  it('checks only the left series of a dual-axis line', () => {
    const r = parseChart(
      'line S\ny-max 100\nseries\n  y-label Left\n    L\n  y-right-label Right\n    R\nA 50 5000\nB 60 6000'
    );
    expect(codes(r)).not.toContain('W_AXIS_DATA_OUTSIDE_RANGE');
  });

  it('leaves a data row that only looks like a directive alone', () => {
    const r = parseChart('bar S\nY-Max 5\nA 6');
    expect(r.axes?.y).toBeUndefined();
    expect(r.data.map((d) => d.label)).toContain('Y-Max');
  });
});

describe('buildValueAxis', () => {
  it('rounds the free end and keeps a fixed end exact', () => {
    const a = buildValueAxis(0, 93, { min: 0, max: 93 }, [0, 100]);
    expect(a.domain()).toEqual([0, 93]);
    const ticks = a.ticks(6);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(93);
    const free = buildValueAxis(3, 93, { min: 3 }, [0, 100], { nice: true });
    expect(free.domain()).toEqual([3, 100]);
  });

  it('keeps the top tick of an auto-rounded axis', () => {
    // 0→245 rounds to 0→260; the 250 tick is on-stride and must stay.
    const a = buildValueAxis(0, 245, undefined, [0, 1], { nice: true });
    expect(a.ticks(6)).toContain(250);
  });

  it('builds a log axis over whole decades with decade ticks', () => {
    const a = buildValueAxis(0, 0, { scale: 'log' }, [0, 100], {
      dataLo: 12,
      dataHi: 8_000_000,
    });
    expect(a.isLog).toBe(true);
    expect(a.domain()).toEqual([10, 10_000_000]);
    expect(a.ticks(6)).toEqual([10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]);
    expect(a.baseline).toBe(10);
  });

  it('adds 2× and 5× steps when a log axis spans under three decades', () => {
    expect(logTicks(10, 100)).toEqual([10, 20, 50, 100]);
  });

  it('falls back to linear when a log axis would include 0', () => {
    const a = buildValueAxis(0, 10, { scale: 'log' }, [0, 1], {
      dataLo: 0,
      dataHi: 10,
    });
    expect(a.isLog).toBe(false);
  });

  it('puts the bar baseline at 0 when 0 is in range, else at the near end', () => {
    expect(buildValueAxis(-5, 10, undefined, [0, 1]).baseline).toBe(0);
    expect(buildValueAxis(0, 10, { min: 4 }, [0, 1]).baseline).toBe(4);
  });
});

describe('axis directives — render', () => {
  it('line: a log axis over 10 → 10M draws decade ticks', async () => {
    const svg = await renderDataChartD3(
      'line Users\ny-scale log\nA 10\nB 1000\nC 100000\nD 10000000',
      'light',
      palette
    );
    expect(tickValues(svg)).toEqual([10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]);
  });

  it('line: y-min and y-max are honoured', async () => {
    const svg = await renderDataChartD3(
      'line Squat\ny-min 0\ny-max 500\nW1 315\nW2 395',
      'light',
      palette
    );
    const t = tickValues(svg);
    expect(Math.min(...t)).toBe(0);
    expect(Math.max(...t)).toBe(500);
  });

  it('bar: a log axis labels every decade', async () => {
    const svg = await renderDataChartD3(
      'bar Sizes\ny-scale log\nA 10\nB 1000\nC 100000',
      'light',
      palette
    );
    for (const label of ['10', '100', '1,000', '10,000', '100,000'])
      expect(svg).toContain(`>${label}</text>`);
  });

  it('scatter: both axes take a log scale', async () => {
    const svg = await renderDataChartD3(
      'scatter S\nx-scale log\ny-scale log\nA 10 10\nB 1000 1000\nC 100000 100000',
      'light',
      palette
    );
    const t = tickValues(svg);
    expect(t).toContain(1000);
    expect(t).toContain(100000);
    expect(t).not.toContain(50000);
  });

  it('function: y-max cuts the curve rather than stretching the axis', async () => {
    const svg = await renderDataChartD3(
      'function F\ny-max 10\nx 0 to 10\nsquare: x^2',
      'light',
      palette
    );
    expect(Math.max(...tickValues(svg))).toBe(10);
  });
});
