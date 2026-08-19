// ============================================================
// Countdown chart — shared resolution + formatting (dependency-free)
// ============================================================
//
// The single source of truth for turning a recurrence rule into a concrete
// next instant, rolling forward when it passes, computing the `since` ordinal,
// and formatting both the hero count and the footer resolution line.
//
// Imported by BOTH:
//   • renderer.ts (Node/resvg + browser) — bakes the no-JS floor
//   • ticker.ts    (browser only)        — recomputes live every second
// so the baked value and the live value never disagree. MUST stay
// dependency-free (no d3, no palettes) — it is bundled into the tiny
// `dist/countdown.js` browser entry alongside the ticker.
//
// Date math is viewer-local UNLESS a countdown carries a `tz <IANA>` slot, in
// which case authored wall-clock times resolve *in that zone* (DST-correct via
// `Intl`, dep-free — same approach as the clock chart) and instants format back
// in that zone. A pinned tz makes the target an absolute instant, so a shared
// page shows every viewer the same remaining time regardless of their OS clock
// (spec §36 tz slot). With `tz` null the v1 viewer-local behavior is unchanged.
// Under TZ=UTC (the test env) local == UTC, so fixtures stay deterministic.

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

// ── Time-zone helpers (dep-free; `Intl` only, like clock/resolve.ts) ──────────

/** Zone-local wall-clock fields of an instant. `weekday` is 0 (Sun)–6 (Sat). */
export interface ZoneFields {
  year: number;
  month: number; // 0-11
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  weekday: number; // 0-6
}

const ZONE_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The wall-clock fields of `ms` in `tz` (or viewer-local when `tz` is null). */
export function zoneFields(ms: number, tz: string | null): ZoneFields {
  const d = new Date(ms);
  if (!tz) {
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
      weekday: d.getDay(),
    };
  }
  try {
    const o: Record<string, string> = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
      .formatToParts(d)
      .forEach((x) => {
        o[x.type] = x.value;
      });
    return {
      year: Number(o['year']),
      month: Number(o['month']) - 1,
      day: Number(o['day']),
      hour: Number(o['hour']) % 24,
      minute: Number(o['minute']),
      second: Number(o['second']),
      weekday: Math.max(0, ZONE_WD.indexOf(o['weekday'] ?? 'Sun')),
    };
  } catch {
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      weekday: d.getUTCDay(),
    };
  }
}

/** Offset (ms) of `tz` at instant `ms`: (zone wall-clock) − UTC. */
function zoneOffsetMs(tz: string, ms: number): number {
  const f = zoneFields(ms, tz);
  const asUTC = Date.UTC(f.year, f.month, f.day, f.hour, f.minute, f.second);
  return asUTC - Math.floor(ms / 1000) * 1000;
}

/**
 * The epoch ms of the wall-clock time y/mo(0-11)/d h:mi in `tz` (or viewer-local
 * when `tz` is null). DST-correct with a one-pass offset correction across the
 * spring/fall boundary. Dep-free — bundled into the tiny browser ticker.
 */
export function wallToMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string | null
): number {
  if (!tz) return new Date(y, mo, d, h, mi).getTime();
  const guess = Date.UTC(y, mo, d, h, mi);
  const off1 = zoneOffsetMs(tz, guess);
  const ms = guess - off1;
  const off2 = zoneOffsetMs(tz, ms);
  return off2 === off1 ? ms : guess - off2;
}

/** The UTC-offset label for `ms` in `tz` (`"UTC−4"`, `"UTC+5:30"`), else "". */
export function zoneOffsetLabel(ms: number, tz: string | null): string {
  if (!tz) return '';
  try {
    const off = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date(ms))
      .find((x) => x.type === 'timeZoneName');
    return off ? off.value.replace('GMT', 'UTC') : '';
  } catch {
    return '';
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
// A local (offset-free) datetime: `2026-08-21T18:00` / `2026-08-21 18:00[:ss]`.
const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Resolve a one-shot target/anchor string to absolute epoch ms. When `tz` is
 * set, a bare date or an offset-free datetime is interpreted **in that zone**;
 * a string carrying its own `Z`/`±HH:MM` offset is already absolute and honored
 * as-is. With `tz` null the v1 behavior holds: bare date → viewer-local midnight
 * (`new Date("2026-08-21")` would be UTC — wrong for "days until"), offset-free
 * datetime → viewer-local. Shared by the parser and the ticker (single source).
 */
export function targetToMs(target: string, tz: string | null = null): number {
  const s = target.trim();
  if (DATE_ONLY_RE.test(s)) {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return wallToMs(y, m - 1, d, 0, 0, tz);
  }
  const dt = LOCAL_DT_RE.exec(s);
  if (dt) {
    return wallToMs(
      Number(dt[1]),
      Number(dt[2]) - 1,
      Number(dt[3]),
      Number(dt[4]),
      Number(dt[5]),
      tz
    );
  }
  // Anything else (an explicit-offset ISO string) is an absolute instant.
  return new Date(s).getTime();
}

/** A resolved recurrence rule. Built by the parser, re-read by the ticker. */
export interface RecurRule {
  /** How `on` binds to the cadence. */
  readonly kind:
    | 'month-day' // every year on Aug 21
    | 'nth-weekday' // every month on 3rd Tuesday
    | 'last-weekday' // every month on last Friday
    | 'weekly' // every week on Friday
    | 'interval'; // every N days|weeks|months from <anchor>
  /** month-day: 0-11. */
  readonly month?: number | undefined;
  /** month-day: 1-31. */
  readonly day?: number | undefined;
  /** nth-weekday: 1-5. */
  readonly nth?: number | undefined;
  /** nth/last/weekly: 0 (Sun) – 6 (Sat). */
  readonly weekday?: number | undefined;
  /** time-of-day hour 0-23 (default 0). */
  readonly hour: number;
  /** time-of-day minute 0-59 (default 0). */
  readonly minute: number;
  /** No `at` time given → the occurrence is the whole DAY (see resolveNext). */
  readonly allDay: boolean;
  /** interval cadence unit. */
  readonly intervalUnit?: 'day' | 'week' | 'month' | undefined;
  /** interval multiplier (>= 1). */
  readonly intervalN?: number | undefined;
  /** interval anchor epoch ms (from `from <date>`). */
  readonly anchorMs?: number | undefined;
  /** IANA zone the anchor's wall-clock resolves in; undefined → viewer-local. */
  readonly tz?: string | undefined;
}

/**
 * What `every` carries — the cadence and nothing else (decision #56). The
 * instant used to live beside it in `every … on <Aug 21>`, where it could
 * disagree with the `since` anchor; deriving every calendar field from the
 * anchor makes that disagreement impossible rather than merely an error.
 */
export type Cadence =
  | { readonly kind: 'year' }
  | { readonly kind: 'month' }
  | { readonly kind: 'month-weekday'; readonly last: boolean }
  | { readonly kind: 'week' }
  | {
      readonly kind: 'interval';
      readonly n: number;
      readonly unit: 'day' | 'week' | 'month';
    };

/**
 * Build the recurrence rule from the cadence plus the `since` anchor instant.
 * Month, day, weekday, nth and time-of-day all come from the anchor, so there
 * is exactly one place a date lives and nothing to reconcile.
 *
 * `every month` follows the anchor's day-of-month (RRULE BYMONTHDAY semantics —
 * a 31st simply skips 30-day months); `every month by weekday` follows its
 * nth-weekday instead, which is the one reading a bare date cannot settle on
 * its own.
 */
export function ruleFromAnchor(
  cadence: Cadence,
  anchorMs: number,
  allDay: boolean,
  tz: string | null
): RecurRule {
  const a = zoneFields(anchorMs, tz);
  const base = {
    hour: allDay ? 0 : a.hour,
    minute: allDay ? 0 : a.minute,
    allDay,
    anchorMs,
    ...(tz ? { tz } : {}),
  };
  switch (cadence.kind) {
    case 'year':
      return { ...base, kind: 'month-day', month: a.month, day: a.day };
    case 'week':
      return { ...base, kind: 'weekly', weekday: a.weekday };
    case 'month-weekday':
      return cadence.last
        ? { ...base, kind: 'last-weekday', weekday: a.weekday }
        : {
            ...base,
            kind: 'nth-weekday',
            weekday: a.weekday,
            nth: Math.floor((a.day - 1) / 7) + 1,
          };
    case 'month':
      return { ...base, kind: 'interval', intervalUnit: 'month', intervalN: 1 };
    case 'interval':
      return {
        ...base,
        kind: 'interval',
        intervalUnit: cadence.unit,
        intervalN: cadence.n,
      };
  }
}

// ── Closed vocab (autocomplete + named errors, never a silent wrong date) ──

/** Month name (full or 3-letter) → 0-11, or null. */
export function monthIndex(token: string): number | null {
  const t = token.trim().toLowerCase().slice(0, 3);
  const i = [
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
  ].indexOf(t);
  return i < 0 ? null : i;
}

/** Weekday name (full or 3-letter) → 0 (Sun) – 6 (Sat), or null. */
export function weekdayIndex(token: string): number | null {
  const t = token.trim().toLowerCase().slice(0, 3);
  const i = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(t);
  return i < 0 ? null : i;
}

/** Ordinal word: 1 → "1st", 2 → "2nd", 7 → "7th", 21 → "21st". */
export function ordinalWord(n: number): string {
  const abs = Math.abs(n);
  const tens = abs % 100;
  let suffix = 'th';
  if (tens < 11 || tens > 13) {
    const ones = abs % 10;
    suffix = ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  }
  return `${n}${suffix}`;
}

/**
 * Fill an ordinal template: `Nth` → the ordinal word ("7th"), `N` → the bare
 * number ("7"). Free-form so any phrasing works — "Nth Anniversary",
 * "Nth Time Around the Sun", "Year N". Case-sensitive tokens so ordinary words
 * containing "n" are untouched. Shared so bake == live.
 */
export function applyOrdinalTemplate(template: string, n: number): string {
  return template
    .replace(/\bNth\b/g, ordinalWord(n))
    .replace(/\bN\b/g, String(n));
}

/** Midnight starting `ms`'s day, in `tz` (or viewer-local when tz is null). */
export function dayStart(ms: number, tz: string | null = null): number {
  const f = zoneFields(ms, tz);
  return wallToMs(f.year, f.month, f.day, 0, 0, tz);
}

/** Whole-day span between two instants (midnight-aligned in `tz`). */
export function dayDelta(
  a: number,
  b: number,
  tz: string | null = null
): number {
  return Math.round((dayStart(b, tz) - dayStart(a, tz)) / DAY_MS);
}

/** Whether two instants fall on the same calendar day in `tz`. */
export function sameDay(
  a: number,
  b: number,
  tz: string | null = null
): boolean {
  const x = zoneFields(a, tz);
  const y = zoneFields(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

// ── Next-instant resolution + roll-forward ──

/** The nth (1-5) occurrence of `weekday` in year/month, or last (nth<0). */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
  hour: number,
  minute: number,
  tz: string | null
): number | null {
  // Weekday-of-a-calendar-date is zone-independent, so day selection uses plain
  // local `Date`; only the resolved instant is zone-anchored via wallToMs.
  if (nth < 0) {
    // last: walk back from the month's final day.
    const last = new Date(year, month + 1, 0).getDate();
    for (let d = last; d >= 1; d--) {
      if (new Date(year, month, d).getDay() === weekday) {
        return wallToMs(year, month, d, hour, minute, tz);
      }
    }
    return null;
  }
  const firstDow = new Date(year, month, 1).getDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  // Overflowed the month (e.g. "5th Tuesday" that doesn't exist) → no match.
  if (day > new Date(year, month + 1, 0).getDate()) return null;
  return wallToMs(year, month, day, hour, minute, tz);
}

/**
 * The next instant strictly after `now` that matches `rule`. Used by both the
 * renderer (bake) and the ticker (live) — calling it with a fresh `now` on each
 * pass is what makes recurring countdowns roll forward automatically.
 */
export function resolveNext(rule: RecurRule, now: number): number {
  const tz = rule.tz ?? null;
  const nowF = zoneFields(now, tz);
  const { hour, minute } = rule;
  // An ALL-DAY occurrence stays current for its whole day: compare at day
  // granularity, so on the day itself `t` (00:00, already behind `now`) still
  // counts and the chart reads "Today!" / the on-day text instead of rolling to
  // next year. Timed occurrences roll at the exact instant.
  const passes = rule.allDay
    ? (t: number): boolean => dayStart(t, tz) >= dayStart(now, tz)
    : (t: number): boolean => t > now;
  // A Y/M/D exists only if constructing it didn't roll into another month
  // (e.g. Feb 29 in a common year, or the 31st of a 30-day month) — then SKIP it,
  // matching RRULE BYMONTHDAY semantics (never a silently shifted date).
  const dayExists = (y: number, m: number, d: number): boolean =>
    new Date(y, m, d).getMonth() === m;

  switch (rule.kind) {
    case 'month-day': {
      const month = rule.month!;
      const day = rule.day!;
      for (let y = nowF.year; ; y++) {
        if (!dayExists(y, month, day)) continue; // skip non-leap Feb 29, etc.
        const t = wallToMs(y, month, day, hour, minute, tz);
        if (passes(t)) return t;
      }
    }
    case 'nth-weekday':
    case 'last-weekday': {
      const weekday = rule.weekday!;
      const nth = rule.kind === 'last-weekday' ? -1 : rule.nth!;
      // Scan forward month by month (a valid match always exists within 12).
      let y = nowF.year;
      let m = nowF.month;
      for (let i = 0; i < 24; i++) {
        const t = nthWeekdayOfMonth(y, m, weekday, nth, hour, minute, tz);
        if (t !== null && passes(t)) return t;
        m++;
        if (m > 11) {
          m = 0;
          y++;
        }
      }
      // Unreachable for valid rules; fall back to a week out.
      return now + WEEK_MS;
    }
    case 'weekly': {
      const weekday = rule.weekday!;
      // Start from today at the target time, advance a day until weekday & passes.
      for (let i = 0; i < 8; i++) {
        // Calendar weekday is zone-independent; anchor the instant via wallToMs.
        const cal = new Date(nowF.year, nowF.month, nowF.day + i);
        if (cal.getDay() !== weekday) continue;
        const t = wallToMs(
          cal.getFullYear(),
          cal.getMonth(),
          cal.getDate(),
          hour,
          minute,
          tz
        );
        if (passes(t)) return t;
      }
      return now + WEEK_MS;
    }
    case 'interval': {
      const n = rule.intervalN ?? 1;
      const anchor = rule.anchorMs ?? now;
      if (rule.intervalUnit === 'month') {
        const a = zoneFields(anchor, tz);
        const day = a.day;
        for (let k = 0; ; k++) {
          const y = a.year;
          const m = a.month + k * n;
          // Normalize the month, then SKIP if the anchor day-of-month doesn't
          // exist there (the 31st in a 30-day month) — same RRULE semantics.
          const yy = y + Math.floor(m / 12);
          const mm = ((m % 12) + 12) % 12;
          if (!dayExists(yy, mm, day)) continue;
          const t = wallToMs(yy, mm, day, hour, minute, tz);
          if (passes(t)) return t;
        }
      }
      const step = (rule.intervalUnit === 'week' ? WEEK_MS : DAY_MS) * n;
      let t = anchor;
      if (!passes(t)) {
        const k = Math.max(0, Math.floor((now - anchor) / step));
        t = anchor + k * step;
        while (!passes(t)) t += step; // 1–2 corrections
      }
      return t;
    }
  }
}

/**
 * The `since` ordinal for a resolved instant: complete cadence-units elapsed
 * since the anchor. Birthday semantics (decision #56) — the anchor occurrence
 * is the 0th, so someone born 2015-06-14 turns 11 on 2026-06-14 — and the same
 * rule holds for every cadence, so a weekly standup anchored on its first
 * meeting numbers that meeting 0 and the next one 1. An author who wants their
 * first occurrence to read "#1" anchors `since` one cadence-unit earlier.
 */
export function ordinalFor(resolvedMs: number, rule: RecurRule): number {
  const anchor = rule.anchorMs;
  if (anchor === undefined) return 0;
  const tz = rule.tz ?? null;
  const a = zoneFields(anchor, tz);
  const r = zoneFields(resolvedMs, tz);
  const months = (r.year - a.year) * 12 + (r.month - a.month);
  const spanDays = (dayStart(resolvedMs, tz) - dayStart(anchor, tz)) / DAY_MS;
  switch (rule.kind) {
    case 'month-day':
      return r.year - a.year;
    case 'nth-weekday':
    case 'last-weekday':
      return months;
    case 'weekly':
      return Math.round(spanDays / 7);
    case 'interval': {
      const n = rule.intervalN ?? 1;
      if (rule.intervalUnit === 'month') return Math.floor(months / n);
      const perStep = rule.intervalUnit === 'week' ? 7 : 1;
      return Math.round(spanDays / perStep / n);
    }
  }
}

// ── Count + footer formatting (shared so baked == live) ──

export type CountUnits =
  | 'human'
  | 'days'
  | 'full'
  | 'clock'
  | 'weeks'
  | 'words'
  | 'compound';
export type RoundMode = 'up' | 'down' | 'nearest';
/** Which `full`-mode segments show. */
export type Field = 'd' | 'h' | 'm' | 's';

function roundBy(value: number, mode: RoundMode): number {
  return mode === 'down'
    ? Math.floor(value)
    : mode === 'nearest'
      ? Math.round(value)
      : Math.ceil(value);
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

export interface CountOpts {
  readonly units: CountUnits;
  readonly round: RoundMode;
  readonly fields: readonly Field[];
}

/** The hero string for `remainingMs` (already clamped ≥ 0 by the caller). */
export function formatCount(remainingMs: number, opts: CountOpts): string {
  const { units, round, fields } = opts;
  if (units === 'days')
    return plural(roundBy(remainingMs / DAY_MS, round), 'day');
  if (units === 'weeks')
    return plural(roundBy(remainingMs / WEEK_MS, round), 'week');

  const totalSec = Math.floor(remainingMs / 1000);
  if (units === 'clock') {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }
  if (units === 'words') {
    const days = Math.ceil(remainingMs / DAY_MS);
    if (days <= 0) return 'now';
    if (days === 1) return 'tomorrow';
    if (days < 14) return `${days} days`;
    if (days < 60) return `${Math.round(days / 7)} weeks`;
    return `${Math.round(days / 30)} months`;
  }
  // full: floor days + HH:MM:SS remainder, pruned by `fields`.
  const days = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const has = (f: Field): boolean => fields.includes(f);
  const clockParts: string[] = [];
  if (has('h')) clockParts.push(pad2(h));
  if (has('m')) clockParts.push(pad2(m));
  if (has('s')) clockParts.push(pad2(s));
  const clock = clockParts.join(':');
  // Drop the "0d " prefix under a day so a same-day countdown reads as a clean
  // clock (matches v1 behavior).
  const dayPrefix = has('d') && days > 0 ? `${days}d${clock ? ' ' : ''}` : '';
  return dayPrefix + clock || plural(days, 'day');
}

/**
 * Split a clock string (`HH:MM:SS`, `Nd HH:MM:SS`) into its lead and the
 * trailing seconds segment (`:SS`) so the fast-ticking seconds can render
 * smaller/subordinate. Non-clock strings, or clocks whose seconds field was
 * pruned (`H:MM`), return `sec: null` and are shown whole.
 */
export function splitClockSeconds(s: string): {
  lead: string;
  sec: string | null;
} {
  const m = /^(.+:\d{2}):(\d{2})$/.exec(s);
  return m ? { lead: m[1]!, sec: ':' + m[2]! } : { lead: s, sec: null };
}

/**
 * Precise breakdown for the `units words` sub-line: `3 days 2 hours 7 minutes`.
 * Drops leading zero units (a sub-day countdown reads `2 hours 7 minutes`);
 * minutes always show so it visibly ticks. Ticker-updated live.
 */
export function formatWordsDetail(remainingMs: number): string {
  const totalMin = Math.floor(Math.max(0, remainingMs) / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d} day${d === 1 ? '' : 's'}`);
  if (d > 0 || h > 0) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * Calendar-aware date subtraction `target − now` (months vary in length, so this
 * can't be done from a raw ms delta). Borrows like long subtraction. Assumes
 * `targetMs >= nowMs` (callers swap args for the count-up "ago" case).
 */
export function breakdown(
  nowMs: number,
  targetMs: number,
  tz: string | null = null
): {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const n = zoneFields(nowMs, tz);
  const t = zoneFields(targetMs, tz);
  let y = t.year - n.year;
  let mo = t.month - n.month;
  let d = t.day - n.day;
  let h = t.hour - n.hour;
  let mi = t.minute - n.minute;
  let s = t.second - n.second;
  if (s < 0) {
    s += 60;
    mi--;
  }
  if (mi < 0) {
    mi += 60;
    h--;
  }
  if (h < 0) {
    h += 24;
    d--;
  }
  if (d < 0) {
    d += new Date(t.year, t.month, 0).getDate(); // days in prev month
    mo--;
  }
  if (mo < 0) {
    mo += 12;
    y--;
  }
  return { years: y, months: mo, days: d, hours: h, minutes: mi, seconds: s };
}

/** The calendar-aware unit ladder years→months→days→hours→minutes for a delta. */
function humanUnits(
  nowMs: number,
  targetMs: number,
  tz: string | null = null
): Array<[number, string]> {
  const b = breakdown(nowMs, targetMs, tz);
  return [
    [b.years, 'year'],
    [b.months, 'month'],
    [b.days, 'day'],
    [b.hours, 'hour'],
    [b.minutes, 'minute'],
  ];
}

/**
 * Human hero (default `units human`): the coarse **top-two units including
 * years** as the hero (`big`), the finer **remainder** as a muted sub-line
 * (`sub`). Leading zero units are dropped ("2 months, 4 days", never "0 years,
 * …"). Shared so the baked hero and the live tick agree.
 */
export function formatHuman(
  nowMs: number,
  targetMs: number,
  tz: string | null = null
): { big: string; sub: string } {
  const units = humanUnits(nowMs, targetMs, tz);
  let i = 0;
  while (i < units.length - 1 && units[i]![0] === 0) i++;
  const rest = units.slice(i);
  const say = (arr: Array<[number, string]>): string =>
    arr.map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`).join(', ');
  const primary = rest.slice(0, 2).filter((p, idx) => p[0] > 0 || idx === 0);
  const secondary = rest.slice(2).filter((p) => p[0] > 0);
  return { big: say(primary) || 'now', sub: say(secondary) };
}

/**
 * Compound human phrase — "10 months, 20 days". Drops leading zero units and
 * shows at most `maxUnits` (default 2) from years→months→days→hours→minutes.
 */
export function formatCompound(
  nowMs: number,
  targetMs: number,
  maxUnits = 2,
  tz: string | null = null
): string {
  const all = humanUnits(nowMs, targetMs, tz);
  let i = 0;
  while (i < all.length - 1 && all[i]![0] === 0) i++;
  const chosen = all
    .slice(i, i + maxUnits)
    .filter((p, idx) => p[0] > 0 || idx === 0);
  if (!chosen.length) return 'now';
  return chosen.map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`).join(', ');
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Tue Jul 21 2026" (locale-free so baked == live regardless of environment). */
export function formatDate(ms: number, tz: string | null = null): string {
  const f = zoneFields(ms, tz);
  return `${WEEKDAY_ABBR[f.weekday]} ${MONTH_ABBR[f.month]} ${f.day} ${f.year}`;
}

/** "Jul 11 2026" — the compact form used by the "as of" stamp. */
export function formatDateShort(ms: number, tz: string | null = null): string {
  const f = zoneFields(ms, tz);
  return `${MONTH_ABBR[f.month]} ${f.day} ${f.year}`;
}

/**
 * The in-chart footer resolution line — the resolved instant formatted in `tz`
 * (viewer-local when null):
 *   `Tue Jul 21 2026 · 18:00`            (viewer-local)
 *   `Fri Aug 21 2026 · 18:00 · UTC−4`    (pinned tz — offset tag disambiguates)
 * `hasTime` includes the clock segment (omitted for midnight one-shot dates).
 */
export function formatFooter(
  resolvedMs: number,
  hasTime: boolean,
  tz: string | null = null
): string {
  const parts = [formatDate(resolvedMs, tz)];
  if (hasTime) {
    const f = zoneFields(resolvedMs, tz);
    parts.push(`${pad2(f.hour)}:${pad2(f.minute)}`);
    const label = zoneOffsetLabel(resolvedMs, tz);
    if (label) parts.push(label);
  }
  return parts.join(' · ');
}
