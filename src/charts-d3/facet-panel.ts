// What a `facet` grid (#1853) tells the bar or line renderer drawing one of
// its panels. Kept apart from `facet.ts`, which imports both renderers.

export interface FacetPanel {
  /** Leave the value-axis tick labels out (the gridlines stay): a panel
   *  past the first column of a shared scale reads them from its row. */
  hideValueTicks?: boolean;
  /** Line only: the other series, one value per row (NaN draws a gap),
   *  drawn thin and grey behind the panel's own series. */
  context?: number[][];
}
