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
// All Date construction uses LOCAL components (viewer-local, v1 — see spec §2.3).
// Under TZ=UTC (the test env) local == UTC, so fixtures are deterministic.

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

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

/** Local midnight for `ms`. */
function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// ── Next-instant resolution + roll-forward ──

/** The nth (1-5) occurrence of `weekday` in year/month, or last (nth<0). */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
  hour: number,
  minute: number
): number | null {
  if (nth < 0) {
    // last: walk back from the month's final day.
    const last = new Date(year, month + 1, 0).getDate();
    for (let d = last; d >= 1; d--) {
      if (new Date(year, month, d).getDay() === weekday) {
        return new Date(year, month, d, hour, minute).getTime();
      }
    }
    return null;
  }
  const firstDow = new Date(year, month, 1).getDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  // Overflowed the month (e.g. "5th Tuesday" that doesn't exist) → no match.
  if (day > new Date(year, month + 1, 0).getDate()) return null;
  return new Date(year, month, day, hour, minute).getTime();
}

/**
 * The next instant strictly after `now` that matches `rule`. Used by both the
 * renderer (bake) and the ticker (live) — calling it with a fresh `now` on each
 * pass is what makes recurring countdowns roll forward automatically.
 */
export function resolveNext(rule: RecurRule, now: number): number {
  const nowD = new Date(now);
  const { hour, minute } = rule;
  // An ALL-DAY occurrence stays current for its whole day: compare at day
  // granularity, so on the day itself `t` (00:00, already behind `now`) still
  // counts and the chart reads "Today!" / the on-day text instead of rolling to
  // next year. Timed occurrences roll at the exact instant.
  const passes = rule.allDay
    ? (t: number): boolean => dayStart(t) >= dayStart(now)
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
      for (let y = nowD.getFullYear(); ; y++) {
        if (!dayExists(y, month, day)) continue; // skip non-leap Feb 29, etc.
        const t = new Date(y, month, day, hour, minute).getTime();
        if (passes(t)) return t;
      }
    }
    case 'nth-weekday':
    case 'last-weekday': {
      const weekday = rule.weekday!;
      const nth = rule.kind === 'last-weekday' ? -1 : rule.nth!;
      // Scan forward month by month (a valid match always exists within 12).
      let y = nowD.getFullYear();
      let m = nowD.getMonth();
      for (let i = 0; i < 24; i++) {
        const t = nthWeekdayOfMonth(y, m, weekday, nth, hour, minute);
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
        const d = new Date(
          nowD.getFullYear(),
          nowD.getMonth(),
          nowD.getDate() + i,
          hour,
          minute
        );
        if (d.getDay() === weekday && passes(d.getTime())) return d.getTime();
      }
      return now + WEEK_MS;
    }
    case 'interval': {
      const n = rule.intervalN ?? 1;
      const anchor = rule.anchorMs ?? now;
      if (rule.intervalUnit === 'month') {
        const a = new Date(anchor);
        const day = a.getDate();
        for (let k = 0; ; k++) {
          const y = a.getFullYear();
          const m = a.getMonth() + k * n;
          // Normalize the month, then SKIP if the anchor day-of-month doesn't
          // exist there (the 31st in a 30-day month) — same RRULE semantics.
          const yy = y + Math.floor(m / 12);
          const mm = ((m % 12) + 12) % 12;
          if (!dayExists(yy, mm, day)) continue;
          const t = new Date(yy, mm, day, hour, minute).getTime();
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

/** The `since` ordinal for a resolved instant: `resolvedYear − since`. */
export function ordinalFor(resolvedMs: number, since: number): number {
  return new Date(resolvedMs).getFullYear() - since;
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
  targetMs: number
): {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const n = new Date(nowMs);
  const t = new Date(targetMs);
  let y = t.getFullYear() - n.getFullYear();
  let mo = t.getMonth() - n.getMonth();
  let d = t.getDate() - n.getDate();
  let h = t.getHours() - n.getHours();
  let mi = t.getMinutes() - n.getMinutes();
  let s = t.getSeconds() - n.getSeconds();
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
    d += new Date(t.getFullYear(), t.getMonth(), 0).getDate(); // days in prev month
    mo--;
  }
  if (mo < 0) {
    mo += 12;
    y--;
  }
  return { years: y, months: mo, days: d, hours: h, minutes: mi, seconds: s };
}

/** The calendar-aware unit ladder years→months→days→hours→minutes for a delta. */
function humanUnits(nowMs: number, targetMs: number): Array<[number, string]> {
  const b = breakdown(nowMs, targetMs);
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
  targetMs: number
): { big: string; sub: string } {
  const units = humanUnits(nowMs, targetMs);
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
  maxUnits = 2
): string {
  const all = humanUnits(nowMs, targetMs);
  let i = 0;
  while (i < all.length - 1 && all[i]![0] === 0) i++;
  const chosen = all
    .slice(i, i + maxUnits)
    .filter((p, idx) => p[0] > 0 || idx === 0);
  if (!chosen.length) return 'now';
  return chosen.map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`).join(', ');
}

/** Short relative phrase for the footer ("in 8 days", "tomorrow", "today"). */
export function relativePhrase(remainingMs: number): string {
  if (remainingMs <= 0) return 'now';
  const days = Math.ceil(remainingMs / DAY_MS);
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
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
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAY_ABBR[d.getDay()]} ${MONTH_ABBR[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

/** "Jul 11 2026" — the compact form used by the "as of" stamp. */
export function formatDateShort(ms: number): string {
  const d = new Date(ms);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

/**
 * The in-chart footer resolution line — just the resolved instant:
 *   `Tue Jul 21 2026 · 18:00`
 * `hasTime` includes the clock segment (omitted for midnight one-shot dates).
 */
export function formatFooter(resolvedMs: number, hasTime: boolean): string {
  const parts = [formatDate(resolvedMs)];
  if (hasTime) {
    const d = new Date(resolvedMs);
    parts.push(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
  }
  return parts.join(' · ');
}
