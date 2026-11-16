// ============================================================
// Calendar heatmap — dates, amounts, shades and the summary line (#1855).
// Pure: no DOM, so the `<desc>` summary can use it without the renderer.
// ============================================================

import { dayToIso } from './parser';
import type { DayNumber, ParsedCalendarHeatmap } from './types';

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
/** Weekday rows that carry a label: Mon, Wed, Fri. */
export const LABELLED_WEEKDAYS = new Set([1, 3, 5]);

/** 0 = Sunday … 6 = Saturday. Day 0 (1970-01-01) was a Thursday. */
export function weekday(day: DayNumber): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function parts(day: DayNumber): {
  year: number;
  month: number;
  date: number;
} {
  const iso = dayToIso(day);
  return {
    year: +iso.slice(0, 4),
    month: +iso.slice(5, 7),
    date: +iso.slice(8, 10),
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * `unit` is written singular; a word takes an English plural, and anything
 * else (`km`, `kg`, `$`) is a symbol and stays as written.
 */
export function unitFor(unit: string, n: number): string {
  if (n === 1 || !/^[a-z]+$/i.test(unit) || !/[aeiouy]/i.test(unit))
    return unit;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  if (/[b-df-hj-np-tv-z]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
}

export function amount(n: number, unit: string | undefined): string {
  return unit ? `${formatNumber(n)} ${unitFor(unit, n)}` : formatNumber(n);
}

/**
 * The shade (0–4) of each value. 0 is zero; 1–4 are four equal-count bands of
 * the non-zero values, or with `max` four equal ranges of (0, max] — a value
 * at or above `max` takes the top band.
 */
export function shadeLevels(
  values: readonly number[],
  max?: number
): (v: number) => number {
  if (max !== undefined) {
    return (v) =>
      v <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((4 * v) / max)));
  }
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = sorted.length;
  const cuts = [1, 2, 3].map(
    (k) => sorted[Math.max(0, Math.ceil((k * n) / 4) - 1)]!
  );
  return (v) => {
    if (v <= 0 || n === 0) return 0;
    let level = 1;
    for (const cut of cuts) if (v > cut) level++;
    return level;
  };
}

/** "1,093 commits · busiest day Mar 10", or null when no day has a value. */
export function calendarSummary(parsed: ParsedCalendarHeatmap): string | null {
  let total = 0;
  let best: { day: DayNumber; value: number } | null = null;
  for (const d of parsed.days) {
    total += d.value;
    if (d.value > 0 && (!best || d.value > best.value)) best = d;
  }
  if (!best) return null;
  const b = parts(best.day);
  const oneYear = parts(parsed.start).year === parts(parsed.end).year;
  const when = `${MONTHS[b.month - 1]!.slice(0, 3)} ${b.date}${oneYear ? '' : `, ${b.year}`}`;
  const head = parsed.unit
    ? amount(total, parsed.unit)
    : `${formatNumber(total)} in total`;
  return `${head} · busiest day ${when}`;
}

export function fullDate(day: DayNumber): string {
  const p = parts(day);
  return `${WEEKDAYS[weekday(day)]}, ${MONTHS[p.month - 1]} ${p.date}, ${p.year}`;
}
