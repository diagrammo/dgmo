// ============================================================
// Chart annotations — the shared grammar (#1832, #2039)
// ============================================================
//
// Top-level directives that mark a data chart. One module parses them for
// every chart that takes them; each chart maps them through its own scales.
//
//   marker <position> [label] [color]   a line at one axis position
//   band <from>..<to> [label] [color]   a shaded value range
//   note [text]                         indented under its row: a ring on
//                                       that datum, with a leader (#2078)
//
// `era` (an ordered-axis span) stays in each chart's own parser.

/** Which axis a mark sits on. `value` is the value axis (y on a vertical
 *  chart). `cross` is the other one: categories on bar, line and slope, the
 *  numeric x axis on scatter. */
export type AnnotationAxis = 'value' | 'cross';

/** `marker <position> [label] [color]` — a dashed line across the plot. */
export interface ChartMarker {
  readonly kind: 'marker';
  readonly axis: AnnotationAxis;
  /** A number on a numeric axis; a category name on a category axis. */
  readonly at: number | string;
  readonly label: string;
  /** Resolved CSS color, or null for the theme's text color. */
  readonly color: string | null;
  readonly lineNumber: number;
}

/** `band <from>..<to> [label] [color]` — a shaded value range. */
export interface ChartBand {
  readonly kind: 'band';
  /** `cross` only on scatter (`band x 2..4`). */
  readonly axis: AnnotationAxis;
  /** Lower end; the parser orders the two ends. */
  readonly from: number;
  /** Upper end. */
  readonly to: number;
  readonly label: string;
  /** Resolved CSS color, or null for the theme's muted text color. */
  readonly color: string | null;
  readonly lineNumber: number;
}

export type ChartAnnotation = ChartMarker | ChartBand;

/** A `marker` line before its position is resolved against the chart. */
export interface RawMarker {
  readonly kind: 'marker';
  /** `marker x …` / `marker y …`; null when the author named no axis. */
  readonly axisHint: 'x' | 'y' | null;
  /** The position and label words, color word removed. */
  readonly text: string;
  readonly color: string | null;
  readonly lineNumber: number;
}

/** A `band` line before its axis is checked against the chart. */
export interface RawBand extends Omit<ChartBand, 'axis'> {
  readonly axisHint: 'x' | 'y' | null;
}

export type RawAnnotation = RawMarker | RawBand;

/** A `note` line before its target is resolved against the chart. */
export interface RawChartNote {
  /** The name before `@`, or null when there is no `@`. */
  readonly series: string | null;
  /** The datum name (no `@`) or the position after `@`. Empty: no target. */
  readonly target: string;
  /** Inline text and indented body, joined with `\n`. Markdown. */
  readonly text: string;
  readonly color: string | null;
  readonly lineNumber: number;
}

/** `note <datum> [text]` resolved to one datum on the chart. */
export interface ChartNote {
  /** Series index (bar, line), or row index on slope; 0 on scatter. */
  readonly series: number;
  /** Category index (bar, line), period index (slope), point index (scatter). */
  readonly index: number;
  readonly text: string;
  readonly color: string | null;
  readonly lineNumber: number;
}
