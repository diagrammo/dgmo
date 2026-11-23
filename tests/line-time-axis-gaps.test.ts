// Times, date-times and gap breaks on the line time axis (#2208).
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import {
  gapBreaksOf,
  mixedTimeLabels,
  parseTimeLabel,
  timeLabelsOf,
} from '../src/charts-d3/date-axis';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

/** Rows every 24 min across one day, with nothing from 08:00 to 14:00. */
function vitalsRows(): string[] {
  const rows: string[] = [];
  const start = new Date(2026, 10, 21, 0, 6);
  for (let i = 0; i < 60; i++) {
    const t = new Date(start.getTime() + i * 24 * 60_000);
    const h = t.getHours();
    if (h >= 8 && h < 14) continue;
    const p = (n: number) => String(n).padStart(2, '0');
    rows.push(
      `2026-11-${p(t.getDate())} ${p(h)}:${p(t.getMinutes())} ${50 + (i % 9)}`
    );
  }
  return rows;
}

/** Subpath count (`M` commands) of every path with this class. */
function moves(svg: string, cls: string): number[] {
  return [...svg.matchAll(new RegExp(`class="${cls}" d="([^"]*)"`, 'g'))].map(
    (m) => (m[1]!.match(/M/g) ?? []).length
  );
}

function pointXs(svg: string): number[] {
  return [
    ...svg.matchAll(
      /<circle[^>]*class="dgmo-pt"[^>]*data-series-index="0"[^>]*cx="([\d.]+)"/g
    ),
  ].map((m) => Number(m[1]));
}

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
}

describe('time labels', () => {
  it('reads date-times with a space or a T, and bare times', () => {
    const a = parseTimeLabel('2026-11-21 06:30');
    const b = parseTimeLabel('2026-11-21T06:30:15');
    expect(a?.kind).toBe('datetime');
    expect(b?.kind).toBe('datetime');
    if (a?.kind === 'datetime') expect(a.date.getHours()).toBe(6);
    if (b?.kind === 'datetime') expect(b.date.getSeconds()).toBe(15);
    expect(parseTimeLabel('06:30')).toEqual({ kind: 'time', seconds: 23400 });
  });

  it('rejects impossible clocks and offsets', () => {
    for (const s of [
      '2026-11-21 24:00',
      '2026-11-21 06:60',
      '2026-11-21T06:30Z',
      '2026-11-21T06:30+01:00',
      '25:00',
      '6:3',
    ])
      expect(parseTimeLabel(s)).toBeNull();
  });

  it('mixes dates with date-times, but not with bare times', () => {
    expect(timeLabelsOf(['2026-11-20', '2026-11-21 06:30'])?.kind).toBe(
      'datetime'
    );
    expect(timeLabelsOf(['2026-11-21', '06:30'])).toBeNull();
  });

  it('wraps bare times past midnight in row order', () => {
    const t = timeLabelsOf(['22:00', '23:30', '00:15', '01:00'])!;
    expect(t.kind).toBe('time');
    const ms = t.dates.map((d) => d.getTime());
    for (let i = 1; i < ms.length; i++)
      expect(ms[i]!).toBeGreaterThan(ms[i - 1]!);
    expect((ms[2]! - ms[1]!) / 60_000).toBe(45);
  });
});

describe('gap breaks', () => {
  const at = (mins: number[]) => mins.map((m) => new Date(2026, 0, 1, 0, m));

  it('breaks where a gap is more than three median intervals', () => {
    expect(gapBreaksOf(at([0, 10, 20, 30, 70, 80]))).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('keeps a gap of exactly three intervals joined', () => {
    expect(gapBreaksOf(at([0, 10, 20, 50, 60])).some(Boolean)).toBe(false);
  });

  it('never breaks two or fewer intervals', () => {
    expect(gapBreaksOf(at([0, 100])).some(Boolean)).toBe(false);
    expect(gapBreaksOf(at([0, 1, 100])).some(Boolean)).toBe(false);
  });
});

describe('line on a date-time axis', () => {
  const src = `line Vitals\n${vitalsRows().join('\n')}`;

  it('places rows to scale and breaks the line across the hole', async () => {
    const svg = await renderDataChartD3(src, 'light', palette);
    expect(moves(svg, 'dgmo-series-line')).toEqual([2]);
    const xs = pointXs(svg);
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    const median = [...steps].sort((a, b) => a - b)[steps.length >> 1]!;
    // Six hours is fifteen 24-minute steps.
    expect(Math.max(...steps) / median).toBeGreaterThan(12);
  });

  it('labels the axis with clock ticks', async () => {
    const svg = await renderDataChartD3(src, 'light', palette);
    expect(texts(svg)).toContain('12:00');
    expect(texts(svg)).not.toContain('2026-11-21 00:30');
  });

  it('breaks the filled area too', async () => {
    const svg = await renderDataChartD3(
      `line Vitals\nfill\n${vitalsRows().join('\n')}`,
      'light',
      palette
    );
    expect(moves(svg, 'dgmo-series-area')).toEqual([2]);
    expect(moves(svg, 'dgmo-series-line')).toEqual([2]);
  });

  it('breaks stacked areas', async () => {
    const rows = vitalsRows().map((r) => `${r} 3`);
    const svg = await renderDataChartD3(
      `line Vitals\nstack\n  CPU\n  IO\n${rows.join('\n')}`,
      'light',
      palette
    );
    const areas = moves(svg, 'dgmo-series-area');
    expect(areas.length).toBe(2);
    for (const n of areas) expect(n).toBe(2);
  });

  it('`join-gaps` keeps the line whole', async () => {
    const svg = await renderDataChartD3(
      `line Vitals\njoin-gaps\n${vitalsRows().join('\n')}`,
      'light',
      palette
    );
    expect(moves(svg, 'dgmo-series-line')).toEqual([1]);
  });

  it('a step line holds across the gap', async () => {
    const svg = await renderDataChartD3(
      `line Vitals\nstep\n${vitalsRows().join('\n')}`,
      'light',
      palette
    );
    expect(moves(svg, 'dgmo-series-line')).toEqual([1]);
  });

  it('categories never break', async () => {
    const svg = await renderDataChartD3(
      'line X\nA 1\nB 2\nC 3\nD 4\nE 5',
      'light',
      palette
    );
    expect(moves(svg, 'dgmo-series-line')).toEqual([1]);
  });
});

describe('line on a bare-time axis', () => {
  const src = 'line Night shift\n22:00 5\n23:00 7\n00:00 6\n01:00 8\n02:00 4';

  it('runs on past midnight instead of folding back', async () => {
    const xs = pointXs(await renderDataChartD3(src, 'light', palette));
    expect(xs).toHaveLength(5);
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it('never prints the anchor date', async () => {
    const t = texts(await renderDataChartD3(src, 'light', palette));
    expect(t).toContain('00:00');
    expect(t.some((s) => /2000|Jan/.test(s))).toBe(false);
  });
});

describe('W_TIME_AXIS_MIXED', () => {
  it('names the row that stops a mostly dated column', () => {
    const r = parseChart('line X\n2026-01-01 1\n2026-01-02 2\nlater 3');
    const d = r.diagnostics.find((x) => x.code === 'W_TIME_AXIS_MIXED');
    expect(d?.line).toBe(4);
    expect(d?.message).toContain('"later"');
  });

  it('flags bare times among dated rows', () => {
    expect(mixedTimeLabels(['2026-01-01', '2026-01-02', '06:30'])).toEqual({
      index: 2,
      reason: 'time-and-date',
    });
  });

  it('stays quiet on category columns and on a full time axis', () => {
    expect(mixedTimeLabels(['Jan', 'Feb', '2026-03'])).toBeNull();
    expect(mixedTimeLabels(['2026-01', '2026-02'])).toBeNull();
    const r = parseChart(
      'bar X\norientation-horizontal\n2026-01 1\n2026-02 2\nlater 3'
    );
    expect(r.diagnostics.some((x) => x.code === 'W_TIME_AXIS_MIXED')).toBe(
      false
    );
  });

  it('warns for `join-gaps` off line and bar', () => {
    const r = parseChart('pie X\njoin-gaps\nA 1\nB 2');
    expect(r.diagnostics.some((x) => /join-gaps/.test(x.message))).toBe(true);
    expect(r.joinGaps).toBeUndefined();
  });
});
