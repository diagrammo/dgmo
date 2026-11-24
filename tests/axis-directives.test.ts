// The axis line (decision #60): `y-axis <title> <min>..<max> <log|linear>`,
// and `x-axis` on scatter and function. Parse, the three warnings, the shared axis builder,
// and the rendered ticks on each chart type that takes them.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { parseExtendedChart } from '../src/data-chart-parser';
import { parseVisualization } from '../src/visualizations/parse';
import { renderDataChartD3 as renderDataChartD3Raw } from '../src/charts-d3';
import { flattenTabular } from './helpers/tabular-text';
import { buildValueAxis, logTicks } from '../src/charts-d3/value-axis';
import { readAxisLine } from '../src/utils/axis-spec';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';

// Labels are digit cells (#2035); read their text as one string.
const renderDataChartD3 = async (
  ...a: Parameters<typeof renderDataChartD3Raw>
): Promise<string> => flattenTabular(await renderDataChartD3Raw(...a));

const palette = getPalette('nord').light;

const codes = (r: { diagnostics: { code?: string }[] }) =>
  r.diagnostics.map((d) => d.code).filter(Boolean);

/** A tick label's number: `1,000`, `10K` and `2.5M` all read back. */
function compactValue(text: string): number {
  const m = /^([\d.,-]+)([KMB]?)$/.exec(text.trim());
  if (!m) return NaN;
  const scale = { '': 1, K: 1e3, M: 1e6, B: 1e9 }[m[2]!]!;
  return Number(m[1]!.replace(/,/g, '')) * scale;
}

/**
 * A value axis as drawn: each gridline's position and the label bar draws
 * right after it, when there is one. A gridline with x1 = x2 belongs to a
 * horizontal axis (labels side by side), y1 = y2 to a vertical one.
 */
type AxisRow = { pos: number; horizontal: boolean; label?: string };
function axisRows(svg: string): AxisRow[] {
  const re =
    /<line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)"[^>]*><\/line>(?:<text(?![^>]*dgmo-tick)[^>]*>([^<]+)<\/text>)?/g;
  return [...svg.matchAll(re)]
    .filter((m) => m[1] === m[2] || m[3] === m[4])
    .map((m) => ({
      pos: Number(m[1] === m[2] ? m[1] : m[3]),
      horizontal: m[1] === m[2],
      // A category name drawn next can follow the last gridline; only a
      // number is a tick label.
      ...(m[5] !== undefined &&
        Number.isFinite(compactValue(m[5])) && { label: m[5] }),
    }));
}

/** True when no two tick labels' boxes overlap (TICK_FONT 12). */
function labelBoxesApart(rows: AxisRow[]): boolean {
  const spans = rows
    .filter((r) => r.label !== undefined)
    .map((r) => {
      const half = (r.horizontal ? measureText(r.label!, 12) : 12 * 1.2) / 2;
      return { lo: r.pos - half, hi: r.pos + half };
    })
    .sort((a, b) => a.lo - b.lo);
  return spans.every((b, i) => i === 0 || spans[i - 1]!.hi <= b.lo);
}

/** Numeric text of every `dgmo-tick` label in the SVG. */
function tickValues(svg: string): number[] {
  const out: number[] = [];
  const re = /class="dgmo-tick"[^>]*>([^<]+)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const n = compactValue(m[1]!);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

describe('axis directives — parse', () => {
  it('reads range and scale on bar and line', () => {
    const bar = parseChart('bar S\ny-axis 1..1000 log\nA 5\nB 50');
    expect(bar.axes?.y).toMatchObject({ scale: 'log', min: 1, max: 1000 });
    const line = parseChart('line S\ny-axis 0..\nA 315\nB 395');
    expect(line.axes?.y?.min).toBe(0);
    expect(codes(line)).toEqual([]);
  });

  it('accepts thousands separators and negative bounds', () => {
    const r = parseChart('line S\ny-axis -1000..2000\nA 5\nB 6');
    expect(r.axes?.y).toMatchObject({ min: -1000, max: 2000 });
  });

  it('reads both axes on scatter, y on function and slope', () => {
    const sc = parseExtendedChart(
      'scatter S\nx-axis log\ny-axis ..10\nA 10 5\nB 1000 7'
    );
    expect(sc.axes?.x?.scale).toBe('log');
    expect(sc.axes?.y?.max).toBe(10);
    const fn = parseExtendedChart(
      'function F\ny-axis -5..\nx-axis 0..10\nf: x'
    );
    expect(fn.axes?.y?.min).toBe(-5);
    const sl = parseVisualization(
      'slope S\nperiod 2020 2024\ny-axis 0..\nA 4 8'
    );
    expect((sl as { axes?: { y?: { min?: number } } }).axes?.y?.min).toBe(0);
  });

  it('warns on a bad value and on an axis the chart does not have', () => {
    expect(codes(parseChart('bar S\ny-axis 1..2..3\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
    expect(codes(parseChart('bar S\ny-axis ten..\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
    expect(codes(parseChart('bar S\nx-axis 0..\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
    expect(codes(parseChart('pie S\ny-axis ..5\nA 5'))).toContain(
      'W_AXIS_DIRECTIVE_INVALID'
    );
  });

  it('drops an inverted min/max pair', () => {
    const r = parseChart('line S\ny-axis 10..5\nA 6\nB 7');
    expect(codes(r)).toContain('W_AXIS_DIRECTIVE_INVALID');
    expect(r.axes?.y?.min).toBeUndefined();
    expect(r.axes?.y?.max).toBeUndefined();
  });

  it('keeps a log axis linear when a value is zero or negative', () => {
    const r = parseChart('line S\ny-axis log\nA 0\nB 1000');
    expect(codes(r)).toContain('W_AXIS_LOG_NOT_POSITIVE');
    expect(r.axes?.y?.scale).toBeUndefined();
  });

  it('refuses a log scale on a stacked bar', () => {
    const r = parseChart(
      'bar S\ny-axis log\nstack\n  One\n  Two\nA 10 100\nB 20 200'
    );
    expect(codes(r)).toContain('W_AXIS_DIRECTIVE_INVALID');
    expect(r.axes?.y?.scale).toBeUndefined();
  });

  it('warns when a value falls outside the fixed range', () => {
    const r = parseChart('bar S\ny-axis ..100\nA 50\nB 500');
    expect(codes(r)).toContain('W_AXIS_DATA_OUTSIDE_RANGE');
    const stacked = parseChart(
      'bar S\ny-axis ..100\nstack\n  One\n  Two\nA 60 60'
    );
    expect(codes(stacked)).toContain('E_STACK_PAST_AXIS_RANGE');
  });

  it('checks only the left series of a dual-axis line', () => {
    const r = parseChart(
      'line S\ny-axis ..100\nseries\n  y-axis Left\n    L\n  y-right-axis Right\n    R\nA 50 5000\nB 60 6000'
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
      'line Users\ny-axis log\nA 10\nB 1000\nC 100000\nD 10000000',
      'light',
      palette
    );
    expect(tickValues(svg)).toEqual([10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]);
  });

  it('line: a fixed range is honoured', async () => {
    const svg = await renderDataChartD3(
      'line Squat\ny-axis 0..500\nW1 315\nW2 395',
      'light',
      palette
    );
    const t = tickValues(svg);
    expect(Math.min(...t)).toBe(0);
    expect(Math.max(...t)).toBe(500);
  });

  it('bar: a log axis labels every decade, compact', async () => {
    const svg = await renderDataChartD3(
      'bar Sizes\ny-axis log\nA 10\nB 1000\nC 100000',
      'light',
      palette
    );
    expect(axisRows(svg).map((r) => r.label)).toEqual([
      '10',
      '100',
      '1K',
      '10K',
      '100K',
    ]);
    // Bar value labels keep full digits (#2135).
    expect(svg).toContain('>100,000</text>');
  });

  it('bar: an explicit format still wins on a log axis', async () => {
    const svg = await renderDataChartD3(
      'bar Sizes\ny-axis log\nformat currency USD\nA 10\nB 1000\nC 100000',
      'light',
      palette
    );
    // No bar is 10,000, so this label is the tick's, in the author's format.
    expect(svg).toContain('>$10,000</text>');
    expect(svg).not.toContain('>10K</text>');
  });

  // #2135: seven decades in a pane-sized plot ran 100,000 → 10,000,000 into
  // each other. Label boxes are TICK_FONT × 1.2 tall, centred on the line.
  const TREASURE = [
    'bar Treasure Hoards by Island',
    'y-axis Doubloons log',
    'x-axis Island',
    '',
    'Skull Cove 12',
    'Tortuga Bay 480',
    'Kraken Reef 9500',
    'Port Lantern 130',
    'Gull Rock 3',
    "Admiral's Vault 2400000",
  ].join('\n');
  // The observed case: horizontal bars, seven decades in about 420px.
  it('bar: the treasure chart at pane size has no touching tick labels', async () => {
    const svg = await renderDataChartD3(TREASURE, 'light', palette, {
      width: 640,
      height: 480,
    });
    const rows = axisRows(svg);
    expect(rows).toHaveLength(8); // 1 … 10M: a gridline on every decade
    expect(labelBoxesApart(rows)).toBe(true);
    expect(rows.map((r) => r.label)).toContain('1M');
  });

  it('bar: a narrow plot thins log labels but keeps every gridline', async () => {
    const svg = await renderDataChartD3(TREASURE, 'light', palette, {
      width: 380,
      height: 480,
    });
    const rows = axisRows(svg);
    expect(rows).toHaveLength(8);
    const labelled = rows.filter((r) => r.label !== undefined);
    expect(labelled.length).toBeLessThan(8);
    expect(labelled.length).toBeGreaterThan(1);
    expect(labelBoxesApart(rows)).toBe(true);
  });

  it('bar: a short vertical plot thins log labels too', async () => {
    const svg = await renderDataChartD3(
      'bar S\ny-axis log\nA 3\nB 400\nC 2400000',
      'light',
      palette,
      { width: 480, height: 240 }
    );
    const rows = axisRows(svg);
    expect(rows.every((r) => !r.horizontal)).toBe(true);
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => r.label !== undefined).length).toBeLessThan(8);
    expect(labelBoxesApart(rows)).toBe(true);
  });

  it('scatter: both axes take a log scale', async () => {
    const svg = await renderDataChartD3(
      'scatter S\nx-axis log\ny-axis log\nA 10 10\nB 1000 1000\nC 100000 100000',
      'light',
      palette
    );
    const t = tickValues(svg);
    expect(t).toContain(1000);
    expect(t).toContain(100000);
    expect(t).not.toContain(50000);
  });

  it('function: a fixed ceiling cuts the curve rather than stretching the axis', async () => {
    const svg = await renderDataChartD3(
      'function F\ny-axis ..10\nx-axis 0..10\nsquare: x^2',
      'light',
      palette
    );
    expect(Math.max(...tickValues(svg))).toBe(10);
  });

  // #2114: a bar the range cuts gets a triangle pointing the way it went.
  const cutMarks = (svg: string) =>
    [...svg.matchAll(/class="dgmo-cut-mark" d="M([^"]+)Z"/g)].map((m) =>
      m[1]!.split('L').map((p) => p.split(',').map(Number))
    );

  it('bar: a value past the ceiling gets an up triangle above the plot', async () => {
    const svg = await renderDataChartD3(
      'bar S\ny-axis 40..120\nA 15\nB 52\nC 300',
      'light',
      palette
    );
    const marks = cutMarks(svg);
    expect(marks).toHaveLength(2); // C above, A below
    // Bars: [y, height]. The cut bar fills the plot, so its top is the edge.
    const bars = [
      ...svg.matchAll(
        /<rect x="[-\d.]+" y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/g
      ),
    ].map((m) => [Number(m[1]), Number(m[2])]);
    const plotTop = Math.min(...bars.map(([y]) => y!));
    const plotBottom = Math.max(...bars.map(([y, h]) => y! + h!));
    const up = marks.find((pts) => pts[2]![1]! < pts[0]![1]!)!;
    const down = marks.find((pts) => pts[2]![1]! > pts[0]![1]!)!;
    expect(up[2]![1]).toBeLessThan(plotTop);
    expect(down[2]![1]).toBeLessThan(plotBottom);
    expect(down[2]![1]).toBeGreaterThan(plotBottom - 10);
    // The real values are still written.
    expect(svg).toContain('>300</text>');
    expect(svg).toContain('>15</text>');
  });

  it('bar: horizontal cuts point right past the plot edge', async () => {
    const svg = await renderDataChartD3(
      'bar S\norientation horizontal\ny-axis ..100\nA 50\nB 400',
      'light',
      palette
    );
    const [mark] = cutMarks(svg);
    expect(mark).toBeDefined();
    expect(mark![2]![0]).toBeGreaterThan(mark![0]![0]!);
    expect(svg).toContain('>400</text>');
  });

  it('bar: nothing in range, no marks', async () => {
    const svg = await renderDataChartD3(
      'bar S\ny-axis ..500\nA 50\nB 400',
      'light',
      palette
    );
    expect(cutMarks(svg)).toHaveLength(0);
  });

  // #2214: a stacked column past a fixed range is an error, not a cut mark.
  const STACK = 'bar S\ny-axis ..100\n\nstack\n  E\n  C\n\nA 20 12\nB 60 70\n';

  it('stack: a total past the ceiling is an error naming the column and total', () => {
    const r = parseChart(STACK);
    expect(codes(r)).toContain('E_STACK_PAST_AXIS_RANGE');
    expect(r.error).toContain('B (total 130)');
    expect(r.error).toContain('y-axis max of 100');
  });

  it('stack: a negative total past the floor is an error', () => {
    const r = parseChart(
      'bar S\ny-axis -50..100\n\nstack\n  E\n  C\n\nA 20 12\nB -40 -30\n'
    );
    expect(codes(r)).toContain('E_STACK_PAST_AXIS_RANGE');
    expect(r.error).toContain('B (total -70)');
  });

  it('stack: several columns are all named', () => {
    const r = parseChart(STACK + 'C 90 90\n');
    expect(r.error).toContain('B (total 130), C (total 180)');
  });

  it('stack: totals in range, stack 100%, and unstacked bars are not errors', () => {
    for (const src of [
      STACK.replace('..100', '..200'),
      STACK.replace('stack\n', 'stack 100%\n'),
      'bar S\ny-axis ..100\nA 50\nB 400',
    ])
      expect(codes(parseChart(src))).not.toContain('E_STACK_PAST_AXIS_RANGE');
  });

  // #2119: points past a fixed range get the same triangle. The tip lies
  // beyond both base corners in the direction the value went.
  const up = (p: number[][]) => p[2]![1]! < Math.min(p[0]![1]!, p[1]![1]!);
  const down = (p: number[][]) => p[2]![1]! > Math.max(p[0]![1]!, p[1]![1]!);
  const right = (p: number[][]) => p[2]![0]! > Math.max(p[0]![0]!, p[1]![0]!);

  it('line: a point past the ceiling becomes an up triangle with its value', async () => {
    const svg = await renderDataChartD3(
      'line S\ny-axis ..100\nJan 42\nFeb 55\nMar 260\nApr 61',
      'light',
      palette
    );
    const marks = cutMarks(svg);
    expect(marks).toHaveLength(1);
    expect(up(marks[0]!)).toBe(true);
    expect(svg).toMatch(
      /<text[^>]*>(<tspan[^>]*>\d<\/tspan>){3}<\/text>|>260<\/text>/
    );
    // The cut point's dot draws nothing.
    expect(svg).toMatch(/data-x-label="Mar"[^>]*r="0"/);
  });

  it('line: a point under the floor points down; in range, no marks', async () => {
    const marks = cutMarks(
      await renderDataChartD3(
        'line S\ny-axis 40..100\nJan 42\nFeb 5\nMar 60',
        'light',
        palette
      )
    );
    expect(marks).toHaveLength(1);
    expect(down(marks[0]!)).toBe(true);
    expect(
      cutMarks(
        await renderDataChartD3(
          'line S\ny-axis ..500\nA 4\nB 9',
          'light',
          palette
        )
      )
    ).toHaveLength(0);
  });

  it('scatter: y and x cuts point up and right, with the real value', async () => {
    const svg = await renderDataChartD3(
      'scatter S\nx-axis ..400\ny-axis ..400\nA 120 180\nB 200 220\nE 380 1450\nF 900 200',
      'light',
      palette
    );
    const marks = cutMarks(svg);
    expect(marks).toHaveLength(2);
    expect(marks.filter(up)).toHaveLength(1);
    expect(marks.filter(right)).toHaveLength(1);
    expect(svg).toContain('1,450');
    expect(svg).toContain('900');
  });

  it('function: one triangle per run that leaves the plot', async () => {
    const svg = await renderDataChartD3(
      'function F\ny-axis -1..1\nx-axis 0..10\nwave: 2*sin(x)',
      'light',
      palette
    );
    const marks = cutMarks(svg);
    // 2 sin x passes 1 on (0.52, 2.62) and (6.81, 8.9), and -1 on
    // (3.67, 5.76) and from 9.95 to the end.
    expect(marks.filter(up)).toHaveLength(2);
    expect(marks.filter(down)).toHaveLength(2);
  });
});

describe('the axis line — one line per axis (decision #60)', () => {
  it('reads title, range and scale from the end', () => {
    expect(readAxisLine('y-axis Range (yards) 0.1..100,000 log')).toEqual({
      axis: 'y',
      label: 'Range (yards)',
      min: 0.1,
      max: 100000,
      scale: 'log',
    });
    expect(readAxisLine('x-axis Crew 1..1000 log')).toMatchObject({
      label: 'Crew',
      min: 1,
      max: 1000,
    });
  });

  it('scales down to one part', () => {
    expect(readAxisLine('y-axis log')).toEqual({ axis: 'y', scale: 'log' });
    expect(readAxisLine('y-axis 0..')).toEqual({ axis: 'y', min: 0 });
    expect(readAxisLine('y-axis ..100')).toEqual({ axis: 'y', max: 100 });
    expect(readAxisLine('y-axis Revenue')).toEqual({
      axis: 'y',
      label: 'Revenue',
    });
  });

  it('takes a quoted title that would read as a scale or range', () => {
    expect(readAxisLine('y-axis "log"')).toEqual({ axis: 'y', label: 'log' });
    expect(readAxisLine('x-axis "Years 2020..2024"')).toEqual({
      axis: 'x',
      label: 'Years 2020..2024',
    });
  });

  it('never reads a capitalised or indented look-alike', () => {
    expect(readAxisLine('Y-axis 5')).toBeNull();
    expect(readAxisLine('y-axes 5')).toBeNull();
  });

  it('sets the title and the range from one line on a bar', () => {
    const r = parseChart('bar S\ny-axis Votes 0..100\nA 50');
    expect(r.ylabel).toBe('Votes');
    expect(r.axes?.y).toMatchObject({ min: 0, max: 100 });
    expect(codes(r)).toEqual([]);
  });

  it('errors on each old directive and names the new form', () => {
    for (const [old, want] of [
      ['y-min 0', 'y-axis 0..'],
      ['y-max 1,000', 'y-axis ..1000'],
      ['y-scale log', 'y-axis log'],
      ['x-label Region', 'x-axis Region'],
      ['y-right-label Barrels', 'y-right-axis Barrels'],
    ] as const) {
      const r = parseChart(`line S\n${old}\nA 5\nB 6`);
      const d = r.diagnostics.find((x) => x.code === 'E_AXIS_OLD_DIRECTIVE');
      expect(d?.message, old).toContain(want);
      expect(r.data.map((p) => p.label)).toEqual(['A', 'B']);
    }
  });

  it('sets a function chart range with x-axis, and errors on `x … to …`', () => {
    const fn = parseExtendedChart('function F\nx-axis t 0..250\nf: x');
    expect(fn.xRange).toEqual({ min: 0, max: 250 });
    expect(fn.xlabel).toBe('t');
    const half = parseExtendedChart('function F\nx-axis 0..\nf: x');
    expect(half.xRange).toEqual({ min: 0, max: 10 });
    const old = parseExtendedChart('function F\nx 0 to 250\nf: x');
    expect(codes(old)).toContain('E_AXIS_OLD_DIRECTIVE');
  });

  it('errors on an old `y-label` header inside a bare series block (#2207)', () => {
    const r = parseChart(
      'line S\nseries\n  y-label Degrees C\n    CPU red\n  y-right-label Fan rpm\n    Fan blue\nA 85 2000\nB 90 3000'
    );
    const old = r.diagnostics.filter((x) => x.code === 'E_AXIS_OLD_DIRECTIVE');
    expect(old.map((d) => d.line)).toEqual([3, 5]);
    expect(old[0]?.message).toContain('y-axis Degrees C');
    expect(old[1]?.message).toContain('y-right-axis Fan rpm');
    expect(r.seriesAxes).toEqual(['left', 'right']);
  });

  it('gives a dual-axis line a fixed right axis from its header', () => {
    const r = parseChart(
      'line S\nseries\n  y-axis Price\n    P\n  y-right-axis Volume 0..10000\n    V\nA 50 5000\nB 60 6000'
    );
    expect(r.ylabel).toBe('Price');
    expect(r.yrlabel).toBe('Volume');
    expect(r.axes?.['y-right']).toMatchObject({ min: 0, max: 10000 });
    expect(r.seriesAxes).toEqual(['left', 'right']);
  });

  it('warns when a right-axis range cuts its own series', () => {
    const r = parseChart(
      'line S\nseries\n  y-axis Price\n    P\n  y-right-axis Volume ..100\n    V\nA 50 5000\nB 60 6000'
    );
    expect(codes(r)).toContain('W_AXIS_DATA_OUTSIDE_RANGE');
  });

  it('reads quadrant and SWOT end labels from x-axis / y-axis', () => {
    const q = parseVisualization(
      'quadrant Q\nx-axis Low Effort, High Effort\ny-axis Low Impact, High Impact\nA 0.2 0.8'
    ) as { quadrantXAxis?: [string, string]; quadrantYAxis?: [string, string] };
    expect(q.quadrantXAxis).toEqual(['Low Effort', 'High Effort']);
    expect(q.quadrantYAxis).toEqual(['Low Impact', 'High Impact']);
    const old = parseVisualization('quadrant Q\nx-label Low, High\nA 0.2 0.8');
    expect(codes(old)).toContain('E_AXIS_OLD_DIRECTIVE');
  });
});

describe('the right axis draws its own range', () => {
  it('draws both dual-axis titles at a narrow 480px width (#2207)', async () => {
    const svg = await renderDataChartD3(
      'line Temperature and fan\nno-value\nseries\n  y-axis Degrees C\n    CPU package red\n    Apple sensor orange\n  y-right-axis Fan rpm\n    Fan blue\n06:30 85 80 2000\n07:00 90 82 3000\n07:30 70 65 1800',
      'light',
      palette,
      { width: 480, height: 300 }
    );
    expect(svg).toContain('Degrees C');
    expect(svg).toContain('Fan rpm');
  });

  it('ends the right axis where y-right-axis fixes it', async () => {
    const svg = await renderDataChartD3(
      'line S\nseries\n  y-axis Price\n    P\n  y-right-axis Volume 0..20000\n    V\nA 50 5000\nB 60 6000',
      'light',
      palette
    );
    expect(Math.max(...tickValues(svg))).toBe(20000);
  });
});
