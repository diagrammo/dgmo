// ============================================================
// Calendar parser — marks and events on a span of days (§41, #1877)
// ============================================================
//
//   calendar Habits 2027
//   year 2027
//   heat Commits as c
//     unit commit
//   tag Mood as m
//     Great green
//     Rough red
//
//   01-05 c: 3, m: Great        ← marks: metadata only
//   03-10 Dentist m: Rough      ← an event: text, then optional metadata
//   07-04 -> 07-18 Vacation     ← a range
//
//   2027-09                     ← a month block: day numbers under it
//     18 -> 20 Offsite
//       Agenda in the **wiki**  ← a note under an event
//
// Every line is collected first and read after the loop: a group may be
// declared after its entries, and `MM-DD` needs the span, which `year`,
// `from` and month headers set wherever they stand.

import {
  emit,
  formatDgmoError,
  makeDgmoError,
  makeFail,
  suggest,
} from '../diagnostics';
import type {
  DgmoError,
  DiagnosticParams,
  DiagnosticSpec,
} from '../diagnostics';
import { withPaletteLifted } from '../palettes/directive';
import type { Writable } from '../utils/brand';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from '../utils/chart-frame-parse';
import { normalizeName } from '../utils/name-normalize';
import {
  cutUnionMetadata,
  extractColor,
  fillModeFromToken,
  measureIndent,
  parseFirstLine,
  parseMetadataRegion,
  peelRampColors,
} from '../utils/parsing';
import {
  type ReservedKeyRegistry,
  withTagAliases,
} from '../utils/reserved-key-registry';
import type { TagGroup } from '../utils/tag-groups';
import {
  activeTagNoMatchMessage,
  AUTO_TAG_COLOR_SENTINEL,
  finalizeAutoTagColors,
  matchTagBlockHeading,
  stripDefaultModifier,
  tagAttrKey,
} from '../utils/tag-groups';
import { dayNumber, dayToIso, daysInMonth, parts, rollingDay } from './dates';
import { CALENDAR_DX } from './diagnostics';
import type {
  CalendarDay,
  CalendarEvent,
  CalendarGroupRef,
  CalendarLayout,
  CalendarNumberGroup,
  DayNumber,
  ParsedCalendar,
} from './types';

export { dayToIso } from './dates';

const BOOLEAN_OPTIONS = new Set([
  'no-summary',
  'no-title',
  'no-legend',
  'legend-inline',
  'no-notes',
  'orientation-horizontal',
]);
const VALUE_OPTIONS = new Set(['palette']);
const LAYOUTS: readonly CalendarLayout[] = ['weeks', 'months', 'month'];
const OPTION_WORDS = [
  'year',
  'unit',
  'from',
  'week-start',
  'max',
  'heat',
  'tag',
  'layout',
  'months-per-row',
  'empty',
  'active-tag',
  'fill-tint',
  'fill-solid',
  'fill-outline',
  ...BOOLEAN_OPTIONS,
  ...VALUE_OPTIONS,
];

const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHORT_DATE_RE = /^(\d{2})-(\d{2})$/;
const MONTH_HEADER_RE = /^(\d{4})-(\d{2})$/;
const DAY_RE = /^\d{1,2}$/;
const NUMBER_RE = /^[+]?(\d+(\.\d*)?|\.\d+)$/;
/** A one-word value meant as a number but not a valid one: `-3`, `1e3`, `2,5`. */
const NUMERIC_LOOKING_RE = /^[-+]?[\d.]/;
/** `as <alias>` at the end of a `heat` name (§1.5). */
const AS_ALIAS_RE = /\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})$/;

/** The key the implied number group stores its marks under. */
export const IMPLIED_GROUP_KEY = 'value';
export const DEFAULT_EMPTY_LABEL = 'Not logged';

interface MonthHeader {
  year: number;
  month: number;
  lineNumber: number;
}

interface RawEntry {
  tokens: string[];
  month: MonthHeader | null;
  indent: number;
  lineNumber: number;
  children: { text: string; lineNumber: number }[];
}

type DateRead =
  | { kind: 'ok'; day: DayNumber }
  | { kind: 'not-date' }
  | { kind: 'bad-date' }
  | { kind: 'no-year' }
  | { kind: 'outside-month'; max: number };

function isDateToken(token: string): boolean {
  return FULL_DATE_RE.test(token) || SHORT_DATE_RE.test(token);
}

/** True when `a` and `b` differ by one insert, delete, change, or swap of
 *  two neighbouring letters. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length)
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

/** The implied group's pill: the unit's plural, capitalised when it is a
 *  word (`Commits`); a symbol stays as written (`km`). */
function impliedName(unit: string | undefined): string {
  if (!unit) return 'Value';
  const plural = pluralUnit(unit, 2);
  return /[aeiouy]/i.test(unit) && /^[a-z]/i.test(unit)
    ? plural.charAt(0).toUpperCase() + plural.slice(1)
    : plural;
}

/** English plural of a singular unit word; a symbol (`km`) stays as written. */
export function pluralUnit(unit: string, n: number): string {
  if (n === 1 || !/^[a-z]+$/i.test(unit) || !/[aeiouy]/i.test(unit))
    return unit;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  if (/[b-df-hj-np-tv-z]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
}

export function parseCalendar(content: string): ParsedCalendar {
  return withPaletteLifted(content, (lifted) => parseCalendarRaw(lifted));
}

function parseCalendarRaw(content: string): ParsedCalendar {
  const options: Record<string, string> = {};
  const result: Writable<ParsedCalendar> & {
    diagnostics: DgmoError[];
  } = {
    type: 'calendar',
    start: 0,
    end: 0,
    weekStart: 0,
    layout: 'weeks',
    horizontal: false,
    emptyLabel: DEFAULT_EMPTY_LABEL,
    fillMode: 'tint',
    numberGroups: [],
    tagGroups: [],
    groups: [],
    days: [],
    events: [],
    options,
    diagnostics: [],
    error: null,
  };
  const diagnostics = result.diagnostics;
  const fail = makeFail(result);

  const report = (
    spec: DiagnosticSpec,
    line: number,
    params: DiagnosticParams = {}
  ): void => {
    const diag = emit(spec, line, params);
    diagnostics.push(diag);
    if (diag.severity === 'error') result.error ??= formatDgmoError(diag);
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');
  // The footnote block and its markdown body (#2093), before any line is read.
  takeFootnoteBlock(result, lines, diagnostics);

  let firstLineSeen = false;
  let range: { from: string; to?: string; lineNumber: number } | null = null;
  let layoutLine = 0;
  let activeTagLine = 0;
  let headerUnit: string | undefined;
  let headerMax: number | undefined;
  const monthHeaders: MonthHeader[] = [];
  const entries: RawEntry[] = [];
  const tagGroups: Writable<TagGroup>[] = [];
  const numberGroups: Writable<CalendarNumberGroup>[] = [];
  const order: CalendarGroupRef[] = [];

  let currentTagGroup: Writable<TagGroup> | null = null;
  let currentHeat: Writable<CalendarNumberGroup> | null = null;
  let currentMonth: MonthHeader | null = null;
  let currentEntry: RawEntry | null = null;

  const addTagValue = (text: string, lineNumber: number): void => {
    const group = currentTagGroup!;
    // `default` means nothing here: a blank day is "Not logged" (§41.5).
    const { text: clean } = stripDefaultModifier(text);
    const { label, color } = extractColor(
      clean,
      undefined,
      diagnostics,
      lineNumber
    );
    group.entries.push({
      value: label,
      color: color ?? AUTO_TAG_COLOR_SENTINEL,
      ...(color !== undefined && {
        authoredColor: clean.trim().split(/\s+/).pop()!,
      }),
      lineNumber,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const indent = measureIndent(line);

    if (!firstLineSeen) {
      firstLineSeen = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'calendar') {
          let msg = `Expected chart type "calendar", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['calendar']);
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

    // ── Indented lines: group bodies, notes, month-block entries ──
    if (indent > 0) {
      if (currentTagGroup) {
        addTagValue(trimmed, lineNumber);
        continue;
      }
      if (currentHeat) {
        const [word, ...restParts] = trimmed.split(/\s+/);
        const rest = restParts.join(' ');
        const key = word!.toLowerCase();
        if (key === 'unit' && rest) currentHeat.unit = rest;
        else if (key === 'max' && NUMBER_RE.test(rest) && Number(rest) > 0)
          currentHeat.max = Number(rest);
        else
          report(CALENDAR_DX.BAD_OPTION, lineNumber, {
            option: key === 'max' || key === 'unit' ? key : 'heat',
            value: rest || trimmed,
          });
        continue;
      }
      if (currentEntry && indent > currentEntry.indent) {
        currentEntry.children.push({ text: trimmed, lineNumber });
        continue;
      }
      if (currentMonth) {
        currentEntry = {
          tokens: trimmed.split(/\s+/),
          month: currentMonth,
          indent,
          lineNumber,
          children: [],
        };
        entries.push(currentEntry);
        continue;
      }
      report(CALENDAR_DX.BAD_ENTRY, lineNumber, { line: trimmed });
      continue;
    }

    currentTagGroup = null;
    currentHeat = null;
    currentEntry = null;
    currentMonth = null;

    const tagHeading = matchTagBlockHeading(trimmed);
    if (tagHeading) {
      currentTagGroup = {
        name: tagHeading.name,
        ...(tagHeading.alias !== undefined && { alias: tagHeading.alias }),
        entries: [],
        lineNumber,
      };
      tagGroups.push(currentTagGroup);
      order.push({
        kind: 'tag',
        key: tagAttrKey(tagHeading.name),
        name: tagHeading.name,
      });
      for (const v of tagHeading.inlineValues ?? []) addTagValue(v, lineNumber);
      continue;
    }

    if (parseChartFrameLine(result, line, lineNumber, diagnostics)) continue;

    const words = trimmed.split(/\s+/);
    const word = words[0]!;
    const keyword = word.toLowerCase();
    const rest = trimmed.slice(word.length).trim();

    const header = MONTH_HEADER_RE.exec(trimmed);
    if (header) {
      const month = +header[2]!;
      if (month < 1 || month > 12) {
        report(CALENDAR_DX.BAD_DATE, lineNumber, { date: trimmed });
        continue;
      }
      currentMonth = { year: +header[1]!, month, lineNumber };
      monthHeaders.push(currentMonth);
      continue;
    }

    if (BOOLEAN_OPTIONS.has(keyword) && !rest) {
      options[keyword] = 'on';
      continue;
    }
    const fill = rest ? null : fillModeFromToken(keyword);
    if (fill) {
      result.fillMode = fill;
      continue;
    }
    if (VALUE_OPTIONS.has(keyword) && rest) {
      options[keyword] = rest;
      continue;
    }
    if (keyword === 'heat') {
      if (!rest) {
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'heat',
          value: rest,
        });
        continue;
      }
      const ramp = peelRampColors(rest);
      let name = ramp.label;
      let alias: string | undefined;
      const am = AS_ALIAS_RE.exec(name);
      if (am) {
        alias = am[1];
        name = name.slice(0, am.index).trimEnd();
      }
      currentHeat = {
        name,
        key: tagAttrKey(name),
        ...(alias !== undefined && { alias }),
        ...(ramp.low !== undefined && { low: ramp.low }),
        ...(ramp.high !== undefined && { high: ramp.high }),
        implied: false,
        lineNumber,
      };
      numberGroups.push(currentHeat);
      order.push({ kind: 'number', key: currentHeat.key, name });
      continue;
    }
    if (keyword === 'year') {
      if (/^\d{4}$/.test(rest)) result.year = +rest;
      else
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'year',
          value: rest,
        });
      continue;
    }
    if (keyword === 'unit') {
      if (rest) headerUnit = rest;
      else
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'unit',
          value: rest,
        });
      continue;
    }
    if (keyword === 'max') {
      const n = NUMBER_RE.test(rest) ? Number(rest) : NaN;
      if (n > 0) headerMax = n;
      else
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'max',
          value: rest,
        });
      continue;
    }
    if (keyword === 'week-start') {
      const v = rest.toLowerCase();
      if (v === 'monday') result.weekStart = 1;
      else if (v === 'sunday') result.weekStart = 0;
      else
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'week-start',
          value: rest,
        });
      continue;
    }
    if (keyword === 'from') {
      const m = /^(\S+)(?:\s+to\s+(\S+))?$/i.exec(rest);
      if (m)
        range = {
          from: m[1]!,
          ...(m[2] !== undefined && { to: m[2] }),
          lineNumber,
        };
      else
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'from',
          value: rest,
        });
      continue;
    }
    if (keyword === 'layout') {
      const v = rest.toLowerCase() as CalendarLayout;
      if (LAYOUTS.includes(v)) {
        result.layout = v;
        layoutLine = lineNumber;
      } else report(CALENDAR_DX.BAD_LAYOUT, lineNumber, { value: rest });
      continue;
    }
    if (keyword === 'months-per-row') {
      const n = /^\d+$/.test(rest) ? Number(rest) : NaN;
      if (n >= 1 && n <= 6) result.monthsPerRow = n;
      else report(CALENDAR_DX.MONTHS_PER_ROW, lineNumber, { value: rest });
      continue;
    }
    if (keyword === 'empty') {
      if (rest) result.emptyLabel = rest;
      else
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'empty',
          value: rest,
        });
      continue;
    }
    if (keyword === 'active-tag') {
      if (rest) {
        options['active-tag'] = rest;
        activeTagLine = lineNumber;
      } else
        report(CALENDAR_DX.BAD_OPTION, lineNumber, {
          option: 'active-tag',
          value: rest,
        });
      continue;
    }

    if (!isDateToken(word)) {
      const hint = suggest(keyword, OPTION_WORDS);
      report(CALENDAR_DX.BAD_ENTRY, lineNumber, {
        line: hint ? `${trimmed}' (${hint})` : trimmed,
      });
      continue;
    }
    currentEntry = {
      tokens: words,
      month: null,
      indent: 0,
      lineNumber,
      children: [],
    };
    entries.push(currentEntry);
  }

  // ── Groups ─────────────────────────────────────────────────
  finalizeAutoTagColors(tagGroups);
  // The header `unit` and `max` name the implied group; with exactly one
  // `heat` group and none of its own, they fall to it.
  if (numberGroups.length === 1) {
    const only = numberGroups[0]!;
    if (only.unit === undefined && headerUnit !== undefined)
      only.unit = headerUnit;
    if (only.max === undefined && headerMax !== undefined) only.max = headerMax;
  }
  const declaredNumberGroups = numberGroups.length;
  const declaredGroups = declaredNumberGroups + tagGroups.length;

  // Metadata keys: every group's alias AND its canonical name (§1.4).
  const metaAliasMap = new Map<string, string>();
  const keyKind = new Map<string, 'number' | 'tag'>();
  for (const g of tagGroups) {
    const key = tagAttrKey(g.name);
    if (g.alias) metaAliasMap.set(normalizeName(g.alias), key);
    metaAliasMap.set(normalizeName(g.name), key);
    keyKind.set(key, 'tag');
  }
  for (const g of numberGroups) {
    if (g.alias) metaAliasMap.set(normalizeName(g.alias), g.key);
    metaAliasMap.set(normalizeName(g.name), g.key);
    keyKind.set(g.key, 'number');
  }
  const registry: ReservedKeyRegistry = withTagAliases(
    { keys: new Set<string>(), tagAliases: new Set<string>() },
    new Set(metaAliasMap.keys())
  );
  const tagValueOf = (groupKey: string, raw: string): string | undefined => {
    const g = tagGroups.find((t) => tagAttrKey(t.name) === groupKey);
    return g?.entries.find((e) => e.value.toLowerCase() === raw.toLowerCase())
      ?.value;
  };
  const onlyTagGroup =
    declaredGroups === 1 && tagGroups.length === 1 ? tagGroups[0]! : null;

  let impliedGroup: Writable<CalendarNumberGroup> | null = null;
  const impliedKey = (): string => {
    if (!impliedGroup) {
      impliedGroup = {
        name: impliedName(headerUnit),
        key: IMPLIED_GROUP_KEY,
        ...(headerUnit !== undefined && { unit: headerUnit }),
        ...(headerMax !== undefined && { max: headerMax }),
        implied: true,
        lineNumber: 0,
      };
      numberGroups.unshift(impliedGroup);
      order.unshift({
        kind: 'number',
        key: IMPLIED_GROUP_KEY,
        name: impliedGroup.name,
      });
      keyKind.set(IMPLIED_GROUP_KEY, 'number');
    }
    return IMPLIED_GROUP_KEY;
  };

  // ── The span, before any `MM-DD` is read ───────────────────
  let start: DayNumber | null = null;
  let end: DayNumber | null = null;
  if (result.year !== undefined) {
    start = dayNumber(result.year, 1, 1);
    end = dayNumber(result.year, 12, 31);
  }
  const readSpanDate = (token: string): DateRead => {
    const full = FULL_DATE_RE.exec(token);
    if (full) {
      const day = dayNumber(+full[1]!, +full[2]!, +full[3]!);
      return day === null ? { kind: 'bad-date' } : { kind: 'ok', day };
    }
    const short = SHORT_DATE_RE.exec(token);
    if (short) {
      if (result.year === undefined) return { kind: 'no-year' };
      const day = dayNumber(result.year, +short[1]!, +short[2]!);
      return day === null ? { kind: 'bad-date' } : { kind: 'ok', day };
    }
    return { kind: 'not-date' };
  };
  if (range) {
    const tokens = [range.from, ...(range.to !== undefined ? [range.to] : [])];
    const reads = tokens.map(readSpanDate);
    let ok = true;
    reads.forEach((read, k) => {
      if (read.kind === 'ok') return;
      ok = false;
      if (read.kind === 'no-year')
        report(CALENDAR_DX.SHORT_DATE_NO_YEAR, range.lineNumber, {
          date: tokens[k]!,
        });
      else if (read.kind === 'bad-date')
        report(CALENDAR_DX.BAD_DATE, range.lineNumber, { date: tokens[k]! });
      else
        report(CALENDAR_DX.BAD_OPTION, range.lineNumber, {
          option: 'from',
          value: tokens.join(' to '),
        });
    });
    if (ok) {
      const from = (reads[0] as { day: DayNumber }).day;
      let to: DayNumber;
      if (reads[1]) to = (reads[1] as { day: DayNumber }).day;
      else {
        // `from` alone: one year from that day (a fiscal year).
        const p = parts(from);
        to = rollingDay(p.year + 1, p.month, p.date) - 1;
      }
      if (to < from) {
        report(CALENDAR_DX.BAD_RANGE, range.lineNumber, {
          from: range.from,
          to: range.to ?? '',
        });
      } else {
        start = from;
        end = to;
      }
    }
  }
  if (start === null && monthHeaders.length > 0) {
    for (const h of monthHeaders) {
      const first = dayNumber(h.year, h.month, 1)!;
      const last = dayNumber(h.year, h.month, daysInMonth(h.year, h.month))!;
      start = start === null ? first : Math.min(start, first);
      end = end === null ? last : Math.max(end, last);
    }
  }
  const spanStart = start;
  const spanEnd = end;

  /** `MM-DD` read in the span: the first year that puts it inside. */
  const readShort = (month: number, date: number): DateRead => {
    if (spanStart !== null && spanEnd !== null) {
      for (let y = parts(spanStart).year; y <= parts(spanEnd).year; y++) {
        const day = dayNumber(y, month, date);
        if (day !== null && day >= spanStart && day <= spanEnd)
          return { kind: 'ok', day };
      }
    }
    const year =
      result.year ?? (spanStart !== null ? parts(spanStart).year : undefined);
    if (year === undefined) return { kind: 'no-year' };
    const day = dayNumber(year, month, date);
    return day === null ? { kind: 'bad-date' } : { kind: 'ok', day };
  };

  const readEntryDate = (
    token: string,
    month: MonthHeader | null,
    after: DayNumber | null
  ): DateRead => {
    const full = FULL_DATE_RE.exec(token);
    if (full) {
      const day = dayNumber(+full[1]!, +full[2]!, +full[3]!);
      return day === null ? { kind: 'bad-date' } : { kind: 'ok', day };
    }
    const short = SHORT_DATE_RE.exec(token);
    if (short) {
      const mm = +short[1]!;
      const dd = +short[2]!;
      if (month) {
        let day = dayNumber(month.year, mm, dd);
        if (day === null) return { kind: 'bad-date' };
        // `29 -> 01-02` under `2026-12` runs into the next year.
        if (after !== null && day < after) {
          const next = dayNumber(month.year + 1, mm, dd);
          if (next !== null) day = next;
        }
        return { kind: 'ok', day };
      }
      return readShort(mm, dd);
    }
    if (month && DAY_RE.test(token)) {
      const dd = +token;
      const max = daysInMonth(month.year, month.month);
      if (dd < 1 || dd > max) return { kind: 'outside-month', max };
      return { kind: 'ok', day: dayNumber(month.year, month.month, dd)! };
    }
    return { kind: 'not-date' };
  };

  const dateFailed = (read: DateRead, token: string, entry: RawEntry): void => {
    if (read.kind === 'no-year')
      report(CALENDAR_DX.SHORT_DATE_NO_YEAR, entry.lineNumber, { date: token });
    else if (read.kind === 'bad-date')
      report(CALENDAR_DX.BAD_DATE, entry.lineNumber, { date: token });
    else if (read.kind === 'outside-month')
      report(CALENDAR_DX.DAY_OUTSIDE_MONTH, entry.lineNumber, {
        day: token,
        month: entry.month
          ? `${entry.month.year}-${String(entry.month.month).padStart(2, '0')}`
          : '',
        max: read.max,
      });
    else
      report(CALENDAR_DX.BAD_ENTRY, entry.lineNumber, {
        line: entry.tokens.join(' '),
      });
  };

  // ── Entries ────────────────────────────────────────────────
  interface Mark {
    first: DayNumber;
    last: DayNumber;
    numbers: Record<string, number>;
    tags: Record<string, string>;
    lineNumber: number;
  }
  const marks: Mark[] = [];
  const rawEvents: Writable<CalendarEvent>[] = [];

  /** Reads `alias: value, …` into number and tag marks; reports bad values. */
  const readMeta = (
    meta: Record<string, string>,
    lineNumber: number,
    into: { numbers: Record<string, number>; tags: Record<string, string> }
  ): void => {
    for (const [key, raw] of Object.entries(meta)) {
      const kind = keyKind.get(key);
      if (kind === 'number') {
        if (NUMBER_RE.test(raw))
          into.numbers[key] = (into.numbers[key] ?? 0) + Number(raw);
        else report(CALENDAR_DX.BAD_VALUE, lineNumber, { value: raw });
      } else if (kind === 'tag') {
        const value = tagValueOf(key, raw);
        if (value !== undefined) into.tags[key] = value;
        else {
          const g = tagGroups.find((t) => tagAttrKey(t.name) === key)!;
          const hint = suggest(
            raw,
            g.entries.map((e) => e.value)
          );
          report(CALENDAR_DX.UNKNOWN_TAG, lineNumber, {
            tag: raw,
            ...(hint && { hint }),
          });
        }
      }
    }
  };

  /** Splits `text` into the name in front and its `alias: value` metadata. */
  const splitLine = (
    text: string,
    lineNumber: number
  ): { name: string; meta: Record<string, string> } => {
    const cut = cutUnionMetadata(text, registry);
    if (cut < 0) return { name: text.trim(), meta: {} };
    return {
      name: text.slice(0, cut).trim(),
      meta: parseMetadataRegion(
        text.slice(cut),
        metaAliasMap,
        diagnostics,
        lineNumber
      ),
    };
  };

  for (const entry of entries) {
    const { tokens, lineNumber } = entry;
    const firstRead = readEntryDate(tokens[0]!, entry.month, null);
    if (firstRead.kind !== 'ok') {
      dateFailed(firstRead, tokens[0]!, entry);
      continue;
    }
    const first = firstRead.day;
    let last = first;
    let restAt = 1;
    if (tokens[1] === '->') {
      const endToken = tokens[2];
      const endRead = endToken
        ? readEntryDate(endToken, entry.month, first)
        : ({ kind: 'not-date' } as DateRead);
      if (endRead.kind !== 'ok') {
        dateFailed(endRead, endToken ?? '', entry);
        continue;
      }
      if (endRead.day < first) {
        report(CALENDAR_DX.END_BEFORE_START, lineNumber, {
          from: tokens[0]!,
          to: endToken!,
        });
        continue;
      }
      last = endRead.day;
      restAt = 3;
    }
    const rest = tokens.slice(restAt).join(' ');
    const { name, meta } = splitLine(rest, lineNumber);

    // Indented `alias: value` lines stay metadata; other lines are notes.
    const notes: { text: string; lineNumber: number }[] = [];
    const childMeta: { meta: Record<string, string>; lineNumber: number }[] =
      [];
    for (const child of entry.children) {
      const split = splitLine(child.text, child.lineNumber);
      if (!split.name && Object.keys(split.meta).length > 0)
        childMeta.push({ meta: split.meta, lineNumber: child.lineNumber });
      else notes.push(child);
    }
    const hasMeta = Object.keys(meta).length > 0 || childMeta.length > 0;

    // ── Marks: metadata only, or the bare shorthand ──
    let mark: Mark | null = null;
    if (!name) {
      if (!hasMeta) {
        report(CALENDAR_DX.BAD_ENTRY, lineNumber, { line: tokens.join(' ') });
        continue;
      }
      mark = { first, last, numbers: {}, tags: {}, lineNumber };
    } else if (!hasMeta) {
      const asTag = onlyTagGroup
        ? tagValueOf(tagAttrKey(onlyTagGroup.name), name)
        : undefined;
      if (asTag !== undefined) {
        mark = { first, last, numbers: {}, tags: {}, lineNumber };
        mark.tags[tagAttrKey(onlyTagGroup!.name)] = asTag;
      } else if (NUMBER_RE.test(name)) {
        if (declaredNumberGroups >= 2) {
          report(CALENDAR_DX.AMBIGUOUS_NUMBER, lineNumber, {
            value: name,
            groups: numberGroups
              .filter((g) => !g.implied)
              .map((g) => g.alias ?? g.name)
              .join(', '),
          });
          continue;
        }
        const key =
          declaredNumberGroups === 1
            ? numberGroups.find((g) => !g.implied)!.key
            : impliedKey();
        mark = {
          first,
          last,
          numbers: { [key]: Number(name) },
          tags: {},
          lineNumber,
        };
      } else if (NUMERIC_LOOKING_RE.test(name) && !/\s/.test(name)) {
        report(CALENDAR_DX.BAD_VALUE, lineNumber, { value: name });
        continue;
      }
    }
    if (mark) {
      readMeta(meta, lineNumber, mark);
      for (const c of childMeta) readMeta(c.meta, c.lineNumber, mark);
      for (const n of notes)
        report(CALENDAR_DX.BAD_ENTRY, n.lineNumber, { line: n.text });
      marks.push(mark);
      continue;
    }

    // ── An event: a name, then optional tags ──
    if (NUMBER_RE.test(name) && hasMeta) {
      report(CALENDAR_DX.NUMBER_ON_EVENT, lineNumber, { value: name });
      continue;
    }
    const sink = { numbers: {} as Record<string, number>, tags: {} };
    const allMeta = [{ meta, lineNumber }, ...childMeta];
    for (const m of allMeta) {
      for (const key of Object.keys(m.meta))
        if (keyKind.get(key) === 'number') {
          report(CALENDAR_DX.NUMBER_ON_EVENT, m.lineNumber, {
            value: `${key}: ${m.meta[key]!}`,
          });
          delete m.meta[key];
        }
      readMeta(m.meta, m.lineNumber, sink);
    }
    if (onlyTagGroup && !/\s/.test(name)) {
      const near = onlyTagGroup.entries.find((e) =>
        oneEditApart(name.toLowerCase(), e.value.toLowerCase())
      );
      if (near)
        report(CALENDAR_DX.NAME_LIKE_TAG, lineNumber, {
          name,
          tag: near.value,
        });
    }
    rawEvents.push({
      name,
      start: first,
      end: last,
      tags: sink.tags,
      notes: notes.map((n) => n.text),
      lineNumber,
    });
  }

  // ── Merge marks by day ─────────────────────────────────────
  const byDay = new Map<DayNumber, Writable<CalendarDay>>();
  for (const m of marks) {
    for (let day = m.first; day <= m.last; day++) {
      let d = byDay.get(day);
      if (!d) {
        d = {
          day,
          date: dayToIso(day),
          numbers: {},
          tags: {},
          lineNumber: m.lineNumber,
        };
        byDay.set(day, d);
      }
      const numbers = d.numbers as Record<string, number>;
      const tags = d.tags as Record<string, string>;
      for (const [k, v] of Object.entries(m.numbers))
        numbers[k] = (numbers[k] ?? 0) + v;
      for (const [k, v] of Object.entries(m.tags)) {
        if (tags[k] !== undefined)
          report(CALENDAR_DX.DUPLICATE_TAG_DAY, m.lineNumber, {
            date: dayToIso(day),
          });
        tags[k] = v;
      }
    }
  }

  // ── The span from the dates given, when nothing else set it ──
  const sorted = [...byDay.values()].sort((a, b) => a.day - b.day);
  if (start === null || end === null) {
    const all = [
      ...sorted.map((d) => d.day),
      ...rawEvents.flatMap((e) => [e.start, e.end]),
    ];
    if (all.length === 0) {
      if (result.error === null) report(CALENDAR_DX.NO_ENTRIES, 1);
      return result;
    }
    start = Math.min(...all);
    end = Math.max(...all);
  }

  const days: CalendarDay[] = [];
  for (const d of sorted) {
    if (d.day < start || d.day > end) {
      report(CALENDAR_DX.OUTSIDE_SPAN, d.lineNumber, { date: d.date });
      continue;
    }
    days.push(d);
  }
  const events: CalendarEvent[] = [];
  for (const e of rawEvents) {
    if (e.end < start || e.start > end) {
      report(CALENDAR_DX.OUTSIDE_SPAN, e.lineNumber, {
        date: dayToIso(e.start),
      });
      continue;
    }
    events.push({
      ...e,
      start: Math.max(e.start, start),
      end: Math.min(e.end, end),
    });
  }

  // ── Layout default: a wall calendar when anything is an event ──
  if (!layoutLine) result.layout = rawEvents.length > 0 ? 'month' : 'weeks';
  result.horizontal = options['orientation-horizontal'] === 'on';

  // ── `active-tag` names a group of either kind, or its alias ──
  const activeWarning = activeTagNoMatchMessage(
    options['active-tag'],
    tagGroups,
    [
      ...numberGroups.map((g) => g.name),
      ...[...tagGroups, ...numberGroups].flatMap((g) =>
        g.alias ? [g.alias] : []
      ),
    ],
    'number group'
  );
  if (activeWarning)
    diagnostics.push(
      makeDgmoError(
        activeTagLine || 1,
        activeWarning,
        'warning',
        'W_ACTIVE_TAG_NO_MATCH'
      )
    );

  result.start = start;
  result.end = end;
  result.days = days;
  result.events = events;
  result.tagGroups = tagGroups;
  result.numberGroups = numberGroups;
  result.groups = order;
  return result;
}

/** The legend's open group: `override` (the app's switcher) first, then
 *  `active-tag`, then the first declared. `null` = no colour. */
export function resolveCalendarActiveGroup(
  parsed: Pick<
    ParsedCalendar,
    'groups' | 'options' | 'tagGroups' | 'numberGroups'
  >,
  override?: string | null
): CalendarGroupRef | null {
  const pick = override !== undefined ? override : parsed.options['active-tag'];
  if (pick === null || pick === '') return null;
  if (pick === undefined) return parsed.groups[0] ?? null;
  const lower = pick.toLowerCase();
  if (lower === 'none') return null;
  const aliasOf = new Map<string, string>();
  for (const g of [...parsed.tagGroups, ...parsed.numberGroups])
    if (g.alias) aliasOf.set(tagAttrKey(g.name), g.alias.toLowerCase());
  return (
    parsed.groups.find(
      (g) =>
        g.name.toLowerCase() === lower ||
        g.key === lower ||
        aliasOf.get(g.key) === lower
    ) ??
    parsed.groups[0] ??
    null
  );
}
