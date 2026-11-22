// ============================================================
// Calendar — dates, amounts, shades and the summary line (§41.6).
// Pure: no DOM, so the `<desc>` summary can use it without the renderer.
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import { parts, weekday } from './dates';
import { pluralUnit, resolveCalendarActiveGroup } from './parser';
import type {
  CalendarGroupRef,
  CalendarNumberGroup,
  DayNumber,
  ParsedCalendar,
} from './types';

export { parts, weekday } from './dates';

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

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * `unit` is written singular; a word takes an English plural, and anything
 * else (`km`, `kg`, `$`) is a symbol and stays as written.
 */
export const unitFor = pluralUnit;

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

export function numberGroupOf(
  parsed: ParsedCalendar,
  ref: CalendarGroupRef
): CalendarNumberGroup | undefined {
  return parsed.numberGroups.find((g) => g.key === ref.key);
}

/** "212 days logged · most often Great"; a tie goes to the value declared
 *  first. Null when no day has a value in the group. */
function tagSummary(parsed: ParsedCalendar, key: string): string | null {
  const counts = new Map<string, number>();
  for (const d of parsed.days) {
    const t = d.tags[key];
    if (t !== undefined) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let logged = 0;
  for (const n of counts.values()) logged += n;
  const group = parsed.tagGroups.find((g) => tagAttrKey(g.name) === key);
  let top: { tag: string; n: number } | null = null;
  for (const e of group?.entries ?? []) {
    const n = counts.get(e.value) ?? 0;
    if (n > 0 && (!top || n > top.n)) top = { tag: e.value, n };
  }
  const days = logged === 1 ? 'day' : 'days';
  return `${formatNumber(logged)} ${days} logged · most often ${top!.tag}`;
}

/** The day with the highest value in a number group (the first on a tie)
 *  and the summary's phrase naming it, "busiest day Mar 10". */
export function busiestDay(
  parsed: ParsedCalendar,
  key: string
): { day: DayNumber; phrase: string } | null {
  let best: { day: DayNumber; value: number } | null = null;
  for (const d of parsed.days) {
    const v = d.numbers[key] ?? 0;
    if (v > 0 && (!best || v > best.value)) best = { day: d.day, value: v };
  }
  if (!best) return null;
  const b = parts(best.day);
  const oneYear = parts(parsed.start).year === parts(parsed.end).year;
  const when = `${MONTHS[b.month - 1]!.slice(0, 3)} ${b.date}${oneYear ? '' : `, ${b.year}`}`;
  return { day: best.day, phrase: `busiest day ${when}` };
}

/**
 * The summary line, following the open pill: number → "844 commits ·
 * busiest day Mar 5"; tag → "212 days logged · most often Great"; no
 * colour or no group → "14 events". Null when there is nothing to say.
 */
export function calendarSummary(
  parsed: ParsedCalendar,
  active: CalendarGroupRef | null = resolveCalendarActiveGroup(parsed)
): string | null {
  if (active?.kind === 'number') {
    const best = busiestDay(parsed, active.key);
    if (best) {
      const unit = numberGroupOf(parsed, active)?.unit;
      const total = parsed.days.reduce(
        (a, d) => a + (d.numbers[active.key] ?? 0),
        0
      );
      const head = unit
        ? amount(total, unit)
        : `${formatNumber(total)} in total`;
      return `${head} · ${best.phrase}`;
    }
  } else if (active?.kind === 'tag') {
    const s = tagSummary(parsed, active.key);
    if (s) return s;
  }
  const n = parsed.events.length;
  return n > 0 ? `${formatNumber(n)} ${n === 1 ? 'event' : 'events'}` : null;
}

export function fullDate(day: DayNumber): string {
  const p = parts(day);
  return `${WEEKDAYS[weekday(day)]}, ${MONTHS[p.month - 1]} ${p.date}, ${p.year}`;
}
