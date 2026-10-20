import { describe, it, expect } from 'vitest';
import { scaleLinear } from 'd3-scale';
import { computeTimeTicks } from '../src/utils/time-ticks';
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
