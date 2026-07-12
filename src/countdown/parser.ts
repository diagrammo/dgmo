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
//     units <days|full|clock|weeks|words> / round <up|down|nearest>
//     fields <d,h,m,s> / lang <en>
//
// A block has EITHER `target` OR `every`, never both.

import type { PaletteColors } from '../palettes';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import { extractColor, measureIndent, parseFirstLine } from '../utils/parsing';
import type { ParsedCountdown, SinceStyle } from './types';
import {
  monthIndex,
  weekdayIndex,
  resolveNext,
  type CountUnits,
  type Field,
  type RecurRule,
  type RoundMode,
} from './resolve';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H_RE = /^(\d{1,2}):(\d{2})$/;
const AMPM_RE = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i;

/**
 * Resolve a one-shot target string to absolute epoch ms. A bare `YYYY-MM-DD` is
 * **local** midnight (JS `new Date("2026-08-21")` would be UTC midnight — wrong
 * for "days until"); a datetime with no offset is local; an offset is honored.
 */
export function targetToMs(target: string): number | null {
  const s = target.trim();
  if (DATE_ONLY_RE.test(s)) {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d).getTime();
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
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
    since: null,
    sinceLabel: null,
    sinceStyle: 'eyebrow',
    units: 'days',
    round: 'up',
    fields: ['d', 'h', 'm', 's'],
    lang: 'en',
    onDay: null,
    expired: null,
    note: null,
    thresholds: null,
    calendar: null,
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
  let anchorMs: number | null = null;
  let targetMs: number | null = null;
  let hasTargetLine = false;
  let hasEvery = false;
  // `note` block: indented lines accumulate here until the next top-level line.
  const noteBody: string[] = [];
  let inNote = false;

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
        if (/^now$/i.test(rest)) {
          targetMs = Date.now();
          result.target = new Date(targetMs).toISOString();
          result.hasTime = true;
        } else {
          const ms = targetToMs(rest);
          if (ms === null) {
            softError(
              lineNum,
              `"target" needs an ISO date/datetime or "now" (got "${rest}").`
            );
          } else {
            result.target = rest;
            targetMs = ms;
            if (rest.includes('T')) result.hasTime = true;
          }
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
        if (head === 'year' || head === 'month' || head === 'week') {
          cadence = head;
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
          const ms = targetToMs(seg.from.join(' '));
          if (ms === null) {
            softError(
              lineNum,
              `"from" needs an anchor date (got "${seg.from.join(' ')}").`
            );
          } else {
            anchorMs = ms;
          }
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
        const ms = targetToMs(rest);
        if (ms === null) {
          softError(lineNum, `"from" needs an anchor date (got "${rest}").`);
        } else {
          anchorMs = ms;
        }
        break;
      }

      // ── Ordinal / since ──
      case 'since': {
        const y = Number(rest);
        if (Number.isInteger(y) && y > 0) result.since = y;
        else softError(lineNum, `"since" needs a year (got "${rest}").`);
        break;
      }
      case 'since-label':
        result.sinceLabel = rest || null;
        break;
      case 'since-style': {
        const v = rest.toLowerCase();
        if (
          v === 'eyebrow' ||
          v === 'headline' ||
          v === 'tenure' ||
          v === 'inline'
        ) {
          result.sinceStyle = v as SinceStyle;
        } else {
          warn(lineNum, `Unknown since-style "${rest}" — using eyebrow.`);
        }
        break;
      }

      // ── Display ──
      case 'units': {
        const v = rest.toLowerCase();
        if (
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
            `Unknown units "${rest}" — use days|full|clock|weeks|words|compound.`
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
      case 'on-day':
        result.onDay = rest || null;
        break;
      case 'expired':
        result.expired = rest;
        break;

      // ── `calendar <year|month|week>` — you-are-here → event band. ──
      case 'calendar': {
        const v = rest.toLowerCase();
        if (v === 'year' || v === 'month' || v === 'week') {
          result.calendar = v;
        } else {
          warn(lineNum, `"calendar" needs year|month|week (got "${rest}").`);
        }
        break;
      }

      // ── `thresholds <amber> <red>` — traffic-light urgency ramp (days). ──
      case 'thresholds': {
        const nums = rest
          .split(/[,\s]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length === 2 && nums[0]! > nums[1]!) {
          result.thresholds = [nums[0]!, nums[1]!];
        } else {
          warn(
            lineNum,
            `"thresholds" needs two day counts, amber > red (e.g. thresholds 30 7).`
          );
        }
        break;
      }

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
      result.rule = rule;
      result.resolvedMs = resolveNext(rule, Date.now());
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

  if (cadence === 'interval') {
    return {
      kind: 'interval',
      intervalN: interval.intervalN,
      intervalUnit: interval.intervalUnit,
      anchorMs: interval.anchorMs ?? undefined,
      hour,
      minute,
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
    };
  }

  if (cadence === 'month') {
    if (onSpec?.nth === undefined || onSpec.weekday === undefined) {
      softError(
        lineNum,
        '`every month` needs `on <nth> <weekday>` or `on last <weekday>`.'
      );
      return null;
    }
    return onSpec.nth < 0
      ? { kind: 'last-weekday', weekday: onSpec.weekday, hour, minute }
      : {
          kind: 'nth-weekday',
          nth: onSpec.nth,
          weekday: onSpec.weekday,
          hour,
          minute,
        };
  }

  // week
  if (onSpec?.weekday === undefined || onSpec.nth !== undefined) {
    softError(lineNum, '`every week` needs `on <weekday>` (e.g. on Friday).');
    return null;
  }
  return { kind: 'weekly', weekday: onSpec.weekday, hour, minute };
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
