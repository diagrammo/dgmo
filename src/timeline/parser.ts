import type { DgmoError } from '../diagnostics';
import { makeDgmoError } from '../diagnostics';
import { splitNameAndMeta, warnUnknownMetaKeys } from '../utils/parsing';
import {
  TIMELINE_REGISTRY,
  withTagAliases,
  type ReservedKeyRegistry,
} from '../utils/reserved-key-registry';
import type { TimelineEvent } from './types';

// ── Duration units supported by timeline (subset of gantt) ───
type TimelineDurationUnit = 'd' | 'w' | 'm' | 'y' | 'h' | 'min' | 's';

const TIMELINE_DURATION_RE = /^(\d+(?:\.\d{1,2})?)(min|[dwmyhs])(\?)?$/;

// ── Date prefix regex ────────────────────────────────────────
// Matches: YYYY, YYYY-MM, YYYY-MM-DD, YYYY-MM-DD HH:MM(:SS)
// Optionally followed by -> endDate (with optional ?)
const DATE_RE = /^(\d{4}(?:-\d{2}(?:-\d{2})?)?)/;
const TIME_RE = /^\s+(\d{1,2}:\d{2}(?::\d{2})?)/;
const ARROW_RE = /^\s*(?:->|–>)\s*/;
// Era-marked date (BCE/BC/CE/AD). Allows 1–4 digit years so ancient dates like
// `753 BCE` / `44 BC` parse; the marker is what disambiguates a short year from
// a stray number. BCE/BC are stored as a signed-year string (`-753`); CE/AD are
// no-ops (positive years). Astronomical-naive: `N BCE` ↔ internal year `-N`.
const ERA_DATE_RE = /^(\d{1,4}(?:-\d{2}(?:-\d{2})?)?)\s+(BCE|BC|CE|AD)\b/i;

interface DatePrefix {
  startDate: string;
  endDate: string | null;
  uncertain: boolean;
  remainder: string;
  startTimeValid: boolean;
  endTimeValid: boolean;
  invalidStartTime: string | undefined;
  invalidEndTime: string | undefined;
}

function parseTime(timeStr: string): {
  valid: boolean;
  h: number;
  m: number;
  s: number;
} {
  const [hStr, mStr, sStr] = timeStr.split(':');
  const h = parseInt(hStr!, 10);
  const m = parseInt(mStr!, 10);
  const s = sStr !== undefined ? parseInt(sStr, 10) : 0;
  const valid = h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59;
  return { valid, h, m, s };
}

function parseDateWithOptionalTime(input: string): {
  date: string;
  rest: string;
  timeValid: boolean;
  invalidTime: string | undefined;
} | null {
  // Era-marked dates (`753 BCE`, `44 BC`, `14 CE`) come first — they allow short
  // years and never carry a time component.
  const eraMatch = input.match(ERA_DATE_RE);
  if (eraMatch) {
    const marker = eraMatch[2]!.toUpperCase();
    const bce = marker === 'BCE' || marker === 'BC';
    const date = (bce ? '-' : '') + eraMatch[1]!;
    return {
      date,
      rest: input.slice(eraMatch[0].length),
      timeValid: true,
      invalidTime: undefined,
    };
  }

  const dateMatch = input.match(DATE_RE);
  if (!dateMatch) return null;

  let date = dateMatch[1]!;
  let rest = input.slice(date.length);
  let timeValid = true;
  let invalidTime: string | undefined;

  const timeMatch = rest.match(TIME_RE);
  if (timeMatch) {
    const timeStr = timeMatch[1]!;
    const { valid } = parseTime(timeStr);
    timeValid = valid;
    if (!valid) invalidTime = timeStr;
    date = `${date} ${timeStr}`;
    rest = rest.slice(timeMatch[0].length);
  }

  return { date, rest, timeValid, invalidTime };
}

export function extractDatePrefix(line: string): DatePrefix | null {
  const startResult = parseDateWithOptionalTime(line);
  if (!startResult) return null;

  const { date: startDate } = startResult;
  let { rest } = startResult;

  const arrowMatch = rest.match(ARROW_RE);
  if (arrowMatch) {
    rest = rest.slice(arrowMatch[0].length);
    const endResult = parseDateWithOptionalTime(rest);
    if (endResult) {
      let uncertain = false;
      let afterEnd = endResult.rest;
      if (afterEnd.startsWith('?')) {
        uncertain = true;
        afterEnd = afterEnd.slice(1);
      }
      const remainder = afterEnd.trimStart();
      return {
        startDate,
        endDate: endResult.date,
        uncertain,
        remainder,
        startTimeValid: startResult.timeValid,
        endTimeValid: endResult.timeValid,
        invalidStartTime: startResult.invalidTime,
        invalidEndTime: endResult.invalidTime,
      };
    }
    // Arrow present but no valid end date — fall through to point event
    // (could be a duration like ->30d, which is legacy syntax we're removing)
    return null;
  }

  // No arrow — must have remainder (the event name)
  const remainder = rest.trimStart();
  if (!remainder) {
    return {
      startDate,
      endDate: null,
      uncertain: false,
      remainder: '',
      startTimeValid: startResult.timeValid,
      endTimeValid: true,
      invalidStartTime: startResult.invalidTime,
      invalidEndTime: undefined,
    };
  }

  return {
    startDate,
    endDate: null,
    uncertain: false,
    remainder,
    startTimeValid: startResult.timeValid,
    endTimeValid: true,
    invalidStartTime: startResult.invalidTime,
    invalidEndTime: undefined,
  };
}

// ── Shared date-string decomposition ─────────────────────────
// Internal date strings are `[-]YYYY[-MM[-DD]][ HH:MM[:SS]]`. A leading `-`
// marks a BCE year (stored signed). Years may be 1–4 digits (ancient/BCE).

interface DateParts {
  sign: 1 | -1;
  year: number; // absolute (unsigned) year value
  month: number; // 1-based, defaults to 1
  day: number; // defaults to 1
  hour: number;
  minute: number;
  second: number;
  /** Number of date components present (1=year, 2=year-month, 3=full). */
  granularity: 1 | 2 | 3;
  hasTime: boolean;
}

function splitDateParts(input: string): DateParts {
  let s = input;
  let sign: 1 | -1 = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }

  const spaceIdx = s.indexOf(' ');
  let datePart = s;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let hasTime = false;

  if (spaceIdx !== -1) {
    datePart = s.slice(0, spaceIdx);
    const tp = s.slice(spaceIdx + 1).split(':');
    if (tp.length >= 2) {
      hasTime = true;
      hour = parseInt(tp[0]!, 10) || 0;
      minute = parseInt(tp[1]!, 10) || 0;
      second = tp.length >= 3 ? parseInt(tp[2]!, 10) || 0 : 0;
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  const granularity = (parts.length >= 3 ? 3 : parts.length === 2 ? 2 : 1) as
    | 1
    | 2
    | 3;
  return {
    sign,
    year: parts[0]!,
    month: parts.length >= 2 ? parts[1]! : 1,
    day: parts.length >= 3 ? parts[2]! : 1,
    hour,
    minute,
    second,
    granularity,
    hasTime,
  };
}

// ── Duration date arithmetic ─────────────────────────────────

export function addDurationToDate(
  startDate: string,
  amount: number,
  unit: TimelineDurationUnit
): string {
  const p = splitDateParts(startDate);
  const signedYear = p.sign * p.year;

  // Build via a safe placeholder year then force the literal year, dodging the
  // JS `new Date(0..99, …)` → 1900s coercion that bites ancient/BCE years.
  const date = new Date(2000, p.month - 1, p.day, p.hour, p.minute, p.second);
  date.setFullYear(signedYear);

  switch (unit) {
    case 'd':
      date.setDate(date.getDate() + Math.round(amount));
      break;
    case 'w':
      date.setDate(date.getDate() + Math.round(amount * 7));
      break;
    case 'm': {
      const wholeMonths = Math.floor(amount);
      const fractionalDays = Math.round((amount - wholeMonths) * 30);
      date.setMonth(date.getMonth() + wholeMonths);
      if (fractionalDays > 0) {
        date.setDate(date.getDate() + fractionalDays);
      }
      break;
    }
    case 'y': {
      const wholeYears = Math.floor(amount);
      const fractionalMonths = Math.round((amount - wholeYears) * 12);
      date.setFullYear(date.getFullYear() + wholeYears);
      if (fractionalMonths > 0) {
        date.setMonth(date.getMonth() + fractionalMonths);
      }
      break;
    }
    case 'h':
      date.setTime(date.getTime() + amount * 3600000);
      break;
    case 'min':
      date.setTime(date.getTime() + amount * 60000);
      break;
    case 's':
      date.setTime(date.getTime() + amount * 1000);
      break;
  }

  const outYear = date.getFullYear();
  const neg = outYear < 0 ? '-' : '';
  const endYear = Math.abs(outYear);
  const endMonth = String(date.getMonth() + 1).padStart(2, '0');
  const endDay = String(date.getDate()).padStart(2, '0');
  const endHour = String(date.getHours()).padStart(2, '0');
  const endMinute = String(date.getMinutes()).padStart(2, '0');
  const endSecond = String(date.getSeconds()).padStart(2, '0');
  const hasTime = unit === 'h' || unit === 'min' || unit === 's' || p.hasTime;
  const showSeconds = unit === 's' || p.second !== 0 || date.getSeconds() !== 0;

  if (p.granularity === 1) {
    return `${neg}${endYear}`;
  } else if (p.granularity === 2) {
    return `${neg}${endYear}-${endMonth}`;
  } else if (
    hasTime &&
    (date.getHours() !== 0 ||
      date.getMinutes() !== 0 ||
      date.getSeconds() !== 0)
  ) {
    const time = showSeconds
      ? `${endHour}:${endMinute}:${endSecond}`
      : `${endHour}:${endMinute}`;
    return `${neg}${endYear}-${endMonth}-${endDay} ${time}`;
  } else {
    return `${neg}${endYear}-${endMonth}-${endDay}`;
  }
}

export function parseTimelineDate(s: string): number {
  const p = splitDateParts(s);
  // BCE years count down toward 0, but months/days within a year still advance
  // forward — so anchor on the signed year and ADD positive sub-year offsets.
  // (753 BCE Jan = -753.0 < 753 BCE Dec = -752.08 < 752 BCE Jan = -752.0.)
  const yearBase = p.sign * p.year;
  return (
    yearBase +
    (p.month - 1) / 12 +
    (p.day - 1) / 365 +
    p.hour / 8760 +
    p.minute / 525600 +
    p.second / 31536000
  );
}

// ── Event line parser ────────────────────────────────────────

export interface ParseEventResult {
  event: TimelineEvent | null;
  diagnostics: DgmoError[];
}

export function parseTimelineEventLine(
  line: string,
  lineNumber: number,
  currentGroup: string | null,
  groupMetadata: Record<string, string>,
  aliasMap: Map<string, string>,
  registry?: ReservedKeyRegistry
): ParseEventResult | null {
  const diagnostics: DgmoError[] = [];

  const prefix = extractDatePrefix(line);
  if (!prefix) {
    // Check if line starts with digits but doesn't match date format
    if (/^\d/.test(line)) {
      const firstToken = line.split(/\s/)[0]!;
      if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(firstToken)) {
        diagnostics.push(
          makeDgmoError(
            lineNumber,
            `Expected date format YYYY, YYYY-MM, or YYYY-MM-DD. Got '${firstToken}'.`,
            'warning'
          )
        );
        return { event: null, diagnostics };
      }
    }
    return null;
  }

  // Validate times
  if (!prefix.startTimeValid && prefix.invalidStartTime) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `Invalid time '${prefix.invalidStartTime}'. Hours must be 0-23, minutes 0-59.`,
        'warning'
      )
    );
  }
  if (!prefix.endTimeValid && prefix.invalidEndTime) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        `Invalid time '${prefix.invalidEndTime}'. Hours must be 0-23, minutes 0-59.`,
        'warning'
      )
    );
  }

  // Check for bare date with no name after
  if (!prefix.remainder) {
    diagnostics.push(
      makeDgmoError(lineNumber, 'Event needs a name after the date.', 'warning')
    );
    return { event: null, diagnostics };
  }

  const tlRegistry =
    registry ??
    withTagAliases(
      TIMELINE_REGISTRY,
      new Set([...aliasMap.keys(), ...aliasMap.values()])
    );

  const split = splitNameAndMeta(prefix.remainder, tlRegistry, aliasMap);
  warnUnknownMetaKeys(split.meta, tlRegistry, (msg) =>
    diagnostics.push(makeDgmoError(lineNumber, msg, 'warning'))
  );

  const name = split.name;
  let endDate = prefix.endDate;
  let uncertain = prefix.uncertain;
  const metadata: Record<string, string> = { ...split.meta };

  // Handle duration: metadata key overrides positional
  let duration: { amount: number; unit: TimelineDurationUnit } | null = null;

  if (metadata['duration']) {
    const durStr = metadata['duration'];
    const uncertainMatch = durStr.match(/^(.+)\?$/);
    const cleanDur = uncertainMatch ? uncertainMatch[1]! : durStr;
    if (uncertainMatch) uncertain = true;
    const durMatch = cleanDur.match(TIMELINE_DURATION_RE);
    if (durMatch) {
      duration = {
        amount: parseFloat(durMatch[1]!),
        unit: durMatch[2]! as TimelineDurationUnit,
      };
    } else {
      diagnostics.push(
        makeDgmoError(
          lineNumber,
          `Invalid duration '${durStr}'. Expected format like "30d", "2w", "1.5m", "1y", "2h", "30min", "45s".`,
          'warning'
        )
      );
    }
    delete metadata['duration'];
  }

  // Warn if both end date and duration present
  if (endDate && duration) {
    diagnostics.push(
      makeDgmoError(
        lineNumber,
        'Event has both an end date and duration. End date takes precedence.',
        'warning'
      )
    );
  }

  // Compute endDate from duration if no explicit end date
  if (!endDate && duration) {
    endDate = addDurationToDate(
      prefix.startDate,
      duration.amount,
      duration.unit
    );
  }

  // Re-append trailing color to label if present
  let label = name;
  if (split.color !== undefined) {
    label = `${label} ${split.color}`;
  }

  // Merge group metadata (group defaults, event overrides)
  const mergedMetadata: Record<string, string> = {
    ...groupMetadata,
    ...metadata,
  };
  if (split.color) {
    mergedMetadata['color'] = split.color;
  }

  // Remove color from merged metadata — it goes on the label as trailing token
  const eventMeta = { ...mergedMetadata };
  if (split.color) delete eventMeta['color'];

  const event: TimelineEvent = {
    date: prefix.startDate,
    endDate,
    label,
    group: currentGroup,
    metadata: eventMeta,
    lineNumber,
    ...(uncertain ? { uncertain: true } : {}),
  };

  return { event, diagnostics };
}
