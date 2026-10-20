// ============================================================
// Left label column: width cap, truncation and hover reveal
// ============================================================
//
// Gantt and timeline (swimlane mode) draw a left column of row labels whose
// width follows the longest label. Uncapped, one long label squeezes the time
// axis to slivers (#1415, #1418). The column is capped at a share of the chart
// width; labels past the cap truncate with "…" and show in full on hover.

import type * as d3Selection from 'd3-selection';
import { truncateText } from './text-measure';

/**
 * The label column's ceiling as a share of the chart width. One third keeps
 * every hand-written gantt we hold untouched: the widest column among the
 * gallery, dgmo-content and my-diagrams charts is 198px, which fits under a
 * third of a 600px app pane.
 */
export const LABEL_COLUMN_MAX_SHARE = 1 / 3;
/** Room kept between a truncated label's "…" and the time axis. */
const LABEL_COLUMN_END_PAD = 12;

export interface LabelColumn {
  /** The column width to lay out with. */
  width: number;
  /**
   * The text to draw for a label starting `labelX` px into the column. Only a
   * capped column truncates, so a chart whose labels fit draws them whole.
   */
  fit: (
    text: string,
    labelX: number,
    fontSize: number,
    bold?: boolean
  ) => string;
}

/**
 * Cap a column whose natural width is `natural` at LABEL_COLUMN_MAX_SHARE of
 * `chartWidth`, never below `floor` (the chart's own minimum column).
 */
export function capLabelColumn(
  natural: number,
  chartWidth: number,
  floor: number
): LabelColumn {
  const cap = Math.max(floor, Math.floor(chartWidth * LABEL_COLUMN_MAX_SHARE));
  const width = Math.min(natural, cap);
  const capped = natural > cap;
  return {
    width,
    fit: (text, labelX, fontSize, bold = false) =>
      capped
        ? truncateText(
            text,
            fontSize,
            Math.max(0, width - labelX - LABEL_COLUMN_END_PAD),
            { bold }
          )
        : text,
  };
}

/**
 * Draw `prefix + shown` in `drawEl`. When `shown` was cut from `full`, mark
 * `labelEl` with `data-full-label` and swap in the full text while `hoverEl`
 * is hovered — the reveal gantt's era and marker labels use. The listeners
 * are namespaced, so they add to the row's own highlight handlers.
 */
export function showFullOnHover<
  H extends Element,
  L extends Element,
  D extends Element,
>(
  hoverEl: d3Selection.Selection<H, unknown, null, undefined>,
  labelEl: d3Selection.Selection<L, unknown, null, undefined>,
  drawEl: d3Selection.Selection<D, unknown, null, undefined>,
  full: string,
  shown: string,
  prefix = ''
): void {
  drawEl.text(prefix + shown);
  if (shown === full) return;
  labelEl.attr('data-full-label', full);
  hoverEl
    .on('mouseenter.reveal', () => drawEl.text(prefix + full))
    .on('mouseleave.reveal', () => drawEl.text(prefix + shown));
}
