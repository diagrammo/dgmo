import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  formatLocalISODate,
  parseLocalISODate,
  unitToDays,
} from '../src/pert/internal';

describe('parseLocalISODate', () => {
  it('parses a valid YYYY-MM-DD into a local-time Date', () => {
    const d = parseLocalISODate('2026-06-01');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(1);
  });

  it('rejects shape mismatches', () => {
    expect(parseLocalISODate('2026/06/01')).toBeNull();
    expect(parseLocalISODate('2026-6-1')).toBeNull();
    expect(parseLocalISODate('Jun 1 2026')).toBeNull();
    expect(parseLocalISODate('')).toBeNull();
  });

  it('rejects calendar-invalid dates via round-trip check', () => {
    expect(parseLocalISODate('2026-13-99')).toBeNull();
    expect(parseLocalISODate('2026-02-31')).toBeNull();
  });

  it('accepts leap-day on a leap year', () => {
    expect(parseLocalISODate('2028-02-29')).not.toBeNull();
    // 2026 is not a leap year.
    expect(parseLocalISODate('2026-02-29')).toBeNull();
  });
});

describe('formatLocalISODate', () => {
  it('formats using local-time getters (zero-padded month/day)', () => {
    const d = new Date(2026, 0, 7); // Jan 7, 2026 local
    expect(formatLocalISODate(d)).toBe('2026-01-07');
  });
});

describe('addCalendarDays', () => {
  it('AC12: adds 7 days across timezone boundaries', () => {
    expect(addCalendarDays('2026-06-01', 7)).toBe('2026-06-08');
  });

  it('handles month rollover', () => {
    expect(addCalendarDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addCalendarDays('2026-07-01', -1)).toBe('2026-06-30');
  });

  it('handles year rollover', () => {
    expect(addCalendarDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(addCalendarDays('2027-01-04', -5)).toBe('2026-12-30');
  });

  it('AC13: rounds at entry, half-away-from-zero (forward + backward agree)', () => {
    expect(addCalendarDays('2026-06-01', 17.5)).toBe(
      addCalendarDays('2026-06-01', 18)
    );
    expect(addCalendarDays('2026-06-30', -17.5)).toBe(
      addCalendarDays('2026-06-30', -18)
    );
  });

  it('returns input unchanged for malformed start dates (defensive)', () => {
    expect(addCalendarDays('not-a-date', 7)).toBe('not-a-date');
  });
});

describe('addCalendarDays — TZ rotation (AC12)', () => {
  // We can't actually change `process.env.TZ` mid-process and have JS
  // pick it up, but we CAN sanity-check that the helper uses local-
  // time constructors (no UTC drift) by iterating boundary dates
  // around midnight where UTC-coercion would slip a day.
  const cases = [
    { input: '2026-06-01', delta: 0, expected: '2026-06-01' },
    { input: '2026-01-01', delta: 0, expected: '2026-01-01' },
    { input: '2026-12-31', delta: 0, expected: '2026-12-31' },
    { input: '2026-03-09', delta: 1, expected: '2026-03-10' }, // DST forward (US)
    { input: '2026-11-02', delta: 1, expected: '2026-11-03' }, // DST back (US)
  ];
  for (const { input, delta, expected } of cases) {
    it(`addCalendarDays('${input}', ${delta}) === '${expected}'`, () => {
      expect(addCalendarDays(input, delta)).toBe(expected);
    });
  }
});

describe('unitToDays', () => {
  it('matches the analyzer table', () => {
    expect(unitToDays('d')).toBe(1);
    expect(unitToDays('bd')).toBe(1);
    expect(unitToDays('w')).toBe(7);
    expect(unitToDays('m')).toBe(30);
    expect(unitToDays('q')).toBe(90);
    expect(unitToDays('y')).toBe(365);
    expect(unitToDays('s')).toBe(14); // sprint, NOT seconds
    expect(unitToDays('h')).toBe(1 / 24);
    expect(unitToDays('min')).toBe(1 / (60 * 24));
  });
});
