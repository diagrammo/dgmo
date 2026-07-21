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
//   workweek <mon-fri|mon,wed,fri>     // working days (default mon-fri)
//   sun    <true|false>                // sundown/sunrise line; default on
//   time-24 / time-12                  // 24h vs 12h am/pm (default 12h)
//
//   <anchor…> [as <label…>] [color]
//
// The ANCHOR is one of three forms, resolved in this order (§37.3):
//   1. starts `UTC`/`GMT`  → a fixed offset (`UTC`, `UTC+1`, `UTC-7`, `UTC+5:30`)
//   2. contains `/`        → an explicit IANA id (`America/New_York`)
//   3. otherwise           → a city name, resolved via the gazetteer
//                            (exact → alias → ambiguous error → did-you-mean)
// `as <label>` is optional (default = the resolved city / offset label); a
// trailing palette color token pins the row's shade. No place-then-zone pair,
// no colons. Order-independent; blank lines allowed.

import type { PaletteColors } from '../palettes';
import { makeDgmoError, makeFail } from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  extractColor,
  fillModeFromToken,
  parseFirstLine,
} from '../utils/parsing';
import type {
  ClockColorBy,
  ClockEntry,
  ParsedClock,
  WorkWindow,
} from './types';
import { coordsFor } from './zone-coords';
import { parseFixedOffset, formatOffsetLabel } from './resolve';
import { resolvePlace } from './gazetteer';

/** Board-level directive keywords — a line starting with one is NOT an entry. */
const DIRECTIVES = new Set([
  'analog',
  'hours',
  'workweek',
  // Legacy alias for `workweek` (decision #48).
  'days',
  'no-sun',
  'time-24',
  'no-title',
  'legend-inline',
  // Canonical direction booleans (§1.9); key+value `direction <lr|tb>` (and
  // its `columns` value alias) stays parse-accepted legacy. These MUST be in
  // this set — otherwise a bare `direction-lr` line parses as a zone entry.
  'direction-lr',
  'direction-tb',
  'direction',
  'color-by',
  'fill-tint',
  'fill-solid',
  'fill-outline',
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
        // `workweek` is canonical; `days` is the legacy alias (decision #48).
        case 'workweek':
        case 'days': {
          const parsed = parseDays(rest);
          if (parsed === null) {
            softError(
              lineNum,
              `"${key}" needs weekdays like mon-fri or mon,wed,fri (got "${rest}").`
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
        case 'legend-inline':
          // §1.9 universal — accepted as a no-op (clock has no legend).
          break;
        case 'fill-tint':
        case 'fill-solid':
        case 'fill-outline': {
          // §1.9 fill family — mutually exclusive, last one wins; `fill-tint`
          // is the explicit spelling of the default (clears the mode).
          const fm = fillModeFromToken(key);
          if (fm === 'solid' || fm === 'outline') result.fillMode = fm;
          else delete result.fillMode;
          break;
        }
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
        case 'direction-lr':
          // §1.9 boolean — columns (panels laid out in a horizontal strip).
          result.columns = true;
          break;
        case 'direction-tb':
          // §1.9 boolean — rows, the default vertical stack (last one wins).
          result.columns = false;
          break;
        case 'direction': {
          // Legacy key+value form (`direction lr|tb|columns`).
          const v = rest.trim().toLowerCase();
          // LR (left-to-right) → columns; TB (top-to-bottom) → rows (default).
          result.columns = v === 'lr' || v === 'columns';
          break;
        }
      }
      continue;
    }

    // ── Otherwise: an ENTRY (a zone row). ──
    // Split the line into ANCHOR [as LABEL] [color]. `as` is a bare token; the
    // trailing color is pulled off whichever side it sits on.
    const asIdx = tokens.findIndex((t) => t.toLowerCase() === 'as');
    let anchor: string;
    let label: string | null = null;
    let color: string | undefined;
    if (asIdx >= 0) {
      anchor = tokens.slice(0, asIdx).join(' ').trim();
      const ex = extractColor(
        tokens
          .slice(asIdx + 1)
          .join(' ')
          .trim(),
        palette,
        undefined,
        lineNum
      );
      if (ex.label) label = ex.label;
      color = ex.color;
    } else {
      // No alias: a trailing palette color still applies (`London purple`).
      const ex = extractColor(
        tokens.join(' ').trim(),
        palette,
        undefined,
        lineNum
      );
      anchor = ex.label.trim();
      color = ex.color;
    }

    if (!anchor) {
      warn(
        lineNum,
        `Empty zone on "${trimmed}" — expected a city, IANA zone, or UTC offset.`
      );
      continue;
    }

    // ── Classify the anchor: UTC/GMT offset → IANA id → gazetteer city. ──
    // Every branch below either assigns `entry` or `continue`s the row.
    let entry: ClockEntry;
    const fixedOffset = parseFixedOffset(anchor);
    if (fixedOffset !== null) {
      // A raw fixed offset — no DST, no coordinates, no sun line.
      const offLabel = formatOffsetLabel(fixedOffset);
      entry = {
        kind: 'fixed',
        place: offLabel,
        zone: offLabel,
        fixedOffsetMin: fixedOffset,
        label: label ?? offLabel,
        lat: null,
        lon: null,
        color: color ?? null,
        lineNumber: lineNum,
      };
    } else if (anchor.includes('/')) {
      // An explicit IANA id.
      if (!isValidZone(anchor)) {
        warn(
          lineNum,
          `Unknown IANA zone "${anchor}" — row skipped (e.g. America/New_York). Or give a UTC offset like UTC-5.`
        );
        continue;
      }
      const coords = coordsFor(anchor);
      const place = zoneCity(anchor);
      entry = {
        kind: 'iana',
        place,
        zone: anchor,
        fixedOffsetMin: null,
        label: label ?? place,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        color: color ?? null,
        lineNumber: lineNum,
      };
    } else {
      // A bare place name — resolve it through the city gazetteer.
      const res = resolvePlace(anchor);
      if (res.kind === 'ambiguous') {
        const list = res.candidates.map((c) => c.zone).join(', ');
        softError(
          lineNum,
          `"${anchor}" is ambiguous — did you mean ${list}? Use the IANA zone to disambiguate.`
        );
        continue;
      }
      if (res.kind === 'unknown') {
        const hint = res.suggestion
          ? ` Did you mean ${res.suggestion}?`
          : ' Give a city, an IANA zone (America/New_York), or a UTC offset (UTC-5).';
        warn(lineNum, `Unknown place "${anchor}" — row skipped.${hint}`);
        continue;
      }
      const coords = coordsFor(res.zone);
      entry = {
        kind: 'iana',
        place: res.city,
        zone: res.zone,
        fixedOffsetMin: null,
        label: label ?? res.city,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        color: color ?? null,
        lineNumber: lineNum,
      };
    }

    entries.push(entry);
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
      '`workweek` has no effect without `hours` — the working-hours status needs a window.'
    );
  }

  result.entries = entries;
  if (entries.length === 0) {
    softError(
      result.titleLineNumber ?? 1,
      'A clock needs at least one zone row (e.g. "London as UK team").'
    );
  }

  return result;
}
