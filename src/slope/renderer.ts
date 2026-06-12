// ============================================================
// Slope renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import * as d3Scale from 'd3-scale';
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
import type { ParsedVisualization } from '../visualizations/types';
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
  parsed: ParsedVisualization,
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
  const sMarginLeft = ctx.aesthetic(SLOPE_MARGIN.left);
  const sLabelFontSize = ctx.text(SLOPE_LABEL_FONT_SIZE);
  const sPeriodFont = ctx.text(18);
  const sValueFont = ctx.text(16);
  const sPeriodHeaderY = ctx.structural(15);
  const sDash = `${ctx.structural(4)},${ctx.structural(4)}`;
  const sLineStroke = ctx.structural(2.5);
  const sHitWidth = ctx.structural(14);
  const sPointR = ctx.structural(4);
  const sPointStroke = ctx.structural(1.5);
  const sValueLabelXOff = ctx.structural(10);
  const sLabelGap = ctx.structural(10);

  svg.attr('preserveAspectRatio', 'xMidYMin meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // Compute right margin from the longest end-of-line label
  const maxLabelText = data.reduce((longest, item) => {
    const text = `${item.values[item.values.length - 1]} — ${item.label}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const estimatedLabelWidth = measureText(maxLabelText, sLabelFontSize);
  const maxRightMargin = Math.floor(width * 0.35);
  const rightMargin = Math.min(
    Math.max(estimatedLabelWidth + ctx.aesthetic(30), ctx.aesthetic(120)),
    maxRightMargin
  );

  const innerWidth = width - sMarginLeft - rightMargin;
  const innerHeight = height - sMarginTop - sMarginBottom;

  // Scales
  const allValues = data.flatMap((d) => d.values);
  const [minVal, maxVal] = d3Array.extent(allValues) as [number, number];
  const valuePadding = (maxVal - minVal) * 0.1 || 1;

  const yScale = d3Scale
    .scaleLinear()
    .domain([minVal - valuePadding, maxVal + valuePadding])
    .range([innerHeight, 0]);

  const xScale = d3Scale
    .scalePoint<string>()
    .domain(periods)
    .range([0, innerWidth])
    .padding(0);

  const g = svg
    .append('g')
    .attr('transform', `translate(${sMarginLeft},${sMarginTop})`);

  // Tooltip
  const tooltip = createTooltip(container, palette, isDark);

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Period column headers
  for (const period of periods) {
    const x = xScale(period)!;
    g.append('text')
      .attr('x', x)
      .attr('y', -sPeriodHeaderY)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sPeriodFont}px`)
      .attr('font-weight', '600')
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
    const tipLines = [`${sign}${parseFloat(absChange.toFixed(2))}`];
    if (pctChange !== null) tipLines.push(`${sign}${pctChange.toFixed(1)}%`);
    const tipHtml = tipLines.join('<br>');

    // Compute right-side label text and wrapping info
    // periods is non-empty (slope requires P >= 2 periods).
    const lastX = xScale(periods[periods.length - 1]!)!;
    const labelText = `${lastVal} — ${item.label}`;
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
    };
  });

  // --- Resolve left-side label collisions per non-last period column ---
  const leftLabelHeight = sValueFont * 1.25;
  const leftLabelCollisions: Map<number, number[]> = new Map();
  for (let pi = 0; pi < periods.length - 1; pi++) {
    const entries = data.map((item) => ({
      // pi is in-bounds by loop guard against periods.length, and each data row has periods.length values.
      naturalY: yScale(item.values[pi]!),
      height: leftLabelHeight,
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

  // Render each data series
  data.forEach((item, idx) => {
    // seriesInfo was built by data.map() above, so idx is in-bounds.
    const si = seriesInfo[idx]!;
    const color = si.color;

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
        seriesG
          .append('text')
          .attr('x', isFirst ? x - sValueLabelXOff : x)
          .attr('y', adjustedY)
          .attr('dy', '0.35em')
          .attr('text-anchor', isFirst ? 'end' : 'middle')
          .attr('fill', color)
          .attr('font-size', `${sValueFont}px`)
          .text(val.toString());
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
      .attr('font-size', `${sLabelFontSize}px`)
      .attr('font-weight', '500');

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
}

// ============================================================
// Arc Node Ordering
// ============================================================

/**
 * Orders arc diagram nodes based on the selected ordering strategy.
 */
