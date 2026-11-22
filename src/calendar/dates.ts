// ============================================================
// Calendar — UTC day numbers. Pure; shared by the parser and the renderer.
// ============================================================

import type { DayNumber } from './types';

export const MS_PER_DAY = 86_400_000;

/** UTC day number of a calendar date, or null when the date does not exist. */
export function dayNumber(
  year: number,
  month: number,
  day: number
): DayNumber | null {
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.round(ms / MS_PER_DAY);
}

/** UTC day number of a date that may overflow its month (Date.UTC rolls it). */
export function rollingDay(
  year: number,
  month: number,
  day: number
): DayNumber {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** `YYYY-MM-DD` for a UTC day number. */
export function dayToIso(day: DayNumber): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Days in a month (month 1–12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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

/** 0 = Sunday … 6 = Saturday. Day 0 (1970-01-01) was a Thursday. */
export function weekday(day: DayNumber): number {
  return (((day + 4) % 7) + 7) % 7;
}
