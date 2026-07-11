import type { DgmoError } from '../diagnostics';

// ============================================================
// Goal chart — Parsed Types
// ============================================================
//
// A single progress-toward-a-target value (`now` vs `target`) rendered in one
// of three static faces. No time, no series, no children — just "how close am
// I?". The mode is a bare-flag directive (like treemap's `radial`).

/** Render face. `bar` is the default (no mode flag). */
export type GoalMode = 'bar' | 'thermometer' | 'gauge';

export interface GoalOptions {
  /** Hide the `%` label. */
  readonly noPercent: boolean;
  /** Hide the raw `now / target` label. */
  readonly noValue: boolean;
  /** Full-saturation fill instead of the 25% tint. */
  readonly solidFill: boolean;
  /** Hide the banner title. */
  readonly noTitle: boolean;
}

export interface ParsedGoal {
  readonly type: 'goal';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly mode: GoalMode;
  /** Current value (raw; may be negative or exceed target). */
  readonly now: number;
  /** Goal value. `0` when missing/invalid — the renderer draws a 0% shell. */
  readonly target: number;
  /** False when `target` was missing or ≤ 0 (an error was emitted). */
  readonly hasTarget: boolean;
  /** Resolved trailing-token / `color:` hex, if any. */
  readonly color?: string;
  readonly options: GoalOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
