// ============================================================
// Duration & Business Day Arithmetic
// ============================================================

import type {
  Duration,
  DurationUnit,
  GanttHolidays,
  Offset,
  Weekday,
} from '../gantt/types';

// ── Weekday constants ─────────────────────────────────────

/** JS Date.getDay() → Weekday mapping (0=Sun, 1=Mon, ..., 6=Sat) */
const JS_DAY_TO_WEEKDAY: Weekday[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

/**
 * Check if a date is a workday (not a weekend and not a holiday).
 */
export function isWorkday(
  date: Date,
  workweek: readonly Weekday[],
  holidaySet: Set<string>
): boolean {
  // date.getDay() returns 0..6; JS_DAY_TO_WEEKDAY is length 7.
  const dayName = JS_DAY_TO_WEEKDAY[date.getDay()]!;
  if (!workweek.includes(dayName)) return false;
  if (holidaySet.has(formatDateKey(date))) return false;
  return true;
}

/**
 * Format a Date as YYYY-MM-DD for holiday set lookups.
 */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build a Set of holiday date strings for efficient lookup.
 * Expands date ranges into individual dates.
 */
export function buildHolidaySet(holidays: GanttHolidays): Set<string> {
  const set = new Set<string>();

  for (const h of holidays.dates) {
    set.add(h.date);
  }

  for (const range of holidays.ranges) {
    const start = new Date(range.startDate + 'T00:00:00');
    const end = new Date(range.endDate + 'T00:00:00');
    const current = new Date(start);
    while (current <= end) {
      set.add(formatDateKey(current));
      current.setDate(current.getDate() + 1);
    }
  }

  return set;
}

/**
 * Add business days to a start date, skipping weekends and holidays.
 *
 * For fractional business days, rounds to the nearest whole day first.
 * Handles both positive amounts (forward) and zero (returns start date).
 */
export function addBusinessDays(
  startDate: Date,
  count: number,
  workweek: readonly Weekday[],
  holidaySet: Set<string>,
  direction: 1 | -1 = 1
): Date {
  const days = Math.round(Math.abs(count));
  if (days === 0) return new Date(startDate);

  // Guard: an invalid start date would produce an infinite loop because
  // isWorkday() always returns false for NaN day-of-week. This happens
  // mid-edit when the user is typing a partial date like `start 2026-`.
  if (Number.isNaN(startDate.getTime())) return new Date(startDate);

  // Guard: a workweek with no workdays (or fully blocked by holidays) would
  // also loop forever. Bound the search at days * 14 calendar days, which
  // covers up to 2 weeks of skipped days per business day requested.
  const current = new Date(startDate);
  let remaining = days;
  let safety = days * 14 + 14;

  while (remaining > 0 && safety-- > 0) {
    current.setDate(current.getDate() + direction);
    if (isWorkday(current, workweek, holidaySet)) {
      remaining--;
    }
  }

  return current;
}

/**
 * Add a gantt duration to a start date, producing an end date.
 *
 * Calendar units (d, w, m, q, y) ignore holidays.
 * Business day units (bd) skip weekends and holidays.
 */
export function addGanttDuration(
  startDate: Date,
  duration: Duration,
  holidays: GanttHolidays,
  holidaySet: Set<string>,
  direction: 1 | -1 = 1,
  opts?: { sprintLength?: Duration }
): Date {
  const { amount, unit } = duration;

  switch (unit) {
    case 'bd':
      return addBusinessDays(
        startDate,
        amount,
        holidays.workweek,
        holidaySet,
        direction
      );

    case 'd': {
      const result = new Date(startDate);
      result.setDate(result.getDate() + Math.round(amount) * direction);
      return result;
    }

    case 'w': {
      const result = new Date(startDate);
      result.setDate(result.getDate() + Math.round(amount * 7) * direction);
      return result;
    }

    case 'm': {
      const result = new Date(startDate);
      const wholeMonths =
        direction === -1 ? Math.round(amount) : Math.floor(amount);
      const fractionalDays =
        direction === -1 ? 0 : Math.round((amount - wholeMonths) * 30);
      result.setMonth(result.getMonth() + wholeMonths * direction);
      if (fractionalDays > 0) {
        result.setDate(result.getDate() + fractionalDays * direction);
      }
      return result;
    }

    case 'q': {
      const result = new Date(startDate);
      const totalMonths = amount * 3;
      const wholeMonths =
        direction === -1 ? Math.round(totalMonths) : Math.floor(totalMonths);
      const fractionalDays =
        direction === -1 ? 0 : Math.round((totalMonths - wholeMonths) * 30);
      result.setMonth(result.getMonth() + wholeMonths * direction);
      if (fractionalDays > 0) {
        result.setDate(result.getDate() + fractionalDays * direction);
      }
      return result;
    }

    case 'y': {
      const result = new Date(startDate);
      const wholeYears =
        direction === -1 ? Math.round(amount) : Math.floor(amount);
      const fractionalMonths =
        direction === -1 ? 0 : Math.round((amount - wholeYears) * 12);
      result.setFullYear(result.getFullYear() + wholeYears * direction);
      if (fractionalMonths > 0) {
        result.setMonth(result.getMonth() + fractionalMonths * direction);
      }
      return result;
    }

    case 'h': {
      const result = new Date(startDate);
      result.setTime(result.getTime() + amount * 3600000 * direction);
      return result;
    }

    case 'min': {
      const result = new Date(startDate);
      result.setTime(result.getTime() + amount * 60000 * direction);
      return result;
    }

    case 's': {
      if (!opts?.sprintLength) {
        throw new Error(
          'Sprint duration unit "s" requires sprintLength configuration'
        );
      }
      const sl = opts.sprintLength;
      const totalDays = amount * sl.amount * (sl.unit === 'w' ? 7 : 1);
      const result = new Date(startDate);
      result.setDate(result.getDate() + Math.round(totalDays) * direction);
      return result;
    }
  }
}

/**
 * Parse a duration string like "3bd" or "5d".
 * `sp` is the canonical sprint suffix (§13.11); bare `s` is its legacy alias.
 */
export function parseDuration(s: string): Duration | null {
  const match = s.trim().match(/^(\d+(?:\.\d+)?)(min|bd|sp|d|w|m|q|y|h|s)$/);
  if (!match) return null;
  const unit = (match[2] === 'sp' ? 's' : match[2]) as DurationUnit;
  return { amount: parseFloat(match[1]!), unit };
}

/**
 * Parse an offset string like "5bd", "-3bd", or "0d".
 * Returns null if the format is invalid.
 * Explicit '+' prefix (e.g. "+5bd") returns null — caller should warn.
 */
export function parseOffset(value: string): Offset | null {
  const trimmed = value.trim();
  let direction: 1 | -1 = 1;
  let remainder = trimmed;

  if (trimmed.startsWith('-')) {
    direction = -1;
    remainder = trimmed.slice(1);
  } else if (trimmed.startsWith('+')) {
    return null; // explicit + is not supported
  }

  const duration = parseDuration(remainder);
  if (!duration) return null;
  return { duration, direction };
}

/**
 * Parse an offset prefix like "+4w", "+10bd", "-3d".
 * Unlike parseOffset(), this accepts explicit '+' prefix (used by new gantt syntax).
 */
export function parseOffsetPrefix(value: string): Offset | null {
  const trimmed = value.trim();
  let direction: 1 | -1 = 1;
  let remainder = trimmed;

  if (trimmed.startsWith('+')) {
    remainder = trimmed.slice(1);
  } else if (trimmed.startsWith('-')) {
    direction = -1;
    remainder = trimmed.slice(1);
  }

  const duration = parseDuration(remainder);
  if (!duration) return null;
  return { duration, direction };
}

/**
 * Parse a date string (YYYY-MM-DD, YYYY-MM, YYYY, or YYYY-MM-DD HH:MM) into a Date object.
 * Returns midnight local time unless HH:MM is specified.
 */
export function parseGanttDate(s: string): Date {
  // Split on space to detect optional time component
  const spaceIdx = s.indexOf(' ');
  let datePart = s;
  let hour = 0;
  let minute = 0;

  if (spaceIdx !== -1) {
    datePart = s.slice(0, spaceIdx);
    const timePart = s.slice(spaceIdx + 1);
    const timeParts = timePart.split(':');
    if (timeParts.length === 2) {
      const h = parseInt(timeParts[0]!, 10);
      const m = parseInt(timeParts[1]!, 10);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        hour = h;
        minute = m;
      }
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  // split() always returns ≥1 element, so parts[0] is defined.
  const year = parts[0]!;
  const month = parts.length >= 2 ? parts[1]! - 1 : 0; // JS months are 0-based
  const day = parts.length >= 3 ? parts[2]! : 1;
  return new Date(year, month, day, hour, minute);
}

/**
 * Format a Date as YYYY-MM-DD string, or YYYY-MM-DD HH:MM if time is non-midnight.
 */
export function formatGanttDate(date: Date): string {
  const dateStr = formatDateKey(date);
  const h = date.getHours();
  const m = date.getMinutes();
  if (h === 0 && m === 0) return dateStr;
  return `${dateStr} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
