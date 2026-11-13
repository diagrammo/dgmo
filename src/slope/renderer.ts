// ============================================================
// Slope renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import { growChartFrame } from '../utils/chart-frame';
import { GRID_DASH, scaleDash } from '../utils/visual-conventions';
import * as d3Scale from 'd3-scale';
import { buildValueAxis } from '../charts-d3/value-axis';
import { makeNumberFormatter } from '../utils/number-format';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import {
  createTooltip,
  hideTooltip,
  initD3Chart,
  renderChartTitle,
  showTooltip,
} from '../utils/d3-helpers';
import type { ParsedSlope } from '../visualizations/types';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  resolveEmphasis,
} from '../utils/emphasis';
import type { PaletteColors } from '../palettes';

// ============================================================
// Slope Chart Renderer
// ============================================================

/**
 * Resolves vertical label collisions by nudging overlapping items apart.
 * Takes items with a naturalY (center) and height, returns adjusted center Y positions.
 * Optional maxY clamps the bottom edge so labels don't overflow the chart area.
 */
export function resolveVerticalCollisions(
  items: { naturalY: number; height: number }[],
  minGap: number,
  maxY?: number
): number[] {
  if (items.length === 0) return [];
  const sorted = items
    .map((it, i) => ({ ...it, idx: i }))
    .sort((a, b) => a.naturalY - b.naturalY);
  const adjustedY = new Array<number>(items.length);
  let prevBottom = -Infinity;
  for (const item of sorted) {
    const halfH = item.height / 2;
    let top = Math.max(item.naturalY - halfH, prevBottom + minGap);
    // Clamp so the label bottom doesn't exceed maxY
    if (maxY !== undefined) {
      top = Math.min(top, maxY - item.height);
    }
    adjustedY[item.idx] = top + halfH;
    prevBottom = top + item.height;
  }
  return adjustedY;
}

const SLOPE_MARGIN = { top: 80, bottom: 40, left: 80 };
const SLOPE_LABEL_FONT_SIZE = 14;

/**
 * Renders a slope chart into the given container using D3.
 */
export function renderSlopeChart(
  container: HTMLDivElement,
  parsed: ParsedSlope,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { periods, data } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (data.length === 0 || periods.length < 2) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  const idealWidth = SLOPE_MARGIN.left + periods.length * 100 + 150;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sMarginTop = ctx.aesthetic(SLOPE_MARGIN.top);
  const sMarginBottom = ctx.aesthetic(SLOPE_MARGIN.bottom);
  const sLabelFontSize = ctx.text(SLOPE_LABEL_FONT_SIZE);
  const sPeriodFont = ctx.text(18);
  const sValueFont = ctx.text(16);
  const sPeriodHeaderY = ctx.structural(15);
  const sDash = scaleDash(GRID_DASH, (n) => ctx.structural(n));
  const sLineStroke = ctx.structural(2.5);
  const sHitWidth = ctx.structural(14);
  const sPointR = ctx.structural(4);
  const sPointStroke = ctx.structural(1.5);
  const sLabelGap = ctx.structural(10);

  svg.attr('preserveAspectRatio', 'xMidYMin meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const g = svg.append('g');

  // Title — drawn before the layout so a wrapped title's extra line, drawn
  // at full size, pushes the plot down (#1718).
  const titleExtra = renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem,
    2
  );
  const sPlotTop = sMarginTop + titleExtra;

  // Compute right margin from the longest end-of-line label
  // The author's `format` / `unit` / `locale` (#1831); plain values otherwise.
  const fmt = makeNumberFormatter(parsed.numberFormat, String);
  const maxLabelText = data.reduce((longest, item) => {
    const text = `${fmt(item.values[item.values.length - 1]!)} — ${item.label}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const estimatedLabelWidth = measureText(maxLabelText, sLabelFontSize);
  const maxRightMargin = Math.floor(width * 0.35);
  const rightMargin = Math.min(
    Math.max(estimatedLabelWidth + ctx.aesthetic(30), ctx.aesthetic(120)),
    maxRightMargin
  );

  // Left margin holds the first column's "name — value" labels
  const maxLeftText = data.reduce((longest, item) => {
    const text = `${item.label} — ${fmt(item.values[0]!)}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const sLeftGap = ctx.structural(10);
  const sMarginLeft = Math.min(
    Math.max(
      measureText(maxLeftText, sLabelFontSize) + sLeftGap + ctx.aesthetic(15),
      ctx.aesthetic(SLOPE_MARGIN.left)
    ),
    Math.floor(width * 0.35)
  );
  const leftAvailableWidth = sMarginLeft - sLeftGap - ctx.aesthetic(10);

  const innerWidth = width - sMarginLeft - rightMargin;
  const innerHeight = height - sPlotTop - sMarginBottom;

  // Scales
  const allValues = data.flatMap((d) => d.values);
  const [minVal, maxVal] = d3Array.extent(allValues) as [number, number];
  const valuePadding = (maxVal - minVal) * 0.1 || 1;

  // `y-scale log`, `y-min`, `y-max` set the vertical range (#1830). Slope
  // draws no tick axis, so the range only places the lines.
  const yScale = buildValueAxis(
    minVal - valuePadding,
    maxVal + valuePadding,
    parsed.axes?.y,
    [innerHeight, 0],
    { dataLo: minVal, dataHi: maxVal }
  );

  const xScale = d3Scale
    .scalePoint<string>()
    .domain(periods)
    .range([0, innerWidth])
    .padding(0);

  g.attr('transform', `translate(${sMarginLeft},${sPlotTop})`);

  // Tooltip
  const tooltip = createTooltip(container, palette, isDark);

  // Period column headers
  for (const period of periods) {
    const x = xScale(period)!;
    g.append('text')
      .attr('x', x)
      .attr('y', -sPeriodHeaderY)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', sPeriodFont)
      .attr('font-weight', 'bold')
      .text(period);

    // Vertical guide line
    g.append('line')
      .attr('x1', x)
      .attr('y1', 0)
      .attr('x2', x)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', sDash);
  }

  // Line generator
  const lineGen = d3Shape
    .line<number>()
    // periods[i] is in-bounds — i comes from d3 line's index callback over the data array.
    .x((_d, i) => xScale(periods[i]!)!)
    .y((d) => yScale(d));

  // Pre-compute per-series data for label collision resolution
  const seriesInfo = data.map((item, idx) => {
    // colors is non-empty; modulo guarantees in-bounds.
    const color = item.color ?? colors[idx % colors.length]!;
    // values is non-empty by parser validation (slope requires P>=2 values per series).
    const firstVal = item.values[0]!;
    const lastVal = item.values[item.values.length - 1]!;
    const absChange = lastVal - firstVal;
    const pctChange = firstVal !== 0 ? (absChange / firstVal) * 100 : null;
    const sign = absChange > 0 ? '+' : '';
    const change = parsed.numberFormat
      ? fmt(absChange)
      : String(parseFloat(absChange.toFixed(2)));
    const tipLines = [`${sign}${change}`];
    if (pctChange !== null) tipLines.push(`${sign}${pctChange.toFixed(1)}%`);
    const tipHtml = tipLines.join('<br>');

    // Compute right-side label text and wrapping info
    // periods is non-empty (slope requires P >= 2 periods).
    const lastX = xScale(periods[periods.length - 1]!)!;
    const labelText = `${fmt(lastVal)} — ${item.label}`;
    const availableWidth = rightMargin - ctx.aesthetic(15);

    let labelLineCount = 1;
    let wrappedLines: string[] | null = null;
    if (measureText(labelText, sLabelFontSize) > availableWidth) {
      const lines = wrapTextToWidth(labelText, sLabelFontSize, availableWidth);
      labelLineCount = lines.length;
      wrappedLines = lines;
    }
    const lineHeight = sLabelFontSize * 1.2;
    const labelHeight =
      labelLineCount === 1 ? sLabelFontSize : labelLineCount * lineHeight;

    // Left-side label (first column): "name — value", wraps like the right side
    const leftText = `${item.label} — ${fmt(firstVal)}`;
    const leftLines =
      measureText(leftText, sLabelFontSize) > leftAvailableWidth
        ? wrapTextToWidth(leftText, sLabelFontSize, leftAvailableWidth)
        : null;
    const leftHeight = leftLines
      ? leftLines.length * lineHeight
      : sLabelFontSize;

    return {
      item,
      idx,
      color,
      firstVal,
      lastVal,
      tipHtml,
      lastX,
      labelText,
      wrappedLines,
      labelHeight,
      leftText,
      leftLines,
      leftHeight,
    };
  });

  // --- Resolve left-side label collisions per non-last period column ---
  const leftLabelHeight = sValueFont * 1.25;
  const leftLabelCollisions: Map<number, number[]> = new Map();
  for (let pi = 0; pi < periods.length - 1; pi++) {
    const entries = data.map((item) => ({
      // pi is in-bounds by loop guard against periods.length, and each data row has periods.length values.
      naturalY: yScale(item.values[pi]!),
      height:
        pi === 0
          ? Math.max(
              ...seriesInfo.map((si) => si.leftHeight),
              sLabelFontSize * 1.4
            )
          : leftLabelHeight,
    }));
    leftLabelCollisions.set(
      pi,
      resolveVerticalCollisions(entries, 4, innerHeight)
    );
  }

  // --- Resolve right-side label collisions ---
  const rightEntries = seriesInfo.map((si) => ({
    naturalY: yScale(si.lastVal),
    height: Math.max(si.labelHeight, sLabelFontSize * 1.4),
  }));
  const rightAdjustedY = resolveVerticalCollisions(
    rightEntries,
    4,
    innerHeight
  );

  // §1.11 emphasis (#1829): `highlight` names series. Every other series —
  // its line, points and labels — recedes; a receded series keeps its colour.
  const { dimmed } = resolveEmphasis(
    parsed.emphasis,
    data.map((d) => d.label)
  );
  const shapeOpacity = (dim: boolean) => (dim ? EMPHASIS_DIM_OPACITY : null);
  const textOpacity = (dim: boolean) =>
    dim ? EMPHASIS_DIM_TEXT_OPACITY : null;

  // Render each data series
  data.forEach((item, idx) => {
    // seriesInfo was built by data.map() above, so idx is in-bounds.
    const si = seriesInfo[idx]!;
    const color = si.color;
    const dim = dimmed.has(item.label);

    // Wrap each series in a group with data-line-number for sync adapter
    const seriesG = g
      .append('g')
      .attr('class', 'slope-series')
      .attr('data-line-number', String(item.lineNumber));

    // Line
    seriesG
      .append('path')
      .datum(item.values)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', sLineStroke)
      .attr('opacity', shapeOpacity(dim))
      .attr('d', lineGen);

    // Invisible wider path for easier hover targeting
    seriesG
      .append('path')
      .datum(item.values)
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', sHitWidth)
      .attr('d', lineGen)
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', (event: MouseEvent) =>
        showTooltip(tooltip, si.tipHtml, event)
      )
      .on('mousemove', (event: MouseEvent) =>
        showTooltip(tooltip, si.tipHtml, event)
      )
      .on('mouseleave', () => hideTooltip(tooltip))
      .on('click', () => {
        if (onClickItem && item.lineNumber) onClickItem(item.lineNumber);
      });

    // Points and value labels
    item.values.forEach((val, i) => {
      // periods[i] is in-bounds because item.values.length === periods.length (slope contract).
      const x = xScale(periods[i]!)!;
      const y = yScale(val);

      // Point circle
      seriesG
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', sPointR)
        .attr('fill', color)
        .attr('stroke', bgColor)
        .attr('stroke-width', sPointStroke)
        .attr('opacity', shapeOpacity(dim))
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('mouseenter', (event: MouseEvent) =>
          showTooltip(tooltip, si.tipHtml, event)
        )
        .on('mousemove', (event: MouseEvent) =>
          showTooltip(tooltip, si.tipHtml, event)
        )
        .on('mouseleave', () => hideTooltip(tooltip))
        .on('click', () => {
          if (onClickItem && item.lineNumber) onClickItem(item.lineNumber);
        });

      // Value label — skip last point (shown in series label instead)
      const isFirst = i === 0;
      const isLast = i === periods.length - 1;
      if (!isLast) {
        // leftLabelCollisions was set for every i in [0, periods.length-1); idx is in-bounds by data.map.
        const adjustedY = leftLabelCollisions.get(i)![idx]!;
        if (isFirst) {
          const leftEl = seriesG
            .append('text')
            .attr('x', x - sLeftGap)
            .attr('y', adjustedY)
            .attr('text-anchor', 'end')
            .attr('fill', color)
            .attr('font-size', sLabelFontSize)
            .attr('opacity', textOpacity(dim));
          if (!si.leftLines) {
            leftEl.attr('dy', '0.35em').text(si.leftText);
          } else {
            const lh = sLabelFontSize * 1.2;
            const startDy = (-(si.leftLines.length - 1) * lh) / 2;
            si.leftLines.forEach((line, li) => {
              leftEl
                .append('tspan')
                .attr('x', x - sLeftGap)
                .attr(
                  'dy',
                  li === 0 ? `${startDy + sLabelFontSize * 0.35}px` : `${lh}px`
                )
                .text(line);
            });
          }
        } else {
          seriesG
            .append('text')
            .attr('x', x)
            .attr('y', adjustedY)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'middle')
            .attr('fill', color)
            .attr('font-size', sValueFont)
            .attr('opacity', textOpacity(dim))
            .text(fmt(val));
        }
      }
    });

    // Series label with value at end of line — wraps if it exceeds available space
    // rightAdjustedY was produced from rightEntries.length === seriesInfo.length === data.length.
    const adjustedLastY = rightAdjustedY[idx]!;

    const labelEl = seriesG
      .append('text')
      .attr('x', si.lastX + sLabelGap)
      .attr('y', adjustedLastY)
      .attr('text-anchor', 'start')
      .attr('fill', color)
      .attr('font-size', sLabelFontSize)
      .attr('font-weight', 'normal')
      .attr('opacity', textOpacity(dim));

    if (!si.wrappedLines) {
      labelEl.attr('dy', '0.35em').text(si.labelText);
    } else {
      const lineHeight = sLabelFontSize * 1.2;
      const totalHeight = (si.wrappedLines.length - 1) * lineHeight;
      const startDy = -totalHeight / 2;

      si.wrappedLines.forEach((line, li) => {
        labelEl
          .append('tspan')
          .attr('x', si.lastX + sLabelGap)
          .attr(
            'dy',
            li === 0
              ? `${startDy + sLabelFontSize * 0.35}px`
              : `${lineHeight}px`
          )
          .text(line);
      });
    }
  });

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });
}

// ============================================================
// Arc Node Ordering
// ============================================================

/**
 * Orders arc diagram nodes based on the selected ordering strategy.
 */
