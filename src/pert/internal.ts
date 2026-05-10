// ============================================================
// PERT — internal types
// ============================================================
//
// Not re-exported from the package barrel. Parser/analyzer/renderer
// share these; consumers should reach for `./types` instead.

import type { Duration, DurationUnit } from '../gantt/types';
import { formatDateKey, parseGanttDate } from '../utils/duration';

/**
 * A three-point duration estimate. Each component is a parsed
 * `Duration { amount, unit }` so mixed units (`1w 2w 3m`) are
 * preserved; the analyzer normalizes to `options.timeUnit` for
 * arithmetic.
 */
export interface DurationEstimate {
  o: Duration;
  m: Duration;
  p: Duration;
  /**
   * When true, only an M token was given on the source line and the
   * analyzer must expand O/P from confidence factors. When false, the
   * user wrote an explicit O M P triple (even when all three values
   * are equal — zero-variance is a valid, deterministic estimate).
   */
  mOnly: boolean;
}

/** Named confidence level. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Resolved O/P heuristic factors. */
export interface ConfidenceFactors {
  oFactor: number;
  pFactor: number;
}

/** Heuristic defaults (see spec § Heuristic Defaults). */
export const CONFIDENCE_TABLE: Record<ConfidenceLevel, ConfidenceFactors> = {
  high: { oFactor: 0.9, pFactor: 1.5 },
  medium: { oFactor: 0.75, pFactor: 3.0 },
  low: { oFactor: 0.5, pFactor: 4.0 },
};

/**
 * Resolve a `confidence` directive value to factor pair.
 * Accepts named levels (`high`/`medium`/`low`) or `O/P` factor pair
 * (`0.6/2.5`). Returns `null` on a malformed value.
 */
export function resolveConfidence(value: string): ConfidenceFactors | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed in CONFIDENCE_TABLE) {
    return CONFIDENCE_TABLE[trimmed as ConfidenceLevel];
  }
  const factorMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (factorMatch) {
    const oFactor = parseFloat(factorMatch[1]);
    const pFactor = parseFloat(factorMatch[2]);
    if (oFactor > 0 && pFactor > 0) return { oFactor, pFactor };
  }
  return null;
}

/**
 * Per-activity layout-overrides shape — the diagrammo-app holds expansion
 * state in its own store and passes overrides to `relayoutPert`.
 */
export type LayoutOverrides = Record<string, { width: number; height: number }>;

/** Pass 1 raw declaration record. */
export interface DeclarationSite {
  /** Original name token (multi-word, pre-alias-strip). */
  name: string;
  /** Alias from `as <id>` suffix, or undefined. */
  alias?: string;
  /** Raw duration tokens (numeric strings) — empty for TBD. */
  durationTokens: string[];
  /** Raw pipe-metadata segment (everything after `|`), or undefined. */
  pipeMetadata?: string;
  /** Source line (1-based). */
  lineNumber: number;
  /** Pending group id from the enclosing block at the source line. */
  groupHint?: string;
}

/** Pass 1 raw reference record. */
export interface ReferenceSite {
  /** Source activity id (resolved at edge-creation time). */
  sourceName: string;
  sourceLineNumber: number;
  /** Target name as written. */
  targetName: string;
  targetLineNumber: number;
  /** Dependency type (default FS when no edge label). */
  type: import('./types').EdgeType;
  /** Lag duration; null = zero offset. Negative amount = lead. */
  lag: import('../gantt/types').Duration | null;
}

// ============================================================
// Date anchoring helpers
// ============================================================
//
// `start-date` / `end-date` directives let PERT diagrams render
// real calendar dates instead of numeric day-offsets. These helpers
// own the host-TZ-invariant arithmetic; reuse them everywhere a date
// flows through PERT (parser, analyzer, renderer).

/** Time-unit → calendar-day conversion, mirroring analyzer's table. */
const UNIT_TO_DAYS_LOCAL: Record<DurationUnit, number> = {
  min: 1 / (60 * 24),
  h: 1 / 24,
  d: 1,
  bd: 1, // PERT has no calendar; bd ≈ d for analytical purposes
  w: 7,
  m: 30,
  q: 90,
  y: 365,
  s: 14, // sprint (14 calendar days) — not seconds
};

export function unitToDays(unit: DurationUnit): number {
  return UNIT_TO_DAYS_LOCAL[unit];
}

/** Strict `YYYY-MM-DD` literal — no time component, no other formats. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * TZ-safe parse of a `YYYY-MM-DD` string into a local-time `Date`.
 * Rejects:
 *   - shape mismatches (e.g. `2026/06/01`, `2026-6-1`)
 *   - invalid calendar dates (`2026-13-99`, `2026-02-31`)
 * Returns `null` on rejection.
 */
export function parseLocalISODate(iso: string): Date | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const date = parseGanttDate(iso);
  // Round-trip check rejects calendar wrap-arounds like 2026-13-99
  // (which JS happily reinterprets as 2027-01-99 etc.).
  if (formatDateKey(date) !== iso) return null;
  return date;
}

/**
 * Format a `Date` as `YYYY-MM-DD` using local-time getters (NOT
 * `toISOString`, which silently shifts to UTC and produces off-by-one
 * results in non-UTC zones).
 */
export function formatLocalISODate(date: Date): string {
  return formatDateKey(date);
}

/**
 * Add `days` calendar days to an ISO date string, returning a new
 * `YYYY-MM-DD`. Single rounding point at entry, symmetric (round-half-
 * away-from-zero) so forward and backward anchors agree at fractional
 * boundaries. Returns the input unchanged when it fails to parse —
 * upstream validation should have caught that, so this is defensive.
 */
export function addCalendarDays(iso: string, days: number): string {
  const start = parseLocalISODate(iso);
  if (!start) return iso;
  // Symmetric round-half-away-from-zero. `Math.round` rounds .5
  // toward +∞, which makes forward (+17.5) and backward (-17.5) of
  // the same offset disagree.
  const whole = Math.sign(days) * Math.round(Math.abs(days));
  const result = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + whole,
    start.getHours(),
    start.getMinutes()
  );
  return formatLocalISODate(result);
}
