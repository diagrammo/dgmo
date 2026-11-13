// ============================================================
// Date x-axis for line (#1880): when every row's label is an ISO date
// (`YYYY-MM-DD` or `YYYY-MM`), rows sit at their place in time rather than
// evenly. Ticks come from the shared `computeTimeTicks` with gantt's exact
// converters, so the two chart types agree on where a date falls.
// ============================================================

import { scaleLinear } from 'd3-scale';
import {
  computeTimeTicks,
  EXACT_FRACTIONAL_YEAR,
  type TickLabelFit,
} from '../utils/time-ticks';

const ISO_DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

/** `YYYY-MM-DD` or `YYYY-MM` → a local Date; anything else → null. */
export function parseIsoDateLabel(label: string): Date | null {
  const m = label.trim().match(ISO_DATE_RE);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = m[3] === undefined ? 1 : Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const date = new Date(y, mo - 1, d);
  // Reject a day the month does not have (2023-02-30 rolls into March).
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  date.setFullYear(y); // years 0–99 would otherwise map to 1900–1999
  return date;
}

/**
 * The rows' dates, or null when any label is not an ISO date. Bare years and
 * mixed rows keep the category axis (owner, 2026-11-12).
 */
export function isoDatesOf(labels: readonly string[]): Date[] | null {
  if (labels.length === 0) return null;
  const out: Date[] = [];
  for (const l of labels) {
    const d = parseIsoDateLabel(l);
    if (!d) return null;
    out.push(d);
  }
  return out;
}

export interface DateAxis {
  /** Date → pixel. */
  x(d: Date): number;
  ticks: { pos: number; label: string }[];
}

/**
 * Build the axis over `dates` on `range`. A single date, or rows that all
 * share one date, get a month either side so the point sits mid-plot.
 */
export function buildDateAxis(
  dates: readonly Date[],
  range: [number, number],
  labelFit: TickLabelFit
): DateAxis {
  const fy = dates.map((d) => EXACT_FRACTIONAL_YEAR.toFractionalYear(d));
  let lo = Math.min(...fy);
  let hi = Math.max(...fy);
  if (!(hi > lo)) {
    lo -= 1 / 12;
    hi += 1 / 12;
  }
  const scale = scaleLinear().domain([lo, hi]).range(range);
  const ticks = computeTimeTicks(
    lo,
    hi,
    scale,
    undefined,
    undefined,
    undefined,
    undefined,
    labelFit,
    EXACT_FRACTIONAL_YEAR
  );
  return {
    x: (d) => scale(EXACT_FRACTIONAL_YEAR.toFractionalYear(d)),
    ticks,
  };
}
