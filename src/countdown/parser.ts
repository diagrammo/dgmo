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
//   Recurring — ONE date, in `since`; `every` carries only the cadence:
//     since <date|datetime>           // the origin instant (REQUIRED)
//     every <year|month|month by [last] weekday|week|day|N days|weeks|months>
//     on-day <text>                   // shown on the occurrence day
//     since-label <template>          // opt-in ordinal eyebrow (Nth / N)
//   `on`, `at` and `from` were RETIRED (decision #56) — every calendar field is
//   derived from the `since` anchor, so no two lines can disagree about a date.
//   A bare `since <date>` with no `every` means yearly.
//
//   Display (both):
//     units <human|days|full|clock|weeks|words> / round <up|down|nearest>
//     fields <d,h,m,s> / lang <en> / no-visual   // suppress the calendar band
//
// A block has EITHER `target` OR `every`, never both.

import type { PaletteColors } from '../palettes';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  extractColor,
  fillModeFromToken,
  measureIndent,
  parseFirstLine,
} from '../utils/parsing';
import { normalizeDate, type DateOrder } from '../utils/date';
import type { ParsedCountdown } from './types';
import {
  monthIndex,
  weekdayIndex,
  resolveNext,
  ruleFromAnchor,
  targetToMs as resolveTargetToMs,
  type Cadence,
  type CountUnits,
  type Field,
  type RoundMode,
} from './resolve';

/** Slots that used to sit on `every` and now live on `since` (decision #56). */
const RETIRED_SLOTS = new Set(['on', 'at', 'from']);

/** What to tell someone who wrote a slot that has moved onto `since`. */
function retiredSlotMessage(slot: string): string {
  if (slot === 'at')
    return '`at` is gone — the time rides the anchor: `since 2026-01-05T18:00`, then `every week`.';
  if (slot === 'from')
    return '`from` is gone — the anchor is `since <date>`: `since 2026-07-03`, then `every 2 weeks`.';
  return '`on` is gone — the date lives in `since`: `since 2026-08-21`, then `every year`.';
}

/**
 * The cadence half of `every` — a shape, never a date. `month` follows the
 * anchor's day-of-month; `month by weekday` follows its nth weekday, the one
 * reading a bare date cannot settle on its own.
 */
function parseCadence(toks: readonly string[]): Cadence | null {
  const low = toks.map((t) => t.toLowerCase());
  const head = low[0] ?? '';
  if (low.length === 1) {
    if (head === 'year') return { kind: 'year' };
    if (head === 'week') return { kind: 'week' };
    if (head === 'month') return { kind: 'month' };
    if (head === 'day') return { kind: 'interval', n: 1, unit: 'day' };
    return null;
  }
  if (head === 'month' && low[1] === 'by') {
    if (low[2] === 'weekday' && low.length === 3)
      return { kind: 'month-weekday', last: false };
    if (low[2] === 'last' && low[3] === 'weekday' && low.length === 4)
      return { kind: 'month-weekday', last: true };
    return null;
  }
  if (low.length === 2 && /^\d+$/.test(head)) {
    const unit = low[1]!.replace(/s$/, '');
    if (unit === 'day' || unit === 'week' || unit === 'month') {
      const n = Number(head);
      if (n >= 1) return { kind: 'interval', n, unit };
    }
  }
  return null;
}

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

/** Convert an am/pm token to its canonical 24h string (matches clock `hours`). */
function ampmTo24h(tok: string): string | null {
  const m = tok.match(AMPM_RE);
  if (!m) return null;
  const h = Number(m[1]);
  if (h < 1 || h > 12) return null;
  let hour = h % 12;
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
    sinceMs: null,
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
  let cadence: Cadence | null = null;
  // Raw date strings, resolved to ms AFTER the loop so a `tz` line can appear in
  // any order relative to `target` / `since`.
  let sinceRaw: string | null = null;
  let sinceLine = 0;
  let sinceMs: number | null = null;
  let sinceHasTime = false;
  let targetRaw: string | null = null;
  let targetIsNow = false;
  let targetLine = 1;
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
        // `every` carries the cadence and nothing else — the instant comes from
        // `since`, so there is no slot here for a second date to live in.
        const toks = rest.split(/\s+/).filter(Boolean);
        const stray = toks.find((t) => RETIRED_SLOTS.has(t.toLowerCase()));
        if (stray)
          return fail(lineNum, retiredSlotMessage(stray.toLowerCase()));
        const parsed = parseCadence(toks);
        if (!parsed) {
          emitFreeProseError(lineNum, rest, softError);
          break;
        }
        cadence = parsed;
        break;
      }

      // The standalone slot lines are retired alongside their `every` slots.
      case 'on':
      case 'at':
      case 'from':
        return fail(lineNum, retiredSlotMessage(key));

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
        // Deferred like `target` so a `tz` line further down still pins it.
        sinceRaw = rest;
        sinceLine = lineNum;
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

      // ── §1.9 fill family — mutually exclusive bare flags, last one wins;
      //    `fill-tint` is the explicit spelling of the default (clears it). ──
      case 'fill-tint':
      case 'fill-solid':
      case 'fill-outline': {
        const fm = fillModeFromToken(key);
        if (fm === 'solid' || fm === 'outline') result.fillMode = fm;
        else delete result.fillMode;
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
  if (sinceRaw !== null) {
    // A bare year was the old spelling; it carries no month or day, so under the
    // one-date rule there is nothing for the cadence to derive from.
    if (/^\d{4}$/.test(sinceRaw.trim())) {
      return fail(
        sinceLine,
        `"since" needs a full date now (got the bare year "${sinceRaw.trim()}") — write \`since ${sinceRaw.trim()}-06-14\`. The month and day that used to sit on \`every … on\` come from here.`
      );
    }
    const iso = normalizeDate(sinceRaw, { order: dateOrder, year: baseYear });
    const effective = iso ?? sinceRaw;
    const ms = targetToMs(effective, result.tz);
    if (ms === null) {
      return fail(
        sinceLine,
        `"since" needs a date or datetime (got "${sinceRaw}").`
      );
    }
    sinceMs = ms;
    sinceHasTime = effective.includes(':');
  }

  // ── Mutual exclusion ──
  const titleLine = result.titleLineNumber ?? 1;
  if ((hasEvery || sinceRaw !== null) && hasTargetLine) {
    return fail(
      titleLine,
      'A countdown has either `target` (one-shot) or `since`/`every` (recurring), not both.'
    );
  }
  if (hasEvery && sinceMs === null) {
    return fail(
      titleLine,
      '`every` needs a `since <date>` to recur from — it carries the cadence, the anchor carries the date.'
    );
  }
  if (result.expired !== null && (hasEvery || sinceMs !== null)) {
    warn(
      titleLine,
      '`expired` applies only to one-shot `target` blocks; recurring blocks roll forward.'
    );
  }

  // ── Assemble the recurrence rule ──
  if (sinceMs !== null) {
    // A bare `since <date>` with no cadence means yearly — the reading a person
    // expects from a date alone, and the common case (birthdays, anniversaries).
    const rule = ruleFromAnchor(
      cadence ?? { kind: 'year' },
      sinceMs,
      !sinceHasTime,
      result.tz
    );
    result.rule = rule;
    result.resolvedMs = resolveNext(rule, Date.now());
    result.sinceMs = sinceMs;
    if (sinceHasTime) result.hasTime = true;
  } else if (targetMs !== null) {
    result.targetMs = targetMs;
    result.resolvedMs = targetMs;
  }

  if (result.resolvedMs === null && result.error === null) {
    // Nothing resolvable and no hard error yet → a plain missing-target block.
    if (!hasTargetLine && sinceRaw === null) {
      softError(
        titleLine,
        'Missing `target` (one-shot) or `since <date>` (recurring) — a countdown needs one.'
      );
    }
  }

  return result;
}

/** Emit the §2.4 free-prose rejection with a suggested canonical form. */
function emitFreeProseError(
  lineNum: number,
  rest: string,
  softError: (line: number, msg: string) => void
): void {
  const toks = rest.split(/\s+/).filter(Boolean);
  const problems: string[] = [];
  let suggestion = 'every year';

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    const fixed = ampmTo24h(tok);
    if (fixed) {
      problems.push(
        `"${tok}": a time belongs on the anchor (since …T${fixed})`
      );
      continue;
    }
    if (weekdayIndex(tok) !== null) {
      problems.push(`"${tok}": a weekday belongs on the anchor`);
      suggestion = 'every week';
      continue;
    }
    if (monthIndex(tok) !== null && toks[i + 1] && /^\d/.test(toks[i + 1]!)) {
      problems.push(`"${tok} ${toks[i + 1]}": a date belongs on the anchor`);
      suggestion = 'every year';
    }
  }
  if (problems.length === 0)
    problems.push(
      'unknown cadence — use year | month | month by [last] weekday | week | day | N days|weeks|months'
    );

  softError(
    lineNum,
    `\`every\` takes a cadence only. ${problems.join('; ')}. Try: \`since <date>\` + \`${suggestion}\`.`
  );
}
