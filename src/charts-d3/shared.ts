// ============================================================
// Shared helpers for the hand-built (D3) data-chart renderers — SPIKE.
//
// These renderers replace the ECharts path for the Tier-1 data-chart types
// (bar / line / pie families). They draw directly into a d3-selection SVG using
// d3-scale + d3-shape — both already first-class dependencies — and reuse the
// same export-container lifecycle, legend, and tint helpers as the rest of the
// repo so the output matches the ECharts path's house style.
// ============================================================

import type * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { measureText } from '../utils/text-measure';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { getSimpleChartLegendGroups } from '../data-chart-parser';
import { renderLegendSvg } from '../utils/legend-svg';
import type { LegendGroupData } from '../utils/legend-types';
import { renderChartTitle } from '../utils/d3-helpers';
import { layoutInlineHeader } from '../utils/inline-header';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  TITLE_OFFSET,
} from '../utils/title-constants';

export type Svg = d3Selection.Selection<
  SVGSVGElement,
  unknown,
  null,
  undefined
>;

/** Cartesian plot margins. Top is set by reserveHeader (title + legend). */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const AXIS_LABEL_FONT = 13;
export const TICK_FONT = 12;
export const VALUE_FONT = 12;

/** Format a numeric tick/value: trim trailing zeros, keep it compact. */
export function fmtNum(n: number): string {
  if (!isFinite(n)) return '';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US');
  return String(Math.round(n * 100) / 100);
}

/**
 * The title text a caller wants the legend renderer to own so it can attempt a
 * one-line header (title left, legend right) per §1.9 `legend-inline`. When this
 * is passed, the DISPATCHER must NOT also render a centered title — the legend
 * path renders the title itself (left-aligned inline, or centered on fallback).
 */
export interface InlineTitleInfo {
  title: string;
  titleLineNumber?: number;
  textColor: string;
}

/**
 * Attempt a one-line header: left-aligned title, series legend flushed right,
 * vertically centered on the title. Returns the plot top-inset on success, or
 * `null` when the legend cannot fit on a single row beside the title (the caller
 * then renders the normal stacked header). The fit decision + geometry come from
 * the shared `layoutInlineHeader`; this only renders. §1.9 `legend-inline`, #50.
 */
function renderInlineHeader(
  svg: Svg,
  groups: LegendGroupData[],
  palette: PaletteColors,
  isDark: boolean,
  width: number,
  info: InlineTitleInfo
): number | null {
  // Probe the legend left-origin at full width to read its natural extent (it
  // won't wrap at full width, so height stays one row unless genuinely huge).
  const {
    svg: legendSvg,
    height: legendH,
    width: legendW,
  } = renderLegendSvg(groups, {
    palette,
    isDark,
    containerWidth: width,
    activeGroup: groups[0]!.name,
    className: 'chart-legend',
    align: 'left',
  });
  if (!legendSvg) return null;

  const geom = layoutInlineHeader({
    requested: true,
    title: info.title,
    hasLegend: true,
    legendWidth: legendW,
    legendHeight: legendH,
    containerWidth: width,
    titleBandHeight: TITLE_OFFSET,
    legendReserve: 0,
    titleBaselineY: TITLE_Y,
    titleFontSize: TITLE_FONT_SIZE,
  });
  if (!geom.inline) return null;

  const titleEl = svg
    .append('text')
    .attr('class', 'chart-title')
    .attr('x', geom.titleX)
    .attr('y', TITLE_Y)
    .attr('fill', info.textColor)
    .attr('font-size', TITLE_FONT_SIZE)
    .attr('font-weight', TITLE_FONT_WEIGHT)
    .text(info.title);
  if (info.titleLineNumber) {
    titleEl.attr('data-line-number', info.titleLineNumber);
  }

  const node = svg.node();
  if (node) {
    node.insertAdjacentHTML(
      'beforeend',
      `<g transform="translate(${geom.legendX},${geom.legendY})">${legendSvg}</g>`
    );
  }
  // Single header row: plot begins just below the title band.
  return TITLE_OFFSET + 12;
}

/**
 * Render the standard top-center legend (capsule + pills) for a multi-series
 * chart, mirroring the ECharts path exactly: same `getSimpleChartLegendGroups`
 * input and same `<g transform="translate(0,legendY)">` injection. Returns the
 * y-coordinate where plot content may begin (below title + legend).
 *
 * When `inlineTitle` is supplied the header first tries the one-line layout
 * (§1.9 `legend-inline`); the caller must not have rendered a centered title.
 */
export function reserveHeader(
  svg: Svg,
  chart: ParsedChart,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  hasTitle: boolean,
  width: number,
  inlineTitle?: InlineTitleInfo
): number {
  return injectLegendGroups(
    svg,
    // `no-legend` (#48) → pass no groups; injectLegendGroups then returns the
    // title-only top inset, so the legend band collapses rather than blanking.
    chart.noLegend ? [] : getSimpleChartLegendGroups(chart, colors),
    palette,
    isDark,
    hasTitle,
    width,
    inlineTitle
  );
}

/**
 * Inject a top-center capsule legend from pre-built groups (mirrors the
 * ECharts path's `<g transform="translate(0,legendY)">` placement) and return
 * the y where plot content may begin. Empty groups → just clear the title.
 *
 * `inlineTitle` (§1.9 `legend-inline`) makes this function OWN the title: it
 * tries the one-line header first, and on fallback (or empty groups) renders the
 * centered title itself. Omit it for the historic stacked behavior, where the
 * caller renders the title separately.
 */
export function injectLegendGroups(
  svg: Svg,
  groups: LegendGroupData[],
  palette: PaletteColors,
  isDark: boolean,
  hasTitle: boolean,
  width: number,
  inlineTitle?: InlineTitleInfo
): number {
  if (inlineTitle && groups.length > 0) {
    const inset = renderInlineHeader(
      svg,
      groups,
      palette,
      isDark,
      width,
      inlineTitle
    );
    if (inset !== null) return inset;
    // Doesn't fit inline → fall through to the stacked header. The dispatcher
    // skipped the centered title on our behalf, so render it here.
  }
  if (inlineTitle) {
    renderChartTitle(
      svg,
      inlineTitle.title,
      inlineTitle.titleLineNumber,
      width,
      inlineTitle.textColor
    );
  }

  const titleH = hasTitle ? 40 : 0;
  if (groups.length === 0) return hasTitle ? titleH + 12 : 24;

  const legendY = 8 + titleH;
  const { svg: legendSvg, height: legendH } = renderLegendSvg(groups, {
    palette,
    isDark,
    containerWidth: width,
    activeGroup: groups[0]!.name,
    className: 'chart-legend',
  });
  const node = svg.node();
  if (node && legendSvg) {
    node.insertAdjacentHTML(
      'beforeend',
      `<g transform="translate(0,${legendY})">${legendSvg}</g>`
    );
  }
  return legendY + legendH + 14;
}

/**
 * Compute a left margin that fits both the rotated y-axis title (when present)
 * and the widest left-edge label (value ticks for vertical charts, category
 * names for horizontal bars). Fixes axis-title / tick-label collisions.
 */
export function computeLeftMargin(
  yLabel: string | undefined,
  leftLabels: string[]
): number {
  const pad = 16;
  const titleBand = yLabel ? 22 : 0;
  const labelW = leftLabels.length
    ? Math.max(...leftLabels.map((t) => measureText(t, TICK_FONT)))
    : 0;
  return Math.max(56, pad + titleBand + labelW + 14);
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

/**
 * Tag a rendered datum element with the shared interaction convention so the
 * framework-agnostic adapter (interactions.ts) and the app's generic
 * data-line-number path can drive it: click-to-source, hover-emphasis/dim,
 * and tooltip content — all from these attributes, no per-type wiring.
 */
export function tagDatum<E extends Element>(
  sel: d3Selection.Selection<E, unknown, null, undefined>,
  o: {
    line?: number;
    key?: string;
    name?: string;
    value?: string | number;
    color?: string;
  }
): d3Selection.Selection<E, unknown, null, undefined> {
  const cls = (sel.attr('class') ?? '').split(/\s+/).filter(Boolean);
  if (!cls.includes('dgmo-datum')) cls.push('dgmo-datum');
  sel.attr('class', cls.join(' '));
  if (o.line != null) sel.attr('data-line-number', o.line);
  if (o.key != null) sel.attr('data-emph-key', o.key);
  if (o.name != null) sel.attr('data-name', o.name);
  if (o.value != null) sel.attr('data-value', String(o.value));
  if (o.color != null) sel.attr('data-color', o.color);
  return sel;
}

/** Draw a value label (data point / bar) in the given color. */
export function drawValueLabel(
  svg: Svg,
  text: string,
  x: number,
  y: number,
  color: string,
  anchor: 'middle' | 'start' | 'end' = 'middle'
): void {
  svg
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('fill', color)
    .attr('font-size', VALUE_FONT)
    .attr('font-family', FONT_FAMILY)
    .text(text);
}
