// ============================================================
// Clock chart — shared time math + formatting (dependency-free)
// ============================================================
//
// The single source of truth for turning an IANA zone + an instant into the
// concrete hour/minute/second, the UTC offset label, the working-hours status,
// the analog hand angles, and the sundown/sunrise line. Ported faithfully from
// the approved mockup (SunCalc-style sunrise/sunset), TS + dep-free.
//
// Imported by BOTH:
//   • renderer.ts (Node/resvg + browser) — bakes the no-JS floor
//   • ticker.ts    (browser only)        — recomputes live every second
// so the baked value and the live value never disagree. MUST stay
// dependency-free (no d3, no palettes) — it is bundled into the tiny
// `dist/clock.js` browser entry alongside the ticker.
//
// `zoneParts` uses `Intl.DateTimeFormat` with an explicit `timeZone`, so the
// result is correct regardless of the host's own TZ (fixtures run under TZ=UTC).

/** Absolute time-of-day hue ramp for `color-by time` (theme-independent). */
const CLOCK_RAMP: readonly (readonly [number, string])[] = [
  [0, '#3d478f'],
  [4, '#4a4d8c'],
  [6, '#c98a6b'],
  [8, '#d9a441'],
  [11, '#e0b23c'],
  [13, '#4f96c4'],
  [16, '#cc7a33'],
  [19, '#8a5aa0'],
  [24, '#3d478f'],
];

/** Blend two `#rrggbb` hexes: `t=0`→a, `t=1`→b. */
function hexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) =>
    Math.round(v + (pb[i]! - v) * t)
      .toString(16)
      .padStart(2, '0')
  );
  return `#${c.join('')}`;
}

/** The time-of-day ramp color at local hour `h` (0–24, wrapping). */
export function rampColor(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  for (let i = 0; i < CLOCK_RAMP.length - 1; i++) {
    const [h0, c0] = CLOCK_RAMP[i]!;
    const [h1, c1] = CLOCK_RAMP[i + 1]!;
    if (hh >= h0 && hh <= h1) return hexLerp(c0, c1, (hh - h0) / (h1 - h0));
  }
  return CLOCK_RAMP[0]![1];
}

/** One weekday's status band. */
export type WorkClass = 'ok' | 'soon' | 'off';

/** A working window resolved to minutes-past-midnight + a day set. */
export interface WorkSpec {
  readonly startMin: number;
  readonly endMin: number;
  /** Keyed by the 3-letter `Intl` short weekday (`Mon`…`Sun`). */
  readonly days: Record<string, boolean>;
}

/** The zone-local wall-clock parts + UTC offset label at an instant. */
export interface ZoneParts {
  readonly h: number; // 0-23
  readonly m: number; // 0-59
  readonly s: number; // 0-59
  readonly weekday: string; // "Mon" … "Sun"
  readonly offsetLabel: string; // "UTC−4", "UTC+5:30", ""
}

/** Within-this-many-minutes-of-open counts as "soon". */
const SOON_MIN = 60;
const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;

/**
 * Zone-local hour/minute/second, short weekday, and UTC offset label for
 * `nowMs` in `zone`. Falls back to UTC parts if `zone` is not a zone `Intl`
 * recognizes (the parser flags that separately) so the renderer never throws.
 */
export function zoneParts(zone: string, nowMs: number): ZoneParts {
  const d = new Date(nowMs);
  try {
    const o: Record<string, string> = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
      .formatToParts(d)
      .forEach((x) => {
        o[x.type] = x.value;
      });
    const off = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(d)
      .find((x) => x.type === 'timeZoneName');
    return {
      h: parseInt(o['hour']!, 10) % 24,
      m: parseInt(o['minute']!, 10),
      s: parseInt(o['second']!, 10),
      weekday: o['weekday']!,
      offsetLabel: off ? off.value.replace('GMT', 'UTC') : '',
    };
  } catch {
    return {
      h: d.getUTCHours(),
      m: d.getUTCMinutes(),
      s: d.getUTCSeconds(),
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
        d.getUTCDay()
      ]!,
      offsetLabel: 'UTC',
    };
  }
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * True when `zone` is an IANA zone id `Intl.DateTimeFormat` recognizes
 * (`America/New_York`, `Asia/Tokyo`, `UTC`). Used to validate an explicit
 * `tz:` before wiring a clock card — an unknown id warns + skips rather than
 * silently ticking off UTC. Does NOT accept fixed-offset tokens (`UTC+9`);
 * check `parseFixedOffset` first for those.
 */
export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAY_SHORT = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

/**
 * A `UTC`/`GMT` fixed-offset token → minutes east of UTC, or null when it is not
 * one. Accepts bare `UTC`/`GMT` (→ 0), `UTC+1`, `UTC-7`, `UTC+5:30`, and the
 * unpunctuated `UTC+0530`. `GMT` is treated as an exact synonym of `UTC`. The
 * range is clamped to the real-world span (−12:00 … +14:00); anything outside is
 * rejected (returns null) so a typo like `UTC+99` falls through to an error
 * rather than rendering a nonsense clock.
 */
export function parseFixedOffset(token: string): number | null {
  const m = token
    .trim()
    .match(/^(?:UTC|GMT)\s*([+-])?\s*(\d{1,2})?(?::?(\d{2}))?$/i);
  if (!m) return null;
  // Bare `UTC` / `GMT` → +00:00.
  if (!m[1] && !m[2] && !m[3]) return 0;
  // A sign with no digits, or digits with no sign, is malformed.
  if (!m[1] || !m[2]) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const h = Number(m[2]);
  const mm = m[3] ? Number(m[3]) : 0;
  if (h > 14 || mm > 59) return null;
  const total = sign * (h * 60 + mm);
  if (total < -12 * 60 || total > 14 * 60) return null;
  return total;
}

/** A fixed offset (minutes east of UTC) → its canonical label (`UTC+5:30`, `UTC−7`, `UTC`). */
export function formatOffsetLabel(offsetMin: number): string {
  if (offsetMin === 0) return 'UTC';
  // ASCII '-' to match `zoneParts`' Intl-derived labels ("UTC-4") and round-trip
  // the author's typed offset.
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `UTC${sign}${h}${mm ? ':' + pad2(mm) : ''}`;
}

/**
 * Wall-clock parts for a FIXED offset (a raw `UTC±HH:MM`), computed straight
 * from UTC + the offset. Deliberately DST-blind: a fixed offset never shifts, so
 * this is the honest reading for `UTC` itself, no-DST regions, and quick
 * throwaways — and wrong half the year for anywhere that observes DST (the parser
 * flags that with a marker, not an error).
 */
export function fixedParts(offsetMin: number, nowMs: number): ZoneParts {
  const d = new Date(nowMs + offsetMin * 60_000);
  return {
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    weekday: WEEKDAY_SHORT[d.getUTCDay()]!,
    offsetLabel: formatOffsetLabel(offsetMin),
  };
}

/** The main + seconds + am/pm segments of a formatted time. */
export interface TimeStr {
  /** "9:05" (12h) or "21:05" (24h). */
  readonly main: string;
  /** Zero-padded seconds, "07". */
  readonly sec: string;
  /** "am" / "pm", or "" for 24-hour. */
  readonly ap: string;
}

/** Format zone parts for display, honoring the board's 12/24-hour mode. */
export function formatTime(
  h: number,
  m: number,
  s: number,
  hours12: boolean
): TimeStr {
  const sec = pad2(s);
  if (hours12) {
    const ap = h < 12 ? 'am' : 'pm';
    let hr = h % 12;
    if (hr === 0) hr = 12;
    return { main: `${hr}:${pad2(m)}`, sec, ap };
  }
  return { main: `${pad2(h)}:${pad2(m)}`, sec, ap: '' };
}

/** The result of a working-hours evaluation. */
export interface WorkStatus {
  readonly cls: WorkClass;
  readonly text: string;
}

/**
 * Human relative-minutes phrase — "45m", "3h 10m" (mirrors the mockup's
 * `fmtDelta`, rounding to whole minutes; under 90m stays in minutes).
 */
export function fmtDelta(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 90) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * The working-hours status for `parts` against `work` (evaluated in the row's
 * own zone). `null` when no work window is configured. Green while inside the
 * window ("3h 10m left"), "soon" within an hour of opening ("starts in 30m"),
 * "off" before/after ("starts in 2h" / "ended 50m ago"), and "Weekend" on a
 * non-working day.
 */
export function workStatus(
  parts: Pick<ZoneParts, 'h' | 'm' | 'weekday'>,
  work: WorkSpec | null
): WorkStatus | null {
  if (!work) return null;
  const min = parts.h * 60 + parts.m;
  if (!work.days[parts.weekday]) return { cls: 'off', text: 'Weekend' };
  if (min < work.startMin) {
    const d = work.startMin - min;
    return {
      cls: d <= SOON_MIN ? 'soon' : 'off',
      text: `starts in ${fmtDelta(d * 60000)}`,
    };
  }
  if (min < work.endMin) {
    return { cls: 'ok', text: `${fmtDelta((work.endMin - min) * 60000)} left` };
  }
  return {
    cls: 'off',
    text: `ended ${fmtDelta((min - work.endMin) * 60000)} ago`,
  };
}

// ── Sunrise / sunset (SunCalc-style, ported from the mockup) ──

function toJulian(ms: number): number {
  return ms / DAY_MS - 0.5 + J1970;
}
function fromJulian(j: number): number {
  return (j + 0.5 - J1970) * DAY_MS;
}

interface SunResult {
  /** Set when the sun never rises/sets on this day (polar). */
  readonly polar?: 'day' | 'night';
  readonly sunriseMs?: number;
  readonly sunsetMs?: number;
}

/** Sunrise / sunset (epoch ms) for `nowMs` at `lat`/`lon`, or a polar flag. */
export function sunTimes(nowMs: number, lat: number, lon: number): SunResult {
  const lw = -lon * RAD;
  const phi = lat * RAD;
  const J = toJulian(nowMs);
  const n = Math.round(J - J2000 - 0.0009 - lw / (2 * Math.PI));
  const Jn = J2000 + 0.0009 + lw / (2 * Math.PI) + n;
  const M = (357.5291 + 0.98560028 * (Jn - J2000)) * RAD;
  const C =
    (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) *
    RAD;
  const L = M + C + Math.PI + 102.9372 * RAD;
  const Jt = Jn + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const dec = Math.asin(Math.sin(L) * Math.sin(23.44 * RAD));
  const cw =
    (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) /
    (Math.cos(phi) * Math.cos(dec));
  if (cw > 1) return { polar: 'night' };
  if (cw < -1) return { polar: 'day' };
  const w = Math.acos(cw);
  const Jset =
    J2000 +
    0.0009 +
    (w + lw) / (2 * Math.PI) +
    n +
    0.0053 * Math.sin(M) -
    0.0069 * Math.sin(2 * L);
  return {
    sunriseMs: fromJulian(Jt - (Jset - Jt)),
    sunsetMs: fromJulian(Jset),
  };
}

/** The sundown/sunrise line: whether the sun is up + a relative-time phrase. */
export interface SunLine {
  readonly up: boolean;
  readonly text: string;
}

/**
 * The sundown/sunrise line for `nowMs` at `lat`/`lon`:
 *   • daytime      → "sunset in 5h 20m"
 *   • before dawn  → "sunrise in 2h 10m"
 *   • after dusk   → "sunrise in 8h" (next day)
 *   • polar        → "midnight sun" / "polar night"
 */
export function sunLine(nowMs: number, lat: number, lon: number): SunLine {
  const t = sunTimes(nowMs, lat, lon);
  if (t.polar) {
    return {
      up: t.polar === 'day',
      text: t.polar === 'day' ? 'midnight sun' : 'polar night',
    };
  }
  if (nowMs < t.sunriseMs!) {
    return { up: false, text: `sunrise in ${fmtDelta(t.sunriseMs! - nowMs)}` };
  }
  if (nowMs < t.sunsetMs!) {
    return { up: true, text: `sunset in ${fmtDelta(t.sunsetMs! - nowMs)}` };
  }
  const tm = sunTimes(nowMs + DAY_MS, lat, lon);
  if (tm.polar) return { up: false, text: 'sunrise in —' };
  return { up: false, text: `sunrise in ${fmtDelta(tm.sunriseMs! - nowMs)}` };
}

// ── Analog hand angles ──

/** Degrees for the hour / minute / second hands, sweeping smoothly. */
export interface HandAngles {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Analog hand rotation angles (degrees, clockwise from 12 o'clock). */
export function handAngles(h: number, m: number, s: number): HandAngles {
  return {
    hour: ((h % 12) + m / 60) * 30,
    minute: (m + s / 60) * 6,
    second: s * 6,
  };
}

export { DAY_MS };
