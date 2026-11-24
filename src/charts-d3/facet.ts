// ============================================================
// Small multiples (#1853): a bar or line chart with `facet` draws one panel
// per series, in declaration order, in a grid under one title block. Each
// panel is the ordinary renderer drawing a one-series chart into its own
// cell, so every per-panel option (fill, step, eras, horizontal bars) comes
// with it.
//
//  - One shared value axis by default; `facet-free-y` gives each panel its
//    own range. The category or time axis is the chart's own, so it is
//    shared always.
//  - A line panel draws the other series thin and grey behind its own,
//    unless `no-context`. Bars draw no context. Context needs one scale, so
//    `facet-free-y` panels draw none.
//  - `columns N` fixes the grid; otherwise as many columns as fit at
//    FACET_MIN_PANEL_W.
//  - Each panel is headed by its series name in the series colour; there is
//    no legend. With a shared axis, tick labels stand on the first column.
// ============================================================

import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { FRAME_BODY_TOP } from '../utils/title-constants';
import { annotationValues } from '../annotations/parse';
import { buildValueAxis } from './value-axis';
import { renderBar } from './bar';
import { renderLine } from './line';
import {
  drawXAxisTitle,
  drawYAxisTitle,
  reserveHeader,
  type Svg,
} from './shared';

/** The narrowest panel the automatic grid allows. */
export const FACET_MIN_PANEL_W = 240;
/** Space between panels, both ways. */
const FACET_GAP = 16;
/** The band above each panel holding its heading. */
const FACET_HEAD_H = 20;
const FACET_HEAD_FONT = 12;
/** Room for the grid's one x-axis or y-axis title. */
const FACET_AXIS_TITLE_ROOM = 24;
/** The shortest cell (heading and panel) before the drawing grows. */
const FACET_MIN_CELL_H = 200;
/** A cell's height on the chart's own canvas, when no caller sets one. */
const FACET_NATURAL_CELL_H = 260;
/** The title band above the grid on the natural canvas. */
const FACET_NATURAL_TOP = 80;

/** Row `d`'s value in series `s`, read as the chart without `facet` reads it. */
function valueOf(
  d: { value: number; extraValues?: number[] },
  s: number
): number {
  return s === 0 ? d.value : (d.extraValues?.[s - 1] ?? 0);
}

/** Columns for `count` panels in `width`: the author's, else as many as fit. */
export function facetColumns(
  count: number,
  width: number,
  columns?: number
): number {
  const fit = Math.floor((width + FACET_GAP) / (FACET_MIN_PANEL_W + FACET_GAP));
  return Math.max(1, Math.min(count, columns ?? fit));
}

/** The canvas height a grid of `rows` rows chooses for itself. */
export function facetNaturalHeight(rows: number): number {
  return (
    FACET_NATURAL_TOP +
    rows * FACET_NATURAL_CELL_H +
    (rows - 1) * FACET_GAP +
    FACET_AXIS_TITLE_ROOM
  );
}

/**
 * The value range every panel shares: what the renderer would fit to all the
 * series at once, rounded the same way. An end the author fixed on `y-axis`
 * stays theirs.
 */
function sharedRange(
  chart: ParsedChart,
  seriesCount: number
): [number, number] {
  const values: number[] = [];
  for (const d of chart.data)
    for (let s = 0; s < seriesCount; s++) {
      const v = valueOf(d, s);
      if (Number.isFinite(v)) values.push(v);
    }
  const marked = annotationValues(chart.annotations);
  const dataLo = Math.min(...values, ...marked);
  const dataHi = Math.max(...values, ...marked);
  let lo = dataLo;
  let hi = dataHi;
  if (!Number.isFinite(lo)) return [0, 1];
  if (chart.type === 'bar') {
    // A bar's length is its value: the axis reaches 0.
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  } else if (chart.noAutoY) {
    if (lo > 0) lo = 0;
  } else {
    // The line renderer's own auto-fit: pad ~5%, never across 0.
    const pad = (hi - lo) * 0.05 || Math.abs(hi) * 0.05 || 1;
    const nlo = lo - pad;
    lo = lo >= 0 && nlo < 0 ? 0 : nlo;
    hi += pad;
  }
  if (lo === hi) hi = lo + 1;
  const axis = buildValueAxis(lo, hi, chart.axes?.y, [0, 1], {
    nice: true,
    dataLo,
    dataHi,
  });
  return axis.domain();
}

/** Series `s` alone, as an ordinary one-series chart for its panel. */
function panelChart(
  chart: ParsedChart,
  s: number,
  color: string,
  range: [number, number] | null
): ParsedChart {
  const rest: ParsedChart = { ...chart };
  // The grid draws these once, around every panel.
  for (const key of [
    'title',
    'titleLineNumber',
    'frame',
    'facet',
    'facetLineNumber',
    'facetFreeY',
    'noContext',
    'facetColumns',
    'xlabel',
    'xlabelLineNumber',
    'ylabel',
    'ylabelLineNumber',
    'seriesNameLineNumbers',
    'barLayout',
    'notes',
  ] as const)
    delete rest[key];
  const { seriesNames, seriesNameLineNumbers, notes } = chart;
  const name = seriesNames?.[s] ?? `Series ${s + 1}`;
  const nameLine = seriesNameLineNumbers?.[s];
  const own = notes
    ?.filter((n) => n.series === s)
    .map((n) => ({ ...n, series: 0 }));
  return {
    ...rest,
    noTitle: true,
    noLegend: true,
    series: name,
    seriesNames: [name],
    ...(nameLine !== undefined && { seriesNameLineNumbers: [nameLine] }),
    seriesNameColors: [color],
    ...(own?.length && { notes: own }),
    ...(range && {
      axes: {
        ...chart.axes,
        y: { ...chart.axes?.y, min: range[0], max: range[1] },
      },
    }),
    data: chart.data.map((d) => {
      const row = { ...d, value: valueOf(d, s) };
      delete row.extraValues;
      return row;
    }),
    diagnostics: [],
    error: null,
  };
}

/**
 * Draw `chart` as small multiples into `svg`, below its title. The caller
 * has drawn the title; the frame (subtitle, source) is laid around the
 * whole grid by `renderInto`, as for any chart.
 */
export function renderFacet(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  bgColor: string,
  hasTitle: boolean
): void {
  const seriesCount = Math.max(1, chart.seriesNames?.length ?? 1);
  // The first row's headings are body ink, so they start under the title
  // band like any chart body (#2111); reserveHeader alone leaves them in it.
  const header = reserveHeader(
    svg,
    { ...chart, noLegend: true },
    colors,
    palette,
    isDark,
    hasTitle,
    width,
    undefined
  );
  const top = hasTitle ? Math.max(FRAME_BODY_TOP, header) : header;
  const shared = !chart.facetFreeY;
  const range = shared ? sharedRange(chart, seriesCount) : null;
  const colorOf = (s: number): string =>
    chart.seriesNameColors?.[s] ?? colors[s % colors.length]!;
  // The grid carries the axis titles once, where one chart would: a
  // horizontal bar's values run along the bottom, its categories down the
  // left.
  const horiz = chart.type === 'bar' && chart.orientation === 'horizontal';
  const leftTitle = horiz ? chart.xlabel : chart.ylabel;
  const bottomTitle = horiz ? chart.ylabel : chart.xlabel;
  const left = leftTitle ? FACET_AXIS_TITLE_ROOM : 0;
  const bottom = bottomTitle ? FACET_AXIS_TITLE_ROOM : 0;

  const cols = facetColumns(seriesCount, width - left, chart.facetColumns);
  const rows = Math.ceil(seriesCount / cols);
  const cellW = (width - left - (cols - 1) * FACET_GAP) / cols;
  const cellH = Math.max(
    FACET_MIN_CELL_H,
    (height - top - bottom - (rows - 1) * FACET_GAP) / rows
  );
  const plotH = cellH - FACET_HEAD_H;
  // Too many rows for the canvas: the drawing grows rather than squeezing a
  // panel past reading, and the frame lays out around the taller canvas.
  const need = top + rows * cellH + (rows - 1) * FACET_GAP + bottom;
  const root = svg.node();
  if (root && need > height) {
    const h = Number(root.getAttribute('height') ?? height) + need - height;
    root.setAttribute('height', String(Math.ceil(h)));
    root.setAttribute(
      'viewBox',
      `0 0 ${root.getAttribute('width') ?? width} ${Math.ceil(h)}`
    );
  }
  const context =
    chart.type === 'line' && shared && !chart.noContext
      ? Array.from({ length: seriesCount }, (_, s) =>
          chart.data.map((d) => valueOf(d, s))
        )
      : null;

  for (let s = 0; s < seriesCount; s++) {
    const col = s % cols;
    const row = Math.floor(s / cols);
    const x = left + col * (cellW + FACET_GAP);
    const y = top + row * (cellH + FACET_GAP);
    const color = colorOf(s);
    const g = svg
      .append('g')
      .attr('class', 'dgmo-facet-panel')
      .attr('data-series', chart.seriesNames?.[s] ?? '');
    const heading = g
      .append('text')
      .attr('class', 'dgmo-facet-heading')
      .attr('x', x + 4)
      .attr('y', y + FACET_HEAD_FONT + 2)
      .attr('fill', color)
      .attr('font-size', FACET_HEAD_FONT)
      .attr('font-weight', 600)
      .attr('font-family', FONT_FAMILY)
      .text(chart.seriesNames?.[s] ?? `Series ${s + 1}`);
    const nameLine = chart.seriesNameLineNumbers?.[s];
    if (nameLine !== undefined) heading.attr('data-line-number', nameLine);
    const cell = g
      .append('svg')
      .attr('x', x)
      .attr('y', y + FACET_HEAD_H)
      .attr('width', cellW)
      .attr('height', plotH)
      .attr('overflow', 'visible');
    const one = panelChart(chart, s, color, range);
    const panel = {
      hideValueTicks: shared && col > 0 && !horiz,
      ...(context && {
        context: context.filter((_, k) => k !== s),
      }),
    };
    if (chart.type === 'line')
      renderLine(
        cell,
        one,
        cellW,
        plotH,
        [color],
        palette,
        isDark,
        textColor,
        mutedColor,
        bgColor,
        false,
        undefined,
        panel
      );
    else
      renderBar(
        cell,
        one,
        cellW,
        plotH,
        [color],
        palette,
        isDark,
        textColor,
        mutedColor,
        false,
        undefined,
        undefined,
        panel
      );
  }

  const gridH = rows * cellH + (rows - 1) * FACET_GAP;
  drawYAxisTitle(svg, leftTitle, top, gridH, 14, textColor);
  drawXAxisTitle(
    svg,
    bottomTitle,
    left + (width - left) / 2,
    top + gridH + FACET_AXIS_TITLE_ROOM - 6,
    textColor
  );
}
