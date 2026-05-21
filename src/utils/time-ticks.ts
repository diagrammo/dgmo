// ============================================================
// Time axis tick computation — shared by d3.ts and gantt/renderer.ts
// ============================================================

import type * as d3Scale from 'd3-scale';

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
  // Inverse of: (month-1)/12 + (day-1)/365 + hour/8760 + minute/525600
  const monthFrac = remainder * 12;
  const month = Math.floor(monthFrac); // 0-based
  const monthRemainder = remainder - month / 12;
  const dayFrac = monthRemainder * 365; // fractional day-of-year offset
  const day = Math.floor(dayFrac) + 1;
  const dayRemainder = dayFrac - Math.floor(dayFrac);
  const hourFrac = dayRemainder * 24;
  const hour = Math.floor(hourFrac);
  const minute = Math.round((hourFrac - hour) * 60);
  return new Date(year, month, day, hour, minute);
}

/** Convert a Date to a fractional year number. */
function dateToFractionalYear(d: Date): number {
  return (
    d.getFullYear() +
    d.getMonth() / 12 +
    (d.getDate() - 1) / 365 +
    d.getHours() / 8760 +
    d.getMinutes() / 525600
  );
}

/**
 * Generates adaptive tick marks along a time axis.
 * Picks the right granularity (years, months, weeks, days, hours, minutes)
 * based on the domain span.
 *
 * Optional boundary parameters add ticks at exact data start/end:
 * - boundaryStart/boundaryEnd: numeric date values
 * - boundaryStartLabel/boundaryEndLabel: formatted labels for those dates
 */
export function computeTimeTicks(
  domainMin: number,
  domainMax: number,
  scale: d3Scale.ScaleLinear<number, number>,
  boundaryStart?: number,
  boundaryEnd?: number,
  boundaryStartLabel?: string,
  boundaryEndLabel?: string
): { pos: number; label: string }[] {
  const minYear = Math.floor(domainMin);
  const maxYear = Math.floor(domainMax);
  const span = domainMax - domainMin;

  let ticks: { pos: number; label: string }[] = [];

  // Year ticks for multi-year spans (need at least 2 boundaries)
  const firstYear = Math.ceil(domainMin);
  const lastYear = Math.floor(domainMax);
  if (lastYear >= firstYear + 1) {
    // Decimate ticks for long spans so labels don't overlap
    const yearSpan = lastYear - firstYear;
    let step = 1;
    if (yearSpan > 80) step = 20;
    else if (yearSpan > 40) step = 10;
    else if (yearSpan > 20) step = 5;
    else if (yearSpan > 10) step = 2;

    // Align to step boundary so ticks land on round years (1700, 1710, …)
    const alignedFirst = Math.ceil(firstYear / step) * step;
    for (let y = alignedFirst; y <= lastYear; y += step) {
      ticks.push({ pos: scale(y), label: String(y) });
    }
  } else if (span > 0.25) {
    // Month ticks for spans > ~3 months
    const crossesYear = maxYear > minYear;
    for (let y = minYear; y <= maxYear + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        const val = y + (m - 1) / 12;
        if (val > domainMax) break;
        if (val >= domainMin) {
          // m is 1..12, so MONTH_ABBR[m-1] is always defined.
          const abbr = MONTH_ABBR[m - 1]!;
          ticks.push({
            pos: scale(val),
            label: crossesYear ? `${abbr} '${String(y).slice(-2)}` : abbr,
          });
        }
      }
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
    const startDate = fractionalYearToDate(domainMin);
    // Round down to nearest step boundary
    startDate.setMinutes(
      Math.floor(startDate.getMinutes() / stepMin) * stepMin,
      0,
      0
    );

    while (true) {
      const val = dateToFractionalYear(startDate);
      if (val > domainMax) break;
      if (val >= domainMin) {
        const hh = String(startDate.getHours()).padStart(2, '0');
        const mm = String(startDate.getMinutes()).padStart(2, '0');
        ticks.push({ pos: scale(val), label: `${hh}:${mm}` });
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

    const startDate = fractionalYearToDate(domainMin);
    // Round down to nearest step boundary
    startDate.setHours(
      Math.floor(startDate.getHours() / stepHour) * stepHour,
      0,
      0,
      0
    );

    while (true) {
      const val = dateToFractionalYear(startDate);
      if (val > domainMax) break;
      if (val >= domainMin) {
        const hh = String(startDate.getHours()).padStart(2, '0');
        const mm = String(startDate.getMinutes()).padStart(2, '0');
        if (singleDay) {
          ticks.push({ pos: scale(val), label: `${hh}:${mm}` });
        } else {
          const mon = MONTH_ABBR[startDate.getMonth()];
          const d = startDate.getDate();
          ticks.push({ pos: scale(val), label: `${mon} ${d} ${hh}:${mm}` });
        }
      }
      startDate.setHours(startDate.getHours() + stepHour);
    }
  } else {
    // Week ticks for spans ≤ ~3 months (1st, 8th, 15th, 22nd of each month)
    for (let y = minYear; y <= maxYear + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, 8, 15, 22]) {
          const val = y + (m - 1) / 12 + (d - 1) / 365;
          if (val > domainMax) break;
          if (val >= domainMin) {
            ticks.push({
              pos: scale(val),
              label: `${MONTH_ABBR[m - 1]} ${d}`,
            });
          }
        }
      }
    }
  }

  // Add boundary ticks at exact data start/end if provided
  // When a boundary tick collides with a standard tick, replace the standard tick
  const collisionThreshold = 40; // pixels

  if (boundaryStart !== undefined && boundaryStartLabel) {
    const boundaryPos = scale(boundaryStart);
    // Remove any standard ticks that would collide with the start boundary
    ticks = ticks.filter(
      (t) => Math.abs(t.pos - boundaryPos) >= collisionThreshold
    );
    ticks.unshift({ pos: boundaryPos, label: boundaryStartLabel });
  }

  if (boundaryEnd !== undefined && boundaryEndLabel) {
    const boundaryPos = scale(boundaryEnd);
    // Remove any standard ticks that would collide with the end boundary
    ticks = ticks.filter(
      (t) => Math.abs(t.pos - boundaryPos) >= collisionThreshold
    );
    ticks.push({ pos: boundaryPos, label: boundaryEndLabel });
  }

  return ticks;
}
