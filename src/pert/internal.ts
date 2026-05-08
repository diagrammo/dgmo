// ============================================================
// PERT — internal types
// ============================================================
//
// Not re-exported from the package barrel. Parser/analyzer/renderer
// share these; consumers should reach for `./types` instead.

import type { Duration } from '../gantt/types';

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
  /** Whether this site was an inline `-> name <durs>` forward-decl. */
  inline: boolean;
  /** Pending group id from the enclosing block at the source line. */
  groupHint?: string;
  /** Set when this is a `milestone <name>` primitive. */
  isMilestone: boolean;
}

/** Pass 1 raw reference record. */
export interface ReferenceSite {
  /** Source activity id (resolved at edge-creation time). */
  sourceName: string;
  sourceLineNumber: number;
  /** Target name as written. */
  targetName: string;
  targetLineNumber: number;
}
