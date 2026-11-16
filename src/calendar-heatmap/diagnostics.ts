// ============================================================
// Calendar heatmap diagnostic catalog
// ============================================================
//
// Every coded diagnostic the calendar-heatmap parser emits. The parser reaches
// these through `emit(CALENDAR_HEATMAP_DX.<KEY>, line, params)`, so catalog
// consumers can list them without re-typing the wording. Every message builder
// tolerates `{}`.

import type { DiagnosticSpec } from '../diagnostics';

export const CALENDAR_HEATMAP_DX = {
  BAD_ENTRY: {
    code: 'E_CALENDAR_HEATMAP_BAD_ENTRY',
    severity: 'error',
    chartType: 'calendar-heatmap',
    title: 'Not a date and a value',
    message: (p) =>
      `'${(p.line as string) ?? 'line'}' is not a date and a value.`,
    hint: 'Write one entry per line: a date (YYYY-MM-DD, or MM-DD under `year`), a space, then a number.',
    example: `calendar-heatmap Runs\n\n2026-03-10 5.2`,
  },
  BAD_DATE: {
    code: 'E_CALENDAR_HEATMAP_BAD_DATE',
    severity: 'error',
    chartType: 'calendar-heatmap',
    title: 'Not a calendar date',
    message: (p) => `'${(p.date as string) ?? 'date'}' is not a calendar date.`,
    hint: 'Write the date as YYYY-MM-DD, for example 2026-03-10.',
    example: `calendar-heatmap Runs\n\n2026-02-30 5`,
  },
  SHORT_DATE_NO_YEAR: {
    code: 'E_CALENDAR_HEATMAP_SHORT_DATE_NO_YEAR',
    severity: 'error',
    chartType: 'calendar-heatmap',
    title: 'Short date with no year',
    message: (p) =>
      `'${(p.date as string) ?? 'MM-DD'}' has no year, and the chart sets none.`,
    hint: 'Add `year YYYY` under the first line, or write the full date YYYY-MM-DD.',
    example: `calendar-heatmap Runs\nyear 2026\n\n03-10 5`,
  },
  BAD_VALUE: {
    code: 'E_CALENDAR_HEATMAP_BAD_VALUE',
    severity: 'error',
    chartType: 'calendar-heatmap',
    title: 'Value is not a number',
    message: (p) =>
      `'${(p.value as string) ?? 'value'}' is not a number of zero or more.`,
    hint: 'Each day takes a count or an amount: 0, 3, 5.2.',
    example: `calendar-heatmap Runs\n\n2026-03-10 5.2`,
  },
  BAD_OPTION: {
    code: 'E_CALENDAR_HEATMAP_BAD_OPTION',
    severity: 'error',
    chartType: 'calendar-heatmap',
    title: 'Option value not understood',
    message: (p) =>
      `'${(p.option as string) ?? 'option'}' cannot take '${(p.value as string) ?? ''}'.`,
    hint: 'year takes YYYY, max a number above zero, week-start sunday or monday, from takes `from YYYY-MM-DD to YYYY-MM-DD`.',
    example: `calendar-heatmap Runs\nyear 2026\nweek-start monday\nmax 20`,
  },
  BAD_RANGE: {
    code: 'E_CALENDAR_HEATMAP_BAD_RANGE',
    severity: 'error',
    chartType: 'calendar-heatmap',
    title: 'Range ends before it starts',
    message: (p) =>
      `The range ends on ${(p.to as string) ?? 'its last day'}, before it starts on ${(p.from as string) ?? 'its first day'}.`,
    hint: 'Swap the two dates: `from` is the first day, `to` the last.',
    example: `calendar-heatmap Runs\nfrom 2026-09-01 to 2026-11-30`,
  },
  OUTSIDE_SPAN: {
    code: 'W_CALENDAR_HEATMAP_OUTSIDE_SPAN',
    severity: 'warning',
    chartType: 'calendar-heatmap',
    title: 'Date outside the span',
    message: (p) =>
      `${(p.date as string) ?? 'This date'} falls outside the span the chart draws, so it is left out.`,
    hint: 'Widen `year` or `from … to …`, or remove the line.',
    example: `calendar-heatmap Runs\nyear 2026\n\n2025-12-31 4`,
  },
  NO_ENTRIES: {
    code: 'E_CALENDAR_HEATMAP_NO_ENTRIES',
    severity: 'error',
    chartType: 'calendar-heatmap',
    title: 'Nothing to draw',
    message: () => 'The chart has no entries and no `year` or range to draw.',
    hint: 'Add a `date value` line, or set `year YYYY` to draw an empty year.',
    example: `calendar-heatmap Runs\n\n2026-03-10 5.2`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const CALENDAR_HEATMAP_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(CALENDAR_HEATMAP_DX);
