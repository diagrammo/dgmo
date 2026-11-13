import { describe, it, expect } from 'vitest';
import { scaleLinear } from 'd3-scale';
import {
  computeTimeTicks,
  EXACT_FRACTIONAL_YEAR as EXACT,
} from '../src/utils/time-ticks';
import { measureText } from '../src/utils/text-measure';

// #1426: tick labels are measured, and the axis steps to a coarser interval
// until no two labels overlap or touch.
const FONT = 10;
const GAP = 8;

function axis(min: number, max: number, widthPx: number) {
  return scaleLinear().domain([min, max]).range([0, widthPx]);
}

/** Smallest clear space between neighbouring labels, centred on their ticks. */
function minClearance(ticks: { pos: number; label: string }[]): number {
  const spans = ticks
    .map((t) => {
      const half = measureText(t.label, FONT) / 2;
      return { lo: t.pos - half, hi: t.pos + half };
    })
    .sort((a, b) => a.lo - b.lo);
  let min = Infinity;
  for (let i = 1; i < spans.length; i++) {
    min = Math.min(min, spans[i]!.lo - spans[i - 1]!.hi);
  }
  return min;
}

const JAN_2024 = 2024;
const SEP_2024 = 2024 + 8 / 12;
// Just short of 2025, so the axis draws months rather than years.
const DEC_2024 = 2024 + 11.5 / 12;

describe('computeTimeTicks label fitting', () => {
  it('keeps every month on an axis wide enough for them', () => {
    const ticks = computeTimeTicks(
      JAN_2024,
      DEC_2024,
      axis(JAN_2024, DEC_2024, 1200)
    );
    expect(ticks).toHaveLength(12);
    expect(minClearance(ticks)).toBeGreaterThanOrEqual(GAP);
  });

  it.each([120, 200, 360, 600])(
    'never lets month labels touch on a %ipx axis',
    (width) => {
      const ticks = computeTimeTicks(
        JAN_2024,
        DEC_2024,
        axis(JAN_2024, DEC_2024, width)
      );
      expect(ticks.length).toBeGreaterThan(0);
      expect(minClearance(ticks)).toBeGreaterThanOrEqual(GAP);
    }
  );

  it('steps to a coarser round interval rather than dropping labels at random', () => {
    const ticks = computeTimeTicks(
      JAN_2024,
      DEC_2024,
      axis(JAN_2024, DEC_2024, 300)
    );
    const ORDER = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const idx = ticks.map((t) => ORDER.indexOf(t.label));
    expect(ticks.length).toBeLessThan(12);
    // Whatever stride wins, it is anchored on January.
    expect(idx[0]).toBe(0);
    const stride = idx[1]! - idx[0]!;
    expect([2, 3, 6]).toContain(stride);
    for (const i of idx) expect(i % stride).toBe(0);
  });

  it('keeps both boundary labels and drops standard ticks that would touch them', () => {
    const ticks = computeTimeTicks(
      JAN_2024,
      SEP_2024,
      axis(JAN_2024, SEP_2024, 450),
      JAN_2024,
      SEP_2024,
      'Jan 2024',
      'Sep 2024'
    );
    expect(ticks[0]!.label).toBe('Jan 2024');
    expect(ticks[ticks.length - 1]!.label).toBe('Sep 2024');
    expect(minClearance(ticks)).toBeGreaterThanOrEqual(GAP);
  });

  it('drops the end boundary when it would touch the start boundary', () => {
    const ticks = computeTimeTicks(
      JAN_2024,
      SEP_2024,
      axis(JAN_2024, SEP_2024, 40),
      JAN_2024,
      SEP_2024,
      'Jan 2024',
      'Sep 2024'
    );
    expect(ticks.map((t) => t.label)).toEqual(['Jan 2024']);
  });

  it('thins year ticks onto round years', () => {
    const ticks = computeTimeTicks(1700, 1800, axis(1700, 1800, 250));
    expect(minClearance(ticks)).toBeGreaterThanOrEqual(GAP);
    for (const t of ticks) expect(Number(t.label) % 10).toBe(0);
  });

  it('spaces a vertical axis by line height, not label width', () => {
    const scale = axis(JAN_2024, DEC_2024, 60);
    const ticks = computeTimeTicks(
      JAN_2024,
      DEC_2024,
      scale,
      undefined,
      undefined,
      undefined,
      undefined,
      { fontSize: FONT, vertical: true }
    );
    const pos = ticks.map((t) => t.pos).sort((a, b) => a - b);
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i]! - pos[i - 1]!).toBeGreaterThanOrEqual(FONT * 1.2 + GAP);
    }
  });
});

// Tick density by span (#1830): a 4-week plan reads by week, a short one by
// day, an 18-month roadmap by month.
describe('computeTimeTicks density', () => {
  const labelsFor = (from: Date, to: Date, width = 1000): string[] => {
    const a = EXACT.toFractionalYear(from);
    const b = EXACT.toFractionalYear(to);
    const s = scaleLinear().domain([a, b]).range([0, width]);
    return computeTimeTicks(
      a,
      b,
      s,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      EXACT
    ).map((t) => t.label);
  };

  it('ticks every day over a short span', () => {
    expect(labelsFor(new Date(2026, 2, 2), new Date(2026, 2, 12))).toEqual(
      Array.from({ length: 11 }, (_, i) => `Mar ${i + 2}`)
    );
  });

  it('ticks every Monday over four weeks', () => {
    // 2026-03-02 is a Monday.
    expect(labelsFor(new Date(2026, 2, 1), new Date(2026, 2, 29))).toEqual([
      'Mar 2',
      'Mar 9',
      'Mar 16',
      'Mar 23',
    ]);
  });

  it('thins weeks to fortnights on a narrow axis, still on Mondays', () => {
    const l = labelsFor(new Date(2026, 2, 1), new Date(2026, 4, 25), 300);
    expect(l.length).toBeGreaterThanOrEqual(3);
    for (const label of l) {
      const [mon, day] = label.split(' ');
      const d = new Date(`${mon} ${day} 2026`);
      expect(d.getDay(), label).toBe(1);
    }
  });

  it('ticks months, not one year, over eighteen months', () => {
    const l = labelsFor(new Date(2024, 0, 1), new Date(2025, 5, 30));
    expect(l.length).toBeGreaterThanOrEqual(6);
    expect(l).toContain("Jan '25");
  });

  it('ticks years from three year boundaries up', () => {
    expect(labelsFor(new Date(2020, 0, 1), new Date(2023, 0, 1))).toEqual([
      '2020',
      '2021',
      '2022',
      '2023',
    ]);
  });
});

describe('computeTimeTicks day axis starting on the 1st of a month', () => {
  // Day 0 of a month is the last day of the month before. calendarDay once
  // rolled it over in the year 2000 and set the year afterwards, so 1 Jan
  // 2024 started the loop at 31 Dec 2024 and the axis came back empty.
  it('draws ticks from the first day, with either converter', () => {
    for (const conv of [undefined, EXACT]) {
      const ticks = computeTimeTicks(
        JAN_2024,
        JAN_2024 + 0.15,
        axis(JAN_2024, JAN_2024 + 0.15, 700),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        conv
      );
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks[0]!.label).toBe('Jan 1');
    }
  });
});
