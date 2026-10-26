// ============================================================
// Time axis tick computation — shared by d3.ts and gantt/renderer.ts
// ============================================================

import type * as d3Scale from 'd3-scale';
import { measureText } from './text-measure';

/** How the axis draws its tick labels, so they can be measured (#1426). */
export interface TickLabelFit {
  /** Font size the labels are drawn at. */
  fontSize: number;
  /** True when labels stack down a vertical axis rather than along a row. */
  vertical?: boolean;
}

/** Clear space kept between neighbouring tick labels — the category axis's. */
const TICK_LABEL_GAP = 8;

type SlottedTick = { pos: number; label: string; slot: number };

export const MONTH_ABBR = [
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

function fractionalYearToDate(frac: number): Date {
  const year = Math.floor(frac);
  const remainder = frac - year;
  // Inverse of: (month-1)/12 + (day-1)/365 + hour/8760 + minute/525600 + second/31536000
  const monthFrac = remainder * 12;
  const month = Math.floor(monthFrac); // 0-based
  const monthRemainder = remainder - month / 12;
  const dayFrac = monthRemainder * 365; // fractional day-of-year offset
  const day = Math.floor(dayFrac) + 1;
  const dayRemainder = dayFrac - Math.floor(dayFrac);
  const hourFrac = dayRemainder * 24;
  const hour = Math.floor(hourFrac);
  const minuteFrac = (hourFrac - hour) * 60;
  const minute = Math.floor(minuteFrac);
  const second = Math.round((minuteFrac - minute) * 60);
  return new Date(year, month, day, hour, minute, second);
}

/** Convert a Date to a fractional year number. */
function dateToFractionalYear(d: Date): number {
  return (
    d.getFullYear() +
    d.getMonth() / 12 +
    (d.getDate() - 1) / 365 +
    d.getHours() / 8760 +
    d.getMinutes() / 525600 +
    d.getSeconds() / 31536000
  );
}

/**
 * How an axis maps Dates to its fractional-year values. A caller whose data
 * uses another formula than the approximate default passes its own pair, so
 * the ticks sit on the same scale as what it draws (#1414).
 */
type FractionalYearConverters = {
  toFractionalYear: (d: Date) => number;
  fromFractionalYear: (frac: number) => Date;
};

const APPROXIMATE_CONVERTERS: FractionalYearConverters = {
  toFractionalYear: dateToFractionalYear,
  fromFractionalYear: fractionalYearToDate,
};

/** Midnight on a calendar day, with years 0–99 kept as written. */
function calendarDay(year: number, month0: number, day: number): Date {
  const d = new Date(2000, month0, day);
  d.setFullYear(year);
  return d;
}

/** Year axis label: negative years render as `N BCE`. */
function formatYearTick(y: number): string {
  return y < 0 ? `${-y} BCE` : String(y);
}

/**
 * Generates adaptive tick marks along a time axis.
 * Picks the right granularity (years, months, weeks, days, hours, minutes)
 * based on the domain span.
 *
 * Optional boundary parameters add ticks at exact data start/end:
 * - boundaryStart/boundaryEnd: numeric date values
 * - boundaryStartLabel/boundaryEndLabel: formatted labels for those dates
 *
 * `converters` maps Dates to domain values and back. It defaults to the
 * approximate `month/12 + (day-1)/365` formula the timeline uses; gantt
 * passes its exact elapsed-time pair (#1414).
 */
export function computeTimeTicks(
  domainMin: number,
  domainMax: number,
  scale: d3Scale.ScaleLinear<number, number>,
  boundaryStart?: number,
  boundaryEnd?: number,
  boundaryStartLabel?: string,
  boundaryEndLabel?: string,
  labelFit: TickLabelFit = { fontSize: 10 },
  converters?: {
    toFractionalYear: (d: Date) => number;
    fromFractionalYear: (frac: number) => Date;
  }
): { pos: number; label: string }[] {
  const { toFractionalYear, fromFractionalYear } =
    converters ?? APPROXIMATE_CONVERTERS;
  // The default formula is evaluated directly, so the timeline's ticks are
  // unchanged to the bit, including years 0–99.
  const dayValue = (y: number, month0: number, day: number): number =>
    converters
      ? toFractionalYear(calendarDay(y, month0, day))
      : y + month0 / 12 + (day - 1) / 365;
  const minYear = Math.floor(domainMin);
  const maxYear = Math.floor(domainMax);
  const span = domainMax - domainMin;

  // `slot` numbers each standard tick on its own interval (a year, a month
  // index, or its order), so thinning can step to a coarser round interval.
  let ticks: SlottedTick[] = [];
  // Strides to try, finest first, when the labels do not fit (#1426).
  let strides: number[] = [];

  // Year ticks for multi-year spans (need at least 2 boundaries)
  const firstYear = Math.ceil(domainMin);
  const lastYear = Math.floor(domainMax);
  if (lastYear >= firstYear + 1) {
    // Decimate ticks for long spans so labels don't overlap. The ladder runs
    // up to century/bicentury steps so millennium-scale spans (and BCE labels,
    // which are ~2× wider) stay legible.
    const yearSpan = lastYear - firstYear;
    let step = 1;
    if (yearSpan > 800) step = 200;
    else if (yearSpan > 400) step = 100;
    else if (yearSpan > 160) step = 50;
    else if (yearSpan > 80) step = 20;
    else if (yearSpan > 40) step = 10;
    else if (yearSpan > 20) step = 5;
    else if (yearSpan > 10) step = 2;

    // Align to step boundary so ticks land on round years (1700, 1710, …)
    strides = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter(
      (c) => c % step === 0
    );
    const alignedFirst = Math.ceil(firstYear / step) * step;
    for (let y = alignedFirst; y <= lastYear; y += step) {
      ticks.push({ pos: scale(y), label: formatYearTick(y), slot: y });
    }
  } else if (span > 0.25) {
    // Month ticks for spans > ~3 months
    const crossesYear = maxYear > minYear;
    for (let y = minYear; y <= maxYear + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        const val = dayValue(y, m - 1, 1);
        if (val > domainMax) break;
        if (val >= domainMin) {
          // m is 1..12, so MONTH_ABBR[m-1] is always defined.
          const abbr = MONTH_ABBR[m - 1]!;
          ticks.push({
            pos: scale(val),
            label: crossesYear ? `${abbr} '${String(y).slice(-2)}` : abbr,
            // Month index, so a stride of 3 lands on Jan, Apr, Jul, Oct.
            slot: y * 12 + (m - 1),
          });
        }
      }
    }
  } else if (span <= 0.0000114) {
    // Second ticks for spans ≤ ~6 minutes
    // Adaptive step: >3min → 30s, >1min → 15s, >30s → 10s, else 5s
    let stepSec = 5;
    const spanSec = span * 31536000;
    if (spanSec > 180) stepSec = 30;
    else if (spanSec > 60) stepSec = 15;
    else if (spanSec > 30) stepSec = 10;

    const startDate = fromFractionalYear(domainMin);
    // Round down to nearest step boundary
    startDate.setSeconds(
      Math.floor(startDate.getSeconds() / stepSec) * stepSec,
      0
    );

    while (true) {
      const val = toFractionalYear(startDate);
      if (val > domainMax) break;
      if (val >= domainMin) {
        const hh = String(startDate.getHours()).padStart(2, '0');
        const mm = String(startDate.getMinutes()).padStart(2, '0');
        const ss = String(startDate.getSeconds()).padStart(2, '0');
        ticks.push({
          pos: scale(val),
          label: `${hh}:${mm}:${ss}`,
          slot: ticks.length,
        });
      }
      startDate.setSeconds(startDate.getSeconds() + stepSec);
    }
  } else if (span <= 0.000685) {
    // Minute ticks for spans ≤ ~6 hours
    // Adaptive step: >3h → 30min, >1h → 15min, >30min → 10min, else 5min
    let stepMin = 5;
    const spanHours = span * 8760;
    if (spanHours > 3) stepMin = 30;
    else if (spanHours > 1) stepMin = 15;
    else if (spanHours > 0.5) stepMin = 10;

    // Iterate from the start hour boundary
    const startDate = fromFractionalYear(domainMin);
    // Round down to nearest step boundary
    startDate.setMinutes(
      Math.floor(startDate.getMinutes() / stepMin) * stepMin,
      0,
      0
    );

    while (true) {
      const val = toFractionalYear(startDate);
      if (val > domainMax) break;
      if (val >= domainMin) {
        const hh = String(startDate.getHours()).padStart(2, '0');
        const mm = String(startDate.getMinutes()).padStart(2, '0');
        ticks.push({
          pos: scale(val),
          label: `${hh}:${mm}`,
          slot: ticks.length,
        });
      }
      startDate.setMinutes(startDate.getMinutes() + stepMin);
    }
  } else if (span <= 0.00822) {
    // Hour ticks for spans ≤ ~3 days
    // Adaptive step: >2d → 6h, >1d → 3h, >12h → 2h, else 1h
    let stepHour = 1;
    const spanHours = span * 8760;
    if (spanHours > 48) stepHour = 6;
    else if (spanHours > 24) stepHour = 3;
    else if (spanHours > 12) stepHour = 2;

    // For single-day spans, just show HH:MM without the date prefix
    const singleDay = spanHours <= 24;

    const startDate = fromFractionalYear(domainMin);
    // Round down to nearest step boundary
    startDate.setHours(
      Math.floor(startDate.getHours() / stepHour) * stepHour,
      0,
      0,
      0
    );

    while (true) {
      const val = toFractionalYear(startDate);
      if (val > domainMax) break;
      if (val >= domainMin) {
        const hh = String(startDate.getHours()).padStart(2, '0');
        const mm = String(startDate.getMinutes()).padStart(2, '0');
        if (singleDay) {
          ticks.push({
            pos: scale(val),
            label: `${hh}:${mm}`,
            slot: ticks.length,
          });
        } else {
          const mon = MONTH_ABBR[startDate.getMonth()];
          const d = startDate.getDate();
          ticks.push({
            pos: scale(val),
            label: `${mon} ${d} ${hh}:${mm}`,
            slot: ticks.length,
          });
        }
      }
      startDate.setHours(startDate.getHours() + stepHour);
    }
  } else {
    // Week ticks for spans ≤ ~3 months (1st, 8th, 15th, 22nd of each month)
    for (let y = minYear; y <= maxYear + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, 8, 15, 22]) {
          const val = dayValue(y, m - 1, d);
          if (val > domainMax) break;
          if (val >= domainMin) {
            ticks.push({
              pos: scale(val),
              label: `${MONTH_ABBR[m - 1]} ${d}`,
              slot: ticks.length,
            });
          }
        }
      }
    }
  }

  if (strides.length === 0) strides = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];

  // Add boundary ticks at exact data start/end if provided
  // When a boundary tick collides with a standard tick, replace the standard tick
  const collisionThreshold = 40; // pixels

  let startBoundary: { pos: number; label: string } | null = null;
  let endBoundary: { pos: number; label: string } | null = null;
  if (boundaryStart !== undefined && boundaryStartLabel) {
    const boundaryPos = scale(boundaryStart);
    // Remove any standard ticks that would collide with the start boundary
    ticks = ticks.filter(
      (t) => Math.abs(t.pos - boundaryPos) >= collisionThreshold
    );
    startBoundary = { pos: boundaryPos, label: boundaryStartLabel };
  }

  if (boundaryEnd !== undefined && boundaryEndLabel) {
    const boundaryPos = scale(boundaryEnd);
    // Remove any standard ticks that would collide with the end boundary
    ticks = ticks.filter(
      (t) => Math.abs(t.pos - boundaryPos) >= collisionThreshold
    );
    endBoundary = { pos: boundaryPos, label: boundaryEndLabel };
  }

  return fitTickLabels(ticks, startBoundary, endBoundary, strides, labelFit);
}

/**
 * Thin the standard ticks until no two labels overlap or come within
 * TICK_LABEL_GAP of each other (#1426). Tries each stride in turn, keeping
 * only ticks whose slot is a multiple of it, so the axis steps to a coarser
 * round interval rather than dropping labels at random. Boundary ticks are
 * kept; a standard tick whose label would touch one is dropped. A chart whose
 * labels already fit keeps every tick, so its axis is unchanged.
 */
function fitTickLabels(
  standard: SlottedTick[],
  startBoundary: { pos: number; label: string } | null,
  endBoundary: { pos: number; label: string } | null,
  strides: number[],
  fit: TickLabelFit
): { pos: number; label: string }[] {
  const extent = (label: string): number =>
    fit.vertical ? fit.fontSize * 1.2 : measureText(label, fit.fontSize);
  type Span = { pos: number; label: string; lo: number; hi: number };
  const span = (t: { pos: number; label: string }): Span => {
    const half = extent(t.label) / 2;
    return { pos: t.pos, label: t.label, lo: t.pos - half, hi: t.pos + half };
  };
  const apart = (a: Span, b: Span): boolean =>
    a.hi + TICK_LABEL_GAP <= b.lo || b.hi + TICK_LABEL_GAP <= a.lo;
  const fitsInOrder = (spans: Span[]): boolean => {
    const sorted = [...spans].sort((a, b) => a.lo - b.lo);
    for (let i = 1; i < sorted.length; i++) {
      if (!apart(sorted[i - 1]!, sorted[i]!)) return false;
    }
    return true;
  };

  const start = startBoundary ? span(startBoundary) : null;
  let end = endBoundary ? span(endBoundary) : null;
  // The end boundary goes when it would touch the start one.
  if (start && end && !apart(start, end)) end = null;
  const pinned = [start, end].filter((p): p is Span => p !== null);
  const withPinned = (kept: Span[]): Span[] => [
    ...(start ? [start] : []),
    ...kept,
    ...(end ? [end] : []),
  ];

  const strip = (s: Span): { pos: number; label: string } => ({
    pos: s.pos,
    label: s.label,
  });
  for (const stride of strides) {
    const kept = standard
      .filter((t) => t.slot % stride === 0)
      .map(span)
      .filter((s) => pinned.every((p) => apart(p, s)));
    if (kept.length === 0 && pinned.length === 0) continue;
    if (fitsInOrder(kept)) {
      return withPinned(kept).map(strip);
    }
  }
  return withPinned([]).map(strip);
}
