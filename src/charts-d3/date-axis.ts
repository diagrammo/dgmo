// ============================================================
// Time x-axis for line, area, vertical bar and scatter (#1880, #2208). When
// every row's label is a date, a date-time or a bare time, rows sit at their
// place in time rather than evenly. Ticks come from the shared
// `computeTimeTicks` with gantt's exact converters, so the chart types agree
// on where a date falls.
//
// Label forms, all local time (no `Z` or offset):
//   `YYYY-MM` · `YYYY-MM-DD`                       → kind 'date'
//   `YYYY-MM-DD HH:MM[:SS]` · `YYYY-MM-DDTHH:MM[:SS]` → kind 'datetime'
//   `HH:MM[:SS]`                                   → kind 'time'
// Bare times run in row order across days: a time earlier than the row
// before it is on the next day (the wrap past midnight).
// ============================================================

import { scaleLinear } from 'd3-scale';
import type { DiagnosticSpec } from '../diagnostics';
import {
  computeTimeTicks,
  EXACT_FRACTIONAL_YEAR,
  type TickLabelFit,
} from '../utils/time-ticks';

const ISO_DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** A gap longer than this many median intervals breaks the line (#2208). */
export const GAP_BREAK_FACTOR = 3;

/** The calendar day bare times are placed on. Never printed. */
const TIME_ANCHOR = { y: 2000, m: 0, d: 1 };

export type TimeLabelKind = 'date' | 'datetime' | 'time';

function validClock(h: number, mi: number, s: number): boolean {
  return h <= 23 && mi <= 59 && s <= 59;
}

function calendarDate(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0
): Date | null {
  if (mo < 1 || mo > 12 || d < 1) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  // Reject a day the month does not have (2023-02-30 rolls into March).
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  date.setFullYear(y); // years 0–99 would otherwise map to 1900–1999
  return date;
}

/** `YYYY-MM-DD` or `YYYY-MM` → a local Date; anything else → null. */
export function parseIsoDateLabel(label: string): Date | null {
  const m = label.trim().match(ISO_DATE_RE);
  if (!m) return null;
  return calendarDate(
    Number(m[1]),
    Number(m[2]),
    m[3] === undefined ? 1 : Number(m[3])
  );
}

/** A label's kind and value: a Date, or seconds since midnight for a bare time. */
export function parseTimeLabel(
  label: string
):
  | { kind: 'date' | 'datetime'; date: Date }
  | { kind: 'time'; seconds: number }
  | null {
  const s = label.trim();
  const date = parseIsoDateLabel(s);
  if (date) return { kind: 'date', date };
  const dt = s.match(ISO_DATETIME_RE);
  if (dt) {
    const h = Number(dt[4]);
    const mi = Number(dt[5]);
    const sec = dt[6] === undefined ? 0 : Number(dt[6]);
    if (!validClock(h, mi, sec)) return null;
    const d = calendarDate(
      Number(dt[1]),
      Number(dt[2]),
      Number(dt[3]),
      h,
      mi,
      sec
    );
    return d ? { kind: 'datetime', date: d } : null;
  }
  const t = s.match(TIME_RE);
  if (t) {
    const h = Number(t[1]);
    const mi = Number(t[2]);
    const sec = t[3] === undefined ? 0 : Number(t[3]);
    if (!validClock(h, mi, sec)) return null;
    return { kind: 'time', seconds: h * 3600 + mi * 60 + sec };
  }
  return null;
}

export interface TimeLabels {
  dates: Date[];
  /** `time` when every label is a bare time; else `date` / `datetime`. */
  kind: TimeLabelKind;
}

/**
 * The rows' times, or null when any label is not a date, date-time or time,
 * or when bare times are mixed with dated labels. Dates and date-times mix
 * freely (a date is its midnight). Bare years and mixed rows keep the
 * category axis (owner, 2026-11-12).
 */
export function timeLabelsOf(labels: readonly string[]): TimeLabels | null {
  if (labels.length === 0) return null;
  const parsed = labels.map(parseTimeLabel);
  if (parsed.some((p) => p === null)) return null;
  const times = parsed.filter((p) => p!.kind === 'time').length;
  if (times > 0 && times < parsed.length) return null;
  if (times > 0) {
    // Bare times wrap past midnight: an earlier time is the next day.
    const dates: Date[] = [];
    let day = 0;
    let prev = -1;
    for (const p of parsed) {
      const sec = (p as { seconds: number }).seconds;
      if (prev >= 0 && sec < prev) day++;
      prev = sec;
      const h = Math.floor(sec / 3600);
      const mi = Math.floor((sec % 3600) / 60);
      dates.push(
        new Date(
          TIME_ANCHOR.y,
          TIME_ANCHOR.m,
          TIME_ANCHOR.d + day,
          h,
          mi,
          sec % 60
        )
      );
    }
    return { dates, kind: 'time' };
  }
  const dates = parsed.map((p) => (p as { date: Date }).date);
  const kind = parsed.some((p) => p!.kind === 'datetime') ? 'datetime' : 'date';
  return { dates, kind };
}

/** The rows' dates, or null when any label is not a date or time. */
export function isoDatesOf(labels: readonly string[]): Date[] | null {
  return timeLabelsOf(labels)?.dates ?? null;
}

/**
 * Why a column that is mostly time labels still gets categories, for
 * `W_TIME_AXIS_MIXED`: the first row that breaks it. Null when the column is
 * a time axis, or when fewer than half its labels look like times (a
 * category column that happens to hold one date is not a mistake).
 */
export function mixedTimeLabels(
  labels: readonly string[]
): { index: number; reason: 'not-time' | 'time-and-date' } | null {
  if (labels.length < 2 || timeLabelsOf(labels)) return null;
  const parsed = labels.map(parseTimeLabel);
  const ok = parsed.filter((p) => p !== null).length;
  if (ok * 2 < labels.length) return null;
  const bad = parsed.findIndex((p) => p === null);
  if (bad >= 0) return { index: bad, reason: 'not-time' };
  // Every label parses, so bare times sit beside dated labels.
  const firstKind = parsed[0]!.kind === 'time';
  const index = parsed.findIndex((p) => (p!.kind === 'time') !== firstKind);
  return { index, reason: 'time-and-date' };
}

/**
 * `out[i]` is true when the gap from row i to row i + 1 is more than
 * `factor` times the median interval: the line breaks there (#2208). Needs
 * two intervals to have a median; fewer rows never break.
 */
export function gapBreaksOf(
  dates: readonly Date[],
  factor = GAP_BREAK_FACTOR
): boolean[] {
  const out = dates.map(() => false);
  if (dates.length < 3) return out;
  const steps = dates
    .slice(1)
    .map((d, i) => Math.abs(d.getTime() - dates[i]!.getTime()));
  const sorted = steps.filter((s) => s > 0).sort((a, b) => a - b);
  if (sorted.length < 2) return out;
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  steps.forEach((s, i) => {
    if (s > factor * median) out[i] = true;
  });
  return out;
}

/**
 * `items` with a breaker after every row whose gap breaks, for d3's
 * `.defined()`: `blank(item)` returns a copy that the generator skips.
 */
export function withGapBreaks<T>(
  items: readonly T[],
  breaks: readonly boolean[] | null,
  blank: (item: T) => T
): T[] {
  if (!breaks?.some(Boolean)) return [...items];
  const out: T[] = [];
  items.forEach((it, i) => {
    out.push(it);
    if (breaks[i]) out.push(blank(it));
  });
  return out;
}

export interface DateAxis {
  /** Date → pixel. */
  x(d: Date): number;
  ticks: { pos: number; label: string }[];
}

const CLOCK_TAIL_RE = /(\d{2}:\d{2}(?::\d{2})?)$/;

/**
 * Build the axis over `dates` on `range`. A single date, or rows that all
 * share one date, get a month either side so the point sits mid-plot (an
 * hour either side when the labels carry a time). A `time` axis never
 * prints its anchor day: ticks read `HH:MM`, and day ticks `Day N`.
 */
export function buildDateAxis(
  dates: readonly Date[],
  range: [number, number],
  labelFit: TickLabelFit,
  kind: TimeLabelKind = 'date'
): DateAxis {
  const fy = dates.map((d) => EXACT_FRACTIONAL_YEAR.toFractionalYear(d));
  let lo = Math.min(...fy);
  let hi = Math.max(...fy);
  if (!(hi > lo)) {
    const pad = kind === 'date' ? 1 / 12 : 1 / 8760;
    lo -= pad;
    hi += pad;
  }
  const scale = scaleLinear().domain([lo, hi]).range(range);
  let ticks = computeTimeTicks(
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
  if (kind === 'time') {
    const anchor = new Date(TIME_ANCHOR.y, TIME_ANCHOR.m, TIME_ANCHOR.d);
    ticks = ticks.map((t) => {
      const clock = t.label.match(CLOCK_TAIL_RE);
      if (clock) return { pos: t.pos, label: clock[1]! };
      const at = EXACT_FRACTIONAL_YEAR.fromFractionalYear(scale.invert(t.pos));
      const day = Math.round(
        (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
          anchor.getTime()) /
          86_400_000
      );
      return { pos: t.pos, label: `Day ${day + 1}` };
    });
  }
  return {
    x: (d) => scale(EXACT_FRACTIONAL_YEAR.toFractionalYear(d)),
    ticks,
  };
}

/** A column that is mostly time labels but falls back to categories (#2208). */
export const TIME_AXIS_MIXED_DX: DiagnosticSpec = {
  code: 'W_TIME_AXIS_MIXED',
  severity: 'warning',
  chartType: null,
  title: 'Time axis not used',
  message: (p) =>
    p.reason === 'time-and-date'
      ? `"${p.label}" is a bare time among dated labels, so the x axis falls back to evenly spaced categories.`
      : `"${p.label}" is not a date or time, so the x axis falls back to evenly spaced categories.`,
  hint: 'Write every label as `YYYY-MM-DD`, `YYYY-MM`, `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM`, or every label as a bare `HH:MM`, to place rows at their time.',
  example: 'line Visits\n2026-01-01 4\n2026-01-02 6\nnext day 5',
};
