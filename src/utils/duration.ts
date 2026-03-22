// ============================================================
// Duration & Business Day Arithmetic
// ============================================================

import type { Duration, DurationUnit, GanttHolidays, Weekday } from '../gantt/types';

// ── Weekday constants ─────────────────────────────────────

/** JS Date.getDay() → Weekday mapping (0=Sun, 1=Mon, ..., 6=Sat) */
const JS_DAY_TO_WEEKDAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Check if a date is a workday (not a weekend and not a holiday).
 */
export function isWorkday(
  date: Date,
  workweek: Weekday[],
  holidaySet: Set<string>,
): boolean {
  const dayName = JS_DAY_TO_WEEKDAY[date.getDay()];
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
  workweek: Weekday[],
  holidaySet: Set<string>,
): Date {
  const days = Math.round(count);
  if (days <= 0) return new Date(startDate);

  const current = new Date(startDate);
  let remaining = days;

  while (remaining > 0) {
    current.setDate(current.getDate() + 1);
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
): Date {
  const { amount, unit } = duration;

  switch (unit) {
    case 'bd':
      return addBusinessDays(startDate, amount, holidays.workweek, holidaySet);

    case 'd': {
      const result = new Date(startDate);
      result.setDate(result.getDate() + Math.round(amount));
      return result;
    }

    case 'w': {
      const result = new Date(startDate);
      result.setDate(result.getDate() + Math.round(amount * 7));
      return result;
    }

    case 'm': {
      const result = new Date(startDate);
      const wholeMonths = Math.floor(amount);
      const fractionalDays = Math.round((amount - wholeMonths) * 30);
      result.setMonth(result.getMonth() + wholeMonths);
      if (fractionalDays > 0) {
        result.setDate(result.getDate() + fractionalDays);
      }
      return result;
    }

    case 'q': {
      // Quarter = 3 months
      const result = new Date(startDate);
      const totalMonths = amount * 3;
      const wholeMonths = Math.floor(totalMonths);
      const fractionalDays = Math.round((totalMonths - wholeMonths) * 30);
      result.setMonth(result.getMonth() + wholeMonths);
      if (fractionalDays > 0) {
        result.setDate(result.getDate() + fractionalDays);
      }
      return result;
    }

    case 'y': {
      const result = new Date(startDate);
      const wholeYears = Math.floor(amount);
      const fractionalMonths = Math.round((amount - wholeYears) * 12);
      result.setFullYear(result.getFullYear() + wholeYears);
      if (fractionalMonths > 0) {
        result.setMonth(result.getMonth() + fractionalMonths);
      }
      return result;
    }
  }
}

/**
 * Parse a date string (YYYY-MM-DD, YYYY-MM, or YYYY) into a Date object.
 * Always returns midnight local time on the first available day.
 */
export function parseGanttDate(s: string): Date {
  const parts = s.split('-').map(p => parseInt(p, 10));
  const year = parts[0];
  const month = parts.length >= 2 ? parts[1] - 1 : 0; // JS months are 0-based
  const day = parts.length >= 3 ? parts[2] : 1;
  return new Date(year, month, day);
}

/**
 * Format a Date as YYYY-MM-DD string.
 */
export function formatGanttDate(date: Date): string {
  return formatDateKey(date);
}

/**
 * Calculate the difference in calendar days between two dates.
 */
export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}
