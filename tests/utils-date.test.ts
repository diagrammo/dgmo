import { describe, it, expect } from 'vitest';
import {
  parseDateToken,
  toInternal,
  resolveDates,
  normalizeDate,
  monthNameToNum,
  type DateToken,
} from '../src/utils/date';

// Convenience: parse + resolve a single field with a fixed current year.
function norm(raw: string, opts: Parameters<typeof normalizeDate>[1] = {}) {
  return normalizeDate(raw, { currentYear: 2026, ...opts });
}

describe('parseDateToken — formats', () => {
  it('ISO full / partial / bare year', () => {
    expect(norm('2026-07-04')).toBe('2026-07-04');
    expect(norm('2026-07')).toBe('2026-07');
    expect(norm('2026')).toBe('2026');
    expect(norm('1716')).toBe('1716');
  });

  it('ISO datetime (T and space, optional seconds)', () => {
    expect(norm('2026-07-04T14:30')).toBe('2026-07-04 14:30');
    expect(norm('2026-07-04 14:30')).toBe('2026-07-04 14:30');
    expect(norm('2026-07-04 14:30:45')).toBe('2026-07-04 14:30:45');
  });

  it('bare month-day resolves against a base year', () => {
    expect(norm('07-04', { year: 2026 })).toBe('2026-07-04');
    expect(norm('7/4', { year: 2026 })).toBe('2026-07-04');
    expect(norm('7/4/2027')).toBe('2027-07-04');
    expect(norm('7/4/27')).toBe('2027-07-04');
  });

  it('month-name forms — no order ambiguity', () => {
    expect(norm('Jul 4', { year: 2026 })).toBe('2026-07-04');
    expect(norm('July 4, 2026')).toBe('2026-07-04');
    expect(norm('4 Jul', { year: 2026 })).toBe('2026-07-04');
    expect(norm('4 July 2026')).toBe('2026-07-04');
    expect(norm('Sep. 2, 2008')).toBe('2008-09-02');
  });

  it('BCE / CE era suffixes', () => {
    expect(norm('753 BCE')).toBe('-753');
    expect(norm('44 BC')).toBe('-44');
    expect(norm('14 CE')).toBe('14');
    expect(norm('14 AD')).toBe('14');
  });

  it('rejects trailing junk / unparseable', () => {
    expect(norm('not a date')).toBeNull();
    expect(norm('2026-07-04 Kickoff')).toBeNull();
    expect(norm('13/13')).toBeNull();
  });

  it('rejects invalid time', () => {
    expect(norm('2026-07-04 25:00')).toBeNull();
    expect(norm('2026-07-04 12:99')).toBeNull();
  });
});

describe('slash-order — US month-first default, dmy flip, self-disambiguation', () => {
  it('defaults to month-first (US)', () => {
    expect(norm('7/4', { year: 2026 })).toBe('2026-07-04');
    expect(norm('12/25', { year: 2026 })).toBe('2026-12-25');
  });

  it('date-order dmy flips to day-first', () => {
    expect(norm('7/4', { year: 2026, order: 'dmy' })).toBe('2026-04-07');
    expect(norm('25/12', { year: 2026, order: 'dmy' })).toBe('2026-12-25');
  });

  it('out-of-range self-disambiguates regardless of order', () => {
    expect(norm('13/2', { year: 2026 })).toBe('2026-02-13'); // 13 can't be month
    expect(norm('2/13', { year: 2026 })).toBe('2026-02-13'); // 13 can't be month
    expect(norm('13/2', { year: 2026, order: 'dmy' })).toBe('2026-02-13');
  });
});

describe('monthNameToNum', () => {
  it('full, abbreviated, dotted, cased', () => {
    expect(monthNameToNum('January')).toBe(1);
    expect(monthNameToNum('jan')).toBe(1);
    expect(monthNameToNum('Sep.')).toBe(9);
    expect(monthNameToNum('DECEMBER')).toBe(12);
    expect(monthNameToNum('xyz')).toBe(0);
  });
});

describe('resolveDates — the year ladder', () => {
  const iso = (
    tokens: (DateToken | null)[],
    opts?: Parameters<typeof resolveDates>[1]
  ) =>
    resolveDates(tokens.filter(Boolean) as DateToken[], opts).map(
      (r) => r.internal
    );

  const tok = (raw: string, order: 'mdy' | 'dmy' = 'mdy') =>
    parseDateToken(raw, { dateOrder: order })!.token;

  it('carry-forward from an explicit anchor row', () => {
    const out = iso([tok('2026-11-01'), tok('11-20'), tok('12-15')], {
      currentYear: 2099,
    });
    expect(out).toEqual(['2026-11-01', '2026-11-20', '2026-12-15']);
  });

  it('rolls over the year when a bare month-day goes backward', () => {
    const out = iso(
      [tok('2026-11-01'), tok('12-15'), tok('01-10'), tok('02-15')],
      { currentYear: 2099 }
    );
    expect(out).toEqual([
      '2026-11-01',
      '2026-12-15',
      '2027-01-10', // rolled: Jan < Dec
      '2027-02-15', // carries the rolled 2027
    ]);
  });

  it('`year` directive seeds the base year', () => {
    const out = iso([tok('2/5'), tok('9/2')], {
      directiveYear: 2026,
      currentYear: 2099,
    });
    expect(out).toEqual(['2026-02-05', '2026-09-02']);
  });

  it('prescan: a later explicit year anchors earlier bare rows', () => {
    const out = iso([tok('3/14'), tok('2026-04-01')], { currentYear: 2099 });
    expect(out).toEqual(['2026-03-14', '2026-04-01']);
  });

  it('explicit year mid-list resets the carry context', () => {
    const out = iso(
      [tok('2026-01-01'), tok('06-01'), tok('2030-01-01'), tok('02-01')],
      { currentYear: 2099 }
    );
    expect(out).toEqual([
      '2026-01-01',
      '2026-06-01',
      '2030-01-01',
      '2030-02-01', // derives from the nearest explicit (2030), not 2026
    ]);
  });

  it('falls back to current year with a hint when no year anywhere', () => {
    const res = resolveDates([tok('7/4'), tok('9/2')], { currentYear: 2026 });
    expect(res.map((r) => r.internal)).toEqual(['2026-07-04', '2026-09-02']);
    expect(res[0]!.hint).toBeDefined();
  });

  it('no-current-year makes a fully-bare chart an error', () => {
    const res = resolveDates([tok('7/4')], {
      currentYear: 2026,
      noCurrentYear: true,
    });
    expect(res[0]!.error).toBeDefined();
  });
});

describe('toInternal — round-trips grain and sign', () => {
  it('preserves grain', () => {
    expect(toInternal(parseDateToken('2026')!.token, 2026)).toBe('2026');
    expect(toInternal(parseDateToken('2026-07')!.token, 2026)).toBe('2026-07');
    expect(toInternal(parseDateToken('2026-07-04')!.token, 2026)).toBe(
      '2026-07-04'
    );
  });

  it('BCE sign', () => {
    expect(toInternal(parseDateToken('753 BCE')!.token, 0)).toBe('-753');
  });
});
