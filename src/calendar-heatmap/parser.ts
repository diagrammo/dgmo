// ============================================================
// Calendar heatmap parser — one `date value` per line (#1855)
// ============================================================
//
//   calendar-heatmap Commits in 2026
//   year 2026
//   unit commit
//
//   01-02 1
//   2026-03-10 11
//
// Header options: `year YYYY`, `unit <noun>`, `from YYYY-MM-DD to YYYY-MM-DD`,
// `week-start monday`, `max N`, `no-summary`. A date is `YYYY-MM-DD`, or
// `MM-DD` when `year` is set. A date not listed is zero; a date listed twice
// adds up. The span is `year`, trimmed by `from … to …`; with neither, the
// dates given.

import { emit, formatDgmoError, makeFail, suggest } from '../diagnostics';
import type {
  DgmoError,
  DiagnosticParams,
  DiagnosticSpec,
} from '../diagnostics';
import type { Writable } from '../utils/brand';
import { parseChartFrameLine } from '../utils/chart-frame-parse';
import { parseFirstLine } from '../utils/parsing';
import { CALENDAR_HEATMAP_DX } from './diagnostics';
import type {
  CalendarHeatmapDay,
  DayNumber,
  ParsedCalendarHeatmap,
} from './types';

const MS_PER_DAY = 86_400_000;

const BOOLEAN_OPTIONS = new Set([
  'no-summary',
  'no-title',
  'no-legend',
  'legend-inline',
]);
const VALUE_OPTIONS = new Set(['palette']);
const OPTION_WORDS = [
  'year',
  'unit',
  'from',
  'week-start',
  'max',
  ...BOOLEAN_OPTIONS,
  ...VALUE_OPTIONS,
];

const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHORT_DATE_RE = /^(\d{2})-(\d{2})$/;
const NUMBER_RE = /^[+]?(\d+(\.\d*)?|\.\d+)$/;

/** UTC day number of a calendar date, or null when the date does not exist. */
function dayNumber(year: number, month: number, day: number): DayNumber | null {
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

/** `YYYY-MM-DD` for a UTC day number. */
export function dayToIso(day: DayNumber): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

type DateRead =
  | { kind: 'ok'; day: DayNumber }
  | { kind: 'not-date' }
  | { kind: 'bad-date' }
  | { kind: 'no-year' };

function readDate(token: string, year: number | undefined): DateRead {
  const full = FULL_DATE_RE.exec(token);
  if (full) {
    const day = dayNumber(+full[1]!, +full[2]!, +full[3]!);
    return day === null ? { kind: 'bad-date' } : { kind: 'ok', day };
  }
  const short = SHORT_DATE_RE.exec(token);
  if (short) {
    if (year === undefined) return { kind: 'no-year' };
    const day = dayNumber(year, +short[1]!, +short[2]!);
    return day === null ? { kind: 'bad-date' } : { kind: 'ok', day };
  }
  return { kind: 'not-date' };
}

export function parseCalendarHeatmap(content: string): ParsedCalendarHeatmap {
  const options: Record<string, string> = {};
  const result: Writable<ParsedCalendarHeatmap> & {
    diagnostics: DgmoError[];
  } = {
    type: 'calendar-heatmap',
    start: 0,
    end: 0,
    weekStart: 0,
    days: [],
    options,
    diagnostics: [],
    error: null,
  };
  const diagnostics = result.diagnostics;
  const fail = makeFail(result);

  const report = (
    spec: DiagnosticSpec,
    line: number,
    params: DiagnosticParams
  ): void => {
    const diag = emit(spec, line, params);
    diagnostics.push(diag);
    if (diag.severity === 'error') result.error ??= formatDgmoError(diag);
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');
  let firstLineSeen = false;
  // `from … to …` is read after every line, since `MM-DD` in it needs `year`
  // and `year` may come after it.
  let range: { from: string; to: string; lineNumber: number } | null = null;
  const entries: { token: string; value: number; lineNumber: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!firstLineSeen) {
      firstLineSeen = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'calendar-heatmap') {
          let msg = `Expected chart type "calendar-heatmap", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['calendar-heatmap']);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    if (parseChartFrameLine(result, line, lineNumber, diagnostics)) continue;

    const parts = trimmed.split(/\s+/);
    const word = parts[0]!;
    const keyword = word.toLowerCase();
    const rest = trimmed.slice(word.length).trim();

    if (BOOLEAN_OPTIONS.has(keyword) && !rest) {
      options[keyword] = 'on';
      continue;
    }
    if (VALUE_OPTIONS.has(keyword) && rest) {
      options[keyword] = rest;
      continue;
    }
    if (keyword === 'year') {
      if (/^\d{4}$/.test(rest)) result.year = +rest;
      else
        report(CALENDAR_HEATMAP_DX.BAD_OPTION, lineNumber, {
          option: 'year',
          value: rest,
        });
      continue;
    }
    if (keyword === 'unit') {
      if (rest) result.unit = rest;
      else
        report(CALENDAR_HEATMAP_DX.BAD_OPTION, lineNumber, {
          option: 'unit',
          value: rest,
        });
      continue;
    }
    if (keyword === 'week-start') {
      const v = rest.toLowerCase();
      if (v === 'monday') result.weekStart = 1;
      else if (v === 'sunday') result.weekStart = 0;
      else
        report(CALENDAR_HEATMAP_DX.BAD_OPTION, lineNumber, {
          option: 'week-start',
          value: rest,
        });
      continue;
    }
    if (keyword === 'max') {
      const n = NUMBER_RE.test(rest) ? Number(rest) : NaN;
      if (n > 0) result.max = n;
      else
        report(CALENDAR_HEATMAP_DX.BAD_OPTION, lineNumber, {
          option: 'max',
          value: rest,
        });
      continue;
    }
    if (keyword === 'from') {
      const m = /^(\S+)\s+to\s+(\S+)$/i.exec(rest);
      if (m) range = { from: m[1]!, to: m[2]!, lineNumber };
      else
        report(CALENDAR_HEATMAP_DX.BAD_OPTION, lineNumber, {
          option: 'from',
          value: rest,
        });
      continue;
    }

    const dateShaped = FULL_DATE_RE.test(word) || SHORT_DATE_RE.test(word);
    if (!dateShaped || parts.length !== 2) {
      const hint = dateShaped ? null : suggest(keyword, OPTION_WORDS);
      report(CALENDAR_HEATMAP_DX.BAD_ENTRY, lineNumber, {
        line: hint ? `${trimmed}' (${hint})` : trimmed,
      });
      continue;
    }
    const valueText = parts[1]!;
    if (!NUMBER_RE.test(valueText)) {
      report(CALENDAR_HEATMAP_DX.BAD_VALUE, lineNumber, { value: valueText });
      continue;
    }
    entries.push({ token: word, value: Number(valueText), lineNumber });
  }

  // ── Dates, now that `year` is known ────────────────────────
  const byDay = new Map<DayNumber, Writable<CalendarHeatmapDay>>();
  for (const entry of entries) {
    const read = readDate(entry.token, result.year);
    if (read.kind === 'no-year') {
      report(CALENDAR_HEATMAP_DX.SHORT_DATE_NO_YEAR, entry.lineNumber, {
        date: entry.token,
      });
      continue;
    }
    if (read.kind !== 'ok') {
      report(CALENDAR_HEATMAP_DX.BAD_DATE, entry.lineNumber, {
        date: entry.token,
      });
      continue;
    }
    const existing = byDay.get(read.day);
    if (existing) existing.value += entry.value;
    else
      byDay.set(read.day, {
        day: read.day,
        date: dayToIso(read.day),
        value: entry.value,
        lineNumber: entry.lineNumber,
      });
  }

  // ── The span ───────────────────────────────────────────────
  let start: DayNumber | null = null;
  let end: DayNumber | null = null;
  if (result.year !== undefined) {
    start = dayNumber(result.year, 1, 1);
    end = dayNumber(result.year, 12, 31);
  }
  if (range) {
    const from = readDate(range.from, result.year);
    const to = readDate(range.to, result.year);
    const bad = [
      [range.from, from],
      [range.to, to],
    ] as const;
    let ok = true;
    for (const [token, read] of bad) {
      if (read.kind === 'ok') continue;
      ok = false;
      if (read.kind === 'no-year')
        report(CALENDAR_HEATMAP_DX.SHORT_DATE_NO_YEAR, range.lineNumber, {
          date: token,
        });
      else if (read.kind === 'bad-date')
        report(CALENDAR_HEATMAP_DX.BAD_DATE, range.lineNumber, { date: token });
      else
        report(CALENDAR_HEATMAP_DX.BAD_OPTION, range.lineNumber, {
          option: 'from',
          value: `${range.from} to ${range.to}`,
        });
    }
    if (ok && from.kind === 'ok' && to.kind === 'ok') {
      if (to.day < from.day) {
        report(CALENDAR_HEATMAP_DX.BAD_RANGE, range.lineNumber, {
          from: range.from,
          to: range.to,
        });
      } else {
        start = from.day;
        end = to.day;
      }
    }
  }

  const sorted = [...byDay.values()].sort((a, b) => a.day - b.day);
  if (start === null || end === null) {
    if (sorted.length === 0) {
      if (result.error === null) report(CALENDAR_HEATMAP_DX.NO_ENTRIES, 1, {});
      return result;
    }
    start = sorted[0]!.day;
    end = sorted[sorted.length - 1]!.day;
  }

  const days: CalendarHeatmapDay[] = [];
  for (const d of sorted) {
    if (d.day < start || d.day > end) {
      report(CALENDAR_HEATMAP_DX.OUTSIDE_SPAN, d.lineNumber, { date: d.date });
      continue;
    }
    days.push(d);
  }
  result.start = start;
  result.end = end;
  result.days = days;
  return result;
}
