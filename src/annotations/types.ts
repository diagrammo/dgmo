// ============================================================
// Chart annotations — the shared grammar (#1832)
// ============================================================
//
// Top-level directives that mark a value on a chart's value axis. One module
// parses them for every chart that takes them; each chart maps them through
// its own scale. This slice carries `ref-line` and `band` on bar and line.

/** `ref-line <value> [label] [color]` — a dashed line across the plot. */
export interface ChartRefLine {
  readonly kind: 'ref-line';
  readonly value: number;
  readonly label: string;
  /** Resolved CSS color, or null for the theme's text color. */
  readonly color: string | null;
  readonly lineNumber: number;
}

/** `band <from>..<to> [label] [color]` — a shaded value range. */
export interface ChartBand {
  readonly kind: 'band';
  /** Lower end; the parser orders the two ends. */
  readonly from: number;
  /** Upper end. */
  readonly to: number;
  readonly label: string;
  /** Resolved CSS color, or null for the theme's muted text color. */
  readonly color: string | null;
  readonly lineNumber: number;
}

export type ChartAnnotation = ChartRefLine | ChartBand;
