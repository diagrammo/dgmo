// ============================================================
// Countdown chart — Parser
// ============================================================
//
// Syntax (verify against docs/dgmo-language-spec.md, not fixtures):
//   countdown <Title>                 // trailing color token ok (§1.5)
//
//   One-shot (absolute target):
//     target <ISO date|datetime|now>
//     expired <text>                  // shown once passed (one-shot only)
//
//   Recurring (fixed-slot grammar — NOT free prose, see §2.4). One line:
//     every <year|month|week|N days|weeks|months> [on <instant>] [at <time>] [from <anchor>]
//       on   Aug 21 | 3rd Tuesday | last Friday | Friday
//       at   18:00                    // 24h, default midnight
//       from 2026-07-03               // interval cadences only
//     (each slot may also sit on its own line.)
//     on-day <text>                   // shown on the occurrence day
//     since <year> / since-label <noun> / since-style <eyebrow|headline|tenure|inline>
//
//   Display (both):
//     units <human|days|full|clock|weeks|words> / round <up|down|nearest>
//     fields <d,h,m,s> / lang <en> / no-visual   // suppress the calendar band
//
// A block has EITHER `target` OR `every`, never both.

import type { PaletteColors } from '../palettes';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import { extractColor, measureIndent, parseFirstLine } from '../utils/parsing';
import { normalizeDate, type DateOrder } from '../utils/date';
import type { ParsedCountdown } from './types';
import {
  monthIndex,
  weekdayIndex,
  resolveNext,
  targetToMs as resolveTargetToMs,
  type CountUnits,
  type Field,
  type RecurRule,
  type RoundMode,
} from './resolve';

const TIME_24H_RE = /^(\d{1,2}):(\d{2})$/;
const AMPM_RE = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i;

/**
 * Resolve a one-shot target string to absolute epoch ms, or null if unparseable.
 * Thin back-compat wrapper over the canonical (tz-aware) `targetToMs` in
 * `./resolve` — a bare `YYYY-MM-DD` counts to `tz`-midnight (viewer-local when
 * `tz` is null); an ISO offset is always honored as an absolute instant.
 */
export function targetToMs(
  target: string,
  tz: string | null = null
): number | null {
  const ms = resolveTargetToMs(target, tz);
  return Number.isFinite(ms) ? ms : null;
}

/** Whether `zone` is an IANA zone (or `UTC`) that `Intl` recognizes. */
function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The nth-ordinal prefix of an `on` token: `3rd` → 3, `last` → -1, else null. */
function ordinalToken(tok: string): number | null {
  const t = tok.toLowerCase();
  if (t === 'last') return -1;
  const m = t.match(/^(\d+)(?:st|nd|rd|th)?$/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 5 ? n : null;
  }
  return null;
}

/** A 24h `HH:MM` token → {hour,minute}, or null (am/pm handled by the caller). */
function parse24h(tok: string): { hour: number; minute: number } | null {
  const m = tok.match(TIME_24H_RE);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Parse an `at` value; rejects am/pm with a 24h fix suggestion (§2.4). */
function parseAt(
  rest: string,
  lineNum: number,
  softError: (line: number, msg: string) => void
): { hour: number; minute: number } | null {
  const t = parse24h(rest.trim());
  if (t) return t;
  const fixed = ampmTo24h(rest.trim());
  softError(
    lineNum,
    fixed
      ? `"at ${rest}": use 24h time (${fixed}).`
      : `"at" needs a 24h time like 18:00 (got "${rest}").`
  );
  return null;
}

/** Convert an am/pm token to a canonical 24h string for a fix suggestion. */
function ampmTo24h(tok: string): string | null {
  const m = tok.match(AMPM_RE);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (/pm/i.test(m[3]!)) hour += 12;
  return `${String(hour).padStart(2, '0')}:${m[2] ?? '00'}`;
}

export function parseCountdown(
  content: string,
  palette?: PaletteColors
): ParsedCountdown {
  const result: Writable<ParsedCountdown> = {
    type: 'countdown',
    title: null,
    titleLineNumber: null,
    target: null,
    targetMs: null,
    rule: null,
    resolvedMs: null,
    hasTime: false,
    tz: null,
    since: null,
    sinceLabel: null,
    units: 'human',
    round: 'up',
    fields: ['d', 'h', 'm', 's'],
    lang: 'en',
    onDay: null,
    expired: null,
    note: null,
    noVisual: false,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);
  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };
  const softError = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error'));
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');
  let headerParsed = false;

  // Recurrence pieces collected across lines, assembled after the loop.
  let cadence: 'year' | 'month' | 'week' | 'interval' | null = null;
  let intervalN = 1;
  let intervalUnit: 'day' | 'week' | 'month' = 'day';
  let onSpec: {
    month?: number;
    day?: number;
    nth?: number;
    weekday?: number;
  } | null = null;
  let atTime: { hour: number; minute: number } | null = null;
  // Raw target/anchor strings, resolved to ms AFTER the loop so a `tz` line can
  // appear in any order relative to `target`/`from`.
  let targetRaw: string | null = null;
  let targetIsNow = false;
  let targetLine = 1;
  let fromRaw: string | null = null;
  let fromLine = 1;
  let anchorMs: number | null = null;
  let targetMs: number | null = null;
  let hasTargetLine = false;
  let hasEvery = false;
  // `note` block: indented lines accumulate here until the next top-level line.
  const noteBody: string[] = [];
  let inNote = false;
  // Universal date directives (§ BL-121). `date-order` picks how a slash date
  // reads; `year` sets the base year for a bare month-day `target`/`from`.
  let dateOrder: DateOrder = 'mdy';
  let baseYear: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // ── First line: `countdown [Title]` ──
    if (!headerParsed) {
      const first = parseFirstLine(trimmed);
      if (first?.chartType !== 'countdown') {
        return fail(lineNum, 'Expected "countdown [Title]" as the first line.');
      }
      if (first.title) {
        const { label, color } = extractColor(
          first.title,
          palette,
          result.diagnostics,
          lineNum
        );
        result.title = label || null;
        if (color !== undefined) result.color = color;
      }
      result.titleLineNumber = lineNum;
      headerParsed = true;
      continue;
    }

    if (measureIndent(raw) > 0) {
      // Indented lines belong to an open `note` block; otherwise ignored.
      if (inNote) noteBody.push(trimmed);
      else
        warn(
          lineNum,
          `Indented content "${trimmed}" ignored — countdown is a single value.`
        );
      continue;
    }

    const [keyword, ...restTokens] = trimmed.split(/\s+/);
    const key = keyword!.toLowerCase();
    const rest = restTokens.join(' ').trim();
    // Any top-level line closes an open note block.
    if (key !== 'note') inNote = false;

    switch (key) {
      // ── One-shot target ──
      case 'target': {
        hasTargetLine = true;
        targetLine = lineNum;
        if (/^now$/i.test(rest)) {
          targetIsNow = true;
          result.hasTime = true;
        } else {
          // Defer resolution until after the loop (a `tz` line may follow).
          targetRaw = rest;
          result.target = rest;
          if (rest.includes('T')) result.hasTime = true;
        }
        break;
      }

      // ── Recurrence — the canonical single-line form:
      //   every <cadence> [on <instant>] [at <time>] [from <date>]
      // (each slot may also appear on its own line — handled below.)
      case 'every': {
        hasEvery = true;
        // Split the line into cadence / on / at / from segments by keyword.
        const seg: Record<'cadence' | 'on' | 'at' | 'from', string[]> = {
          cadence: [],
          on: [],
          at: [],
          from: [],
        };
        let cur: keyof typeof seg = 'cadence';
        for (const tok of rest.split(/\s+/).filter(Boolean)) {
          const low = tok.toLowerCase();
          if (low === 'on' || low === 'at' || low === 'from') cur = low;
          else seg[cur].push(tok);
        }

        const head = (seg.cadence[0] ?? '').toLowerCase();
        // `every {day|week|month} from <date>` (no `on`) is a plain interval, N=1
        // — so "every month from the 31st" works, not just "every 2 months from".
        const bareInterval =
          (head === 'day' || head === 'week' || head === 'month') &&
          seg.from.length > 0 &&
          seg.on.length === 0;
        if (bareInterval) {
          cadence = 'interval';
          intervalN = 1;
          intervalUnit = head as 'day' | 'week' | 'month';
        } else if (head === 'year' || head === 'month' || head === 'week') {
          cadence = head;
        } else if (head === 'day') {
          softError(
            lineNum,
            '`every day` needs `from <date>` (an interval anchor).'
          );
          break;
        } else if (/^\d+$/.test(head) && seg.cadence[1]) {
          const unit = seg.cadence[1]!.toLowerCase().replace(/s$/, '');
          if (unit === 'day' || unit === 'week' || unit === 'month') {
            cadence = 'interval';
            intervalN = Number(head);
            intervalUnit = unit as 'day' | 'week' | 'month';
          } else {
            softError(
              lineNum,
              `every ${head} <days|weeks|months> — unknown unit "${seg.cadence[1]}".`
            );
          }
        } else {
          emitFreeProseError(lineNum, rest, softError);
          break;
        }

        if (seg.on.length)
          onSpec = parseOn(seg.on.join(' '), lineNum, softError);
        if (seg.at.length)
          atTime = parseAt(seg.at.join(' '), lineNum, softError);
        if (seg.from.length) {
          fromRaw = seg.from.join(' ');
          fromLine = lineNum;
        }
        break;
      }

      // Standalone slot lines (lenient multi-line form).
      case 'on': {
        onSpec = parseOn(rest, lineNum, softError);
        break;
      }

      case 'at': {
        const t = parseAt(rest, lineNum, softError);
        if (t) atTime = t;
        break;
      }

      case 'from': {
        fromRaw = rest;
        fromLine = lineNum;
        break;
      }

      // ── Universal date directives (§ BL-121) ──
      case 'date-order': {
        const v = rest.toLowerCase();
        if (v === 'mdy' || v === 'dmy') dateOrder = v;
        else
          softError(lineNum, `"date-order" is "mdy" or "dmy" (got "${rest}").`);
        break;
      }
      case 'year': {
        const y = parseInt(rest, 10);
        if (Number.isInteger(y) && y > 0) baseYear = y;
        else softError(lineNum, `"year" needs a 4-digit year (got "${rest}").`);
        break;
      }

      // ── Ordinal / since — numbers a yearly occurrence (resolvedYear − since) ──
      case 'since': {
        const y = Number(rest);
        if (Number.isInteger(y) && y > 0) result.since = y;
        else softError(lineNum, `"since" needs a year (got "${rest}").`);
        break;
      }
      // The eyebrow template: `Nth` → ordinal word, `N` → the number.
      case 'since-label':
        result.sinceLabel = rest || null;
        break;

      // ── Display ──
      case 'units': {
        const v = rest.toLowerCase();
        if (
          v === 'human' ||
          v === 'days' ||
          v === 'full' ||
          v === 'clock' ||
          v === 'weeks' ||
          v === 'words' ||
          v === 'compound'
        ) {
          result.units = v as CountUnits;
        } else {
          warn(
            lineNum,
            `Unknown units "${rest}" — use human|days|full|clock|weeks|words.`
          );
        }
        break;
      }
      case 'round': {
        const v = rest.toLowerCase();
        if (v === 'up' || v === 'down' || v === 'nearest') {
          result.round = v as RoundMode;
        } else {
          warn(lineNum, `Unknown round "${rest}" — use up|down|nearest.`);
        }
        break;
      }
      case 'fields': {
        const set = rest
          .split(/[,\s]+/)
          .map((f) => f.toLowerCase())
          .filter((f): f is Field => ['d', 'h', 'm', 's'].includes(f));
        if (set.length) result.fields = set;
        else
          warn(lineNum, `"fields" needs a subset of d,h,m,s (got "${rest}").`);
        break;
      }
      case 'lang':
        result.lang = rest.toLowerCase() || 'en';
        break;

      // ── `tz <IANA>` — pin authored wall-clock times to a zone (§36 tz slot).
      //    Space-separated (no colon), an IANA id like `America/New_York`. ──
      case 'tz': {
        const zone = rest.trim();
        if (!zone) {
          warn(lineNum, '"tz" needs an IANA zone like America/New_York.');
        } else if (!isValidZone(zone)) {
          warn(
            lineNum,
            `Unknown time zone "${zone}" — use an IANA id like America/New_York. Counting viewer-local.`
          );
        } else {
          result.tz = zone;
        }
        break;
      }
      case 'on-day':
        result.onDay = rest || null;
        break;
      case 'expired':
        result.expired = rest;
        break;

      // ── `no-visual` — suppress the default-on calendar band (§36.6). ──
      case 'no-visual':
        result.noVisual = true;
        break;

      // ── `note` — markdown caption; inline value or indented body block. ──
      case 'note':
        inNote = true;
        if (rest) noteBody.push(rest);
        break;

      default:
        warn(lineNum, `Unrecognized line "${trimmed}".`);
    }
  }

  if (noteBody.length) result.note = noteBody.join('\n');

  // ── Resolve deferred target/anchor now that `tz` (if any) is known ──
  if (targetIsNow) {
    targetMs = Date.now();
    result.target = new Date(targetMs).toISOString();
  } else if (targetRaw !== null) {
    // Liberal input → canonical ISO (slash/month-name/bare → YYYY-MM-DD). A
    // string carrying its own offset or `now` returns null here and passes
    // through to targetToMs unchanged (absolute-instant path).
    const iso = normalizeDate(targetRaw, { order: dateOrder, year: baseYear });
    const effective = iso ?? targetRaw;
    const ms = targetToMs(effective, result.tz);
    if (ms === null) {
      softError(
        targetLine,
        `"target" needs a date/datetime or "now" (got "${targetRaw}").`
      );
    } else {
      targetMs = ms;
      if (iso) {
        result.target = iso;
        if (iso.includes(':')) result.hasTime = true;
      }
    }
  }
  if (fromRaw !== null) {
    const iso = normalizeDate(fromRaw, { order: dateOrder, year: baseYear });
    const ms = targetToMs(iso ?? fromRaw, result.tz);
    if (ms === null) {
      softError(fromLine, `"from" needs an anchor date (got "${fromRaw}").`);
    } else {
      anchorMs = ms;
    }
  }

  // ── Mutual exclusion ──
  if (hasEvery && hasTargetLine) {
    softError(
      result.titleLineNumber ?? 1,
      'A countdown has either `target` (one-shot) or `every` (recurring), not both.'
    );
  }
  if (result.expired !== null && hasEvery) {
    warn(
      result.titleLineNumber ?? 1,
      '`expired` applies only to one-shot `target` blocks; recurring blocks roll forward.'
    );
  }

  // ── Assemble the recurrence rule ──
  if (hasEvery && cadence) {
    const rule = assembleRule(
      cadence,
      { intervalN, intervalUnit, anchorMs },
      onSpec,
      atTime,
      result.titleLineNumber ?? 1,
      softError
    );
    if (rule) {
      // Attach the zone so resolveNext anchors the `at`/`on` wall-clock in it.
      const tzRule: RecurRule = result.tz ? { ...rule, tz: result.tz } : rule;
      result.rule = tzRule;
      result.resolvedMs = resolveNext(tzRule, Date.now());
      if (atTime) result.hasTime = true;
    }
  } else if (targetMs !== null) {
    result.targetMs = targetMs;
    result.resolvedMs = targetMs;
  }

  if (result.resolvedMs === null && result.error === null) {
    // Nothing resolvable and no hard error yet → a plain missing-target block.
    if (!hasEvery && !hasTargetLine) {
      softError(
        result.titleLineNumber ?? 1,
        'Missing `target` or `every` — a countdown needs one.'
      );
    }
  }

  return result;
}

/** Parse an `on <…>` value into month/day, nth-weekday, last-weekday, or weekday. */
function parseOn(
  rest: string,
  lineNum: number,
  softError: (line: number, msg: string) => void
): { month?: number; day?: number; nth?: number; weekday?: number } | null {
  const toks = rest.split(/\s+/).filter(Boolean);
  if (toks.length === 0) {
    softError(
      lineNum,
      '"on" needs a target (e.g. "Aug 21", "3rd Tuesday", "Friday").'
    );
    return null;
  }

  // `last Friday` / `3rd Tuesday` — ordinal + weekday.
  const ord = ordinalToken(toks[0]!);
  if (ord !== null && toks[1]) {
    const wd = weekdayIndex(toks[1]!);
    if (wd === null) {
      softError(lineNum, `"${toks[1]}" is not a weekday.`);
      return null;
    }
    return { nth: ord, weekday: wd };
  }

  // `Aug 21` — month + day.
  const mo = monthIndex(toks[0]!);
  if (mo !== null && toks[1]) {
    const day = Number(toks[1]!.replace(/(st|nd|rd|th)$/i, ''));
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      softError(lineNum, `"${toks[1]}" is not a valid day of month.`);
      return null;
    }
    return { month: mo, day };
  }

  // Bare weekday — weekly.
  const wd = weekdayIndex(toks[0]!);
  if (wd !== null) return { weekday: wd };

  softError(
    lineNum,
    `"on ${rest}" — use "Aug 21", "3rd Tuesday", "last Friday", or a weekday.`
  );
  return null;
}

/** Combine cadence + on + at into a RecurRule, validating the pairing. */
function assembleRule(
  cadence: 'year' | 'month' | 'week' | 'interval',
  interval: {
    intervalN: number;
    intervalUnit: 'day' | 'week' | 'month';
    anchorMs: number | null;
  },
  onSpec: {
    month?: number;
    day?: number;
    nth?: number;
    weekday?: number;
  } | null,
  atTime: { hour: number; minute: number } | null,
  lineNum: number,
  softError: (line: number, msg: string) => void
): RecurRule | null {
  const hour = atTime?.hour ?? 0;
  const minute = atTime?.minute ?? 0;
  const allDay = atTime === null; // no `at` → whole-day occurrence

  if (cadence === 'interval') {
    return {
      kind: 'interval',
      intervalN: interval.intervalN,
      intervalUnit: interval.intervalUnit,
      anchorMs: interval.anchorMs ?? undefined,
      hour,
      minute,
      allDay,
    };
  }

  if (cadence === 'year') {
    if (onSpec?.month === undefined || onSpec.day === undefined) {
      softError(
        lineNum,
        '`every year` needs `on <Month> <Day>` (e.g. on Aug 21).'
      );
      return null;
    }
    return {
      kind: 'month-day',
      month: onSpec.month,
      day: onSpec.day,
      hour,
      minute,
      allDay,
    };
  }

  if (cadence === 'month') {
    if (onSpec?.nth === undefined || onSpec.weekday === undefined) {
      softError(
        lineNum,
        '`every month` needs `on <nth> <weekday>`, `on last <weekday>`, or `from <date>`.'
      );
      return null;
    }
    return onSpec.nth < 0
      ? { kind: 'last-weekday', weekday: onSpec.weekday, hour, minute, allDay }
      : {
          kind: 'nth-weekday',
          nth: onSpec.nth,
          weekday: onSpec.weekday,
          hour,
          minute,
          allDay,
        };
  }

  // week
  if (onSpec?.weekday === undefined || onSpec.nth !== undefined) {
    softError(lineNum, '`every week` needs `on <weekday>` (e.g. on Friday).');
    return null;
  }
  return { kind: 'weekly', weekday: onSpec.weekday, hour, minute, allDay };
}

/** Emit the §2.4 free-prose rejection with a suggested canonical form. */
function emitFreeProseError(
  lineNum: number,
  rest: string,
  softError: (line: number, msg: string) => void
): void {
  const toks = rest.split(/\s+/).filter(Boolean);
  const problems: string[] = [];
  let onPart = '';
  let atPart = '';

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    const fixed = ampmTo24h(tok);
    if (fixed) {
      problems.push(`"${tok}": use 24h time (${fixed})`);
      atPart = ` at ${fixed}`;
      continue;
    }
    const wd = weekdayIndex(tok);
    if (wd !== null) onPart = `week on ${tok}`;
    const mo = monthIndex(tok);
    if (mo !== null && toks[i + 1] && /^\d/.test(toks[i + 1]!)) {
      onPart = `year on ${tok} ${toks[i + 1]}`;
    }
  }

  if (!onPart && !atPart) {
    problems.push(
      'bare cadence — use year | month | week | N days|weeks|months'
    );
  } else if (onPart.startsWith('week')) {
    problems.push('bare weekday needs a cadence');
  }

  const suggestion = onPart
    ? `every ${onPart}${atPart}`
    : `every week …${atPart}`;
  softError(
    lineNum,
    `Free-form recurrence rejected. ${problems.join('; ')}. Try: ${suggestion}`
  );
}
