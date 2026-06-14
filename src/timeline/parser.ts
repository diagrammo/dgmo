import type { DgmoError } from '../diagnostics';
import {
  makeDgmoError,
  METADATA_DIAGNOSTIC_CODES,
  timelineBareDurationRemovedMessage,
} from '../diagnostics';
import { splitNameAndMeta, warnUnknownMetaKeys } from '../utils/parsing';
import {
  TIMELINE_REGISTRY,
  withTagAliases,
  type ReservedKeyRegistry,
} from '../utils/reserved-key-registry';
import type { TimelineEvent } from './types';

// ── Duration units supported by timeline (subset of gantt) ───
type TimelineDurationUnit = 'd' | 'w' | 'm' | 'y' | 'h' | 'min';

const TIMELINE_DURATION_RE = /^(\d+(?:\.\d{1,2})?)(min|[dwmyh])(\?)?$/;

// ── Date prefix regex ────────────────────────────────────────
// Matches: YYYY, YYYY-MM, YYYY-MM-DD, YYYY-MM-DD HH:MM
// Optionally followed by -> endDate (with optional ?)
// Captures:
//   1: start date
//   2: optional time (HH:MM) for start — used for validation
//   3: arrow presence (-> or –>)
//   4: end date (if range)
//   5: optional time (HH:MM) for end — used for validation
//   6: uncertain ? on end date
const DATE_RE = /^(\d{4}(?:-\d{2}(?:-\d{2})?)?)/;
const TIME_RE = /^\s+(\d{1,2}:\d{2})/;
const ARROW_RE = /^\s*(?:->|–>)\s*/;

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

function parseTime(timeStr: string): { valid: boolean; h: number; m: number } {
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr!, 10);
  const m = parseInt(mStr!, 10);
  return { valid: h >= 0 && h <= 23 && m >= 0 && m <= 59, h, m };
}

function parseDateWithOptionalTime(input: string): {
  date: string;
  rest: string;
  timeValid: boolean;
  invalidTime: string | undefined;
} | null {
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
    if (valid) {
      date = `${date} ${timeStr}`;
      rest = rest.slice(timeMatch[0].length);
    } else {
      timeValid = false;
      invalidTime = timeStr;
      date = `${date} ${timeStr}`;
      rest = rest.slice(timeMatch[0].length);
    }
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

// ── Duration date arithmetic ─────────────────────────────────

export function addDurationToDate(
  startDate: string,
  amount: number,
  unit: TimelineDurationUnit
): string {
  const spaceIdx = startDate.indexOf(' ');
  let datePart = startDate;
  let hour = 0;
  let minute = 0;

  if (spaceIdx !== -1) {
    datePart = startDate.slice(0, spaceIdx);
    const timePart = startDate.slice(spaceIdx + 1);
    const tp = timePart.split(':');
    if (tp.length === 2) {
      hour = parseInt(tp[0]!, 10);
      minute = parseInt(tp[1]!, 10);
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  const year = parts[0]!;
  const month = parts.length >= 2 ? parts[1]! : 1;
  const day = parts.length >= 3 ? parts[2]! : 1;

  const date = new Date(year, month - 1, day, hour, minute);

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
  }

  const endYear = date.getFullYear();
  const endMonth = String(date.getMonth() + 1).padStart(2, '0');
  const endDay = String(date.getDate()).padStart(2, '0');
  const endHour = String(date.getHours()).padStart(2, '0');
  const endMinute = String(date.getMinutes()).padStart(2, '0');
  const hasTime = unit === 'h' || unit === 'min' || spaceIdx !== -1;

  if (parts.length === 1) {
    return String(endYear);
  } else if (parts.length === 2) {
    return `${endYear}-${endMonth}`;
  } else if (hasTime && (date.getHours() !== 0 || date.getMinutes() !== 0)) {
    return `${endYear}-${endMonth}-${endDay} ${endHour}:${endMinute}`;
  } else {
    return `${endYear}-${endMonth}-${endDay}`;
  }
}

export function parseTimelineDate(s: string): number {
  const spaceIdx = s.indexOf(' ');
  let datePart = s;
  let hour = 0;
  let minute = 0;

  if (spaceIdx !== -1) {
    datePart = s.slice(0, spaceIdx);
    const timePart = s.slice(spaceIdx + 1);
    const timeParts = timePart.split(':');
    if (timeParts.length === 2) {
      hour = parseInt(timeParts[0]!, 10);
      minute = parseInt(timeParts[1]!, 10);
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  const year = parts[0]!;
  const month = parts.length >= 2 ? parts[1]! : 1;
  const day = parts.length >= 3 ? parts[2]! : 1;
  return (
    year + (month - 1) / 12 + (day - 1) / 365 + hour / 8760 + minute / 525600
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

  let name = split.name;
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
          `Invalid duration '${durStr}'. Expected format like "30d", "2w", "1.5m", "1y".`,
          'warning'
        )
      );
    }
    delete metadata['duration'];
  }

  // Right-to-left scan for positional duration (only if no explicit duration key and no end date)
  if (!duration && !endDate) {
    const tokens = name.split(/\s+/).filter(Boolean);
    for (let j = tokens.length - 1; j >= 0; j--) {
      const m = tokens[j]!.match(TIMELINE_DURATION_RE);
      if (m) {
        // Guard: require at least one non-duration word before the duration token
        if (j < 1) break;
        // Removed at 1.0: `duration:` is canonical; the positional form is a
        // hard error directing to it. Value is still applied so it renders.
        diagnostics.push(
          makeDgmoError(
            lineNumber,
            timelineBareDurationRemovedMessage(tokens[j]!),
            'error',
            METADATA_DIAGNOSTIC_CODES.TIMELINE_BARE_DURATION_REMOVED
          )
        );
        duration = {
          amount: parseFloat(m[1]!),
          unit: m[2]! as TimelineDurationUnit,
        };
        if (m[3]) uncertain = true;
        name = tokens.slice(0, j).join(' ');
        break;
      }
    }
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
