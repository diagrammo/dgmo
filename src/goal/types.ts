import type { DgmoError } from '../diagnostics';
import type { ChartFrame } from '../utils/chart-frame-parse';

// ============================================================
// Goal chart — Parsed Types
// ============================================================
//
// Progress toward a target (`actual` vs `target`), drawn on one of three
// faces. An optional `bands` block names zones (poor / ok / good) that colour
// the fill and draw as a ribbon (#1973). `[Measure]` headers put several
// measures in one chart — the bullet chart (#1851).

/** Render face. `bar` is the default (no mode flag). */
export type GoalMode = 'bar' | 'thermometer' | 'gauge';

export interface GoalOptions {
  /** Hide the `%` label and the band label after it. */
  readonly noPercent: boolean;
  /** Hide the raw value labels. */
  readonly noValue: boolean;
  /** §1.9 fill family; undefined ⇒ canonical 25% tint. */
  readonly fillMode: 'solid' | 'outline' | undefined;
  /** Hide the banner title. */
  readonly noTitle: boolean;
  /** Fill takes the palette colour, not the band (status) colour. */
  readonly noAutoColor: boolean;
  /** Suppress the `note` description block even when one is present. */
  readonly noNote: boolean;
  /** Drop the band ribbon and its labels. */
  readonly noRibbon: boolean;
  /** Keep the ribbon, hide the band names on it. */
  readonly noRibbonLabels: boolean;
  /** Several measures: put every row on one scale. */
  readonly sharedScale: boolean;
}

/** One band, resolved to an absolute start value. Runs to the next band's start. */
export interface GoalBand {
  readonly start: number;
  readonly label: string | null;
  /** Resolved colour when the line named one; null ⇒ the position ramp. */
  readonly color: string | null;
  readonly lineNumber: number;
}

/** One measure: a single goal, or one row of a bullet chart. */
export interface GoalMeasure {
  /** `[Measure]` header text; null for a single goal. */
  readonly name: string | null;
  readonly lineNumber: number | null;
  /** Current value (raw; may be negative or exceed target). */
  readonly actual: number;
  /** Goal value. `0` when missing/invalid — the renderer draws a 0% shell. */
  readonly target: number;
  /** False when `target` was missing or ≤ 0 (an error was emitted). */
  readonly hasTarget: boolean;
  /** Header / title-line colour: sets the fill. */
  readonly color?: string;
  /**
   * Resolved bands, ascending. With no `bands` block these are the hidden
   * default (0% red, 50% orange, 80% green) and `explicitBands` is false.
   */
  readonly bands: readonly GoalBand[];
  /** True when a `bands` block applies (own or top-level) — draws the ribbon. */
  readonly explicitBands: boolean;
  /** True when this measure has its own `bands` block (bullet label rule). */
  readonly ownBands: boolean;
  /** Where the scale ends: max(target, closing edge, actual) with bands; else target. */
  readonly scaleEnd: number;
}

export interface ParsedGoal {
  readonly type: 'goal';
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  readonly frame?: ChartFrame;
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  /** Optional free-text caption shown under the value (via `note <text>`). */
  readonly description: string | null;
  readonly mode: GoalMode;
  /** True when `[Measure]` headers made rows (the bullet chart). */
  readonly multi: boolean;
  /** One entry for a single goal; one per `[Measure]` otherwise. */
  readonly measures: readonly GoalMeasure[];
  readonly options: GoalOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
