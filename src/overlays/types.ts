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

/** Every overlay directive dgmo knows. */
export type OverlayKind = 'mean' | 'median' | 'target' | 'trend';

/** One parsed overlay directive. */
export interface ChartOverlay {
  readonly kind: OverlayKind;
  /** `target N`: the authored value. */
  readonly value?: number;
  /** `target N below`: at or under N is good. */
  readonly below?: boolean;
  readonly lineNumber: number;
}
