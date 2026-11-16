import { describe, expect, it } from 'vitest';
import { parseCalendarHeatmap, dayToIso } from '../src/calendar-heatmap/parser';

const codes = (src: string) =>
  parseCalendarHeatmap(src).diagnostics.map((d) => d.code);

describe('calendar-heatmap parser (#1855)', () => {
  it('reads the header and MM-DD dates under `year`', () => {
    const p = parseCalendarHeatmap(`calendar-heatmap Commits in 2026
year 2026
unit commit

01-02 1
2026-03-10 11
`);
    expect(p.error).toBeNull();
    expect(p.title).toBe('Commits in 2026');
    expect(p.unit).toBe('commit');
    expect(p.year).toBe(2026);
    expect(dayToIso(p.start)).toBe('2026-01-01');
    expect(dayToIso(p.end)).toBe('2026-12-31');
    expect(p.days.map((d) => [d.date, d.value])).toEqual([
      ['2026-01-02', 1],
      ['2026-03-10', 11],
    ]);
  });

  it('adds up a date listed twice, keeping the first line', () => {
    const p = parseCalendarHeatmap(`calendar-heatmap
year 2026
03-10 1
03-10 2.5
2026-03-10 1
`);
    expect(p.days).toHaveLength(1);
    expect(p.days[0]!.value).toBe(4.5);
    expect(p.days[0]!.lineNumber).toBe(3);
  });

  it('reads `year` written after the entries', () => {
    const p = parseCalendarHeatmap(`calendar-heatmap
03-10 1
year 2026
`);
    expect(p.error).toBeNull();
    expect(p.days[0]!.date).toBe('2026-03-10');
  });

  it('spans the dates given when there is no year or range', () => {
    const p = parseCalendarHeatmap(`calendar-heatmap
2026-05-04 3
2026-04-20 1
`);
    expect(dayToIso(p.start)).toBe('2026-04-20');
    expect(dayToIso(p.end)).toBe('2026-05-04');
  });

  it('trims the span to `from … to …` and leaves out a date outside it', () => {
    const p = parseCalendarHeatmap(`calendar-heatmap
year 2026
from 09-01 to 2026-11-30
08-31 4
09-02 6
`);
    expect(dayToIso(p.start)).toBe('2026-09-01');
    expect(dayToIso(p.end)).toBe('2026-11-30');
    expect(p.days.map((d) => d.date)).toEqual(['2026-09-02']);
    expect(p.error).toBeNull();
    expect(
      codes('calendar-heatmap\nyear 2026\nfrom 09-01 to 11-30\n08-31 4')
    ).toEqual(['W_CALENDAR_HEATMAP_OUTSIDE_SPAN']);
  });

  it('a date outside `year` is left out with a warning', () => {
    expect(codes('calendar-heatmap\nyear 2026\n2025-12-31 4\n01-01 1')).toEqual(
      ['W_CALENDAR_HEATMAP_OUTSIDE_SPAN']
    );
  });

  it('reads week-start and max', () => {
    const p = parseCalendarHeatmap(
      'calendar-heatmap\nweek-start monday\nmax 20\n2026-01-01 1'
    );
    expect(p.weekStart).toBe(1);
    expect(p.max).toBe(20);
    expect(
      parseCalendarHeatmap('calendar-heatmap\n2026-01-01 1').weekStart
    ).toBe(0);
  });

  it('turns on the boolean options', () => {
    const p = parseCalendarHeatmap(
      'calendar-heatmap\nno-summary\nno-legend\n2026-01-01 1'
    );
    expect(p.options['no-summary']).toBe('on');
    expect(p.options['no-legend']).toBe('on');
  });

  it('accepts 29 February only in a leap year', () => {
    expect(
      parseCalendarHeatmap('calendar-heatmap\n2028-02-29 1').error
    ).toBeNull();
    expect(codes('calendar-heatmap\n2026-02-29 1')).toEqual([
      'E_CALENDAR_HEATMAP_BAD_DATE',
    ]);
  });

  it('draws an empty year when `year` is set and nothing is logged', () => {
    const p = parseCalendarHeatmap('calendar-heatmap Quiet\nyear 2026');
    expect(p.error).toBeNull();
    expect(p.days).toEqual([]);
    expect(p.end - p.start + 1).toBe(365);
  });

  it.each([
    [
      'an MM-DD date with no year',
      'calendar-heatmap\n03-10 1',
      'E_CALENDAR_HEATMAP_SHORT_DATE_NO_YEAR',
    ],
    [
      'a date that does not exist',
      'calendar-heatmap\n2026-13-01 1',
      'E_CALENDAR_HEATMAP_BAD_DATE',
    ],
    [
      'a value that is not a number',
      'calendar-heatmap\n2026-03-10 lots',
      'E_CALENDAR_HEATMAP_BAD_VALUE',
    ],
    [
      'a negative value',
      'calendar-heatmap\n2026-03-10 -2',
      'E_CALENDAR_HEATMAP_BAD_VALUE',
    ],
    [
      'a date with no value',
      'calendar-heatmap\n2026-03-10',
      'E_CALENDAR_HEATMAP_BAD_ENTRY',
    ],
    [
      'a line that is not an entry',
      'calendar-heatmap\nRan a lot',
      'E_CALENDAR_HEATMAP_BAD_ENTRY',
    ],
    [
      'a bad year',
      'calendar-heatmap\nyear 26\n2026-01-01 1',
      'E_CALENDAR_HEATMAP_BAD_OPTION',
    ],
    [
      'max of zero',
      'calendar-heatmap\nmax 0\n2026-01-01 1',
      'E_CALENDAR_HEATMAP_BAD_OPTION',
    ],
    [
      'an unknown week-start',
      'calendar-heatmap\nweek-start friday\n2026-01-01 1',
      'E_CALENDAR_HEATMAP_BAD_OPTION',
    ],
    [
      'a range with no `to`',
      'calendar-heatmap\nfrom 2026-01-01\n2026-01-01 1',
      'E_CALENDAR_HEATMAP_BAD_OPTION',
    ],
    [
      'a range that ends before it starts',
      'calendar-heatmap\nfrom 2026-05-01 to 2026-04-01\n2026-04-10 1',
      'E_CALENDAR_HEATMAP_BAD_RANGE',
    ],
    [
      'no entries and no span',
      'calendar-heatmap Empty',
      'E_CALENDAR_HEATMAP_NO_ENTRIES',
    ],
  ])('reports %s', (_name, src, code) => {
    const p = parseCalendarHeatmap(src);
    expect(p.diagnostics.map((d) => d.code)).toContain(code);
    expect(p.error).not.toBeNull();
  });

  it('names the option a mistyped header word was meant to be', () => {
    const p = parseCalendarHeatmap('calendar-heatmap\nyaer 2026\n2026-01-01 1');
    expect(p.diagnostics[0]!.code).toBe('E_CALENDAR_HEATMAP_BAD_ENTRY');
    expect(p.diagnostics[0]!.message).toContain('year');
  });

  it('refuses another chart type on the first line', () => {
    expect(parseCalendarHeatmap('heatmap\n2026-01-01 1').error).toContain(
      'calendar-heatmap'
    );
  });
});
