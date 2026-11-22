// ============================================================
// Calendar diagnostic catalog (§41.8)
// ============================================================
//
// Every coded diagnostic the calendar parser emits. The parser reaches these
// through `emit(CALENDAR_DX.<KEY>, line, params)`, so catalog consumers can
// list them without re-typing the wording. Every message builder tolerates
// `{}`.

import type { DiagnosticSpec } from '../diagnostics';

export const CALENDAR_DX = {
  BAD_ENTRY: {
    code: 'E_CALENDAR_BAD_ENTRY',
    severity: 'error',
    chartType: 'calendar',
    title: 'Not a dated entry',
    message: (p) => `'${(p.line as string) ?? 'line'}' is not a dated entry.`,
    hint: 'Start the line with a date (YYYY-MM-DD, MM-DD under `year`, or a day number under a YYYY-MM header), then marks or an event name. Notes go under an event.',
    example: `calendar Runs\n\n2026-03-10`,
  },
  BAD_DATE: {
    code: 'E_CALENDAR_BAD_DATE',
    severity: 'error',
    chartType: 'calendar',
    title: 'Not a calendar date',
    message: (p) => `'${(p.date as string) ?? 'date'}' is not a calendar date.`,
    hint: 'Write the date as YYYY-MM-DD, for example 2026-03-10.',
    example: `calendar Runs\n\n2026-02-30 5`,
  },
  SHORT_DATE_NO_YEAR: {
    code: 'E_CALENDAR_SHORT_DATE_NO_YEAR',
    severity: 'error',
    chartType: 'calendar',
    title: 'Short date with no year',
    message: (p) =>
      `'${(p.date as string) ?? 'MM-DD'}' has no year, and the chart sets none.`,
    hint: 'Add `year YYYY` or `from YYYY-MM-DD` under the first line, or write the full date YYYY-MM-DD.',
    example: `calendar Runs\n\n03-10 5`,
  },
  BAD_VALUE: {
    code: 'E_CALENDAR_BAD_VALUE',
    severity: 'error',
    chartType: 'calendar',
    title: 'Value is not a number',
    message: (p) =>
      `'${(p.value as string) ?? 'value'}' is not a number of zero or more.`,
    hint: 'A number group takes a count or an amount: 0, 3, 5.2.',
    example: `calendar Runs\n\n2026-03-10 -3`,
  },
  BAD_OPTION: {
    code: 'E_CALENDAR_BAD_OPTION',
    severity: 'error',
    chartType: 'calendar',
    title: 'Option value not understood',
    message: (p) =>
      `'${(p.option as string) ?? 'option'}' cannot take '${(p.value as string) ?? ''}'.`,
    hint: 'year takes YYYY, max a number above zero, week-start sunday or monday, from takes `from YYYY-MM-DD [to YYYY-MM-DD]`; under `heat` only `unit` and `max` are allowed.',
    example: `calendar Runs\nweek-start friday\n\n2026-03-10 5`,
  },
  BAD_RANGE: {
    code: 'E_CALENDAR_BAD_RANGE',
    severity: 'error',
    chartType: 'calendar',
    title: 'Span ends before it starts',
    message: (p) =>
      `The span ends on ${(p.to as string) || 'its last day'}, before it starts on ${(p.from as string) ?? 'its first day'}.`,
    hint: 'Swap the two dates: `from` is the first day, `to` the last.',
    example: `calendar Runs\nfrom 2026-11-30 to 2026-09-01`,
  },
  END_BEFORE_START: {
    code: 'E_CALENDAR_END_BEFORE_START',
    severity: 'error',
    chartType: 'calendar',
    title: 'Range ends before it starts',
    message: (p) =>
      `The range ends on ${(p.to as string) ?? 'its last day'}, before it starts on ${(p.from as string) ?? 'its first day'}.`,
    hint: 'Write the first day before `->` and the last day after it.',
    example: `calendar Trips\nyear 2026\n\n07-18 -> 07-04 Vacation`,
  },
  OUTSIDE_SPAN: {
    code: 'W_CALENDAR_OUTSIDE_SPAN',
    severity: 'warning',
    chartType: 'calendar',
    title: 'Date outside the span',
    message: (p) =>
      `${(p.date as string) ?? 'This date'} falls outside the span the chart draws, so it is left out.`,
    hint: 'Widen `year` or `from … to …`, or remove the line.',
    example: `calendar Runs\nyear 2026\n\n2025-12-31 4`,
  },
  UNKNOWN_TAG: {
    code: 'E_CALENDAR_UNKNOWN_TAG',
    severity: 'error',
    chartType: 'calendar',
    title: 'Tag value not declared',
    message: (p) =>
      `'${(p.tag as string) ?? 'value'}' is not a value of that tag group.${p.hint ? ` ${p.hint as string}` : ''}`,
    hint: 'Indent the value under its `tag` group, or fix the spelling.',
    example: `calendar Mood\nyear 2026\ntag Mood as m\n  Great green\n  Rough red\n\n01-01 m: Greta`,
  },
  DUPLICATE_TAG_DAY: {
    code: 'W_CALENDAR_DUPLICATE_TAG_DAY',
    severity: 'warning',
    chartType: 'calendar',
    title: 'Day tagged twice',
    message: (p) =>
      `${(p.date as string) ?? 'This date'} is tagged twice in one group; the later line wins.`,
    hint: 'Remove one of the two lines for this date.',
    example: `calendar Mood\nyear 2026\ntag Mood\n  Great green\n  Rough red\n\n01-01 Great\n01-01 Rough`,
  },
  NO_ENTRIES: {
    code: 'E_CALENDAR_NO_ENTRIES',
    severity: 'error',
    chartType: 'calendar',
    title: 'Nothing to draw',
    message: () =>
      'The chart has no entries and no `year`, `from` or month header to draw.',
    hint: 'Add a dated line, or set `year YYYY` to draw an empty year.',
    example: `calendar Runs\nunit km`,
  },
  AMBIGUOUS_NUMBER: {
    code: 'E_CALENDAR_AMBIGUOUS_NUMBER',
    severity: 'error',
    chartType: 'calendar',
    title: 'Bare number with several number groups',
    message: (p) =>
      `'${(p.value as string) ?? 'number'}' has no group, and the chart has several number groups${p.groups ? ` (${p.groups as string})` : ''}.`,
    hint: 'Name the group: `c: 3`.',
    example: `calendar Log\nyear 2026\nheat Commits as c\nheat Reviews as r\n\n01-05 3`,
  },
  NUMBER_ON_EVENT: {
    code: 'E_CALENDAR_NUMBER_ON_EVENT',
    severity: 'error',
    chartType: 'calendar',
    title: 'Number on an event',
    message: (p) =>
      `'${(p.value as string) ?? 'number'}' is a number on an event line; numbers are marks only.`,
    hint: 'Put the number on a line of its own for that date: `03-10 c: 2`.',
    example: `calendar Log\nyear 2026\nheat Commits as c\n\n03-10 Release c: 2`,
  },
  DAY_OUTSIDE_MONTH: {
    code: 'E_CALENDAR_DAY_OUTSIDE_MONTH',
    severity: 'error',
    chartType: 'calendar',
    title: 'Day past the end of its month',
    message: (p) =>
      `Day ${(p.day as string) ?? ''} is past the end of ${(p.month as string) || 'its month'}${p.max ? `, which has ${String(p.max)} days` : ''}.`,
    hint: 'Use a day the month has, or write the full date.',
    example: `calendar Team\n\n2027-02\n  30 Offsite`,
  },
  BAD_LAYOUT: {
    code: 'E_CALENDAR_BAD_LAYOUT',
    severity: 'error',
    chartType: 'calendar',
    title: 'Layout not understood',
    message: (p) => `'layout' cannot take '${(p.value as string) ?? ''}'.`,
    hint: 'Write `layout weeks`, `layout months` or `layout month`.',
    example: `calendar Runs\nyear 2026\nlayout grid`,
  },
  MONTHS_PER_ROW: {
    code: 'W_CALENDAR_MONTHS_PER_ROW',
    severity: 'warning',
    chartType: 'calendar',
    title: 'Months per row out of range',
    message: (p) =>
      `'months-per-row' takes 1 to 6, not '${(p.value as string) ?? ''}'; the default is used.`,
    hint: 'Write a whole number from 1 to 6.',
    example: `calendar Team\nyear 2026\nlayout month\nmonths-per-row 9`,
  },
  NAME_LIKE_TAG: {
    code: 'W_CALENDAR_NAME_LIKE_TAG',
    severity: 'warning',
    chartType: 'calendar',
    title: 'Event name looks like a tag value',
    message: (p) =>
      `'${(p.name as string) ?? 'name'}' became an event; did you mean the tag value '${(p.tag as string) ?? ''}'?`,
    hint: 'Fix the spelling to mark the day, or keep it as an event name.',
    example: `calendar Mood\nyear 2026\ntag Mood\n  Great green\n  Rough red\n\n01-01 Greet`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const CALENDAR_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(CALENDAR_DX);
