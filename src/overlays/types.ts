// ============================================================
// Statistics overlays — the shared grammar (#1954)
// ============================================================
//
// One bare directive per overlay. The value is computed from the chart's own
// parsed data and drawn as a reference line or marker behind the series.
//
//   mean                 line, bar   dashed horizontal line
//   median               line, bar   dotted horizontal line
//   target N [below]     line, bar   an authored line; what reaches it is lit
//   trend                line, bar,  least-squares line; slope label on line
//                        scatter     and bar, R² per category on scatter
//   moving-average N     line        trailing N-point average, drawn thicker
//   extremes             line        highest and lowest point of each series
//   pareto               bar         sort largest first, cumulative-% line on
//                                    a right 0–100% axis, dashed 80% guide

/** Every overlay directive dgmo knows. */
export type OverlayKind =
  | 'mean'
  | 'median'
  | 'target'
  | 'trend'
  | 'moving-average'
  | 'extremes'
  | 'pareto';

/** One parsed overlay directive. */
export interface ChartOverlay {
  readonly kind: OverlayKind;
  /** `target N`: the authored value. `moving-average N`: the window. */
  readonly value?: number;
  /** `target N below`: at or under N is good. */
  readonly below?: boolean;
  readonly lineNumber: number;
}
