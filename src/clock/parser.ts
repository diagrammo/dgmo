// ============================================================
// Clock chart — Parser
// ============================================================
//
// Syntax (verify against docs/dgmo-language-spec.md, not fixtures). Flat, NO
// indentation — the first line is `clock <Title>`; every other non-blank line
// is EITHER a board-level directive (its first token is an option keyword) or
// an ENTRY (a place row):
//
//   clock <Title>
//   face   <analog|digital>            // default digital; either/or, never both
//   hours  <start>-<end>               // 9-17 · 9am-5pm · 8:30-5:15 (bare→PM)
//   days   <mon-fri|mon,wed,fri>       // working days (default mon-fri)
//   sun    <true|false>                // sundown/sunrise line; default on
//   time-24 / time-12                  // 24h vs 12h am/pm (default 12h)
//
//   <place tokens…> <IANA/Zone> [as <label…>]
//
// The zone is the token containing `/` (or a known IANA zone / `UTC`); text
// before it is the place, `as <label>` the display alias (default = place).
// Order-independent; blank lines allowed. No colons anywhere.

import type { PaletteColors } from '../palettes';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import { extractColor, parseFirstLine } from '../utils/parsing';
import { resolveColor } from '../colors';
import type {
  ClockColorBy,
  ClockEntry,
  ParsedClock,
  WorkWindow,
} from './types';
import { coordsFor } from './zone-coords';

/** Board-level directive keywords — a line starting with one is NOT an entry. */
const DIRECTIVES = new Set([
  'analog',
  'hours',
  'days',
  'no-sun',
  'time-24',
  'no-title',
  'direction',
  'color-by',
]);

/** `Intl` short weekday abbreviations, Sun-first (matches `zoneParts`). */
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short weekday token → 0 (Sun) – 6 (Sat), or null. */
function weekdayIndex(token: string): number | null {
  const t = token.trim().toLowerCase().slice(0, 3);
  const i = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(t);
  return i < 0 ? null : i;
}

/** Parse an `H` or `HH:MM` token to minutes-past-midnight, or null. */
/**
 * Parse one side of an `hours` window: `9`, `17`, `8:30` (24h), or `9am`,
 * `5pm`, `8:30am`, `5:15pm` (12h). Returns minutes-past-midnight plus whether a
 * meridiem was explicit (so a bare afternoon end can be inferred — see below).
 */
function parseClockTime(
  token: string
): { readonly min: number; readonly mer: boolean } | null {
  const m = token
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const mer = m[3];
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === 'am') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 24) {
    return null;
  }
  return { min: h * 60 + min, mer: Boolean(mer) };
}

/** Is `zone` a time zone `Intl` recognizes? (bad zones still render as UTC). */
function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Does this token look like a zone? (`/`-bearing, `UTC`, or in our coords). */
function looksLikeZone(token: string): boolean {
  return token.includes('/') || token === 'UTC' || coordsFor(token) !== null;
}

/** Mon–Fri, the default working-day set. */
function defaultWorkDays(): Record<string, boolean> {
  return { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true };
}

/**
 * Parse a `days` value: a range (`mon-fri`) or a comma/space list
 * (`mon,wed,fri`). Returns a set keyed by the `Intl` short weekday, or null on
 * an unusable value.
 */
function parseDays(rest: string): Record<string, boolean> | null {
  const days: Record<string, boolean> = {};
  const range = rest.match(/^([a-z]{3,})\s*-\s*([a-z]{3,})$/i);
  if (range) {
    const a = weekdayIndex(range[1]!);
    const b = weekdayIndex(range[2]!);
    if (a === null || b === null) return null;
    // Walk forward from a to b (inclusive), wrapping through the week.
    let i = a;
    for (let n = 0; n < 7; n++) {
      days[WEEKDAY_ABBR[i]!] = true;
      if (i === b) break;
      i = (i + 1) % 7;
    }
    return days;
  }
  const toks = rest.split(/[,\s]+/).filter(Boolean);
  let any = false;
  for (const tok of toks) {
    const wd = weekdayIndex(tok);
    if (wd !== null) {
      days[WEEKDAY_ABBR[wd]!] = true;
      any = true;
    }
  }
  return any ? days : null;
}

/** The last path segment of a zone, underscores → spaces (`New_York` → `New York`). */
function zoneCity(zone: string): string {
  const seg = zone.split('/').pop() ?? zone;
  return seg.replace(/_/g, ' ');
}

export function parseClock(
  content: string,
  palette?: PaletteColors
): ParsedClock {
  const result: Writable<ParsedClock> = {
    type: 'clock',
    title: null,
    titleLineNumber: null,
    face: 'digital',
    hours12: true,
    sun: true,
    noTitle: false,
    columns: false,
    colorBy: 'place',
    work: null,
    entries: [],
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
  const entries: ClockEntry[] = [];
  let headerParsed = false;

  // Working window pieces, assembled after the loop (days may precede hours).
  let workStart: number | null = null;
  let workEnd: number | null = null;
  let workDays: Record<string, boolean> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i]!;
    // Strip an inline comment (`# …` or `// …`) then trim.
    const trimmed = raw.replace(/\s+(#|\/\/).*$/, '').trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//'))
      continue;

    // ── First line: `clock [Title]` ──
    if (!headerParsed) {
      const first = parseFirstLine(trimmed);
      if (first?.chartType !== 'clock') {
        return fail(lineNum, 'Expected "clock [Title]" as the first line.');
      }
      if (first.title) {
        const { label, color } = extractColor(
          first.title,
          palette,
          result.diagnostics,
          lineNum
        );
        // Clock has no accent-color slot; keep the whole title, ignore color.
        result.title = (color !== undefined ? first.title : label) || null;
      }
      result.titleLineNumber = lineNum;
      headerParsed = true;
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    const key = tokens[0]!.toLowerCase();
    const rest = tokens.slice(1).join(' ').trim();

    // ── Board-level directive? (first token is an option keyword) ──
    if (DIRECTIVES.has(key)) {
      switch (key) {
        case 'analog':
          // Bare flag → analog dials (digital is the default face).
          result.face = 'analog';
          break;
        case 'hours': {
          const m = rest.match(/^(\S+)\s*-\s*(\S+)$/);
          const s = m ? parseClockTime(m[1]!) : null;
          const e = m ? parseClockTime(m[2]!) : null;
          if (!s || !e) {
            softError(
              lineNum,
              `"hours" needs a window like 9-17, 9am-5pm, or 8:30-5:15 (got "${rest}").`
            );
          } else {
            // Smart bare PM: a bare end at/under the start reads as afternoon,
            // so "9-5" → 09:00–17:00 and "8:30-5:15" → 08:30–17:15. An explicit
            // meridiem (`5pm`) or 24h end (`17`) is always taken literally.
            let end = e.min;
            if (!e.mer && end <= s.min && end < 12 * 60) end += 12 * 60;
            workStart = s.min;
            workEnd = end;
          }
          break;
        }
        case 'days': {
          const parsed = parseDays(rest);
          if (parsed === null) {
            softError(
              lineNum,
              `"days" needs weekdays like mon-fri or mon,wed,fri (got "${rest}").`
            );
          } else {
            workDays = parsed;
          }
          break;
        }
        case 'no-sun':
          // The sundown/sunrise line is on by default; this hides it.
          result.sun = false;
          break;
        case 'time-24':
          // 24-hour readout (12-hour am/pm is the default).
          result.hours12 = false;
          break;
        case 'no-title':
          result.noTitle = true;
          break;
        case 'color-by': {
          const v = rest.trim().toLowerCase();
          const modes = ['place', 'work', 'daylight', 'time', 'none'];
          if (v === '' || modes.includes(v)) {
            // bare `color-by` → the default per-place accents.
            result.colorBy = (v || 'place') as ClockColorBy;
          } else {
            warn(
              lineNum,
              `Unknown color-by "${rest}" — use place|work|daylight|time|none.`
            );
          }
          break;
        }
        case 'direction': {
          const v = rest.trim().toLowerCase();
          // LR (left-to-right) → columns; TB (top-to-bottom) → rows (default).
          result.columns = v.startsWith('lr') || v === 'columns';
          break;
        }
      }
      continue;
    }

    // ── Otherwise: an ENTRY (a place row). ──
    const zoneIdx = tokens.findIndex((t) => looksLikeZone(t));
    if (zoneIdx < 0) {
      warn(
        lineNum,
        `No time zone found in "${trimmed}" — expected an IANA zone like America/New_York.`
      );
      continue;
    }
    const zone = tokens[zoneIdx]!;
    const placeTokens = tokens.slice(0, zoneIdx);
    // `as <label> [color]` after the zone → alias + optional trailing palette
    // color; without `as`, a lone trailing color token still applies.
    let label: string | null = null;
    let color: string | undefined;
    const afterZone = tokens.slice(zoneIdx + 1);
    const asIdx = afterZone.findIndex((t) => t.toLowerCase() === 'as');
    if (asIdx >= 0) {
      const ex = extractColor(
        afterZone
          .slice(asIdx + 1)
          .join(' ')
          .trim(),
        palette,
        undefined,
        lineNum
      );
      if (ex.label) label = ex.label;
      color = ex.color;
    } else if (palette && afterZone.length === 1) {
      color = resolveColor(afterZone[0]!, palette) ?? undefined;
    }
    const place = placeTokens.join(' ').trim() || zoneCity(zone);

    if (!isValidZone(zone)) {
      // We can't tell the time without a real zone, so skip the row entirely
      // rather than render a misleading UTC clock.
      warn(
        lineNum,
        `Unknown time zone "${zone}" — row skipped (use an IANA zone like America/New_York).`
      );
      continue;
    }
    const coords = coordsFor(zone);
    entries.push({
      place,
      zone,
      label: label ?? place,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      color: color ?? null,
      lineNumber: lineNum,
    });
  }

  if (!headerParsed) {
    return fail(0, 'Expected "clock [Title]" as the first line.');
  }

  // ── Assemble the working window (only when `hours` was given). ──
  if (workStart !== null && workEnd !== null) {
    const work: WorkWindow = {
      startMin: workStart,
      endMin: workEnd,
      days: workDays ?? defaultWorkDays(),
    };
    result.work = work;
  } else if (workDays !== null) {
    warn(
      result.titleLineNumber ?? 1,
      '`days` has no effect without `hours` — the working-hours status needs a window.'
    );
  }

  result.entries = entries;
  if (entries.length === 0) {
    softError(
      result.titleLineNumber ?? 1,
      'A clock needs at least one place row (e.g. "London Europe/London").'
    );
  }

  return result;
}
