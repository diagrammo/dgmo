// ============================================================
// Shared helpers for the hand-built (D3) data-chart renderers — SPIKE.
//
// These renderers replace the ECharts path for the Tier-1 data-chart types
// (bar / line / pie families). They draw directly into a d3-selection SVG using
// d3-scale + d3-shape — both already first-class dependencies — and reuse the
// same export-container lifecycle as every other D3 visualization in the repo.
// ============================================================

import type * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { measureText } from '../utils/text-measure';

export type Svg = d3Selection.Selection<
  SVGSVGElement,
  unknown,
  null,
  undefined
>;

/** Cartesian plot margins. Top leaves room for the title. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const AXIS_LABEL_FONT = 13;
export const TICK_FONT = 12;
export const LEGEND_FONT = 13;
export const LEGEND_DOT_R = 5;
export const LEGEND_ROW_H = 22;
export const LEGEND_GAP = 18;

/** Format a numeric tick: trim trailing zeros, keep it compact. */
export function fmtNum(n: number): string {
  if (!isFinite(n)) return '';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US');
  // up to 2 decimals, no trailing zeros
  return String(Math.round(n * 100) / 100);
}

/**
 * Draw a single-row legend centered at the bottom of the canvas. Returns the
 * height it consumed so the caller can reserve bottom margin for it.
 */
export function drawLegend(
  svg: Svg,
  items: { name: string; color: string }[],
  width: number,
  bottomY: number,
  textColor: string
): number {
  if (items.length <= 1) return 0;
  const widths = items.map(
    (it) => LEGEND_DOT_R * 2 + 6 + measureText(it.name, LEGEND_FONT)
  );
  const total =
    widths.reduce((a, b) => a + b, 0) + LEGEND_GAP * (items.length - 1);
  let x = (width - total) / 2;
  const g = svg.append('g').attr('class', 'dgmo-legend');
  items.forEach((it, i) => {
    const row = g.append('g').attr('transform', `translate(${x},${bottomY})`);
    row
      .append('circle')
      .attr('cx', LEGEND_DOT_R)
      .attr('cy', -LEGEND_FONT / 2 + 1)
      .attr('r', LEGEND_DOT_R)
      .attr('fill', it.color);
    row
      .append('text')
      .attr('x', LEGEND_DOT_R * 2 + 6)
      .attr('y', 0)
      .attr('fill', textColor)
      .attr('font-size', LEGEND_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(it.name);
    x += widths[i]! + LEGEND_GAP;
  });
  return LEGEND_ROW_H;
}

/** Draw a centered axis title below the x-axis. */
export function drawXAxisTitle(
  svg: Svg,
  label: string | undefined,
  cx: number,
  y: number,
  textColor: string
): void {
  if (!label) return;
  svg
    .append('text')
    .attr('x', cx)
    .attr('y', y)
    .attr('text-anchor', 'middle')
    .attr('fill', textColor)
    .attr('font-size', AXIS_LABEL_FONT)
    .attr('font-family', FONT_FAMILY)
    .attr('font-weight', 600)
    .text(label);
}

/** Draw a rotated axis title to the left of the y-axis. */
export function drawYAxisTitle(
  svg: Svg,
  label: string | undefined,
  cy: number,
  x: number,
  textColor: string
): void {
  if (!label) return;
  svg
    .append('text')
    .attr('transform', `translate(${x},${cy}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', textColor)
    .attr('font-size', AXIS_LABEL_FONT)
    .attr('font-family', FONT_FAMILY)
    .attr('font-weight', 600)
    .text(label);
}
