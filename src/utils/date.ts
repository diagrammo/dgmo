// ============================================================
// Universal Date Handling (BL-121)
// ============================================================
//
// One liberal date parser shared by every date-bearing chart type. Accepts ISO,
// slash (`7/4`), bare-dash (`07-04`), and month-name (`Jul 4`) forms; normalizes
// to the canonical **internal** string the renderers/calculators already consume:
//
//     [-]YYYY[-MM[-DD]][ HH:MM[:SS]]
//
// A leading `-` marks a BCE year (astronomical-naive: `N BCE` ↔ `-N`). Years may
// be 1–4 digits (ancient/BCE). Because the OUTPUT format is unchanged, downstream
// code is untouched — this is a normalization shim, not a rewrite.
//
// Year inference (the ladder, §4 of the tech spec) is separate: `parseDateToken`
// leaves `year: null` for bare month-days; `resolveDates` / `resolveTokenYear`
// fill it via explicit → `year` directive → derive-from-sibling (carry-forward +
// rollover) → current render year.

export type DateOrder = 'mdy' | 'dmy';

/** Number of date components present. 1=year, 2=year-month, 3=day (full). */
export type DateGrain = 1 | 2 | 3;

export interface DateToken {
  sign: 1 | -1;
  /** Absolute (unsigned) year, or null when it must be inferred from context. */
  year: number | null;
  month: number; // 1-based
  day: number;
  hour: number;
  minute: number;
  second: number;
  grain: DateGrain;
  hasTime: boolean;
  /** Set when a time component was present but out of range (h>23 / m>59). */
  invalidTime?: string | undefined;
}

export interface ParseDateResult {
  token: DateToken;
  /** Number of characters consumed from the front of the input. */
  consumed: number;
}

const MONTHS_FULL = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTHS_ABBR = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

/** Month name (full or 3-letter, case-insensitive, trailing dot allowed) → 1..12, or 0 if not a month. */
export function monthNameToNum(raw: string): number {
  const t = raw.toLowerCase().replace(/\.$/, '');
  let i = MONTHS_FULL.indexOf(t);
  if (i >= 0) return i + 1;
  i = MONTHS_ABBR.indexOf(t.slice(0, 3));
  return i >= 0 ? i + 1 : 0;
}

// Non-anchored, global mirror of the MONTH_D_RE / D_MONTH_RE arms below, for
// scanning a whole line during syntax highlighting. `\b` keeps the leader
// standalone (no matching inside identifiers). Alt 1 = D_MONTH (`3 Jan`),
// alt 2 = MONTH_D (`Jan 3` / `Jan 3, 2026`).
const MONTH_NAME_SCAN_RE =
  /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+\d{4})?|\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+\d{4})?/g;

/**
 * Find every month-name date literal in `line` (`Jan 3`, `3 January`,
 * `Jan 3, 2026`, `3 Jan 2026`) and return the char-offset span of each whole
 * literal, left-to-right and non-overlapping.
 *
 * The Lezer grammar already tokenizes numeric/ISO/slash dates as `DateLiteral`,
 * but it cannot join a month word and its day across a space — this powers a
 * highlight post-pass that colors them like numeric dates. It mirrors the
 * MONTH_D / D_MONTH parser arms exactly — same regex shape plus the
 * `monthNameToNum` guard — so highlighting matches parser acceptance, including
 * its month-prefix over-acceptance (e.g. `Marina` → March). It is intentionally
 * liberal about position (matches anywhere in the line, not just the front) so
 * a date mid-label (`Task  Jan 3`) still highlights.
 */
export function scanMonthNameDates(
  line: string
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = new RegExp(MONTH_NAME_SCAN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    // Group 2 = month word in the D_MONTH arm; group 3 = month in MONTH_D.
    const month = m[2] ?? m[3] ?? '';
    if (monthNameToNum(month) <= 0) {
      // False candidate (`Sprint 3`, `3 items`). Resume ONE char past the
      // match start rather than past its end, so a real date that overlaps the
      // tail isn't swallowed — `Sprint 3 Jan` must still yield `3 Jan`.
      re.lastIndex = m.index + 1;
      continue;
    }
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

// ── Regexes (anchored at the front for prefix scanning) ──────
const ERA_RE = /^(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?\s+(BCE|BC|CE|AD)\b/i;
const ISO_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/;
const MONTH_D_RE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/;
const D_MONTH_RE = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?/;
const SLASH_RE = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/;
const TIME_RE = /^[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/;

function matchTime(rest: string): {
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
  consumed: number;
  invalid?: string | undefined;
} {
  const m = rest.match(TIME_RE);
  if (!m) return { hour: 0, minute: 0, second: 0, hasTime: false, consumed: 0 };
  const hour = parseInt(m[1]!, 10);
  const minute = parseInt(m[2]!, 10);
  const second = m[3] !== undefined ? parseInt(m[3], 10) : 0;
  const ok = hour <= 23 && minute <= 59 && second <= 59;
  return {
    hour,
    minute,
    second,
    hasTime: true,
    consumed: m[0].length,
    invalid: ok ? undefined : m[0].trim(),
  };
}

function dayToken(
  year: number | null,
  month: number,
  day: number,
  sign: 1 | -1 = 1
): DateToken {
  return {
    sign,
    year,
    month,
    day,
    hour: 0,
    minute: 0,
    second: 0,
    grain: 3,
    hasTime: false,
    invalidTime: undefined,
  };
}

/**
 * Parse a date at the FRONT of `input`, liberal in format. Returns the parsed
 * token (year possibly null → infer later) and how many chars it consumed, or
 * null if nothing date-like leads the string.
 */
export function parseDateToken(
  input: string,
  opts: { dateOrder?: DateOrder | undefined } = {}
): ParseDateResult | null {
  const order: DateOrder = opts.dateOrder ?? 'mdy';

  // 1 ─ Era-marked (BCE/BC/CE/AD). No time component.
  const era = input.match(ERA_RE);
  if (era) {
    const marker = era[4]!.toUpperCase();
    const sign: 1 | -1 = marker === 'BCE' || marker === 'BC' ? -1 : 1;
    const grain = (era[3] ? 3 : era[2] ? 2 : 1) as DateGrain;
    return {
      token: {
        sign,
        year: parseInt(era[1]!, 10),
        month: era[2] ? parseInt(era[2], 10) : 1,
        day: era[3] ? parseInt(era[3], 10) : 1,
        hour: 0,
        minute: 0,
        second: 0,
        grain,
        hasTime: false,
      },
      consumed: era[0].length,
    };
  }

  // 2 ─ ISO (4-digit lead): YYYY, YYYY-MM, YYYY-MM-DD [+ time].
  const iso = input.match(ISO_RE);
  if (iso) {
    const grain = (iso[3] ? 3 : iso[2] ? 2 : 1) as DateGrain;
    let consumed = iso[0].length;
    let time: ReturnType<typeof matchTime> = {
      hour: 0,
      minute: 0,
      second: 0,
      hasTime: false,
      consumed: 0,
    };
    if (grain === 3) {
      time = matchTime(input.slice(consumed));
      consumed += time.consumed;
    }
    return {
      token: {
        sign: 1,
        year: parseInt(iso[1]!, 10),
        month: iso[2] ? parseInt(iso[2], 10) : 1,
        day: iso[3] ? parseInt(iso[3], 10) : 1,
        hour: time.hour,
        minute: time.minute,
        second: time.second,
        grain,
        hasTime: time.hasTime,
        invalidTime: time.invalid,
      },
      consumed,
    };
  }

  // 3 ─ Month-name forms: `Jul 4`, `July 4, 2026`, `4 Jul`, `4 July 2026`.
  const md = input.match(MONTH_D_RE);
  if (md && monthNameToNum(md[1]!) > 0) {
    const mo = monthNameToNum(md[1]!);
    const day = parseInt(md[2]!, 10);
    const year = md[3] ? parseInt(md[3], 10) : null;
    const tok = dayToken(year, mo, day);
    const time = matchTime(input.slice(md[0].length));
    tok.hour = time.hour;
    tok.minute = time.minute;
    tok.second = time.second;
    tok.hasTime = time.hasTime;
    tok.invalidTime = time.invalid;
    return { token: tok, consumed: md[0].length + time.consumed };
  }
  const dm = input.match(D_MONTH_RE);
  if (dm && monthNameToNum(dm[2]!) > 0) {
    const mo = monthNameToNum(dm[2]!);
    const day = parseInt(dm[1]!, 10);
    const year = dm[3] ? parseInt(dm[3], 10) : null;
    const tok = dayToken(year, mo, day);
    const time = matchTime(input.slice(dm[0].length));
    tok.hour = time.hour;
    tok.minute = time.minute;
    tok.second = time.second;
    tok.hasTime = time.hasTime;
    tok.invalidTime = time.invalid;
    return { token: tok, consumed: dm[0].length + time.consumed };
  }

  // 4 ─ Numeric slash/dash (1–2 digit lead): M/D, M/D/Y, MM-DD.
  const sl = input.match(SLASH_RE);
  if (sl) {
    const a = parseInt(sl[1]!, 10);
    const b = parseInt(sl[2]!, 10);
    let year: number | null = null;
    if (sl[3]) {
      year = parseInt(sl[3], 10);
      if (sl[3].length === 2) year += 2000;
    }
    let month: number;
    let day: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b; // forced day-first
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b; // forced month-first
    } else if (order === 'dmy') {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const tok = dayToken(year, month, day);
    const time = matchTime(input.slice(sl[0].length));
    tok.hour = time.hour;
    tok.minute = time.minute;
    tok.second = time.second;
    tok.hasTime = time.hasTime;
    tok.invalidTime = time.invalid;
    return { token: tok, consumed: sl[0].length + time.consumed };
  }

  return null;
}

/** Build the canonical internal string from a token whose year is known. */
export function toInternal(token: DateToken, resolvedYear: number): string {
  const y = token.year ?? resolvedYear;
  const neg = token.sign < 0 ? '-' : '';
  const yStr = String(y);
  if (token.grain === 1) return `${neg}${yStr}`;
  const mm = String(token.month).padStart(2, '0');
  if (token.grain === 2) return `${neg}${yStr}-${mm}`;
  const dd = String(token.day).padStart(2, '0');
  let out = `${neg}${yStr}-${mm}-${dd}`;
  if (token.hasTime) {
    const hh = String(token.hour).padStart(2, '0');
    const mi = String(token.minute).padStart(2, '0');
    out += ` ${hh}:${mi}`;
    if (token.second) out += `:${String(token.second).padStart(2, '0')}`;
  }
  return out;
}

// ── Year-resolution ladder (§4) ──────────────────────────────

export interface YearContext {
  order: DateOrder;
  /** Base year from a `year 20XX` directive, or null. */
  directiveYear: number | null;
  /** Current render year (injected — never read the clock inside the parser). */
  currentYear: number;
  /** When true, a fully-bare chart (no year anywhere) is an error, not current-year. */
  noCurrentYear: boolean;
  /** Running carry-forward year; seeded from directive/prescan. */
  contextYear: number | null;
  /** Last fully-resolved (year,month,day) for rollover comparison. */
  prev: { y: number; m: number; d: number } | null;
}

export interface ResolveOutcome {
  internal: string;
  /** Non-blocking hint (soft) when a bare date fell back to the current year. */
  hint?: string | undefined;
  /** Hard error when noCurrentYear is set and no year could be derived. */
  error?: string | undefined;
}

function cmp(
  y: number,
  m: number,
  d: number,
  p: { y: number; m: number; d: number }
): number {
  if (y !== p.y) return y - p.y;
  if (m !== p.m) return m - p.m;
  return d - p.d;
}

/**
 * Resolve one token's year in document order, mutating `ctx` (carry-forward +
 * rollover). Explicit-year tokens set the context; bare tokens derive from it.
 */
export function resolveTokenYear(
  token: DateToken,
  ctx: YearContext
): ResolveOutcome {
  if (token.year != null) {
    const signed = token.sign * token.year;
    ctx.contextYear = signed;
    ctx.prev = { y: signed, m: token.month, d: token.day };
    return { internal: toInternal(token, token.year) };
  }

  // Bare month-day → ladder: contextYear (directive/prescan/carry) else current.
  let hint: string | undefined;
  let error: string | undefined;
  let y: number;
  if (ctx.contextYear != null) {
    y = ctx.contextYear;
  } else if (ctx.noCurrentYear) {
    error =
      'Date has no year and none can be derived. Add a full date, a `year 20XX` directive, or remove `no-current-year`.';
    y = ctx.currentYear;
  } else {
    y = ctx.currentYear;
    hint =
      'Date has no year; assuming the current year. Add `year 20XX` to make this diagram reproducible.';
  }

  // Rollover: if the month-day fell before the previous resolved date, bump a year.
  if (ctx.prev && cmp(y, token.month, token.day, ctx.prev) < 0) {
    y += 1;
  }
  ctx.contextYear = y;
  ctx.prev = { y, m: token.month, d: token.day };
  return { internal: toInternal(token, y), hint, error };
}

/**
 * Seed a YearContext. `directiveYear` (from `year 20XX`) wins; otherwise the
 * first explicit year found anywhere in the document (`prescanYear`) anchors
 * bare dates that appear before it. Both null → bare dates fall to currentYear.
 */
export function makeYearContext(opts: {
  order?: DateOrder;
  directiveYear?: number | null;
  prescanYear?: number | null;
  currentYear?: number;
  noCurrentYear?: boolean;
}): YearContext {
  const directiveYear = opts.directiveYear ?? null;
  const seed = directiveYear ?? opts.prescanYear ?? null;
  return {
    order: opts.order ?? 'mdy',
    directiveYear,
    currentYear: opts.currentYear ?? new Date().getFullYear(),
    noCurrentYear: opts.noCurrentYear ?? false,
    contextYear: seed,
    prev: null,
  };
}

/** The first explicit (non-null) year among tokens, for prescan seeding. */
export function prescanYear(tokens: DateToken[]): number | null {
  for (const t of tokens) if (t.year != null) return t.sign * t.year;
  return null;
}

/**
 * Batch-resolve a list of tokens in document order. Convenience over the
 * stateful API for parsers that collect all their dates first.
 */
export function resolveDates(
  tokens: DateToken[],
  opts: {
    order?: DateOrder;
    directiveYear?: number | null;
    currentYear?: number;
    noCurrentYear?: boolean;
  } = {}
): ResolveOutcome[] {
  const ctx = makeYearContext({
    ...opts,
    prescanYear: prescanYear(tokens),
  });
  return tokens.map((t) => resolveTokenYear(t, ctx));
}

/**
 * One-shot normalize a whole-string date field (gantt `start`, countdown
 * `target`, a holiday date) to canonical ISO. No carry-forward context — uses
 * the directive/current year for a bare month-day. Returns null if unparseable
 * or if trailing junk follows the date.
 */
export function normalizeDate(
  raw: string,
  opts: {
    order?: DateOrder;
    year?: number | null;
    currentYear?: number;
  } = {}
): string | null {
  const s = raw.trim();
  const res = parseDateToken(s, { dateOrder: opts.order });
  if (!res) return null;
  if (res.consumed !== s.length) return null; // trailing junk → not a clean date
  if (res.token.invalidTime) return null;
  const year =
    res.token.year ?? opts.year ?? opts.currentYear ?? new Date().getFullYear();
  return toInternal(res.token, year);
}
