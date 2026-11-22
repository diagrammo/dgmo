// ============================================================
// Calendar heatmap diagnostic catalog
// ============================================================
//
// Every coded diagnostic the calendar parser emits. The parser reaches
// these through `emit(CALENDAR_DX.<KEY>, line, params)`, so catalog
// consumers can list them without re-typing the wording. Every message builder
// tolerates `{}`.

import type { DiagnosticSpec } from '../diagnostics';

export const CALENDAR_DX = {
  BAD_ENTRY: {
    code: 'E_CALENDAR_BAD_ENTRY',
    severity: 'error',
    chartType: 'calendar',
    title: 'Not a date and a value',
    message: (p) =>
      `'${(p.line as string) ?? 'line'}' is not a date and a value.`,
    hint: 'Write one entry per line: a date (YYYY-MM-DD, or MM-DD under `year`), a space, then a number.',
    example: `calendar Runs\n\n2026-03-10 5.2`,
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
    hint: 'Add `year YYYY` under the first line, or write the full date YYYY-MM-DD.',
    example: `calendar Runs\nyear 2026\n\n03-10 5`,
  },
  BAD_VALUE: {
    code: 'E_CALENDAR_BAD_VALUE',
    severity: 'error',
    chartType: 'calendar',
    title: 'Value is not a number',
    message: (p) =>
      `'${(p.value as string) ?? 'value'}' is not a number of zero or more.`,
    hint: 'Each day takes a count or an amount: 0, 3, 5.2.',
    example: `calendar Runs\n\n2026-03-10 5.2`,
  },
  BAD_OPTION: {
    code: 'E_CALENDAR_BAD_OPTION',
    severity: 'error',
    chartType: 'calendar',
    title: 'Option value not understood',
    message: (p) =>
      `'${(p.option as string) ?? 'option'}' cannot take '${(p.value as string) ?? ''}'.`,
    hint: 'year takes YYYY, max a number above zero, week-start sunday or monday, from takes `from YYYY-MM-DD to YYYY-MM-DD`.',
    example: `calendar Runs\nyear 2026\nweek-start monday\nmax 20`,
  },
  BAD_RANGE: {
    code: 'E_CALENDAR_BAD_RANGE',
    severity: 'error',
    chartType: 'calendar',
    title: 'Range ends before it starts',
    message: (p) =>
      `The range ends on ${(p.to as string) ?? 'its last day'}, before it starts on ${(p.from as string) ?? 'its first day'}.`,
    hint: 'Swap the two dates: `from` is the first day, `to` the last.',
    example: `calendar Runs\nfrom 2026-09-01 to 2026-11-30`,
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
      `'${(p.tag as string) ?? 'value'}' is not a value of any tag group.${p.hint ? ` ${p.hint as string}` : ''}`,
    hint: 'Indent the value under its `tag` group, or fix the spelling.',
    example: `calendar Mood\nyear 2026\ntag Mood\n  Great green\n  Rough red\n\n01-01 Great`,
  },
  MIXED_ENTRIES: {
    code: 'E_CALENDAR_MIXED_ENTRIES',
    severity: 'error',
    chartType: 'calendar',
    title: 'Numbers and tags mixed',
    message: () =>
      'This chart has both number entries and tag entries; use one or the other.',
    hint: 'Give every day a number, or give every day a tag value from a `tag` group.',
    example: `calendar Mood\nyear 2026\ntag Mood\n  Great green\n\n01-01 Great\n01-02 Great`,
  },
  DUPLICATE_TAG_DAY: {
    code: 'W_CALENDAR_DUPLICATE_TAG_DAY',
    severity: 'warning',
    chartType: 'calendar',
    title: 'Day tagged twice',
    message: (p) =>
      `${(p.date as string) ?? 'This date'} is tagged twice; the later line wins.`,
    hint: 'Remove one of the two lines for this date.',
    example: `calendar Mood\nyear 2026\ntag Mood\n  Great green\n  Rough red\n\n01-01 Great\n01-01 Rough`,
  },
  NO_ENTRIES: {
    code: 'E_CALENDAR_NO_ENTRIES',
    severity: 'error',
    chartType: 'calendar',
    title: 'Nothing to draw',
    message: () => 'The chart has no entries and no `year` or range to draw.',
    hint: 'Add a `date value` line, or set `year YYYY` to draw an empty year.',
    example: `calendar Runs\n\n2026-03-10 5.2`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const CALENDAR_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(CALENDAR_DX);
