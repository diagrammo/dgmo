import { describe, expect, it } from 'vitest';
import {
  parseCalendar,
  dayToIso,
  resolveCalendarActiveGroup,
} from '../src/calendar/parser';
import { CALENDAR_DIAGNOSTICS } from '../src/calendar/diagnostics';

const codes = (src: string) =>
  parseCalendar(src).diagnostics.map((d) => d.code);
const iso = (n: number) => dayToIso(n);
const value = (src: string, date: string, key = 'value') =>
  parseCalendar(src).days.find((d) => d.date === date)?.numbers[key];

describe('calendar parser — numbers and the span (§41.2)', () => {
  it('reads the header and MM-DD dates under `year`', () => {
    const p = parseCalendar(`calendar Commits in 2026
year 2026
unit commit

01-02 1
2026-03-10 11
`);
    expect(p.error).toBeNull();
    expect(p.title).toBe('Commits in 2026');
    expect(p.year).toBe(2026);
    expect(iso(p.start)).toBe('2026-01-01');
    expect(iso(p.end)).toBe('2026-12-31');
    expect(p.days.map((d) => [d.date, d.numbers.value])).toEqual([
      ['2026-01-02', 1],
      ['2026-03-10', 11],
    ]);
  });

  it('forms the implied number group from bare numbers, named by `unit`', () => {
    const p = parseCalendar(
      'calendar\nyear 2026\nunit commit\nmax 20\n01-02 1'
    );
    expect(p.numberGroups).toEqual([
      expect.objectContaining({
        name: 'Commits',
        key: 'value',
        unit: 'commit',
        max: 20,
        implied: true,
      }),
    ]);
    expect(p.groups).toEqual([
      { kind: 'number', key: 'value', name: 'Commits' },
    ]);
  });

  it('adds up a date listed twice, keeping the first line', () => {
    const p = parseCalendar(`calendar
year 2026
03-10 1
03-10 2.5
2026-03-10 1
`);
    expect(p.days).toHaveLength(1);
    expect(p.days[0]!.numbers.value).toBe(4.5);
    expect(p.days[0]!.lineNumber).toBe(3);
  });

  it('reads `year` written after the entries', () => {
    const p = parseCalendar('calendar\n03-10 1\nyear 2026\n');
    expect(p.error).toBeNull();
    expect(p.days[0]!.date).toBe('2026-03-10');
  });

  it('spans the dates given when there is no year or range', () => {
    const p = parseCalendar('calendar\n2026-05-04 3\n2026-04-20 1\n');
    expect(iso(p.start)).toBe('2026-04-20');
    expect(iso(p.end)).toBe('2026-05-04');
  });

  it('`from … to …` sets exactly that range and leaves out a date outside it', () => {
    const p = parseCalendar(`calendar
year 2026
from 03-01 to 2026-05-31
2026-02-10 4
2026-03-10 2
`);
    expect(iso(p.start)).toBe('2026-03-01');
    expect(iso(p.end)).toBe('2026-05-31');
    expect(p.days.map((d) => d.date)).toEqual(['2026-03-10']);
    expect(
      codes(`calendar\nyear 2026\nfrom 03-01 to 05-31\n2026-02-10 4`)
    ).toEqual(['W_CALENDAR_OUTSIDE_SPAN']);
  });

  it('`from` alone spans one year from that day (a fiscal year)', () => {
    const p = parseCalendar('calendar\nfrom 2025-10-01\n10-05 1\n03-02 2\n');
    expect(p.error).toBeNull();
    expect(iso(p.start)).toBe('2025-10-01');
    expect(iso(p.end)).toBe('2026-09-30');
    // MM-DD is read in the span: October is 2025, March is 2026.
    expect(p.days.map((d) => d.date)).toEqual(['2025-10-05', '2026-03-02']);
  });

  it('spans the months named when only month headers are given', () => {
    const p = parseCalendar(
      'calendar\n2027-02\n  3 Kickoff\n2027-03\n  1 Review\n'
    );
    expect(iso(p.start)).toBe('2027-02-01');
    expect(iso(p.end)).toBe('2027-03-31');
  });

  it('reads week-start and the boolean options', () => {
    const p = parseCalendar(
      'calendar\nweek-start monday\nno-summary\nno-notes\norientation-horizontal\n2026-01-01 1'
    );
    expect(p.weekStart).toBe(1);
    expect(p.options['no-summary']).toBe('on');
    expect(p.options['no-notes']).toBe('on');
    expect(p.horizontal).toBe(true);
  });

  it('accepts 29 February only in a leap year', () => {
    expect(parseCalendar('calendar\n2024-02-29 1').error).toBeNull();
    expect(codes('calendar\n2026-02-29 1')).toContain('E_CALENDAR_BAD_DATE');
  });

  it('draws an empty year when `year` is set and nothing is logged', () => {
    const p = parseCalendar('calendar Quiet\nyear 2026');
    expect(p.error).toBeNull();
    expect(p.days).toEqual([]);
    expect(p.end - p.start + 1).toBe(365);
  });

  it('names the option a mistyped header word was meant to be', () => {
    const p = parseCalendar('calendar\nyaer 2026\n2026-01-01 1');
    expect(p.diagnostics[0]!.code).toBe('E_CALENDAR_BAD_ENTRY');
    expect(p.diagnostics[0]!.message).toContain('year');
  });

  it('refuses another chart type on the first line', () => {
    expect(parseCalendar('heatmap\n2026-01-01 1').error).toContain('calendar');
  });

  it('refuses the removed calendar-heatmap keyword', () => {
    expect(
      parseCalendar('calendar-heatmap\n2026-01-01 1').error
    ).not.toBeNull();
  });
});

describe('calendar parser — layout and options (§41.3, §41.7)', () => {
  it('defaults to weeks, or to month when any entry is an event', () => {
    expect(parseCalendar('calendar\n2026-01-01 1').layout).toBe('weeks');
    expect(parseCalendar('calendar\n2026-01-01 Dentist').layout).toBe('month');
  });

  it('reads an explicit layout over the default', () => {
    for (const l of ['weeks', 'months', 'month'] as const)
      expect(
        parseCalendar(`calendar\nlayout ${l}\n2026-01-01 Dentist`).layout
      ).toBe(l);
  });

  it('reads months-per-row 1–6 and warns outside it', () => {
    expect(
      parseCalendar('calendar\nmonths-per-row 3\nyear 2026').monthsPerRow
    ).toBe(3);
    const p = parseCalendar('calendar\nmonths-per-row 9\nyear 2026');
    expect(p.monthsPerRow).toBeUndefined();
    expect(p.error).toBeNull();
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_CALENDAR_MONTHS_PER_ROW',
    ]);
  });

  it('reads `empty`, the fill family and `active-tag`', () => {
    const p = parseCalendar(
      'calendar\nempty Free\nfill-solid\nactive-tag none\nyear 2026'
    );
    expect(p.emptyLabel).toBe('Free');
    expect(p.fillMode).toBe('solid');
    expect(p.options['active-tag']).toBe('none');
    expect(parseCalendar('calendar\nyear 2026').emptyLabel).toBe('Not logged');
  });

  it('warns on an `active-tag` that names no group', () => {
    expect(
      codes('calendar\nyear 2026\ntag Mood\n  Great\nactive-tag Moood')
    ).toEqual(['W_ACTIVE_TAG_NO_MATCH']);
    // A number group's name or an alias is a group too.
    expect(
      codes(
        'calendar\nyear 2026\nheat Commits as c\ntag Mood as m\n  Great\nactive-tag c'
      )
    ).toEqual([]);
  });
});

describe('calendar parser — groups (§41.5)', () => {
  const HABITS = `calendar Habits
year 2027
heat Commits as c
  unit commit
  max 20
heat Pages as p
tag Mood as m
  Great green
  Ok blue
  Rough red
`;

  it('reads heat groups with `as`, indented unit and max, and ramp colours', () => {
    const p = parseCalendar(`${HABITS}heat Runs as r blue red\n01-01 c: 1`);
    expect(
      p.numberGroups.map((g) => [g.name, g.alias, g.unit, g.max, g.low, g.high])
    ).toEqual([
      ['Commits', 'c', 'commit', 20, undefined, undefined],
      ['Pages', 'p', undefined, undefined, undefined, undefined],
      ['Runs', 'r', undefined, undefined, 'blue', 'red'],
    ]);
    expect(p.groups.map((g) => `${g.kind}:${g.name}`)).toEqual([
      'number:Commits',
      'number:Pages',
      'tag:Mood',
      'number:Runs',
    ]);
  });

  it('reads `alias: value` marks, by alias or by canonical name', () => {
    const p = parseCalendar(
      `${HABITS}01-05 c: 3, m: Great\n01-06 commits: 2, mood: rough\n`
    );
    expect(p.error).toBeNull();
    expect(p.days.map((d) => [d.date, d.numbers, d.tags])).toEqual([
      ['2027-01-05', { commits: 3 }, { mood: 'Great' }],
      ['2027-01-06', { commits: 2 }, { mood: 'Rough' }],
    ]);
  });

  it('merges separate lines for one date: numbers add, tags join', () => {
    const p = parseCalendar(
      `${HABITS}01-07 c: 11\n01-07 m: Rough\n01-07 c: 1\n`
    );
    expect(p.days).toEqual([
      expect.objectContaining({
        date: '2027-01-07',
        numbers: { commits: 12 },
        tags: { mood: 'Rough' },
        lineNumber: 11,
      }),
    ]);
  });

  it('a tag written twice takes the later line, with a warning', () => {
    const p = parseCalendar(`${HABITS}01-07 m: Great\n01-07 m: Rough\n`);
    expect(p.days[0]!.tags.mood).toBe('Rough');
    expect(p.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['W_CALENDAR_DUPLICATE_TAG_DAY', 12],
    ]);
  });

  it('a group first value is not a default: a blank day has no tag', () => {
    const p = parseCalendar(`${HABITS}01-07 c: 1\n`);
    expect(p.days[0]!.tags).toEqual({});
    expect(p.tagGroups[0]!.defaultValue).toBeUndefined();
  });

  it('reads a range of marks onto every day of it', () => {
    const p = parseCalendar(`${HABITS}01-30 -> 02-02 m: Ok\n`);
    expect(p.days.map((d) => d.date)).toEqual([
      '2027-01-30',
      '2027-01-31',
      '2027-02-01',
      '2027-02-02',
    ]);
  });

  it('reads the bare shorthand when the chart declares one group', () => {
    const one = `calendar\nyear 2026\ntag Mood\n  Great\n  Rough\n`;
    expect(parseCalendar(`${one}01-02 great`).days[0]!.tags.mood).toBe('Great');
    const heat = `calendar\nyear 2026\nheat Runs as r\n`;
    expect(value(`${heat}01-02 8`, '2026-01-02', 'runs')).toBe(8);
  });

  it('a declared tag value wins over a number in the shorthand', () => {
    const p = parseCalendar(
      'calendar\nyear 2026\ntag Stars\n  1\n  5 stars\n\n01-01 1\n01-02 5 stars'
    );
    expect(p.days.map((d) => d.tags.stars)).toEqual(['1', '5 stars']);
    expect(p.numberGroups).toEqual([]);
  });

  it('with two or more groups a bare tag value is an event, not a mark', () => {
    const p = parseCalendar(`${HABITS}01-02 Great`);
    expect(p.days).toEqual([]);
    expect(p.events.map((e) => e.name)).toEqual(['Great']);
  });

  it('a bare number with one heat group and tag groups goes to that group', () => {
    const src = `calendar\nyear 2026\nheat Runs as r\ntag Mood as m\n  Great\n01-02 4`;
    expect(value(src, '2026-01-02', 'runs')).toBe(4);
  });

  it('refuses a bare number when two number groups exist', () => {
    expect(codes(`${HABITS}01-02 4`)).toEqual(['E_CALENDAR_AMBIGUOUS_NUMBER']);
  });

  it('refuses a tag value its group does not declare, and suggests the near one', () => {
    const p = parseCalendar(`${HABITS}01-02 m: Graet`);
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'E_CALENDAR_UNKNOWN_TAG',
    ]);
    expect(p.diagnostics[0]!.message).toContain('Great');
  });

  it('refuses a number group value that is not a number', () => {
    expect(codes(`${HABITS}01-02 c: lots`)).toEqual(['E_CALENDAR_BAD_VALUE']);
  });

  it('reads tag entries written before their tag group', () => {
    const p = parseCalendar(
      'calendar\nyear 2026\n01-01 Great\ntag Mood\n  Great green\n'
    );
    expect(p.error).toBeNull();
    expect(p.days[0]!.tags.mood).toBe('Great');
  });

  it('resolves the open group: override, then active-tag, then the first', () => {
    const p = parseCalendar(`${HABITS}active-tag m\n01-01 c: 1`);
    expect(resolveCalendarActiveGroup(p)?.name).toBe('Mood');
    expect(resolveCalendarActiveGroup(p, 'Pages')?.name).toBe('Pages');
    expect(resolveCalendarActiveGroup(p, null)).toBeNull();
    const q = parseCalendar(`${HABITS}01-01 c: 1`);
    expect(resolveCalendarActiveGroup(q)?.name).toBe('Commits');
    const none = parseCalendar(`${HABITS}active-tag none\n01-01 c: 1`);
    expect(resolveCalendarActiveGroup(none)).toBeNull();
  });
});

describe('calendar parser — events, ranges, month blocks, notes (§41.4)', () => {
  const MOOD = `calendar\nyear 2027\ntag Mood as m\n  Great green\n  Rough red\ntag Kind as k\n  Health\n`;

  it('reads text then metadata as an event with tags', () => {
    const p = parseCalendar(`${MOOD}03-10 Dentist m: Rough, k: Health`);
    expect(p.events).toEqual([
      {
        name: 'Dentist',
        start: p.events[0]!.start,
        end: p.events[0]!.start,
        tags: { mood: 'Rough', kind: 'Health' },
        notes: [],
        lineNumber: 8,
      },
    ]);
    expect(iso(p.events[0]!.start)).toBe('2027-03-10');
  });

  it('reads `a -> b` ranges as events', () => {
    const p = parseCalendar(`${MOOD}07-04 -> 07-18 Vacation`);
    expect(p.events.map((e) => [iso(e.start), iso(e.end), e.name])).toEqual([
      ['2027-07-04', '2027-07-18', 'Vacation'],
    ]);
  });

  it('refuses a range that ends before it starts', () => {
    expect(codes(`${MOOD}07-18 -> 07-04 Vacation`)).toEqual([
      'E_CALENDAR_END_BEFORE_START',
    ]);
  });

  it('reads month blocks: day numbers, ranges, and a range into the next month', () => {
    const p = parseCalendar(`calendar Team
2027-01
  5 Kickoff
  18 -> 20 Offsite
  29 -> 02-02 Trip
2027-12
  30 -> 01-02 New year
`);
    expect(p.error).toBeNull();
    expect(p.events.map((e) => [e.name, iso(e.start), iso(e.end)])).toEqual([
      ['Kickoff', '2027-01-05', '2027-01-05'],
      ['Offsite', '2027-01-18', '2027-01-20'],
      ['Trip', '2027-01-29', '2027-02-02'],
      // Clipped to the span the headers name.
      ['New year', '2027-12-30', '2027-12-31'],
    ]);
  });

  it('refuses a day number past the end of its month', () => {
    const p = parseCalendar('calendar\n2027-02\n  29 Offsite');
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'E_CALENDAR_DAY_OUTSIDE_MONTH',
    ]);
    expect(p.diagnostics[0]!.message).toContain('28 days');
  });

  it('keeps indented lines under an event as notes, and `alias: value` as tags', () => {
    const p = parseCalendar(`${MOOD}2027-09
  18 -> 20 Offsite
    Agenda in the **wiki**
    m: Great
    Bring a laptop
`);
    expect(p.events[0]!.notes).toEqual([
      'Agenda in the **wiki**',
      'Bring a laptop',
    ]);
    expect(p.events[0]!.tags).toEqual({ mood: 'Great' });
  });

  it('reads notes under a flat event too', () => {
    const p = parseCalendar(`${MOOD}03-10 Dentist\n  Bring the card`);
    expect(p.events[0]!.notes).toEqual(['Bring the card']);
  });

  it('refuses a number-group value on an event line', () => {
    expect(
      codes('calendar\nyear 2027\nheat Commits as c\n\n03-10 Release c: 2')
    ).toEqual(['E_CALENDAR_NUMBER_ON_EVENT']);
  });

  it('warns when an event name is one edit from a tag value under the shorthand', () => {
    const p = parseCalendar(
      'calendar\nyear 2026\ntag Mood\n  Great\n  Rough\n\n01-01 Graet\n01-02 Lunch'
    );
    expect(p.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['W_CALENDAR_NAME_LIKE_TAG', 7],
    ]);
    expect(p.events.map((e) => e.name)).toEqual(['Graet', 'Lunch']);
  });

  it('stacks events on one date without a diagnostic', () => {
    const p = parseCalendar(
      `${MOOD}03-10 Dentist\n03-10 Lunch\n03-10 m: Great`
    );
    expect(p.error).toBeNull();
    expect(p.diagnostics).toEqual([]);
    expect(p.events).toHaveLength(2);
    expect(p.days[0]!.tags.mood).toBe('Great');
  });

  it('leaves out an event wholly outside the span, and clips one across it', () => {
    const p = parseCalendar(
      'calendar\nyear 2027\n2026-12-20 -> 2026-12-24 Old\n2026-12-30 -> 2027-01-03 Trip'
    );
    expect(p.diagnostics.map((d) => d.code)).toEqual([
      'W_CALENDAR_OUTSIDE_SPAN',
    ]);
    expect(p.events.map((e) => [e.name, iso(e.start), iso(e.end)])).toEqual([
      ['Trip', '2027-01-01', '2027-01-03'],
    ]);
  });
});

describe('calendar diagnostics (§41.8)', () => {
  it.each([
    [
      'an MM-DD date with no year',
      'calendar\n03-10 1',
      'E_CALENDAR_SHORT_DATE_NO_YEAR',
    ],
    [
      'a date that does not exist',
      'calendar\n2026-13-01 1',
      'E_CALENDAR_BAD_DATE',
    ],
    ['a negative value', 'calendar\n2026-03-10 -2', 'E_CALENDAR_BAD_VALUE'],
    [
      'a date with nothing after it',
      'calendar\n2026-03-10',
      'E_CALENDAR_BAD_ENTRY',
    ],
    [
      'a line that is not an entry',
      'calendar\nRan a lot',
      'E_CALENDAR_BAD_ENTRY',
    ],
    ['a bad year', 'calendar\nyear 26\n2026-01-01 1', 'E_CALENDAR_BAD_OPTION'],
    ['max of zero', 'calendar\nmax 0\n2026-01-01 1', 'E_CALENDAR_BAD_OPTION'],
    [
      'an unknown week-start',
      'calendar\nweek-start friday\n2026-01-01 1',
      'E_CALENDAR_BAD_OPTION',
    ],
    [
      'an unknown line under heat',
      'calendar\nheat Runs\n  colour red\n2026-01-01 1',
      'E_CALENDAR_BAD_OPTION',
    ],
    [
      'a span that ends before it starts',
      'calendar\nfrom 2026-05-01 to 2026-04-01\n2026-04-10 1',
      'E_CALENDAR_BAD_RANGE',
    ],
    [
      'an unknown layout',
      'calendar\nlayout grid\n2026-01-01 1',
      'E_CALENDAR_BAD_LAYOUT',
    ],
    ['no entries and no span', 'calendar Empty', 'E_CALENDAR_NO_ENTRIES'],
    [
      'a note under a mark',
      'calendar\nyear 2026\n01-01 3\n  a note',
      'E_CALENDAR_BAD_ENTRY',
    ],
  ])('reports %s', (_name, src, code) => {
    const p = parseCalendar(src);
    expect(p.diagnostics.map((d) => d.code)).toContain(code);
    expect(p.error).not.toBeNull();
  });

  it('every catalog example fires its own code', () => {
    for (const spec of CALENDAR_DIAGNOSTICS)
      expect(codes(spec.example!), spec.code).toContain(spec.code);
  });

  it('every code is E_CALENDAR_* or W_CALENDAR_*, and MIXED_ENTRIES is gone', () => {
    for (const spec of CALENDAR_DIAGNOSTICS)
      expect(spec.code).toMatch(/^[EW]_CALENDAR_[A-Z_]+$/);
    expect(CALENDAR_DIAGNOSTICS.map((d) => d.code)).not.toContain(
      'E_CALENDAR_MIXED_ENTRIES'
    );
  });
});
