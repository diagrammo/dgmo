import { describe, it, expect } from 'vitest';
import {
  addBusinessDays,
  addGanttDuration,
  buildHolidaySet,
  isWorkday,
  formatDateKey,
} from '../src/utils/duration';
import type { GanttHolidays } from '../src/gantt/types';

const DEFAULT_WORKWEEK = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
const DEFAULT_HOLIDAYS: GanttHolidays = {
  dates: [],
  ranges: [],
  workweek: [...DEFAULT_WORKWEEK],
};

function makeDate(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d); // JS months are 0-based
}

function fmt(d: Date): string {
  return formatDateKey(d);
}

describe('isWorkday', () => {
  it('Monday is a workday', () => {
    expect(isWorkday(makeDate(2024, 1, 15), [...DEFAULT_WORKWEEK], new Set())).toBe(true);
  });

  it('Saturday is not a workday', () => {
    expect(isWorkday(makeDate(2024, 1, 20), [...DEFAULT_WORKWEEK], new Set())).toBe(false);
  });

  it('Sunday is not a workday', () => {
    expect(isWorkday(makeDate(2024, 1, 21), [...DEFAULT_WORKWEEK], new Set())).toBe(false);
  });

  it('holiday is not a workday', () => {
    const holidays = new Set(['2024-01-15']);
    expect(isWorkday(makeDate(2024, 1, 15), [...DEFAULT_WORKWEEK], holidays)).toBe(false);
  });
});

describe('addBusinessDays', () => {
  const emptySet = new Set<string>();

  it('1bd from Monday = Tuesday', () => {
    const result = addBusinessDays(makeDate(2024, 1, 15), 1, [...DEFAULT_WORKWEEK], emptySet);
    expect(fmt(result)).toBe('2024-01-16');
  });

  it('5bd from Monday = next Monday (skips weekend)', () => {
    const result = addBusinessDays(makeDate(2024, 1, 15), 5, [...DEFAULT_WORKWEEK], emptySet);
    expect(fmt(result)).toBe('2024-01-22');
  });

  it('10bd from Monday skips 2 weekends', () => {
    const result = addBusinessDays(makeDate(2024, 1, 15), 10, [...DEFAULT_WORKWEEK], emptySet);
    expect(fmt(result)).toBe('2024-01-29');
  });

  it('1bd from Friday = next Monday', () => {
    const result = addBusinessDays(makeDate(2024, 1, 19), 1, [...DEFAULT_WORKWEEK], emptySet);
    expect(fmt(result)).toBe('2024-01-22');
  });

  it('0bd returns same date', () => {
    const result = addBusinessDays(makeDate(2024, 1, 15), 0, [...DEFAULT_WORKWEEK], emptySet);
    expect(fmt(result)).toBe('2024-01-15');
  });

  it('skips holidays', () => {
    const holidays = new Set(['2024-01-16']); // Tuesday is a holiday
    const result = addBusinessDays(makeDate(2024, 1, 15), 1, [...DEFAULT_WORKWEEK], holidays);
    expect(fmt(result)).toBe('2024-01-17'); // skips to Wednesday
  });

  it('skips holiday + weekend combo', () => {
    // Friday is a holiday, so 1bd from Thursday = Monday
    const holidays = new Set(['2024-01-19']); // Friday
    const result = addBusinessDays(makeDate(2024, 1, 18), 1, [...DEFAULT_WORKWEEK], holidays);
    expect(fmt(result)).toBe('2024-01-22');
  });
});

describe('buildHolidaySet', () => {
  it('expands date ranges', () => {
    const holidays: GanttHolidays = {
      dates: [{ date: '2024-01-01', label: 'NY' }],
      ranges: [{ startDate: '2024-12-24', endDate: '2024-12-26', label: 'Xmas' }],
      workweek: [...DEFAULT_WORKWEEK],
    };
    const set = buildHolidaySet(holidays);
    expect(set.has('2024-01-01')).toBe(true);
    expect(set.has('2024-12-24')).toBe(true);
    expect(set.has('2024-12-25')).toBe(true);
    expect(set.has('2024-12-26')).toBe(true);
    expect(set.has('2024-12-27')).toBe(false);
  });
});

describe('addGanttDuration', () => {
  const holidaySet = new Set<string>();

  it('calendar days (d) ignore weekends', () => {
    const result = addGanttDuration(makeDate(2024, 1, 15), { amount: 7, unit: 'd' }, DEFAULT_HOLIDAYS, holidaySet);
    expect(fmt(result)).toBe('2024-01-22'); // 7 calendar days, includes weekend
  });

  it('business days (bd) skip weekends', () => {
    const result = addGanttDuration(makeDate(2024, 1, 15), { amount: 7, unit: 'bd' }, DEFAULT_HOLIDAYS, holidaySet);
    // 5bd = Mon-Fri, then 2 more bd = next Mon, Tue
    expect(fmt(result)).toBe('2024-01-24');
  });

  it('weeks (w)', () => {
    const result = addGanttDuration(makeDate(2024, 1, 15), { amount: 2, unit: 'w' }, DEFAULT_HOLIDAYS, holidaySet);
    expect(fmt(result)).toBe('2024-01-29');
  });

  it('months (m)', () => {
    const result = addGanttDuration(makeDate(2024, 1, 15), { amount: 1, unit: 'm' }, DEFAULT_HOLIDAYS, holidaySet);
    expect(fmt(result)).toBe('2024-02-15');
  });

  it('quarters (q)', () => {
    const result = addGanttDuration(makeDate(2024, 1, 15), { amount: 1, unit: 'q' }, DEFAULT_HOLIDAYS, holidaySet);
    expect(fmt(result)).toBe('2024-04-15');
  });

  it('years (y)', () => {
    const result = addGanttDuration(makeDate(2024, 1, 15), { amount: 1, unit: 'y' }, DEFAULT_HOLIDAYS, holidaySet);
    expect(fmt(result)).toBe('2025-01-15');
  });

  it('custom workweek sun-thu', () => {
    const customHolidays: GanttHolidays = {
      dates: [],
      ranges: [],
      workweek: ['sun', 'mon', 'tue', 'wed', 'thu'],
    };
    // Jan 18 = Thursday. 1bd = next Sun (skips Fri, Sat)
    const result = addGanttDuration(makeDate(2024, 1, 18), { amount: 1, unit: 'bd' }, customHolidays, new Set());
    expect(fmt(result)).toBe('2024-01-21'); // Sunday
  });
});
