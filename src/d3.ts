import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';
import cloud from 'd3-cloud';
import { FONT_FAMILY } from './fonts';
import { computeQuadrantPointLabels, type LabelRect } from './label-layout';
import { MONTH_ABBR, computeTimeTicks } from './utils/time-ticks';
import { measureText, wrapTextToWidth } from './utils/text-measure';
import type { D3ExportDimensions } from './utils/d3-types';
import { ScaleContext } from './utils/scaling';

// ============================================================
// Types + parser — split into ./visualizations (Story 109.2)
// ============================================================
import { parseVisualization } from './visualizations/parse';
import {
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  createExportContainer,
  createTooltip,
  finalizeSvgExport,
  initD3Chart,
  renderChartTitle,
  resolveExportPalette,
} from './utils/d3-helpers';
import type {
  VisualizationType,
  ParsedVisualization,
  WordCloudWord,
  WordCloudRotate,
  ArcLink,
  ArcOrder,
  ArcNodeGroup,
  VennOverlap,
  QuadrantLabel,
} from './visualizations/types';
export { parseVisualization };
export type { VisualizationType, ParsedVisualization, ArcLink, ArcNodeGroup };

import type {
  TimelineEvent,
  TimelineGroup,
  TimelineEra,
  TimelineMarker,
} from './timeline/types';
import { parseTimelineDate } from './timeline/parser';

export { parseTimelineDate, addDurationToDate } from './timeline/parser';

/** Optional explicit dimensions for CLI/export rendering (bypasses DOM layout). */
export type { D3ExportDimensions } from './utils/d3-types';
// ============================================================
// Color Imports
// ============================================================

import type { PaletteColors } from './palettes';
import { getSeriesColors } from './palettes';
import { mix, shapeFill } from './palettes/color-utils';
import { resolveTagColor, resolveActiveTagGroup } from './utils/tag-groups';
import type { TagGroup } from './utils/tag-groups';
import {
  LEGEND_HEIGHT as TL_LEGEND_HEIGHT,
  LEGEND_PILL_PAD as TL_LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE as TL_LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD as TL_LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R as TL_LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE as TL_LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP as TL_LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL as TL_LEGEND_ENTRY_TRAIL,
  measureLegendText,
  truncateLegendText,
} from './utils/legend-constants';
import { renderLegendD3 } from './utils/legend-d3';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
} from './utils/legend-types';
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
export function orderArcNodes(
  links: ArcLink[],
  order: ArcOrder,
  groups: ArcNodeGroup[]
): string[] {
  // Collect all unique nodes in first-appearance order
  const nodeSet = new Set<string>();
  for (const link of links) {
    nodeSet.add(link.source);
    nodeSet.add(link.target);
  }
  const allNodes = Array.from(nodeSet);

  if (order === 'name') {
    return allNodes.slice().sort((a, b) => a.localeCompare(b));
  }

  if (order === 'degree') {
    const degree = new Map<string, number>();
    for (const node of allNodes) degree.set(node, 0);
    for (const link of links) {
      degree.set(link.source, degree.get(link.source)! + link.value);
      degree.set(link.target, degree.get(link.target)! + link.value);
    }
    return allNodes.slice().sort((a, b) => {
      const diff = degree.get(b)! - degree.get(a)!;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }

  if (order === 'group') {
    if (groups.length > 0) {
      // Explicit groups: order by ## header order, appearance within each group
      const ordered: string[] = [];
      const placed = new Set<string>();
      for (const group of groups) {
        for (const node of group.nodes) {
          if (!placed.has(node)) {
            ordered.push(node);
            placed.add(node);
          }
        }
      }
      // Orphans at end in first-appearance order
      for (const node of allNodes) {
        if (!placed.has(node)) {
          ordered.push(node);
          placed.add(node);
        }
      }
      return ordered;
    }
    // No explicit groups: connectivity clustering via BFS
    const adj = new Map<string, Set<string>>();
    for (const node of allNodes) adj.set(node, new Set());
    for (const link of links) {
      adj.get(link.source)!.add(link.target);
      adj.get(link.target)!.add(link.source);
    }

    const degree = new Map<string, number>();
    for (const node of allNodes) degree.set(node, 0);
    for (const link of links) {
      degree.set(link.source, degree.get(link.source)! + link.value);
      degree.set(link.target, degree.get(link.target)! + link.value);
    }

    const visited = new Set<string>();
    const components: string[][] = [];

    const remaining = new Set(allNodes);
    while (remaining.size > 0) {
      // Pick highest-degree unvisited node as BFS root
      let root = '';
      let maxDeg = -1;
      for (const node of remaining) {
        if (degree.get(node)! > maxDeg) {
          maxDeg = degree.get(node)!;
          root = node;
        }
      }
      // BFS
      const component: string[] = [];
      const queue = [root];
      visited.add(root);
      remaining.delete(root);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);
        for (const neighbor of adj.get(curr)!) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            remaining.delete(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }
    // Sort components by size descending
    components.sort((a, b) => b.length - a.length);
    return components.flat();
  }

  // 'appearance' — first-appearance order (default)
  return allNodes;
}

// ============================================================
// Arc Diagram Renderer
// ============================================================

const ARC_MARGIN_TOP = 60;
const ARC_MARGIN_RIGHT = 40;
const ARC_MARGIN_BOTTOM = 60;
const ARC_MARGIN_LEFT = 40;
const ARC_MARGIN_LEFT_VERTICAL = 120;
const ARC_NODE_RADIUS = 5;
const ARC_NODE_STROKE_WIDTH = 1.5;
const ARC_NODE_LABEL_FONT = 11;
const ARC_GROUP_LABEL_FONT = 12;
const ARC_BAND_HALF_W = 60;
const ARC_BAND_HALF_H = 40;
const ARC_BAND_RADIUS = 4;
const ARC_BAND_LABEL_X_OFFSET = 6;
const ARC_BAND_LABEL_Y_OFFSET = 14;
const ARC_BAND_LABEL_BOTTOM_OFFSET = 4;
const ARC_NODE_LABEL_X_OFFSET = 14;
const ARC_NODE_LABEL_Y_OFFSET = 20;
const ARC_STROKE_MIN = 1.5;
const ARC_STROKE_MAX = 6;
const ARC_BASELINE_STROKE_WIDTH = 1;

/**
 * Renders an arc diagram into the given container using D3.
 */
export function renderArcDiagram(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { links, orientation, arcOrder, arcNodeGroups } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (links.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  const isVertical = orientation === 'vertical';

  const nodes = orderArcNodes(links, arcOrder, arcNodeGroups);

  const idealWidth = isVertical
    ? ARC_MARGIN_LEFT_VERTICAL + ARC_MARGIN_RIGHT + ARC_BAND_HALF_W * 2 + 100
    : nodes.length * 20 + ARC_MARGIN_LEFT + ARC_MARGIN_RIGHT;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sMarginTop = ctx.aesthetic(ARC_MARGIN_TOP);
  const sMarginRight = ctx.aesthetic(ARC_MARGIN_RIGHT);
  const sMarginBottom = ctx.aesthetic(ARC_MARGIN_BOTTOM);
  const sMarginLeft = isVertical
    ? ctx.aesthetic(ARC_MARGIN_LEFT_VERTICAL)
    : ctx.aesthetic(ARC_MARGIN_LEFT);
  const sNodeRadius = ctx.structural(ARC_NODE_RADIUS);
  const sNodeStrokeWidth = ctx.structural(ARC_NODE_STROKE_WIDTH);
  const sNodeLabelFont = ctx.text(ARC_NODE_LABEL_FONT);
  const sGroupLabelFont = ctx.text(ARC_GROUP_LABEL_FONT);
  const sBandHalfW = ctx.aesthetic(ARC_BAND_HALF_W);
  const sBandHalfH = ctx.aesthetic(ARC_BAND_HALF_H);
  const sBandRadius = ctx.structural(ARC_BAND_RADIUS);
  const sBandLabelXOffset = ctx.structural(ARC_BAND_LABEL_X_OFFSET);
  const sBandLabelYOffset = ctx.structural(ARC_BAND_LABEL_Y_OFFSET);
  const sBandLabelBottomOffset = ctx.structural(ARC_BAND_LABEL_BOTTOM_OFFSET);
  const sNodeLabelXOffset = ctx.structural(ARC_NODE_LABEL_X_OFFSET);
  const sNodeLabelYOffset = ctx.structural(ARC_NODE_LABEL_Y_OFFSET);
  const sStrokeMin = ctx.structural(ARC_STROKE_MIN);
  const sStrokeMax = ctx.structural(ARC_STROKE_MAX);
  const sBaselineDash = `${ctx.structural(4)},${ctx.structural(4)}`;
  const sBaselineStrokeWidth = ctx.structural(ARC_BASELINE_STROKE_WIDTH);

  svg.attr('preserveAspectRatio', 'xMidYMin meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const margin = {
    top: sMarginTop,
    right: sMarginRight,
    bottom: sMarginBottom,
    left: sMarginLeft,
  };

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const nodeColorMap = new Map<string, string>();
  for (const group of arcNodeGroups) {
    if (group.color) {
      for (const node of group.nodes) {
        if (!nodeColorMap.has(node)) {
          nodeColorMap.set(node, group.color);
        }
      }
    }
  }

  const groupNodeSets = new Map<string, Set<string>>();
  for (const group of arcNodeGroups) {
    groupNodeSets.set(group.name, new Set(group.nodes));
  }

  const values = links.map((l) => l.value);
  const [minVal, maxVal] = d3Array.extent(values) as [number, number];
  const strokeScale = d3Scale
    .scaleLinear()
    .domain([minVal, maxVal])
    .range([sStrokeMin, sStrokeMax]);

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Build adjacency map for hover interactions
  const neighbors = new Map<string, Set<string>>();
  for (const node of nodes) neighbors.set(node, new Set());
  for (const link of links) {
    neighbors.get(link.source)!.add(link.target);
    neighbors.get(link.target)!.add(link.source);
  }

  const FADE_OPACITY = 0.1;

  function handleMouseEnter(hovered: string) {
    const connected = neighbors.get(hovered)!;

    g.selectAll<SVGPathElement, unknown>('.arc-link').each(function () {
      const el = d3Selection.select(this);
      const src = el.attr('data-source');
      const tgt = el.attr('data-target');
      const isRelated = src === hovered || tgt === hovered;
      el.attr('stroke-opacity', isRelated ? 0.85 : FADE_OPACITY);
    });

    g.selectAll<SVGGElement, unknown>('.arc-node').each(function () {
      const el = d3Selection.select(this);
      const name = el.attr('data-node');
      const isRelated = name === hovered || connected.has(name!);
      el.attr('opacity', isRelated ? 1 : FADE_OPACITY);
    });
  }

  function handleMouseLeave() {
    g.selectAll<SVGPathElement, unknown>('.arc-link').attr(
      'stroke-opacity',
      0.7
    );
    g.selectAll<SVGGElement, unknown>('.arc-node').attr('opacity', 1);
    g.selectAll<SVGRectElement, unknown>('.arc-group-band').attr(
      'fill-opacity',
      0.06
    );
    g.selectAll<SVGTextElement, unknown>('.arc-group-label').attr(
      'fill-opacity',
      0.5
    );
  }

  function handleGroupEnter(groupName: string) {
    const members = groupNodeSets.get(groupName);
    if (!members) return;

    g.selectAll<SVGPathElement, unknown>('.arc-link').each(function () {
      const el = d3Selection.select(this);
      const isRelated =
        members.has(el.attr('data-source')!) ||
        members.has(el.attr('data-target')!);
      el.attr('stroke-opacity', isRelated ? 0.85 : FADE_OPACITY);
    });

    g.selectAll<SVGGElement, unknown>('.arc-node').each(function () {
      const el = d3Selection.select(this);
      el.attr('opacity', members.has(el.attr('data-node')!) ? 1 : FADE_OPACITY);
    });

    g.selectAll<SVGRectElement, unknown>('.arc-group-band').each(function () {
      const el = d3Selection.select(this);
      el.attr(
        'fill-opacity',
        el.attr('data-group') === groupName ? 0.18 : 0.03
      );
    });

    g.selectAll<SVGTextElement, unknown>('.arc-group-label').each(function () {
      const el = d3Selection.select(this);
      el.attr('fill-opacity', el.attr('data-group') === groupName ? 1 : 0.2);
    });
  }

  if (isVertical) {
    // Vertical layout: nodes along Y axis, arcs curve to the right
    const yScale = d3Scale
      .scalePoint<string>()
      .domain(nodes)
      .range([0, innerHeight])
      .padding(0.5);

    const baseX = innerWidth / 2;

    // Group bands (shaded regions bounding grouped nodes)
    if (arcNodeGroups.length > 0) {
      const bandPad = (yScale.step?.() ?? 20) * 0.4;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => yScale(n)!);
        const minY = Math.min(...positions) - bandPad;
        const maxY = Math.max(...positions) + bandPad;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', baseX - sBandHalfW)
          .attr('y', minY)
          .attr('width', sBandHalfW * 2)
          .attr('height', maxY - minY)
          .attr('rx', sBandRadius)
          .attr('fill', textColor)
          .attr('fill-opacity', 0.06)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', baseX - sBandHalfW + sBandLabelXOffset)
          .attr('y', minY + sBandLabelYOffset)
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.5)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .text(group.name)
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });
      }
    }

    // Dashed vertical baseline
    g.append('line')
      .attr('x1', baseX)
      .attr('y1', 0)
      .attr('x2', baseX)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', sBaselineStrokeWidth)
      .attr('stroke-dasharray', sBaselineDash);

    // Arcs
    links.forEach((link, idx) => {
      const y1 = yScale(link.source)!;
      const y2 = yScale(link.target)!;
      const midY = (y1 + y2) / 2;
      const distance = Math.abs(y2 - y1);
      const controlX = baseX + distance * 0.4;
      // colors is non-empty; modulo guarantees in-bounds.
      const color = link.color ?? colors[idx % colors.length]!;

      g.append('path')
        .attr('class', 'arc-link')
        .attr('data-source', link.source)
        .attr('data-target', link.target)
        .attr('data-line-number', String(link.lineNumber))
        .attr('d', `M ${baseX},${y1} Q ${controlX},${midY} ${baseX},${y2}`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeScale(link.value))
        .attr('stroke-opacity', 0.7)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem && link.lineNumber) onClickItem(link.lineNumber);
        });
    });

    // Node circles and labels
    for (const node of nodes) {
      const y = yScale(node)!;
      const nodeColor = nodeColorMap.get(node) ?? textColor;
      // Find the first link involving this node (for line number and click target)
      const nodeLink = links.find(
        (l) => l.source === node || l.target === node
      );

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
        .attr(
          'data-line-number',
          nodeLink?.lineNumber ? String(nodeLink.lineNumber) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', () => handleMouseEnter(node))
        .on('mouseleave', handleMouseLeave)
        .on('click', () => {
          if (onClickItem && nodeLink?.lineNumber)
            onClickItem(nodeLink.lineNumber);
        });

      nodeG
        .append('circle')
        .attr('cx', baseX)
        .attr('cy', y)
        .attr('r', sNodeRadius)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', sNodeStrokeWidth);

      nodeG
        .append('text')
        .attr('x', baseX - sNodeLabelXOffset)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', `${sNodeLabelFont}px`)
        .text(node);
    }
  } else {
    // Horizontal layout (default): nodes along X axis, arcs curve upward
    const xScale = d3Scale
      .scalePoint<string>()
      .domain(nodes)
      .range([0, innerWidth])
      .padding(0.5);

    const baseY = innerHeight / 2;

    // Group bands (shaded regions bounding grouped nodes)
    if (arcNodeGroups.length > 0) {
      const bandPad = (xScale.step?.() ?? 20) * 0.4;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => xScale(n)!);
        const minX = Math.min(...positions) - bandPad;
        const maxX = Math.max(...positions) + bandPad;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', minX)
          .attr('y', baseY - sBandHalfH)
          .attr('width', maxX - minX)
          .attr('height', sBandHalfH * 2)
          .attr('rx', sBandRadius)
          .attr('fill', textColor)
          .attr('fill-opacity', 0.06)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', (minX + maxX) / 2)
          .attr('y', baseY + sBandHalfH - sBandLabelBottomOffset)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.5)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .text(group.name)
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });
      }
    }

    // Dashed horizontal baseline
    g.append('line')
      .attr('x1', 0)
      .attr('y1', baseY)
      .attr('x2', innerWidth)
      .attr('y2', baseY)
      .attr('stroke', mutedColor)
      .attr('stroke-width', sBaselineStrokeWidth)
      .attr('stroke-dasharray', sBaselineDash);

    // Arcs
    links.forEach((link, idx) => {
      const x1 = xScale(link.source)!;
      const x2 = xScale(link.target)!;
      const midX = (x1 + x2) / 2;
      const distance = Math.abs(x2 - x1);
      const controlY = baseY - distance * 0.4;
      // colors is non-empty; modulo guarantees in-bounds.
      const color = link.color ?? colors[idx % colors.length]!;

      g.append('path')
        .attr('class', 'arc-link')
        .attr('data-source', link.source)
        .attr('data-target', link.target)
        .attr('data-line-number', String(link.lineNumber))
        .attr('d', `M ${x1},${baseY} Q ${midX},${controlY} ${x2},${baseY}`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeScale(link.value))
        .attr('stroke-opacity', 0.7)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem && link.lineNumber) onClickItem(link.lineNumber);
        });
    });

    // Node circles and labels
    for (const node of nodes) {
      const x = xScale(node)!;
      const nodeColor = nodeColorMap.get(node) ?? textColor;
      // Find the first link involving this node (for line number and click target)
      const nodeLink = links.find(
        (l) => l.source === node || l.target === node
      );

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
        .attr(
          'data-line-number',
          nodeLink?.lineNumber ? String(nodeLink.lineNumber) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', () => handleMouseEnter(node))
        .on('mouseleave', handleMouseLeave)
        .on('click', () => {
          if (onClickItem && nodeLink?.lineNumber)
            onClickItem(nodeLink.lineNumber);
        });

      nodeG
        .append('circle')
        .attr('cx', x)
        .attr('cy', baseY)
        .attr('r', sNodeRadius)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', sNodeStrokeWidth);

      nodeG
        .append('text')
        .attr('x', x)
        .attr('y', baseY + sNodeLabelYOffset)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', `${sNodeLabelFont}px`)
        .text(node);
    }
  }
}

// ============================================================
// Timeline Era Bands
// ============================================================

function getEraColors(palette: PaletteColors): string[] {
  return [
    palette.colors.blue,
    palette.colors.green,
    palette.colors.yellow,
    palette.colors.orange,
    palette.colors.purple,
  ];
}

/**
 * Renders semi-transparent era background bands behind timeline events.
 */
function renderEras(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  eras: TimelineEra[],
  scale: d3Scale.ScaleLinear<number, number>,
  isVertical: boolean,
  innerWidth: number,
  innerHeight: number,
  onEnter: (eraStart: number, eraEnd: number) => void,
  onLeave: () => void,
  hasScale: boolean = false,
  _tooltip: HTMLDivElement | null = null,
  palette?: PaletteColors,
  // When provided (horizontal reserved-row mode), eras render their label
  // in the dedicated header row at this Y, the rect stays inside the chart
  // (rectTop=0), and the label is truncated to fit the era's span. Hover
  // restores the full text.
  reservedLabelY?: number
): void {
  const eraColors = palette
    ? getEraColors(palette)
    : ['#3b6ea5', '#5b9357', '#c9a227', '#cc7a33', '#7d5ba6'];
  eras.forEach((era, i) => {
    const startVal = parseTimelineDate(era.startDate);
    const endVal = parseTimelineDate(era.endDate);
    if (!Number.isFinite(startVal) || !Number.isFinite(endVal)) return;
    const start = scale(startVal);
    const end = scale(endVal);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    // eraColors is non-empty; modulo guarantees in-bounds.
    const color = era.color || eraColors[i % eraColors.length]!;

    const eraG = g
      .append('g')
      .attr('class', 'tl-era')
      .attr('data-line-number', String(era.lineNumber))
      .attr('data-era-start', String(startVal))
      .attr('data-era-end', String(endVal))
      .style('cursor', 'pointer');

    let labelEl: d3Selection.Selection<
      SVGTextElement,
      unknown,
      null,
      undefined
    >;
    let displayLabel = era.label;
    let truncated = false;

    if (isVertical) {
      const y = Math.min(start, end);
      const h = Math.abs(end - start);
      eraG
        .append('rect')
        .attr('x', 0)
        .attr('y', y)
        .attr('width', innerWidth)
        .attr('height', h)
        .attr('fill', color)
        .attr('opacity', 0.08);
      labelEl = eraG
        .append('text')
        .attr('x', 6)
        .attr('y', y + 18)
        .attr('text-anchor', 'start')
        .attr('fill', color)
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .attr('opacity', 0.8)
        .text(displayLabel);
    } else {
      const x = Math.min(start, end);
      const w = Math.abs(end - start);
      // Reserved-row mode: rect lives inside the chart, label sits in its
      // own row above. Legacy mode (no reserved row): keep the era rect
      // extending above the chart so the label has space when scale is on.
      const useReservedRow = reservedLabelY != null;
      const rectTop = useReservedRow ? 0 : hasScale ? -48 : 0;
      const labelY = useReservedRow ? reservedLabelY! : hasScale ? -32 : 18;
      eraG
        .append('rect')
        .attr('x', x)
        .attr('y', rectTop)
        .attr('width', w)
        .attr('height', innerHeight - rectTop)
        .attr('fill', color)
        .attr('opacity', 0.08);
      if (useReservedRow) {
        // Truncate to era's own span so labels stay inside their tinted band.
        const maxW = Math.max(0, w - 8);
        displayLabel = truncateLegendText(era.label, 13, maxW);
        truncated = displayLabel !== era.label;
      }
      labelEl = eraG
        .append('text')
        .attr('x', x + w / 2)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .attr('opacity', 0.8)
        .text(displayLabel);
    }

    eraG
      .on('mouseenter', function () {
        onEnter(startVal, endVal);
        if (truncated) labelEl.text(era.label);
      })
      .on('mouseleave', function () {
        onLeave();
        if (truncated) labelEl.text(displayLabel);
      });
  });
}

/**
 * Renders timeline markers as dashed vertical lines with diamond indicators and labels.
 */
function renderMarkers(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  markers: TimelineMarker[],
  scale: d3Scale.ScaleLinear<number, number>,
  isVertical: boolean,
  innerWidth: number,
  innerHeight: number,
  onEnter: (markerDate: number) => void,
  onLeave: () => void,
  _hasScale: boolean = false,
  _tooltip: HTMLDivElement | null = null,
  palette?: PaletteColors,
  // When provided (horizontal reserved-row mode), labels render at this Y
  // above the chart edge instead of inside the chart at y=6, and are
  // truncated symmetrically based on neighbor distance.
  reservedLabelY?: number
): void {
  // Default marker color - bright orange/red that "pops"
  const defaultColor = palette?.accent || '#3a9188';

  // Pre-compute marker positions so each can size its label based on the
  // distance to its nearest neighbor (or chart edge).
  const positions = markers.map((m) => {
    const v = parseTimelineDate(m.date);
    return Number.isFinite(v) ? scale(v) : NaN;
  });
  const useReservedRow = reservedLabelY != null && !isVertical;

  markers.forEach((marker, i) => {
    const dateVal = parseTimelineDate(marker.date);
    if (!Number.isFinite(dateVal)) return;
    // positions is produced by markers.map(), so i is in-bounds.
    const pos = positions[i]!;
    if (!Number.isFinite(pos)) return;
    const color = marker.color || defaultColor;
    const lineOpacity = 0.5;
    const diamondSize = 5;

    const markerG = g
      .append('g')
      .attr('class', 'tl-marker')
      .attr('data-marker-date', String(dateVal))
      .attr('data-line-number', String(marker.lineNumber))
      .style('cursor', 'pointer');

    if (isVertical) {
      // Vertical orientation: horizontal dashed line across the chart
      markerG
        .append('line')
        .attr('x1', 0)
        .attr('y1', pos)
        .attr('x2', innerWidth)
        .attr('y2', pos)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', lineOpacity);

      // Label above diamond
      markerG
        .append('text')
        .attr('x', -diamondSize - 8)
        .attr('y', pos - diamondSize - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(marker.label);

      // Diamond at the left edge
      markerG
        .append('path')
        .attr(
          'd',
          `M${-diamondSize - 8},${pos} l${diamondSize},-${diamondSize} l${diamondSize},${diamondSize} l-${diamondSize},${diamondSize} Z`
        )
        .attr('fill', color)
        .attr('opacity', 0.9);

      markerG
        .on('mouseenter', function () {
          onEnter(dateVal);
        })
        .on('mouseleave', function () {
          onLeave();
        });
    } else {
      // Horizontal orientation: vertical dashed line down the chart.
      // Reserved-row mode lifts the label above the chart edge; legacy mode
      // keeps it at y=6 inside the chart top.
      const labelY = useReservedRow ? reservedLabelY! : 6;
      // Diamond sits fully above the chart edge in reserved-row mode so it
      // isn't clipped by group bars that start at y=0; legacy mode keeps the
      // diamond inside the chart top below the label.
      const diamondY = useReservedRow ? -(diamondSize + 1) : labelY + 14;
      const lineTop = diamondY + diamondSize;

      // Compute available label width based on nearest-neighbor distance.
      // Both labels truncate symmetrically and meet in the middle of the gap.
      let displayLabel = marker.label;
      let truncated = false;
      if (useReservedRow) {
        let nearestDist = Math.min(pos, innerWidth - pos);
        for (let j = 0; j < positions.length; j++) {
          if (j === i) continue;
          // In-bounds by loop guard.
          const other = positions[j]!;
          if (!Number.isFinite(other)) continue;
          const d = Math.abs(other - pos);
          if (d < nearestDist) nearestDist = d;
        }
        const maxW = Math.max(0, nearestDist - 8);
        displayLabel = truncateLegendText(marker.label, 11, maxW);
        truncated = displayLabel !== marker.label;
      }

      const labelEl = markerG
        .append('text')
        .attr('x', pos)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(displayLabel);

      // Diamond
      markerG
        .append('path')
        .attr(
          'd',
          `M${pos},${diamondY - diamondSize} l${diamondSize},${diamondSize} l-${diamondSize},${diamondSize} l-${diamondSize},-${diamondSize} Z`
        )
        .attr('fill', color)
        .attr('opacity', 0.9);

      // Dashed line down the chart
      markerG
        .append('line')
        .attr('x1', pos)
        .attr('y1', lineTop)
        .attr('x2', pos)
        .attr('y2', innerHeight)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', lineOpacity);

      markerG
        .on('mouseenter', function () {
          onEnter(dateVal);
          if (truncated) labelEl.text(marker.label);
        })
        .on('mouseleave', function () {
          onLeave();
          if (truncated) labelEl.text(displayLabel);
        });
    }
  });
}

// ============================================================
// Timeline Time Scale
// ============================================================

/**
 * Converts a DSL date string (YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DD HH:MM) to a human-readable label.
 *   '1718'              → '1718'
 *   '1718-05'           → 'May 1718'
 *   '1718-05-22'        → 'May 22, 1718'
 *   '2024-06-15 14:30'  → 'Jun 15, 2024 14:30'
 */
export function formatDateLabel(dateStr: string): string {
  // Split off optional time component
  const spaceIdx = dateStr.indexOf(' ');
  let datePart = dateStr;
  let timeSuffix = '';

  if (spaceIdx !== -1) {
    datePart = dateStr.slice(0, spaceIdx);
    timeSuffix = ' ' + dateStr.slice(spaceIdx + 1);
  }

  const parts = datePart.split('-');
  // split returns at least one element.
  const year = parts[0]!;
  if (parts.length === 1) return year + timeSuffix;
  // In-bounds by length check above.
  const month = MONTH_ABBR[parseInt(parts[1]!, 10) - 1];
  if (parts.length === 2) return `${month} ${year}${timeSuffix}`;
  // In-bounds by length check above.
  const day = parseInt(parts[2]!, 10);
  return `${month} ${day}, ${year}${timeSuffix}`;
}

/**
 * Formats a boundary label for the time axis.
 * When both boundaries fall on the same calendar day and have a time component,
 * returns just the time (e.g. "12:15") to avoid collisions with regular ticks.
 * Otherwise falls back to the full formatDateLabel.
 */
function formatBoundaryLabel(dateStr: string, otherDateStr: string): string {
  const spaceIdx = dateStr.indexOf(' ');
  const otherSpaceIdx = otherDateStr.indexOf(' ');
  // Both must have time components and share the same date portion
  if (spaceIdx !== -1 && otherSpaceIdx !== -1) {
    const datePart = dateStr.slice(0, spaceIdx);
    const otherDatePart = otherDateStr.slice(0, otherSpaceIdx);
    if (datePart === otherDatePart) {
      return dateStr.slice(spaceIdx + 1); // just "HH:MM"
    }
  }
  return formatDateLabel(dateStr);
}

/**
 * Renders adaptive tick marks along the time axis.
 * Optional boundary parameters add ticks at exact data start/end.
 */
function renderTimeScale(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3Scale.ScaleLinear<number, number>,
  isVertical: boolean,
  innerWidth: number,
  innerHeight: number,
  textColor: string,
  boundaryStart?: number,
  boundaryEnd?: number,
  boundaryStartLabel?: string,
  boundaryEndLabel?: string
): void {
  // d3 linear scales always return a 2-element domain.
  const [domainMin, domainMax] = scale.domain() as [number, number];
  const ticks = computeTimeTicks(
    domainMin,
    domainMax,
    scale,
    boundaryStart,
    boundaryEnd,
    boundaryStartLabel,
    boundaryEndLabel
  );
  if (ticks.length < 2) return;

  const tickLen = 6;
  const opacity = 0.4;

  const guideOpacity = 0.15;

  for (const tick of ticks) {
    if (isVertical) {
      // Guide line spanning full width
      g.append('line')
        .attr('x1', 0)
        .attr('y1', tick.pos)
        .attr('x2', innerWidth)
        .attr('y2', tick.pos)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4')
        .attr('opacity', guideOpacity);

      // Left edge
      g.append('line')
        .attr('x1', -tickLen)
        .attr('y1', tick.pos)
        .attr('x2', 0)
        .attr('y2', tick.pos)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('x', -tickLen - 3)
        .attr('y', tick.pos)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);

      // Right edge
      g.append('line')
        .attr('x1', innerWidth)
        .attr('y1', tick.pos)
        .attr('x2', innerWidth + tickLen)
        .attr('y2', tick.pos)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('x', innerWidth + tickLen + 3)
        .attr('y', tick.pos)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);
    } else {
      // Guide line spanning full height
      g.append('line')
        .attr('class', 'tl-scale-tick')
        .attr('x1', tick.pos)
        .attr('y1', 0)
        .attr('x2', tick.pos)
        .attr('y2', innerHeight)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4')
        .attr('opacity', guideOpacity);

      // Bottom edge
      g.append('line')
        .attr('class', 'tl-scale-tick')
        .attr('x1', tick.pos)
        .attr('y1', innerHeight)
        .attr('x2', tick.pos)
        .attr('y2', innerHeight + tickLen)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('class', 'tl-scale-tick')
        .attr('x', tick.pos)
        .attr('y', innerHeight + tickLen + 12)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);

      // Top edge
      g.append('line')
        .attr('class', 'tl-scale-tick')
        .attr('x1', tick.pos)
        .attr('y1', -tickLen)
        .attr('x2', tick.pos)
        .attr('y2', 0)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('class', 'tl-scale-tick')
        .attr('x', tick.pos)
        .attr('y', -tickLen - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);
    }
  }
}

// ============================================================
// Timeline Event Date Scale Helpers
// ============================================================

/**
 * Shows event start/end dates on the scale, fading existing scale ticks.
 * For horizontal timelines, displays dates at the top of the scale.
 */
function showEventDatesOnScale(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3Scale.ScaleLinear<number, number>,
  startDate: string,
  endDate: string | null,
  innerHeight: number,
  accentColor: string
): void {
  // Fade existing scale ticks
  g.selectAll('.tl-scale-tick').attr('opacity', 0.1);

  const tickLen = 6;
  const startPos = scale(parseTimelineDate(startDate));
  const startLabel = formatDateLabel(startDate);

  // Start date - top
  g.append('line')
    .attr('class', 'tl-event-date')
    .attr('x1', startPos)
    .attr('y1', -tickLen)
    .attr('x2', startPos)
    .attr('y2', innerHeight)
    .attr('stroke', accentColor)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4 4')
    .attr('opacity', 0.6);

  g.append('text')
    .attr('class', 'tl-event-date')
    .attr('x', startPos)
    .attr('y', -tickLen - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', accentColor)
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .text(startLabel);

  // Start date - bottom
  g.append('text')
    .attr('class', 'tl-event-date')
    .attr('x', startPos)
    .attr('y', innerHeight + tickLen + 12)
    .attr('text-anchor', 'middle')
    .attr('fill', accentColor)
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .text(startLabel);

  if (endDate) {
    const endPos = scale(parseTimelineDate(endDate));
    const endLabel = formatDateLabel(endDate);

    // End date - top
    g.append('line')
      .attr('class', 'tl-event-date')
      .attr('x1', endPos)
      .attr('y1', -tickLen)
      .attr('x2', endPos)
      .attr('y2', innerHeight)
      .attr('stroke', accentColor)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.6);

    g.append('text')
      .attr('class', 'tl-event-date')
      .attr('x', endPos)
      .attr('y', -tickLen - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', accentColor)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .text(endLabel);

    // End date - bottom
    g.append('text')
      .attr('class', 'tl-event-date')
      .attr('x', endPos)
      .attr('y', innerHeight + tickLen + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', accentColor)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .text(endLabel);
  }
}

/**
 * Hides event dates and restores scale tick visibility.
 */
function hideEventDatesOnScale(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>
): void {
  // Remove event date elements
  g.selectAll('.tl-event-date').remove();

  // Restore scale tick visibility
  g.selectAll('.tl-scale-tick').each(function () {
    const el = d3Selection.select(this);
    // Restore original opacity based on element type
    const isDashed = el.attr('stroke-dasharray');
    el.attr('opacity', isDashed ? 0.15 : 0.4);
  });
}

function showTooltip(
  tooltip: HTMLDivElement,
  html: string,
  event: MouseEvent
): void {
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const container = tooltip.parentElement!;
  const rect = container.getBoundingClientRect();
  let left = event.clientX - rect.left + 12;
  let top = event.clientY - rect.top - 28;
  // Clamp so tooltip stays inside the container
  const tipW = tooltip.offsetWidth;
  const tipH = tooltip.offsetHeight;
  if (left + tipW > rect.width) left = rect.width - tipW - 4;
  if (top < 0) top = event.clientY - rect.top + 16;
  if (top + tipH > rect.height) top = rect.height - tipH - 4;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip(tooltip: HTMLDivElement): void {
  tooltip.style.display = 'none';
}

function buildEventTooltipHtml(ev: TimelineEvent): string {
  const datePart = ev.endDate
    ? `${formatDateLabel(ev.date)} → ${formatDateLabel(ev.endDate)}`
    : formatDateLabel(ev.date);
  return `<strong>${ev.label}</strong><br>${datePart}`;
}

// ============================================================
// Timeline Renderer
// ============================================================

/**
 * Renders timeline group legend as pills (colored dot + text in rounded rect),
 * matching the centralized legend pill style.
 */
function renderTimelineGroupLegend(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  groups: TimelineGroup[],
  groupColorMap: Map<string, string>,
  textColor: string,
  palette: PaletteColors,
  isDark: boolean,
  legendY: number,
  onHover: (name: string) => void,
  onLeave: () => void
): void {
  const PILL_H = 22;
  const DOT_R = 4;
  const DOT_GAP = 4;
  const PAD_X = 10;
  const FONT_SIZE = 11;
  const GAP = 8;
  const pillBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);

  let legendX = 0;
  for (const grp of groups) {
    const color = groupColorMap.get(grp.name) ?? textColor;
    const textW = measureLegendText(grp.name, FONT_SIZE);
    const pillW = PAD_X + DOT_R * 2 + DOT_GAP + textW + PAD_X;

    const itemG = g
      .append('g')
      .attr('class', 'tl-legend-item')
      .attr('data-group', grp.name)
      .style('cursor', 'pointer')
      .on('mouseenter', () => onHover(grp.name))
      .on('mouseleave', () => onLeave());

    // Pill background
    itemG
      .append('rect')
      .attr('x', legendX)
      .attr('y', legendY - PILL_H / 2)
      .attr('width', pillW)
      .attr('height', PILL_H)
      .attr('rx', PILL_H / 2)
      .attr('fill', pillBg);

    // Colored dot
    itemG
      .append('circle')
      .attr('cx', legendX + PAD_X + DOT_R)
      .attr('cy', legendY)
      .attr('r', DOT_R)
      .attr('fill', color);

    // Label text
    itemG
      .append('text')
      .attr('x', legendX + PAD_X + DOT_R * 2 + DOT_GAP)
      .attr('y', legendY)
      .attr('dy', '0.35em')
      .attr('fill', textColor)
      .attr('font-size', `${FONT_SIZE}px`)
      .attr('font-family', FONT_FAMILY)
      .text(grp.name);

    legendX += pillW + GAP;
  }
}

// ============================================================
// Timeline — setup helper (extracted from renderTimeline)
// ============================================================

type Lane = { name: string; events: TimelineEvent[] };

type TimelineSetup = {
  width: number;
  height: number;
  isVertical: boolean;
  tooltip: HTMLDivElement;
  solid: boolean;
  textColor: string;
  mutedColor: string;
  bgColor: string;
  bg: string;
  swimlaneTagGroup: string | null;
  groupColorMap: Map<string, string>;
  tagLanes: Lane[] | null;
  eventColor: (ev: TimelineEvent) => string;
  minDate: number;
  maxDate: number;
  datePadding: number;
  earliestStartDateStr: string;
  latestEndDateStr: string;
  tagLegendReserve: number;
  ctx: ScaleContext;
};

/**
 * Computes layout context (dimensions, colors, date domain, tag lanes,
 * event-color resolver) for a timeline before the orientation-specific
 * rendering branch runs. Returns null when there is nothing to render
 * (empty events or zero-sized container).
 *
 * Side effects: clears the container and creates the tooltip element.
 */
function setupTimeline(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  exportDims: D3ExportDimensions | undefined,
  activeTagGroup: string | null | undefined,
  swimlaneTagGroup: string | null | undefined
): TimelineSetup | null {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const solid = parsed.solidFill === true;

  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineSort,
    orientation,
  } = parsed;
  if (timelineEvents.length === 0) return null;

  let resolvedSwimlaneTG: string | null = swimlaneTagGroup ?? null;
  if (
    resolvedSwimlaneTG == null &&
    timelineSort === 'tag' &&
    parsed.timelineDefaultSwimlaneTG
  ) {
    resolvedSwimlaneTG = parsed.timelineDefaultSwimlaneTG;
  }

  const tooltip = createTooltip(container, palette, isDark);

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return null;

  const isVertical = orientation === 'vertical';

  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.bg;
  const bg = isDark ? palette.surface : palette.bg;
  const colors = getSeriesColors(palette);

  const groupColorMap = new Map<string, string>();
  timelineGroups.forEach((grp, i) => {
    // colors is non-empty; modulo guarantees in-bounds.
    groupColorMap.set(grp.name, grp.color ?? colors[i % colors.length]!);
  });

  let tagLanes: Lane[] | null = null;

  if (resolvedSwimlaneTG) {
    const tagKey = resolvedSwimlaneTG.toLowerCase();
    const tagGroup = parsed.timelineTagGroups.find(
      (g) => g.name.toLowerCase() === tagKey
    );
    if (tagGroup) {
      const buckets = new Map<string, TimelineEvent[]>();
      const otherEvents: TimelineEvent[] = [];
      for (const ev of timelineEvents) {
        const val = ev.metadata[tagKey];
        if (val) {
          const list = buckets.get(val) ?? [];
          list.push(ev);
          buckets.set(val, list);
        } else {
          otherEvents.push(ev);
        }
      }

      const laneEntries = [...buckets.entries()].sort((a, b) => {
        const aMin = Math.min(...a[1].map((e) => parseTimelineDate(e.date)));
        const bMin = Math.min(...b[1].map((e) => parseTimelineDate(e.date)));
        return aMin - bMin;
      });

      tagLanes = laneEntries.map(([name, events]) => ({ name, events }));
      if (otherEvents.length > 0) {
        tagLanes.push({ name: '(Other)', events: otherEvents });
      }

      for (const entry of tagGroup.entries) {
        groupColorMap.set(entry.value, entry.color);
      }
    }
  }

  const effectiveColorTG = activeTagGroup ?? resolvedSwimlaneTG ?? null;

  function eventColor(ev: TimelineEvent): string {
    if (effectiveColorTG) {
      const tagColor = resolveTagColor(
        ev.metadata,
        parsed.timelineTagGroups,
        effectiveColorTG
      );
      if (tagColor) return tagColor;
    }
    if (ev.group && groupColorMap.has(ev.group)) {
      return groupColorMap.get(ev.group)!;
    }
    return textColor;
  }

  let minDate = Infinity;
  let maxDate = -Infinity;
  let earliestStartDateStr = '';
  let latestEndDateStr = '';

  for (const ev of timelineEvents) {
    const startNum = parseTimelineDate(ev.date);
    const endNum = ev.endDate ? parseTimelineDate(ev.endDate) : startNum;

    if (startNum < minDate) {
      minDate = startNum;
      earliestStartDateStr = ev.date;
    }
    if (endNum > maxDate) {
      maxDate = endNum;
      latestEndDateStr = ev.endDate ?? ev.date;
    }
  }

  for (const era of timelineEras) {
    const eraStartNum = parseTimelineDate(era.startDate);
    const eraEndNum = parseTimelineDate(era.endDate);
    if (Number.isFinite(eraStartNum) && eraStartNum < minDate) {
      minDate = eraStartNum;
      earliestStartDateStr = era.startDate;
    }
    if (Number.isFinite(eraEndNum) && eraEndNum > maxDate) {
      maxDate = eraEndNum;
      latestEndDateStr = era.endDate;
    }
  }
  for (const marker of timelineMarkers) {
    const markerNum = parseTimelineDate(marker.date);
    if (!Number.isFinite(markerNum)) continue;
    if (markerNum < minDate) {
      minDate = markerNum;
      earliestStartDateStr = marker.date;
    }
    if (markerNum > maxDate) {
      maxDate = markerNum;
      latestEndDateStr = marker.date;
    }
  }
  const datePadding = (maxDate - minDate) * 0.05 || 0.5;

  const tagLegendReserve = parsed.timelineTagGroups.length > 0 ? 36 : 0;

  const idealWidth = isVertical
    ? 500
    : Math.max(600, timelineEvents.length * 40 + 200);
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  return {
    width,
    height,
    isVertical,
    tooltip,
    solid,
    textColor,
    mutedColor,
    bgColor,
    bg,
    swimlaneTagGroup: resolvedSwimlaneTG,
    groupColorMap,
    tagLanes,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  };
}

// ============================================================
// Timeline — hover helpers (extracted from renderTimeline)
// ============================================================

type TimelineHoverHelpers = {
  FADE_OPACITY: number;
  fadeToGroup: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    groupName: string
  ) => void;
  fadeToEra: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    eraStart: number,
    eraEnd: number
  ) => void;
  fadeToMarker: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    markerDate: number
  ) => void;
  fadeReset: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) => void;
  fadeToTagValue: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    tagKey: string,
    tagValue: string
  ) => void;
  setTagAttrs: (
    evG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    ev: TimelineEvent
  ) => void;
};

/**
 * Shared hover helpers for timeline rendering. Operate on CSS classes,
 * orientation-agnostic. Used by all three rendering branches.
 */
function makeTimelineHoverHelpers(): TimelineHoverHelpers {
  const FADE_OPACITY = 0.1;

  function fadeToGroup(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    groupName: string
  ) {
    g.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
      const el = d3Selection.select(this);
      const evGroup = el.attr('data-group');
      el.attr('opacity', evGroup === groupName ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').each(
      function () {
        const el = d3Selection.select(this);
        const name = el.attr('data-group');
        el.attr('opacity', name === groupName ? 1 : FADE_OPACITY);
      }
    );
    g.selectAll<SVGGElement, unknown>('.tl-marker').attr(
      'opacity',
      FADE_OPACITY
    );
  }

  function fadeToEra(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    eraStart: number,
    eraEnd: number
  ) {
    g.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
      const el = d3Selection.select(this);
      const date = parseFloat(el.attr('data-date')!);
      const endDate = el.attr('data-end-date');
      const evEnd = endDate ? parseFloat(endDate) : date;
      const inside = evEnd >= eraStart && date <= eraEnd;
      el.attr('opacity', inside ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-era').each(function () {
      const el = d3Selection.select(this);
      const s = parseFloat(el.attr('data-era-start')!);
      const e = parseFloat(el.attr('data-era-end')!);
      const isSelf = s === eraStart && e === eraEnd;
      el.attr('opacity', isSelf ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-marker').each(function () {
      const el = d3Selection.select(this);
      const date = parseFloat(el.attr('data-marker-date')!);
      const inside = date >= eraStart && date <= eraEnd;
      el.attr('opacity', inside ? 1 : FADE_OPACITY);
    });
  }

  function fadeToMarker(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    markerDate: number
  ) {
    g.selectAll<SVGGElement, unknown>('.tl-event').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-era').attr('opacity', FADE_OPACITY);
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-marker').each(function () {
      const el = d3Selection.select(this);
      const date = parseFloat(el.attr('data-marker-date')!);
      el.attr('opacity', date === markerDate ? 1 : FADE_OPACITY);
    });
  }

  function fadeReset(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) {
    g.selectAll<SVGGElement, unknown>(
      '.tl-event, .tl-legend-item, .tl-lane-header, .tl-marker, .tl-tag-legend-entry'
    ).attr('opacity', 1);
    g.selectAll<SVGGElement, unknown>('.tl-era').attr('opacity', 1);
  }

  function fadeToTagValue(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    tagKey: string,
    tagValue: string
  ) {
    const attrName = `data-tag-${tagKey}`;
    g.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
      const el = d3Selection.select(this);
      const val = el.attr(attrName);
      el.attr('opacity', val === tagValue ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-marker').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-tag-legend-entry').each(function () {
      const el = d3Selection.select(this);
      const entryValue = el.attr('data-legend-entry');
      if (entryValue === '__group__') return;
      const entryGroup = el.attr('data-tag-group');
      el.attr(
        'opacity',
        entryGroup === tagKey && entryValue === tagValue ? 1 : FADE_OPACITY
      );
    });
  }

  /** Attach data-tag-* attributes on an event group element */
  function setTagAttrs(
    evG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    ev: TimelineEvent
  ) {
    for (const [key, value] of Object.entries(ev.metadata)) {
      evG.attr(`data-tag-${key}`, value.toLowerCase());
    }
  }

  return {
    FADE_OPACITY,
    fadeToGroup,
    fadeToEra,
    fadeToMarker,
    fadeReset,
    fadeToTagValue,
    setTagAttrs,
  };
}

// ============================================================
// Timeline — tag-legend overlay (extracted from renderTimeline)
// ============================================================

function renderTimelineTagLegendOverlay(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  exportDims: D3ExportDimensions | undefined,
  swimlaneTagGroup: string | null | undefined,
  activeTagGroup: string | null | undefined,
  onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  viewMode: boolean | undefined,
  exportMode?: boolean
): void {
  if (parsed.timelineTagGroups.length === 0) return;

  const { width, textColor, groupColorMap, solid } = setup;
  const { FADE_OPACITY, fadeReset, fadeToTagValue } = hovers;
  const title = parsed.noTitle ? null : parsed.title;
  const { timelineEvents } = parsed;

  const LG_HEIGHT = TL_LEGEND_HEIGHT;
  const LG_PILL_PAD = TL_LEGEND_PILL_PAD;
  const LG_PILL_FONT_SIZE = TL_LEGEND_PILL_FONT_SIZE;
  const LG_CAPSULE_PAD = TL_LEGEND_CAPSULE_PAD;
  const LG_DOT_R = TL_LEGEND_DOT_R;
  const LG_ENTRY_FONT_SIZE = TL_LEGEND_ENTRY_FONT_SIZE;
  const LG_ENTRY_DOT_GAP = TL_LEGEND_ENTRY_DOT_GAP;
  const LG_ENTRY_TRAIL = TL_LEGEND_ENTRY_TRAIL;
  // LG_GROUP_GAP no longer needed — centralized legend handles spacing
  const LG_ICON_W = 20; // swimlane icon area (icon + surrounding space) — local

  const mainSvg = d3Selection.select(container).select<SVGSVGElement>('svg');
  const mainG = mainSvg.select<SVGGElement>('g');
  if (!mainSvg.empty() && !mainG.empty()) {
    // Position legend at top, below title
    const legendY = title ? 50 : 10;

    // Pre-compute group widths (minified and expanded)
    type LegendGroup = {
      group: TagGroup;
      minifiedWidth: number;
      expandedWidth: number;
    };
    const legendGroups: LegendGroup[] = parsed.timelineTagGroups.map((g) => {
      const pillW = measureLegendText(g.name, LG_PILL_FONT_SIZE) + LG_PILL_PAD;
      // Expanded: pill + icon (unless viewMode) + entries
      const iconSpace = viewMode ? 8 : LG_ICON_W + 4;
      let entryX = LG_CAPSULE_PAD + pillW + iconSpace;
      for (const entry of g.entries) {
        const textX = entryX + LG_DOT_R * 2 + LG_ENTRY_DOT_GAP;
        entryX =
          textX +
          measureLegendText(entry.value, LG_ENTRY_FONT_SIZE) +
          LG_ENTRY_TRAIL;
      }
      return {
        group: g,
        minifiedWidth: pillW,
        expandedWidth: entryX + LG_CAPSULE_PAD,
      };
    });

    // Two independent state axes: swimlane source + color source
    let currentActiveGroup: string | null = activeTagGroup ?? null;
    let currentSwimlaneGroup: string | null = swimlaneTagGroup ?? null;

    /** Render the swimlane icon (3 horizontal bars of varying width) */
    function drawSwimlaneIcon(
      parent: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
      x: number,
      y: number,
      isSwimActive: boolean
    ) {
      const iconG = parent
        .append('g')
        .attr('class', 'tl-swimlane-icon')
        .attr('transform', `translate(${x}, ${y})`)
        .style('cursor', 'pointer');

      // Transparent hit area so the whole icon (not just the 2px bars) is clickable
      iconG
        .append('rect')
        .attr('x', -5)
        .attr('y', -5)
        .attr('width', 22)
        .attr('height', 20)
        .attr('fill', 'transparent');

      const barColor = isSwimActive ? palette.primary : palette.textMuted;
      const barOpacity = isSwimActive ? 1 : 0.35;
      const bars = [
        { y: 0, w: 8 },
        { y: 4, w: 12 },
        { y: 8, w: 6 },
      ];
      for (const bar of bars) {
        iconG
          .append('rect')
          .attr('x', 0)
          .attr('y', bar.y)
          .attr('width', bar.w)
          .attr('height', 2)
          .attr('rx', 1)
          .attr('fill', barColor)
          .attr('opacity', barOpacity);
      }
      return iconG;
    }

    /** Full re-render with updated swimlane state */
    function relayout() {
      renderTimeline(
        container,
        parsed,
        palette,
        isDark,
        onClickItem,
        exportDims,
        currentActiveGroup,
        currentSwimlaneGroup,
        onTagStateChange,
        viewMode
      );
    }

    function drawLegend() {
      // Remove previous legend
      mainSvg.selectAll('.tl-tag-legend-group').remove();
      mainSvg.selectAll('.tl-tag-legend-container').remove();

      // Effective color source: explicit color group > swimlane group
      const effectiveColorKey =
        (currentActiveGroup ?? currentSwimlaneGroup)?.toLowerCase() ?? null;

      // In view mode, only show the color-driving tag group (expanded, non-interactive).
      // Skip the swimlane group if it's separate from the color group (lane headers already label it).
      const visibleGroups = viewMode
        ? legendGroups.filter(
            (lg) =>
              effectiveColorKey != null &&
              lg.group.name.toLowerCase() === effectiveColorKey
          )
        : legendGroups;

      if (visibleGroups.length === 0) return;

      // Legend container for data-legend-active attribute
      const legendContainer = mainSvg
        .append('g')
        .attr('class', 'tl-tag-legend-container');
      if (currentActiveGroup) {
        legendContainer.attr(
          'data-legend-active',
          currentActiveGroup.toLowerCase()
        );
      }

      // Render tag groups via centralized legend system
      const iconAddon = viewMode ? 0 : LG_ICON_W;
      const centralGroups = visibleGroups.map((lg) => ({
        name: lg.group.name,
        entries: lg.group.entries.map((e) => ({
          value: e.value,
          color: e.color,
        })),
      }));

      // Determine effective active group for centralized renderer
      const centralActive = viewMode ? effectiveColorKey : currentActiveGroup;

      const centralConfig: LegendConfig = {
        groups: centralGroups,
        position: { placement: 'top-center', titleRelation: 'below-title' },
        mode: exportMode ? 'export' : 'preview',
        capsulePillAddonWidth: iconAddon,
      };
      const centralState: LegendState = { activeGroup: centralActive };

      const centralCallbacks: LegendCallbacks = viewMode
        ? {}
        : {
            onGroupToggle: (groupName) => {
              currentActiveGroup =
                currentActiveGroup === groupName.toLowerCase()
                  ? null
                  : groupName.toLowerCase();
              drawLegend();
              recolorEvents();
              onTagStateChange?.(currentActiveGroup, currentSwimlaneGroup);
            },
            onEntryHover: (groupName, entryValue) => {
              const tagKey = groupName.toLowerCase();
              if (entryValue) {
                const tagVal = entryValue.toLowerCase();
                fadeToTagValue(mainG, tagKey, tagVal);
                mainSvg
                  .selectAll<SVGGElement, unknown>('[data-legend-entry]')
                  .each(function () {
                    const el = d3Selection.select(this);
                    const ev = el.attr('data-legend-entry');
                    const eg =
                      el.attr('data-tag-group') ??
                      (el.node() as Element)
                        ?.closest?.('[data-tag-group]')
                        ?.getAttribute('data-tag-group');
                    el.attr(
                      'opacity',
                      eg === tagKey && ev === tagVal ? 1 : FADE_OPACITY
                    );
                  });
              } else {
                fadeReset(mainG);
                mainSvg
                  .selectAll<SVGGElement, unknown>('[data-legend-entry]')
                  .attr('opacity', 1);
              }
            },
            onGroupRendered: (groupName, groupEl, isActive) => {
              const groupKey = groupName.toLowerCase();
              groupEl.attr('data-tag-group', groupKey);
              if (isActive && !viewMode) {
                const isSwimActive =
                  currentSwimlaneGroup?.toLowerCase() === groupKey;
                const pillWidth =
                  measureLegendText(groupName, LG_PILL_FONT_SIZE) + LG_PILL_PAD;
                const pillXOff = LG_CAPSULE_PAD;
                const iconX = pillXOff + pillWidth + 5;
                const iconY = (LG_HEIGHT - 10) / 2;
                const iconEl = drawSwimlaneIcon(
                  groupEl,
                  iconX,
                  iconY,
                  isSwimActive
                );
                iconEl
                  .attr('data-swimlane-toggle', groupKey)
                  .on('click', (event: MouseEvent) => {
                    event.stopPropagation();
                    currentSwimlaneGroup =
                      currentSwimlaneGroup === groupKey ? null : groupKey;
                    onTagStateChange?.(
                      currentActiveGroup,
                      currentSwimlaneGroup
                    );
                    relayout();
                  });
              }
            },
          };

      const legendInnerG = legendContainer
        .append('g')
        .attr('transform', `translate(0, ${legendY})`);
      renderLegendD3(
        legendInnerG,
        centralConfig,
        centralState,
        palette,
        isDark,
        centralCallbacks,
        width
      );
    }

    // Build a quick lineNumber→event lookup
    const eventByLine = new Map<string, TimelineEvent>();
    for (const ev of timelineEvents) {
      eventByLine.set(String(ev.lineNumber), ev);
    }

    function recolorEvents() {
      const colorTG = currentActiveGroup ?? swimlaneTagGroup ?? null;
      mainG.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
        const el = d3Selection.select(this);
        const lineNum = el.attr('data-line-number');
        const ev = lineNum ? eventByLine.get(lineNum) : undefined;
        if (!ev) return;

        let color: string;
        if (colorTG) {
          const tagColor = resolveTagColor(
            ev.metadata,
            parsed.timelineTagGroups,
            colorTG
          );
          color =
            tagColor ??
            (ev.group && groupColorMap.has(ev.group)
              ? groupColorMap.get(ev.group)!
              : textColor);
        } else {
          color =
            ev.group && groupColorMap.has(ev.group)
              ? groupColorMap.get(ev.group)!
              : textColor;
        }
        el.selectAll('rect')
          .attr('fill', shapeFill(palette, color, isDark, { solid }))
          .attr('stroke', color);
        el.selectAll('circle:not(.tl-event-point-outline)')
          .attr('fill', shapeFill(palette, color, isDark, { solid }))
          .attr('stroke', color);
      });
    }

    drawLegend();
  }
}

// ============================================================
// Timeline — horizontal-time-sort renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineHorizontalTimeSort(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  _exportDims: D3ExportDimensions | undefined,
  _swimlaneTagGroup: string | null | undefined,
  _activeTagGroup: string | null | undefined,
  _onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  _viewMode: boolean | undefined
): void {
  const {
    width,
    tooltip,
    solid,
    textColor,
    bgColor,
    bg,
    groupColorMap,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  } = setup;
  const { fadeToGroup, fadeToEra, fadeToMarker, fadeReset, setTagAttrs } =
    hovers;
  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineScale,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  const sBarH = ctx.structural(22);
  const sPointR = ctx.structural(5);
  const sPointStroke = ctx.structural(2);
  const sBarRx = ctx.structural(4);
  const sBarStroke = ctx.structural(2);
  const sEventFont = ctx.text(13);
  const sEventFontSm = ctx.text(12);
  const sCharW = ctx.structural(7);

  // === TIME SORT, horizontal: each event on its own row ===
  const sorted = timelineEvents
    .slice()
    .sort((a, b) => parseTimelineDate(a.date) - parseTimelineDate(b.date));

  const scaleMargin = timelineScale ? ctx.aesthetic(24) : 0;
  const ERA_ROW_H = ctx.structural(22);
  const MARKER_ROW_H = ctx.structural(22);
  const eraReserve = timelineEras.length > 0 ? ERA_ROW_H : 0;
  const markerReserve = timelineMarkers.length > 0 ? MARKER_ROW_H : 0;
  const topScaleH = timelineScale ? ctx.structural(40) : 0;
  const margin = {
    top:
      ctx.aesthetic(104) +
      topScaleH +
      eraReserve +
      markerReserve +
      tagLegendReserve,
    right: ctx.aesthetic(40),
    bottom: ctx.aesthetic(40) + scaleMargin,
    left: ctx.aesthetic(60),
  };
  const markerLabelY = markerReserve ? -(topScaleH + MARKER_ROW_H / 2) : 0;
  const eraLabelY = eraReserve
    ? -(topScaleH + markerReserve + ERA_ROW_H / 2)
    : 0;
  const innerWidth = width - margin.left - margin.right;
  // Each event gets a fixed comfortable row. The old behaviour compressed rowH
  // to fit the container height (`min(28, avail / n)`), but that only ever
  // shrank rows BELOW the 22px bar height — cramming events into overlap when
  // the host surface was shorter than the content required (e.g. the app's
  // fixed-height embedded-diagram surface). A constant rowH never overlaps:
  // when the container is taller than needed the SVG shrinks to the content
  // (top-aligned via preserveAspectRatio); when shorter, the SVG grows past it
  // and the host collapses/expands to the rendered height. This also makes the
  // interactive preview match the exported image, which already used rowH=28.
  const rowH = ctx.structural(28);
  // Draw the era bands and time axis to the content height (not the full
  // container) so the axis sits just below the last event.
  const innerHeight = rowH * sorted.length;
  const usedHeight = margin.top + innerHeight + margin.bottom;

  const xScale = d3Scale
    .scaleLinear()
    .domain([minDate - datePadding, maxDate + datePadding])
    .range([0, innerWidth]);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', usedHeight)
    .attr('viewBox', `0 0 ${width} ${usedHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('background', bgColor);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  renderEras(
    g,
    timelineEras,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (s, e) => fadeToEra(g, s, e),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    eraReserve ? eraLabelY : undefined
  );

  renderMarkers(
    g,
    timelineMarkers,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (d) => fadeToMarker(g, d),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    markerReserve ? markerLabelY : undefined
  );

  if (timelineScale) {
    renderTimeScale(
      g,
      xScale,
      false,
      innerWidth,
      innerHeight,
      textColor,
      minDate,
      maxDate,
      formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
      formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
    );
  }

  // Group legend at top-left (pill style)
  if (timelineGroups.length > 0) {
    const legendY = timelineScale ? -ctx.aesthetic(75) : -ctx.aesthetic(55);
    renderTimelineGroupLegend(
      g,
      timelineGroups,
      groupColorMap,
      textColor,
      palette,
      isDark,
      legendY,
      (name) => fadeToGroup(g, name),
      () => fadeReset(g)
    );
  }

  sorted.forEach((ev, i) => {
    // Marker labels live in their reserved row above the chart, so the
    // first event sits at the chart top edge.
    const y = i * rowH + rowH / 2;
    const x = xScale(parseTimelineDate(ev.date));
    const color = eventColor(ev);

    const evG = g
      .append('g')
      .attr('class', 'tl-event')
      .attr('data-group', ev.group || '')
      .attr('data-line-number', String(ev.lineNumber))
      .attr('data-date', String(parseTimelineDate(ev.date)))
      .attr(
        'data-end-date',
        ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
      )
      .style('cursor', 'pointer')
      .on('mouseenter', function (event: MouseEvent) {
        if (ev.group && timelineGroups.length > 0) fadeToGroup(g, ev.group);
        if (timelineScale) {
          showEventDatesOnScale(
            g,
            xScale,
            ev.date,
            ev.endDate,
            innerHeight,
            color
          );
        } else {
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        }
      })
      .on('mouseleave', function () {
        fadeReset(g);
        if (timelineScale) {
          hideEventDatesOnScale(g);
        } else {
          hideTooltip(tooltip);
        }
      })
      .on('mousemove', function (event: MouseEvent) {
        if (!timelineScale) {
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        }
      })
      .on('click', () => {
        if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
      });
    setTagAttrs(evG, ev);

    if (ev.endDate) {
      const x2 = xScale(parseTimelineDate(ev.endDate));
      const rectW = Math.max(x2 - x, 4);
      const estLabelWidth = ev.label.length * sCharW + ctx.aesthetic(16);
      const labelFitsInside = rectW >= estLabelWidth;

      let fill: string = shapeFill(palette, color, isDark, { solid });
      let stroke: string = color;
      if (ev.uncertain) {
        const gradientId = `uncertain-ts-${ev.lineNumber}`;
        const strokeGradientId = `uncertain-ts-s-${ev.lineNumber}`;
        const defs = svg.select('defs').node() || svg.append('defs').node();
        const defsEl = d3Selection.select(defs as Element);
        defsEl
          .append('linearGradient')
          .attr('id', gradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '100%')
          .attr('y2', '0%')
          .selectAll('stop')
          .data([
            { offset: '0%', opacity: 1 },
            { offset: '80%', opacity: 1 },
            { offset: '100%', opacity: 0 },
          ])
          .enter()
          .append('stop')
          .attr('offset', (d) => d.offset)
          .attr('stop-color', mix(color, bg, 30))
          .attr('stop-opacity', (d) => d.opacity);
        defsEl
          .append('linearGradient')
          .attr('id', strokeGradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '100%')
          .attr('y2', '0%')
          .selectAll('stop')
          .data([
            { offset: '0%', opacity: 1 },
            { offset: '80%', opacity: 1 },
            { offset: '100%', opacity: 0 },
          ])
          .enter()
          .append('stop')
          .attr('offset', (d) => d.offset)
          .attr('stop-color', color)
          .attr('stop-opacity', (d) => d.opacity);
        fill = `url(#${gradientId})`;
        stroke = `url(#${strokeGradientId})`;
      }

      evG
        .append('rect')
        .attr('x', x)
        .attr('y', y - sBarH / 2)
        .attr('width', rectW)
        .attr('height', sBarH)
        .attr('rx', sBarRx)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', sBarStroke);

      if (labelFitsInside) {
        evG
          .append('text')
          .attr('x', x + ctx.aesthetic(8))
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'start')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFont}px`)
          .text(ev.label);
      } else {
        const sLabelGap = ctx.aesthetic(6);
        const wouldFlipLeft = x + rectW > innerWidth * 0.6;
        const labelFitsLeft = x - sLabelGap - estLabelWidth > 0;
        const flipLeft = wouldFlipLeft && labelFitsLeft;
        evG
          .append('text')
          .attr('x', flipLeft ? x - sLabelGap : x + rectW + sLabelGap)
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', flipLeft ? 'end' : 'start')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFont}px`)
          .text(ev.label);
      }
    } else {
      const estLabelWidth = ev.label.length * sCharW;
      const sPointGap = ctx.aesthetic(10);
      const wouldFlipLeft = x > innerWidth * 0.6;
      const labelFitsLeft = x - sPointGap - estLabelWidth > 0;
      const flipLeft = wouldFlipLeft && labelFitsLeft;
      evG
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', sPointR)
        .attr('fill', shapeFill(palette, color, isDark, { solid }))
        .attr('stroke', color)
        .attr('stroke-width', sPointStroke);
      evG
        .append('text')
        .attr('x', flipLeft ? x - sPointGap : x + sPointGap)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', flipLeft ? 'end' : 'start')
        .attr('fill', textColor)
        .attr('font-size', `${sEventFontSm}px`)
        .text(ev.label);
    }
  });
}

// ============================================================
// Timeline — horizontal-grouped renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineHorizontalGrouped(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  _exportDims: D3ExportDimensions | undefined,
  _swimlaneTagGroup: string | null | undefined,
  _activeTagGroup: string | null | undefined,
  _onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  _viewMode: boolean | undefined,
  collapsedGroups: Set<string>,
  toggleGroup: (name: string) => void
): void {
  const {
    width,
    height,
    tooltip,
    solid,
    textColor,
    bgColor,
    bg,
    groupColorMap,
    tagLanes,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  } = setup;
  const { fadeToGroup, fadeToEra, fadeToMarker, fadeReset, setTagAttrs } =
    hovers;
  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineScale,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  const sBarH = ctx.structural(22);
  const sGroupGap = ctx.aesthetic(12);
  const sPointR = ctx.structural(5);
  const sPointStroke = ctx.structural(2);
  const sBarRx = ctx.structural(4);
  const sBarStroke = ctx.structural(2);
  const sEventFont = ctx.text(13);
  const sCharW = ctx.structural(7);
  const sLaneHeaderFont = ctx.text(12);

  // === GROUPED: swim-lanes stacked vertically, events on own rows ===
  let lanes: Lane[];

  if (tagLanes) {
    lanes = tagLanes;
  } else {
    const groupNames = timelineGroups.map((gr) => gr.name);
    const ungroupedEvents = timelineEvents.filter(
      (ev) => ev.group === null || !groupNames.includes(ev.group)
    );
    const laneNames =
      ungroupedEvents.length > 0 ? [...groupNames, '(Other)'] : groupNames;
    lanes = laneNames.map((name) => ({
      name,
      events: timelineEvents.filter((ev) =>
        name === '(Other)'
          ? ev.group === null || !groupNames.includes(ev.group)
          : ev.group === name
      ),
    }));
  }

  const totalRows = lanes.reduce((s, l) => {
    if (collapsedGroups.has(l.name)) return s + 1;
    return s + l.events.length + 1;
  }, 0);
  const scaleMargin = timelineScale ? ctx.aesthetic(24) : 0;
  // Per-feature header rows: era + marker each get their own row, reserved
  // only when present (mirrors the gantt header stack).
  const ERA_ROW_H = ctx.structural(22);
  const MARKER_ROW_H = ctx.structural(22);
  const eraReserve = timelineEras.length > 0 ? ERA_ROW_H : 0;
  const markerReserve = timelineMarkers.length > 0 ? MARKER_ROW_H : 0;
  const topScaleH = timelineScale ? ctx.structural(40) : 0;
  const maxGroupNameLen = Math.max(...lanes.map((l) => l.name.length)) + 2;
  const maxEventLabelLen = Math.max(
    0,
    ...lanes.flatMap((l) => l.events.map((ev) => ev.label.length + 2))
  );
  const maxLeftLabelLen = Math.max(maxGroupNameLen, maxEventLabelLen);
  const dynamicLeftMargin = Math.max(
    ctx.aesthetic(140),
    maxLeftLabelLen * sCharW + ctx.aesthetic(30)
  );
  const baseTopMargin = title ? ctx.aesthetic(50) : ctx.aesthetic(20);
  const margin = {
    top:
      baseTopMargin + topScaleH + eraReserve + markerReserve + tagLegendReserve,
    right: ctx.aesthetic(40),
    bottom: ctx.aesthetic(40) + scaleMargin,
    left: dynamicLeftMargin,
  };
  const markerLabelY = markerReserve ? -(topScaleH + MARKER_ROW_H / 2) : 0;
  const eraLabelY = eraReserve
    ? -(topScaleH + markerReserve + ERA_ROW_H / 2)
    : 0;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const totalGaps = (lanes.length - 1) * sGroupGap;
  const rowH = Math.min(
    ctx.structural(28),
    (innerHeight - totalGaps) / totalRows
  );

  const xScale = d3Scale
    .scaleLinear()
    .domain([minDate - datePadding, maxDate + datePadding])
    .range([0, innerWidth]);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('background', bgColor);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  renderEras(
    g,
    timelineEras,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (s, e) => fadeToEra(g, s, e),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    eraReserve ? eraLabelY : undefined
  );

  renderMarkers(
    g,
    timelineMarkers,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (d) => fadeToMarker(g, d),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    markerReserve ? markerLabelY : undefined
  );

  if (timelineScale) {
    renderTimeScale(
      g,
      xScale,
      false,
      innerWidth,
      innerHeight,
      textColor,
      minDate,
      maxDate,
      formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
      formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
    );
  }

  // Marker labels now live in their reserved row above the chart, so
  // events can start at y=0 (chart top edge).
  let curY = 0;

  for (const lane of lanes) {
    const laneColor = groupColorMap.get(lane.name) ?? textColor;
    const isCollapsed = collapsedGroups.has(lane.name);
    const toggleIcon = isCollapsed ? '▶' : '▼';

    // Header label band — gantt-style: spans only the left label column.
    // Band height matches the event bar height (sBarH) instead of the full
    // row stride (rowH), leaving a small gap below — same look as gantt.
    const bandX = -margin.left + 5;
    const bandW = margin.left - 7;
    const bandY = curY;
    const bandH = sBarH;
    const sBandRx = ctx.structural(4);
    const sBandAccentW = ctx.structural(4);

    const clipId = `tl-band-clip-${tlBandClipCounter++}`;
    g.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', bandX)
      .attr('y', bandY)
      .attr('width', bandW)
      .attr('height', bandH)
      .attr('rx', sBandRx);

    g.append('rect')
      .attr('class', 'tl-group-header-bg')
      .attr('data-group', lane.name)
      .attr('x', bandX)
      .attr('y', bandY)
      .attr('width', bandW)
      .attr('height', bandH)
      .attr('rx', sBandRx)
      .attr('fill', shapeFill(palette, laneColor, isDark, { solid }))
      .style('pointer-events', 'none');

    g.append('rect')
      .attr('class', 'tl-group-header-accent')
      .attr('data-group', lane.name)
      .attr('x', bandX)
      .attr('y', bandY)
      .attr('width', sBandAccentW)
      .attr('height', bandH)
      .attr('fill', laneColor)
      .attr('clip-path', `url(#${clipId})`)
      .style('pointer-events', 'none');

    const headerG = g
      .append('g')
      .attr('class', 'tl-group-header')
      .attr('data-group', lane.name)
      .style('cursor', 'pointer')
      .on('mouseenter', () => fadeToGroup(g, lane.name))
      .on('mouseleave', () => fadeReset(g))
      .on('click', () => toggleGroup(lane.name));

    headerG
      .append('text')
      .attr('x', -margin.left + ctx.aesthetic(10))
      .attr('y', curY + sBarH / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'start')
      .attr('fill', textColor)
      .attr('font-size', `${sLaneHeaderFont}px`)
      .attr('font-weight', '600')
      .text(`${toggleIcon} ${lane.name}`);

    // Group bar in time area — spans min→max event dates, always rendered
    // (expanded and collapsed). Visually identical to gantt's group bar.
    if (lane.events.length > 0) {
      const evDates = lane.events.map((ev) => parseTimelineDate(ev.date));
      const evEndDates = lane.events
        .filter((ev) => ev.endDate)
        .map((ev) => parseTimelineDate(ev.endDate!));
      const laneMinD = Math.min(...evDates);
      const laneMaxD = Math.max(...evDates, ...evEndDates);
      const sx1 = xScale(laneMinD);
      const sx2 = xScale(laneMaxD);
      const groupBarW = Math.max(sx2 - sx1, ctx.structural(20));

      const groupBarG = g
        .append('g')
        .attr('class', isCollapsed ? 'tl-group-summary' : 'tl-group-bar')
        .attr('data-group', lane.name)
        .style('cursor', 'pointer')
        .on('mouseenter', () => fadeToGroup(g, lane.name))
        .on('mouseleave', () => fadeReset(g))
        .on('click', () => toggleGroup(lane.name));

      groupBarG
        .append('rect')
        .attr('x', sx1)
        .attr('y', curY)
        .attr('width', groupBarW)
        .attr('height', sBarH)
        .attr('rx', sBarRx)
        .attr('fill', shapeFill(palette, laneColor, isDark, { solid }))
        .attr('stroke', laneColor)
        .attr('stroke-width', sBarStroke);
    }

    if (isCollapsed) {
      curY += rowH + sGroupGap;
      continue;
    }

    lane.events.forEach((ev, i) => {
      const y = curY + (i + 1) * rowH + rowH / 2;
      const x = xScale(parseTimelineDate(ev.date));

      const evG = g
        .append('g')
        .attr('class', 'tl-event')
        .attr('data-group', lane.name)
        .attr('data-line-number', String(ev.lineNumber))
        .attr('data-date', String(parseTimelineDate(ev.date)))
        .attr(
          'data-end-date',
          ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', function (event: MouseEvent) {
          fadeToGroup(g, lane.name);
          if (timelineScale) {
            showEventDatesOnScale(
              g,
              xScale,
              ev.date,
              ev.endDate,
              innerHeight,
              laneColor
            );
          } else {
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          }
        })
        .on('mouseleave', function () {
          fadeReset(g);
          if (timelineScale) {
            hideEventDatesOnScale(g);
          } else {
            hideTooltip(tooltip);
          }
        })
        .on('mousemove', function (event: MouseEvent) {
          if (!timelineScale) {
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          }
        })
        .on('click', () => {
          if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
        });
      setTagAttrs(evG, ev);

      const evColor = eventColor(ev);

      // Left column: event label with colored bullet/diamond icon
      const isPoint = !ev.endDate;
      const icon = isPoint ? '◆' : '●';
      const labelEl = evG
        .append('text')
        .attr('class', 'tl-event-label')
        .attr('x', -margin.left + ctx.aesthetic(20))
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', `${sEventFont}px`)
        .attr('fill', textColor);
      labelEl.append('tspan').attr('fill', evColor).text(icon);
      labelEl
        .append('tspan')
        .attr('fill', textColor)
        .text(' ' + ev.label);

      // Time area: shape only (no floating label)
      if (ev.endDate) {
        const x2 = xScale(parseTimelineDate(ev.endDate));
        const rectW = Math.max(x2 - x, 4);

        let fill: string = shapeFill(palette, evColor, isDark, { solid });
        let stroke: string = evColor;
        if (ev.uncertain) {
          const gradientId = `uncertain-${ev.lineNumber}`;
          const strokeGradientId = `uncertain-s-${ev.lineNumber}`;
          const defs = svg.select('defs').node() || svg.append('defs').node();
          const defsEl = d3Selection.select(defs as Element);
          defsEl
            .append('linearGradient')
            .attr('id', gradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '100%')
            .attr('y2', '0%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', mix(evColor, bg, 30))
            .attr('stop-opacity', (d) => d.opacity);
          defsEl
            .append('linearGradient')
            .attr('id', strokeGradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '100%')
            .attr('y2', '0%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', evColor)
            .attr('stop-opacity', (d) => d.opacity);
          fill = `url(#${gradientId})`;
          stroke = `url(#${strokeGradientId})`;
        }

        evG
          .append('rect')
          .attr('x', x)
          .attr('y', y - sBarH / 2)
          .attr('width', rectW)
          .attr('height', sBarH)
          .attr('rx', sBarRx)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', sBarStroke);
      } else {
        evG
          .append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', sPointR)
          .attr('fill', shapeFill(palette, evColor, isDark, { solid }))
          .attr('stroke', evColor)
          .attr('stroke-width', sPointStroke);
      }
    });

    curY += (lane.events.length + 1) * rowH + sGroupGap;
  }
}

// ============================================================
// Timeline — vertical-orientation renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineVertical(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  exportDims: D3ExportDimensions | undefined,
  _swimlaneTagGroup: string | null | undefined,
  _activeTagGroup: string | null | undefined,
  _onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  _viewMode: boolean | undefined
): void {
  const {
    width,
    height,
    tooltip,
    solid,
    textColor,
    mutedColor,
    bgColor,
    bg,
    groupColorMap,
    tagLanes,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  } = setup;
  const { fadeToGroup, fadeToEra, fadeToMarker, fadeReset, setTagAttrs } =
    hovers;
  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineSort,
    timelineScale,
    timelineSwimlanes,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  const sPointR = ctx.structural(4);
  const sPointStroke = ctx.structural(2);
  const sBarRx = ctx.structural(4);
  const sBarStroke = ctx.structural(2);
  const sBarW = ctx.structural(12);
  const sEventFont = ctx.text(10);
  const sEventFontSm = ctx.text(11);
  const sDateFont = ctx.text(10);
  const sLaneHeaderFont = ctx.text(12);
  const sDash = `${ctx.structural(4)},${ctx.structural(4)}`;

  const useGroupedVertical =
    tagLanes != null || (timelineSort === 'group' && timelineGroups.length > 0);
  if (useGroupedVertical) {
    // === GROUPED: one column/lane per group, vertical ===
    let laneNames: string[];
    let laneEventsByName: Map<string, TimelineEvent[]>;

    if (tagLanes) {
      laneNames = tagLanes.map((l) => l.name);
      laneEventsByName = new Map(tagLanes.map((l) => [l.name, l.events]));
    } else {
      const groupNames = timelineGroups.map((gr) => gr.name);
      const ungroupedEvents = timelineEvents.filter(
        (ev) => ev.group === null || !groupNames.includes(ev.group)
      );
      laneNames =
        ungroupedEvents.length > 0 ? [...groupNames, '(Other)'] : groupNames;
      laneEventsByName = new Map(
        laneNames.map((name) => [
          name,
          timelineEvents.filter((ev) =>
            name === '(Other)'
              ? ev.group === null || !groupNames.includes(ev.group)
              : ev.group === name
          ),
        ])
      );
    }

    const laneCount = laneNames.length;
    const scaleMargin = timelineScale ? ctx.aesthetic(40) : 0;
    const markerMargin = timelineMarkers.length > 0 ? ctx.aesthetic(30) : 0;
    const margin = {
      top: ctx.aesthetic(104) + markerMargin + tagLegendReserve,
      right: ctx.aesthetic(40) + scaleMargin,
      bottom: ctx.aesthetic(40),
      left: ctx.aesthetic(60) + scaleMargin,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const laneWidth = innerWidth / laneCount;

    const yScale = d3Scale
      .scaleLinear()
      .domain([minDate - datePadding, maxDate + datePadding])
      .range([0, innerHeight]);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', exportDims ? width : '100%')
      .attr('preserveAspectRatio', 'xMidYMin meet')
      .style('background', bgColor);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    renderChartTitle(
      svg,
      title,
      parsed.titleLineNumber,
      width,
      textColor,
      onClickItem
    );

    renderEras(
      g,
      timelineEras,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (s, e) => fadeToEra(g, s, e),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    renderMarkers(
      g,
      timelineMarkers,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (d) => fadeToMarker(g, d),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    if (timelineScale) {
      renderTimeScale(
        g,
        yScale,
        true,
        innerWidth,
        innerHeight,
        textColor,
        minDate,
        maxDate,
        formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
        formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
      );
    }

    // Render swimlane backgrounds for vertical lanes
    if (timelineSwimlanes || tagLanes) {
      laneNames.forEach((laneName, laneIdx) => {
        const laneX = laneIdx * laneWidth;
        const fillColor = laneIdx % 2 === 0 ? textColor : 'transparent';
        g.append('rect')
          .attr('class', 'tl-swimlane')
          .attr('data-group', laneName)
          .attr('x', laneX)
          .attr('y', 0)
          .attr('width', laneWidth)
          .attr('height', innerHeight)
          .attr('fill', fillColor)
          .attr('opacity', 0.06);
      });
    }

    laneNames.forEach((laneName, laneIdx) => {
      const laneX = laneIdx * laneWidth;
      const laneColor = groupColorMap.get(laneName) ?? textColor;
      const laneCenter = laneX + laneWidth / 2;

      const headerG = g
        .append('g')
        .attr('class', 'tl-lane-header')
        .attr('data-group', laneName)
        .style('cursor', 'pointer')
        .on('mouseenter', () => fadeToGroup(g, laneName))
        .on('mouseleave', () => fadeReset(g));

      headerG
        .append('text')
        .attr('x', laneCenter)
        .attr('y', -ctx.structural(15))
        .attr('text-anchor', 'middle')
        .attr('fill', laneColor)
        .attr('font-size', `${sLaneHeaderFont}px`)
        .attr('font-weight', '600')
        .text(laneName);

      g.append('line')
        .attr('x1', laneCenter)
        .attr('y1', 0)
        .attr('x2', laneCenter)
        .attr('y2', innerHeight)
        .attr('stroke', mutedColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', sDash);

      const laneEvents = laneEventsByName.get(laneName) ?? [];

      for (const ev of laneEvents) {
        const y = yScale(parseTimelineDate(ev.date));
        const evG = g
          .append('g')
          .attr('class', 'tl-event')
          .attr('data-group', laneName)
          .attr('data-line-number', String(ev.lineNumber))
          .attr('data-date', String(parseTimelineDate(ev.date)))
          .attr(
            'data-end-date',
            ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
          )
          .style('cursor', 'pointer')
          .on('mouseenter', function (event: MouseEvent) {
            fadeToGroup(g, laneName);
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          })
          .on('mouseleave', function () {
            fadeReset(g);
            hideTooltip(tooltip);
          })
          .on('mousemove', function (event: MouseEvent) {
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          })
          .on('click', () => {
            if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
          });
        setTagAttrs(evG, ev);

        const evColor = eventColor(ev);

        if (ev.endDate) {
          const y2 = yScale(parseTimelineDate(ev.endDate));
          const rectH = Math.max(y2 - y, 4);

          let fill: string = shapeFill(palette, evColor, isDark, { solid });
          let stroke: string = evColor;
          if (ev.uncertain) {
            const gradientId = `uncertain-vg-${ev.lineNumber}`;
            const strokeGradientId = `uncertain-vg-s-${ev.lineNumber}`;
            const defs = svg.select('defs').node() || svg.append('defs').node();
            const defsEl = d3Selection.select(defs as Element);
            defsEl
              .append('linearGradient')
              .attr('id', gradientId)
              .attr('x1', '0%')
              .attr('y1', '0%')
              .attr('x2', '0%')
              .attr('y2', '100%')
              .selectAll('stop')
              .data([
                { offset: '0%', opacity: 1 },
                { offset: '80%', opacity: 1 },
                { offset: '100%', opacity: 0 },
              ])
              .enter()
              .append('stop')
              .attr('offset', (d) => d.offset)
              .attr('stop-color', mix(laneColor, bg, 30))
              .attr('stop-opacity', (d) => d.opacity);
            defsEl
              .append('linearGradient')
              .attr('id', strokeGradientId)
              .attr('x1', '0%')
              .attr('y1', '0%')
              .attr('x2', '0%')
              .attr('y2', '100%')
              .selectAll('stop')
              .data([
                { offset: '0%', opacity: 1 },
                { offset: '80%', opacity: 1 },
                { offset: '100%', opacity: 0 },
              ])
              .enter()
              .append('stop')
              .attr('offset', (d) => d.offset)
              .attr('stop-color', evColor)
              .attr('stop-opacity', (d) => d.opacity);
            fill = `url(#${gradientId})`;
            stroke = `url(#${strokeGradientId})`;
          }

          evG
            .append('rect')
            .attr('x', laneCenter - sBarW / 2)
            .attr('y', y)
            .attr('width', sBarW)
            .attr('height', rectH)
            .attr('rx', sBarRx)
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', sBarStroke);
          evG
            .append('text')
            .attr('x', laneCenter + sBarW + ctx.aesthetic(2))
            .attr('y', y + rectH / 2)
            .attr('dy', '0.35em')
            .attr('fill', textColor)
            .attr('font-size', `${sEventFont}px`)
            .text(ev.label);
        } else {
          evG
            .append('circle')
            .attr('cx', laneCenter)
            .attr('cy', y)
            .attr('r', sPointR)
            .attr('fill', shapeFill(palette, evColor, isDark, { solid }))
            .attr('stroke', evColor)
            .attr('stroke-width', sPointStroke);
          evG
            .append('text')
            .attr('x', laneCenter + ctx.aesthetic(10))
            .attr('y', y)
            .attr('dy', '0.35em')
            .attr('fill', textColor)
            .attr('font-size', `${sEventFont}px`)
            .text(ev.label);
        }
      }
    });
  } else {
    // === TIME SORT, vertical: single vertical axis ===
    const scaleMargin = timelineScale ? ctx.aesthetic(40) : 0;
    const markerMargin = timelineMarkers.length > 0 ? ctx.aesthetic(30) : 0;
    const margin = {
      top: ctx.aesthetic(104) + markerMargin + tagLegendReserve,
      right: ctx.aesthetic(200),
      bottom: ctx.aesthetic(40),
      left: ctx.aesthetic(60) + scaleMargin,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const axisX = ctx.structural(20);

    const yScale = d3Scale
      .scaleLinear()
      .domain([minDate - datePadding, maxDate + datePadding])
      .range([0, innerHeight]);

    const sorted = timelineEvents
      .slice()
      .sort((a, b) => parseTimelineDate(a.date) - parseTimelineDate(b.date));

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', exportDims ? width : '100%')
      .attr('preserveAspectRatio', 'xMidYMin meet')
      .style('background', bgColor);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    renderChartTitle(
      svg,
      title,
      parsed.titleLineNumber,
      width,
      textColor,
      onClickItem
    );

    renderEras(
      g,
      timelineEras,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (s, e) => fadeToEra(g, s, e),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    renderMarkers(
      g,
      timelineMarkers,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (d) => fadeToMarker(g, d),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    if (timelineScale) {
      renderTimeScale(
        g,
        yScale,
        true,
        innerWidth,
        innerHeight,
        textColor,
        minDate,
        maxDate,
        formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
        formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
      );
    }

    if (timelineGroups.length > 0) {
      renderTimelineGroupLegend(
        g,
        timelineGroups,
        groupColorMap,
        textColor,
        palette,
        isDark,
        -ctx.aesthetic(55),
        (name) => fadeToGroup(g, name),
        () => fadeReset(g)
      );
    }

    g.append('line')
      .attr('x1', axisX)
      .attr('y1', 0)
      .attr('x2', axisX)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', sDash);

    for (const ev of sorted) {
      const y = yScale(parseTimelineDate(ev.date));
      const color = eventColor(ev);

      const evG = g
        .append('g')
        .attr('class', 'tl-event')
        .attr('data-group', ev.group || '')
        .attr('data-line-number', String(ev.lineNumber))
        .attr('data-date', String(parseTimelineDate(ev.date)))
        .attr(
          'data-end-date',
          ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', function (event: MouseEvent) {
          if (ev.group && timelineGroups.length > 0) fadeToGroup(g, ev.group);
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        })
        .on('mouseleave', function () {
          fadeReset(g);
          hideTooltip(tooltip);
        })
        .on('mousemove', function (event: MouseEvent) {
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        })
        .on('click', () => {
          if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
        });
      setTagAttrs(evG, ev);

      if (ev.endDate) {
        const y2 = yScale(parseTimelineDate(ev.endDate));
        const rectH = Math.max(y2 - y, 4);

        let fill: string = shapeFill(palette, color, isDark, { solid });
        let stroke: string = color;
        if (ev.uncertain) {
          const gradientId = `uncertain-v-${ev.lineNumber}`;
          const strokeGradientId = `uncertain-v-s-${ev.lineNumber}`;
          const defs = svg.select('defs').node() || svg.append('defs').node();
          const defsEl = d3Selection.select(defs as Element);
          defsEl
            .append('linearGradient')
            .attr('id', gradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', mix(color, bg, 30))
            .attr('stop-opacity', (d) => d.opacity);
          defsEl
            .append('linearGradient')
            .attr('id', strokeGradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', color)
            .attr('stop-opacity', (d) => d.opacity);
          fill = `url(#${gradientId})`;
          stroke = `url(#${strokeGradientId})`;
        }

        evG
          .append('rect')
          .attr('x', axisX - sBarW / 2)
          .attr('y', y)
          .attr('width', sBarW)
          .attr('height', rectH)
          .attr('rx', sBarRx)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', sBarStroke);
        evG
          .append('text')
          .attr('x', axisX + sBarW + ctx.aesthetic(4))
          .attr('y', y + rectH / 2)
          .attr('dy', '0.35em')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFontSm}px`)
          .text(ev.label);
      } else {
        evG
          .append('circle')
          .attr('cx', axisX)
          .attr('cy', y)
          .attr('r', sPointR)
          .attr('fill', shapeFill(palette, color, isDark, { solid }))
          .attr('stroke', color)
          .attr('stroke-width', sPointStroke);
        evG
          .append('text')
          .attr('x', axisX + sBarW + ctx.aesthetic(4))
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFontSm}px`)
          .text(ev.label);
      }

      evG
        .append('text')
        .attr('x', axisX - ctx.aesthetic(14))
        .attr(
          'y',
          ev.endDate
            ? yScale(parseTimelineDate(ev.date)) +
                Math.max(
                  yScale(parseTimelineDate(ev.endDate)) -
                    yScale(parseTimelineDate(ev.date)),
                  4
                ) /
                  2
            : y
        )
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', mutedColor)
        .attr('font-size', `${sDateFont}px`)
        .text(ev.date + (ev.endDate ? `→${ev.endDate}` : ''));
    }
  }
}

const timelineCollapseState = new WeakMap<HTMLDivElement, Set<string>>();
let tlBandClipCounter = 0;

export function renderTimeline(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  activeTagGroup?: string | null,
  swimlaneTagGroup?: string | null,
  onTagStateChange?: (
    activeTagGroup: string | null,
    swimlaneTagGroup: string | null
  ) => void,
  viewMode?: boolean,
  exportMode?: boolean
): void {
  const setup = setupTimeline(
    container,
    parsed,
    palette,
    isDark,
    exportDims,
    activeTagGroup,
    swimlaneTagGroup
  );
  if (!setup) return;
  swimlaneTagGroup = setup.swimlaneTagGroup;

  const { isVertical, tagLanes } = setup;
  const hovers = makeTimelineHoverHelpers();

  let collapsedGroups = timelineCollapseState.get(container);
  if (!collapsedGroups) {
    collapsedGroups = new Set<string>();
    timelineCollapseState.set(container, collapsedGroups);
  }

  function toggleGroup(name: string) {
    if (collapsedGroups!.has(name)) collapsedGroups!.delete(name);
    else collapsedGroups!.add(name);
    renderTimeline(
      container,
      parsed,
      palette,
      isDark,
      onClickItem,
      exportDims,
      activeTagGroup,
      swimlaneTagGroup,
      onTagStateChange,
      viewMode,
      exportMode
    );
  }

  if (isVertical) {
    renderTimelineVertical(
      container,
      parsed,
      palette,
      isDark,
      setup,
      hovers,
      onClickItem,
      exportDims,
      swimlaneTagGroup,
      activeTagGroup,
      onTagStateChange,
      viewMode
    );
    return;
  }

  const useGroupedHorizontal =
    tagLanes != null ||
    (parsed.timelineSort !== 'time' && parsed.timelineGroups.length > 0);
  if (useGroupedHorizontal) {
    renderTimelineHorizontalGrouped(
      container,
      parsed,
      palette,
      isDark,
      setup,
      hovers,
      onClickItem,
      exportDims,
      swimlaneTagGroup,
      activeTagGroup,
      onTagStateChange,
      viewMode,
      collapsedGroups,
      toggleGroup
    );
  } else {
    renderTimelineHorizontalTimeSort(
      container,
      parsed,
      palette,
      isDark,
      setup,
      hovers,
      onClickItem,
      exportDims,
      swimlaneTagGroup,
      activeTagGroup,
      onTagStateChange,
      viewMode
    );
  }

  renderTimelineTagLegendOverlay(
    container,
    parsed,
    palette,
    isDark,
    setup,
    hovers,
    onClickItem,
    exportDims,
    swimlaneTagGroup,
    activeTagGroup,
    onTagStateChange,
    viewMode,
    exportMode
  );
}

// ============================================================
// Word Cloud Helpers
// ============================================================

function getRotateFn(mode: WordCloudRotate): () => number {
  if (mode === 'mixed') return () => (Math.random() > 0.5 ? 0 : 90);
  if (mode === 'angled') return () => Math.round(Math.random() * 30 - 15);
  return () => 0;
}

/**
 * d3-cloud rasterizes each glyph to a canvas sprite for pixel-perfect
 * collision detection. In headless Node (jsdom), `getContext('2d')` returns
 * null, so d3-cloud throws (`getImageData` on null). This detects whether a
 * usable 2D canvas exists; when it doesn't, we fall back to a canvas-free
 * spiral packer so word clouds still render in SSG (remark wrappers), the MCP
 * server, and the CLI.
 */
function hasCanvas2d(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return typeof canvas.getContext === 'function' && !!canvas.getContext('2d');
  } catch {
    return false;
  }
}

function estimateWordWidth(text: string, size: number): number {
  return measureText(text, size);
}

type PlacedCloudWord = WordCloudWord & {
  size: number;
  x: number;
  y: number;
  rotate: number;
};

/**
 * Canvas-free word-cloud layout. Places the largest words first at the centre
 * and walks an Archimedean spiral outward, using axis-aligned bounding-box
 * overlap tests (text width estimated from font metrics). Returns words in
 * placement order with `x`/`y` relative to the cloud centre — the same shape
 * d3-cloud hands to its `end` callback — so the existing draw code is reused.
 * Words that can't be placed within the box are dropped, matching d3-cloud.
 */
function layoutWordsNoCanvas(
  words: Array<WordCloudWord & { size: number }>,
  width: number,
  height: number,
  padding: number,
  rotateFn: () => number
): PlacedCloudWord[] {
  const sorted = [...words].sort((a, b) => b.size - a.size);
  const placed: Array<PlacedCloudWord & { halfW: number; halfH: number }> = [];
  const maxR = Math.sqrt(width * width + height * height) / 2;
  // Bias the spiral to the box aspect so wide clouds spread horizontally.
  const aspect = width > 0 ? height / width : 1;

  for (const w of sorted) {
    const rotate = rotateFn();
    const rawW = estimateWordWidth(w.text, w.size) + padding * 2;
    const rawH = w.size + padding * 2;
    const rad = (rotate * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const halfW = (rawW * cos + rawH * sin) / 2;
    const halfH = (rawW * sin + rawH * cos) / 2;

    let spot: { x: number; y: number } | null = null;
    for (let t = 0; t < 4000; t++) {
      const a = t * 0.25;
      const r = a * 1.4;
      if (r > maxR) break;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * aspect;
      if (
        x - halfW < -width / 2 ||
        x + halfW > width / 2 ||
        y - halfH < -height / 2 ||
        y + halfH > height / 2
      ) {
        continue;
      }
      let collides = false;
      for (const p of placed) {
        if (
          Math.abs(x - p.x) < halfW + p.halfW &&
          Math.abs(y - p.y) < halfH + p.halfH
        ) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        spot = { x, y };
        break;
      }
    }
    if (!spot) continue;
    placed.push({ ...w, rotate, x: spot.x, y: spot.y, halfW, halfH });
  }
  return placed;
}

// ============================================================
// Word Cloud Renderer
// ============================================================

/**
 * Renders a word cloud into the given container using d3-cloud.
 */
export function renderWordCloud(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { words, cloudOptions } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (words.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, colors } = init;

  const idealWidth = Math.max(400, words.length * 30);
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sTitleHeight = title ? ctx.aesthetic(40) : 0;
  const cloudHeight = height - sTitleHeight;
  const sPadding = ctx.structural(2);

  svg.attr('preserveAspectRatio', 'xMidYMid meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const { minSize, maxSize } = cloudOptions;
  const sMinSize = ctx.text(minSize);
  const sMaxSize = ctx.text(maxSize);
  const weights = words.map((w) => w.weight);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const range = maxWeight - minWeight || 1;

  const fontSize = (weight: number): number => {
    const t = (weight - minWeight) / range;
    return sMinSize + Math.sqrt(t) * (sMaxSize - sMinSize);
  };

  const rotateFn = getRotateFn(cloudOptions.rotate);

  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  const g = svg
    .append('g')
    .attr(
      'transform',
      `translate(${width / 2},${sTitleHeight + cloudHeight / 2})`
    );

  const sized = words.map((w) => ({ ...w, size: fontSize(w.weight) }));

  const draw = (
    layoutWords: Array<{
      text?: string;
      size?: number;
      x?: number;
      y?: number;
      rotate?: number;
    }>
  ): void => {
    g.selectAll('text')
      .data(layoutWords)
      .join('text')
      .style('font-size', (d) => `${d.size}px`)
      .style('font-family', FONT_FAMILY)
      .style('font-weight', '600')
      // colors is non-empty; modulo guarantees in-bounds.
      .style('fill', (_d, i) => colors[i % colors.length]!)
      .style('cursor', (d) =>
        onClickItem && (d as WordCloudWord).lineNumber ? 'pointer' : 'default'
      )
      .attr('text-anchor', 'middle')
      .attr('transform', (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
      .attr('data-line-number', (d) => {
        const ln = (d as WordCloudWord).lineNumber;
        return ln ? String(ln) : null;
      })
      .text((d) => d.text!)
      .on('click', (_event, d) => {
        const ln = (d as WordCloudWord).lineNumber;
        if (onClickItem && ln) onClickItem(ln);
      });
  };

  // No real 2D canvas (headless Node) → fall back to the spiral packer.
  if (!hasCanvas2d()) {
    draw(layoutWordsNoCanvas(sized, width, cloudHeight, sPadding, rotateFn));
    return;
  }

  cloud<WordCloudWord & cloud.Word>()
    .size([width, cloudHeight])
    .words(sized)
    .padding(sPadding)
    .rotate(rotateFn)
    .fontSize((d) => d.size!)
    .font(FONT_FAMILY)
    .on('end', draw)
    .start();
}

// ============================================================
// Word Cloud Renderer (for export — returns Promise)
// ============================================================

function renderWordCloudAsync(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  _isDark: boolean,
  exportDims?: D3ExportDimensions
): Promise<void> {
  return new Promise((resolve) => {
    d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

    const { words, cloudOptions } = parsed;
    const title = parsed.noTitle ? null : parsed.title;
    if (words.length === 0) {
      resolve();
      return;
    }

    const width = exportDims?.width ?? container.clientWidth;
    const height = exportDims?.height ?? container.clientHeight;
    if (width <= 0 || height <= 0) {
      resolve();
      return;
    }

    const titleHeight = title ? 40 : 0;
    const cloudHeight = height - titleHeight;

    const textColor = palette.text;
    const bgColor = palette.bg;
    const colors = getSeriesColors(palette);

    const { minSize, maxSize } = cloudOptions;
    const weights = words.map((w) => w.weight);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const range = maxWeight - minWeight || 1;

    const fontSize = (weight: number): number => {
      const t = (weight - minWeight) / range;
      return minSize + Math.sqrt(t) * (maxSize - minSize);
    };

    const rotateFn = getRotateFn(cloudOptions.rotate);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('background', bgColor);

    renderChartTitle(svg, title, parsed.titleLineNumber, width, textColor);

    const g = svg
      .append('g')
      .attr(
        'transform',
        `translate(${width / 2},${titleHeight + cloudHeight / 2})`
      );

    const sized = words.map((w) => ({ ...w, size: fontSize(w.weight) }));

    const draw = (
      layoutWords: Array<{
        text?: string;
        size?: number;
        x?: number;
        y?: number;
        rotate?: number;
      }>
    ): void => {
      g.selectAll('text')
        .data(layoutWords)
        .join('text')
        .style('font-size', (d) => `${d.size}px`)
        .style('font-family', FONT_FAMILY)
        .style('font-weight', '600')
        // colors is non-empty; modulo guarantees in-bounds.
        .style('fill', (_d, i) => colors[i % colors.length]!)
        .attr('text-anchor', 'middle')
        .attr(
          'transform',
          (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`
        )
        .text((d) => d.text!);
      resolve();
    };

    // No real 2D canvas (headless Node: SSG wrappers, MCP, CLI) → d3-cloud's
    // sprite rasterization can't run. Use the canvas-free spiral packer.
    if (!hasCanvas2d()) {
      draw(layoutWordsNoCanvas(sized, width, cloudHeight, 2, rotateFn));
      return;
    }

    cloud<WordCloudWord & cloud.Word>()
      .size([width, cloudHeight])
      .words(sized)
      .padding(2)
      .rotate(rotateFn)
      .fontSize((d) => d.size!)
      .font(FONT_FAMILY)
      .on('end', draw)
      .start();
  });
}

// ============================================================
// Venn Diagram Math Helpers
// ============================================================

interface Point {
  x: number;
  y: number;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

function fitCirclesToContainerAsymmetric(
  circles: Circle[],
  w: number,
  h: number,
  mLeft: number,
  mRight: number,
  mTop: number,
  mBottom: number
): Circle[] {
  if (circles.length === 0) return [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const availW = w - mLeft - mRight;
  const availH = h - mTop - mBottom;
  const scale = Math.min(availW / bw, availH / bh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tx = mLeft + availW / 2;
  const ty = mTop + availH / 2;
  return circles.map((c) => ({
    x: (c.x - cx) * scale + tx,
    y: (c.y - cy) * scale + ty,
    r: c.r * scale,
  }));
}

function pointInCircle(p: Point, c: Circle): boolean {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return dx * dx + dy * dy <= c.r * c.r + 1e-6;
}

function regionCentroid(circles: Circle[], inside: boolean[]): Point {
  // Deterministic 50×50 grid scan instead of random sampling
  const GRID = 50;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const stepX = (maxX - minX) / GRID;
  const stepY = (maxY - minY) / GRID;
  let sx = 0,
    sy = 0,
    count = 0;
  for (let gi = 0; gi <= GRID; gi++) {
    const x = minX + gi * stepX;
    for (let gj = 0; gj <= GRID; gj++) {
      const y = minY + gj * stepY;
      let match = true;
      for (let j = 0; j < circles.length; j++) {
        // In-bounds by loop guard.
        const isIn = pointInCircle({ x, y }, circles[j]!);
        if (isIn !== inside[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        sx += x;
        sy += y;
        count++;
      }
    }
  }
  if (count === 0) {
    // Fallback: centroid of the circles that should be "inside"
    let fx = 0,
      fy = 0,
      fc = 0;
    for (let j = 0; j < circles.length; j++) {
      if (inside[j]) {
        // In-bounds by loop guard.
        fx += circles[j]!.x;
        fy += circles[j]!.y;
        fc++;
      }
    }
    return { x: fx / (fc || 1), y: fy / (fc || 1) };
  }
  return { x: sx / count, y: sy / count };
}

// ============================================================
// Venn Diagram Renderer
// ============================================================

export function renderVenn(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { vennSets, vennOverlaps } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (vennSets.length < 2 || vennSets.length > 3) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, colors } = init;
  const n = vennSets.length;

  const idealWidth = n === 2 ? 500 : 600;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sTitleHeight = title ? ctx.aesthetic(40) : 0;

  svg.attr('preserveAspectRatio', 'xMidYMid meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // ── Equal-radius layout with ~30% overlap depth ──
  // All circles share the same base radius; center distance = 1.4r gives ~30% penetration
  const BASE_R = 100;
  const OVERLAP_DISTANCE = BASE_R * 1.4;

  let rawCircles: Circle[];
  if (n === 2) {
    rawCircles = [
      { x: -OVERLAP_DISTANCE / 2, y: 0, r: BASE_R },
      { x: OVERLAP_DISTANCE / 2, y: 0, r: BASE_R },
    ];
  } else {
    // Equilateral triangle with side = OVERLAP_DISTANCE
    const s = OVERLAP_DISTANCE;
    const h = (Math.sqrt(3) / 2) * s;
    rawCircles = [
      { x: -s / 2, y: h / 3, r: BASE_R },
      { x: s / 2, y: h / 3, r: BASE_R },
      { x: 0, y: -(2 * h) / 3, r: BASE_R },
    ];
  }

  // Resolve colors for each set
  const setColors = vennSets.map(
    // colors is non-empty; modulo guarantees in-bounds.
    (s, i) => s.color ?? colors[i % colors.length]!
  );

  // ── Layout-aware centering with label space ──
  const clusterCx = rawCircles.reduce((s, c) => s + c.x, 0) / n;
  const clusterCy = rawCircles.reduce((s, c) => s + c.y, 0) / n;

  let marginLeft = ctx.aesthetic(30),
    marginRight = ctx.aesthetic(30),
    marginTop = ctx.aesthetic(30),
    marginBottom = ctx.aesthetic(30);
  const stubLen = ctx.structural(20);
  const edgePad = ctx.aesthetic(8);
  const labelTextPad = ctx.aesthetic(4);

  const sSetLabelFont = ctx.text(14);

  for (let i = 0; i < n; i++) {
    // In-bounds by loop guard (n === vennSets.length === rawCircles.length).
    const estimatedWidth =
      measureText(vennSets[i]!.name, sSetLabelFont) +
      stubLen +
      edgePad +
      labelTextPad;
    const dx = rawCircles[i]!.x - clusterCx;
    const dy = rawCircles[i]!.y - clusterCy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) marginRight = Math.max(marginRight, estimatedWidth);
      else marginLeft = Math.max(marginLeft, estimatedWidth);
    } else {
      const halfEstimate = estimatedWidth * 0.5;
      if (dy >= 0)
        marginBottom = Math.max(marginBottom, halfEstimate + ctx.aesthetic(20));
      else marginTop = Math.max(marginTop, halfEstimate + ctx.aesthetic(20));
    }
  }

  // Pre-wrap overlap labels and reserve margin so circles shrink enough
  // to leave readable space outside for leader+text. Wrap target scales
  // with the canvas so labels stay narrow on small windows.
  const OVERLAP_FONT = ctx.text(13);
  const OVERLAP_LINE_H = ctx.structural(16);
  const OVERLAP_LEADER_PAD = ctx.structural(18);
  const OVERLAP_TEXT_GAP = ctx.aesthetic(6);
  const OVERLAP_MARGIN_PAD = ctx.aesthetic(12);
  const OVERLAP_WRAP_TARGET_W = Math.max(
    ctx.structural(80),
    Math.min(ctx.structural(170), width * 0.18)
  );

  function predictOverlapDirRaw(idxs: number[]): { x: number; y: number } {
    const excluded = rawCircles
      .map((_, j) => j)
      .filter((j) => !idxs.includes(j));
    if (excluded.length > 0) {
      let sx = 0,
        sy = 0;
      for (const ei of excluded) {
        // ei comes from rawCircles' index map above.
        sx += rawCircles[ei]!.x;
        sy += rawCircles[ei]!.y;
      }
      sx /= excluded.length;
      sy /= excluded.length;
      let cx = 0,
        cy = 0;
      for (const ci of idxs) {
        // ci is a valid index into rawCircles by caller's contract.
        cx += rawCircles[ci]!.x;
        cy += rawCircles[ci]!.y;
      }
      cx /= idxs.length;
      cy /= idxs.length;
      const dx = cx - sx;
      const dy = cy - sy;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m >= 1e-6) return { x: dx / m, y: dy / m };
    }
    if (n === 3) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  const wrappedOverlapLabels = new Map<VennOverlap, string[]>();
  for (const ov of vennOverlaps) {
    if (!ov.label) continue;
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((idx) => idx < 0)) continue;
    const lines = wrapTextToWidth(
      ov.label,
      OVERLAP_FONT,
      OVERLAP_WRAP_TARGET_W
    );
    wrappedOverlapLabels.set(ov, lines);

    const dir = predictOverlapDirRaw(idxs);
    const labelW = lines.reduce(
      (m, l) => Math.max(m, measureText(l, OVERLAP_FONT)),
      0
    );
    const labelH = lines.length * OVERLAP_LINE_H;
    const baseLeader =
      OVERLAP_LEADER_PAD + OVERLAP_TEXT_GAP + OVERLAP_MARGIN_PAD;

    if (Math.abs(dir.x) >= Math.abs(dir.y)) {
      const need = labelW + baseLeader;
      if (dir.x >= 0) marginRight = Math.max(marginRight, need);
      else marginLeft = Math.max(marginLeft, need);
      // Multi-line label also reaches vertically; reserve half its height
      const halfH = labelH / 2;
      if (dir.y >= 0) marginBottom = Math.max(marginBottom, halfH + 8);
      else marginTop = Math.max(marginTop, halfH + 8);
    } else {
      // Triple-overlap leader exits the union at the top circle's top
      // edge — exactly where that circle's set label gets placed when
      // it can't fit inside (small canvases). Use a longer leader pad
      // so the triple text clears the set label.
      const isStackedTriple = idxs.length === 3 && n === 3 && dir.y < 0;
      const padBoost = isStackedTriple ? 32 : 0;
      const need = labelH + baseLeader + padBoost;
      if (dir.y >= 0) marginBottom = Math.max(marginBottom, need);
      else marginTop = Math.max(marginTop, need);
    }
  }

  const drawH = height - sTitleHeight;
  // Cap margins so the figure always keeps a usable share of the canvas.
  // If labels need more space than the cap allows the leader+text logic
  // will clamp them to the viewport instead of letting circles shrink to
  // unreadable.
  const maxSideMarginX = width * 0.32;
  const maxSideMarginY = drawH * 0.4;
  marginLeft = Math.min(marginLeft, maxSideMarginX);
  marginRight = Math.min(marginRight, maxSideMarginX);
  marginTop = Math.min(marginTop, maxSideMarginY);
  marginBottom = Math.min(marginBottom, maxSideMarginY);
  const circles = fitCirclesToContainerAsymmetric(
    rawCircles,
    width,
    drawH,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom
  ).map((c) => ({ ...c, y: c.y + sTitleHeight }));

  // circles is non-empty: vennSets.length >= 2 guard above ensures rawCircles is sized.
  const scaledR = circles[0]!.r;

  // Suppress WebKit focus ring on interactive SVG elements
  svg
    .append('style')
    .text(
      'circle:focus, circle:focus-visible { outline-solid: none !important; }'
    );

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // ── Semi-transparent filled circles (non-interactive) ──
  const circleEls: d3Selection.Selection<
    SVGCircleElement,
    unknown,
    null,
    undefined
  >[] = [];
  const circleGroup = svg.append('g');
  circles.forEach((c, i) => {
    const el = circleGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      // setColors was built from vennSets via map, so i is in-bounds.
      .attr('fill', setColors[i]!)
      .attr('fill-opacity', 0.35)
      .attr('stroke', setColors[i]!)
      .attr('stroke-width', ctx.structural(2))
      .style('pointer-events', 'none') as d3Selection.Selection<
      SVGCircleElement,
      unknown,
      null,
      undefined
    >;
    circleEls.push(el);
  });

  // ── Per-region highlight overlays (section-only, not full circles) ──
  // Build SVG defs with clipPaths + masks so each region can be highlighted independently.
  const defs = svg.append('defs');

  // Individual circle clipPaths
  circles.forEach((c, i) => {
    defs
      .append('clipPath')
      .attr('id', `vcp-${i}`)
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r);
  });

  // All region index-sets: exclusive then intersection subsets
  const regionIdxSets: number[][] = circles.map((_, i) => [i]);
  if (n === 2) {
    regionIdxSets.push([0, 1]);
  } else {
    regionIdxSets.push([0, 1], [0, 2], [1, 2], [0, 1, 2]);
  }

  const overlayGroup = svg.append('g').style('pointer-events', 'none');
  const overlayEls = new Map<
    string,
    d3Selection.Selection<SVGRectElement, unknown, null, undefined>
  >();

  for (const idxs of regionIdxSets) {
    const key = idxs.join('-');
    const excluded = Array.from({ length: n }, (_, j) => j).filter(
      (j) => !idxs.includes(j)
    );

    // Build nested clipPath for intersection of all idxs
    // idxs is non-empty by construction in regionIdxSets.
    let clipId = `vcp-${idxs[0]!}`;
    for (let k = 1; k < idxs.length; k++) {
      const nestedId = `vcp-n-${idxs.slice(0, k + 1).join('-')}`;
      // k is in-bounds by loop guard.
      const ci = idxs[k]!;
      defs
        .append('clipPath')
        .attr('id', nestedId)
        .append('circle')
        // ci is a valid index into circles by caller's contract.
        .attr('cx', circles[ci]!.x)
        .attr('cy', circles[ci]!.y)
        .attr('r', circles[ci]!.r)
        .attr('clip-path', `url(#${clipId})`);
      clipId = nestedId;
    }

    // Determine line number for this region (for editor sync)
    let regionLineNumber: number | null = null; // eslint-disable-line no-useless-assignment
    if (idxs.length === 1) {
      // idxs[0] guaranteed by length check above.
      regionLineNumber = vennSets[idxs[0]!]!.lineNumber;
    } else {
      const sortedNames = idxs.map((i) => vennSets[i]!.name).sort();
      const ov = vennOverlaps.find(
        (o) =>
          o.sets.length === sortedNames.length &&
          o.sets.every((s, k) => s === sortedNames[k])
      );
      regionLineNumber = ov?.lineNumber ?? null;
    }

    const el = overlayGroup
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'white')
      .attr('fill-opacity', 0)
      .attr('class', 'venn-region-overlay')
      .attr(
        'data-line-number',
        regionLineNumber != null ? String(regionLineNumber) : '0'
      )
      .attr('clip-path', `url(#${clipId})`);

    if (excluded.length > 0) {
      // Mask subtracts excluded circles so only the exact region shape highlights
      const maskId = `vvm-${key}`;
      const mask = defs.append('mask').attr('id', maskId);
      mask
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'white');
      for (const j of excluded) {
        // excluded is built from circles' indices, so j is in-bounds.
        mask
          .append('circle')
          .attr('cx', circles[j]!.x)
          .attr('cy', circles[j]!.y)
          .attr('r', circles[j]!.r)
          .attr('fill', 'black');
      }
      el.attr('mask', `url(#${maskId})`);
    }

    overlayEls.set(key, el);
  }

  // Registry of label wrapper <g>s keyed by region (sorted idxs joined by
  // '-'), so hovering a shape can dim non-matching labels and hovering a
  // label can highlight the matching shape overlay.
  const labelEls = new Map<
    string,
    d3Selection.Selection<SVGGElement, unknown, null, undefined>[]
  >();
  function registerLabel(
    key: string,
    el: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) {
    if (!labelEls.has(key)) labelEls.set(key, []);
    labelEls.get(key)!.push(el);
  }
  function dimLabelsExcept(matchKey: string | null) {
    labelEls.forEach((els, k) => {
      const op = matchKey === null || k === matchKey ? 1 : 0.2;
      els.forEach((el) => el.attr('opacity', op));
    });
  }

  const showRegionOverlay = (idxs: number[]) => {
    const key = [...idxs].sort((a, b) => a - b).join('-');
    overlayEls.forEach((el, k) =>
      el.attr('fill-opacity', k === key ? 0 : 0.55)
    );
    dimLabelsExcept(key);
  };
  const hideAllOverlays = () => {
    overlayEls.forEach((el) => el.attr('fill-opacity', 0));
    dimLabelsExcept(null);
  };

  // ── Labels ──
  const gcx = circles.reduce((s, c) => s + c.x, 0) / n;
  const gcy = circles.reduce((s, c) => s + c.y, 0) / n;

  function exclusiveHSpan(_px: number, py: number, ci: number): number {
    // ci is in-bounds: caller passes a circle index.
    const cci = circles[ci]!;
    const dy = py - cci.y;
    const halfChord = Math.sqrt(Math.max(0, cci.r * cci.r - dy * dy));
    let left = cci.x - halfChord;
    let right = cci.x + halfChord;
    for (let j = 0; j < n; j++) {
      if (j === ci) continue;
      // In-bounds: n === circles.length.
      const cj = circles[j]!;
      const djy = py - cj.y;
      if (Math.abs(djy) >= cj.r) continue;
      const hc = Math.sqrt(cj.r * cj.r - djy * djy);
      const jLeft = cj.x - hc;
      const jRight = cj.x + hc;
      if (jLeft <= left && jRight >= right) return 0;
      if (jLeft <= left && jRight > left) left = jRight;
      if (jRight >= right && jLeft < right) right = jLeft;
    }
    return Math.max(0, right - left);
  }

  const MIN_FONT = ctx.text(10);
  const MAX_FONT = ctx.text(22);
  const INTERNAL_PAD = ctx.aesthetic(12);

  const labelGroup = svg.append('g');

  // Bboxes of rendered set labels, used to clip overlap leader lines
  // so they don't draw through the set name text.
  type Bbox = { x: number; y: number; w: number; h: number };
  const setLabelBBoxes: Array<Bbox | null> = circles.map(() => null);

  // Set name labels: prefer inside exclusive region, fall back to external leader line
  circles.forEach((c, i) => {
    // vennSets.length === circles.length by construction.
    const text = vennSets[i]!.name;
    const inside = circles.map((_, j) => j === i);
    const centroid = regionCentroid(circles, inside);

    const availW = exclusiveHSpan(centroid.x, centroid.y, i);
    // Width of `text` at fontSize 1; scale to solve for the largest fitting font.
    const textWidthPerPx = measureText(text, 1);
    const fitFont = Math.min(
      MAX_FONT,
      Math.max(MIN_FONT, (availW - INTERNAL_PAD * 2) / textWidthPerPx)
    );
    const estTextW = measureText(text, fitFont);

    const fitsInside =
      estTextW + INTERNAL_PAD * 2 < availW &&
      pointInCircle({ x: centroid.x, y: centroid.y - fitFont / 2 }, c) &&
      pointInCircle({ x: centroid.x, y: centroid.y + fitFont / 2 }, c);

    const setKey = String(i);
    const labelG = labelGroup
      .append('g')
      .style('cursor', 'default')
      .on('mouseenter', () => showRegionOverlay([i]))
      .on('mouseleave', () => hideAllOverlays());
    registerLabel(setKey, labelG);

    if (fitsInside) {
      labelG
        .append('text')
        .attr('x', centroid.x)
        .attr('y', centroid.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', `${Math.round(fitFont)}px`)
        .attr('font-weight', 'bold')
        .text(text);
      setLabelBBoxes[i] = {
        x: centroid.x - estTextW / 2,
        y: centroid.y - fitFont / 2,
        w: estTextW,
        h: fitFont,
      };
    } else {
      let dx = c.x - gcx;
      let dy = c.y - gcy;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag < 1e-6) {
        dx = 1;
        dy = 0;
      } else {
        dx /= mag;
        dy /= mag;
      }

      const exitX = c.x + dx * c.r;
      const exitY = c.y + dy * c.r;
      const edgeX = exitX + dx * edgePad;
      const edgeY = exitY + dy * edgePad;
      const stubEndX = edgeX + dx * stubLen;
      const stubEndY = edgeY + dy * stubLen;

      labelG
        .append('line')
        .attr('x1', edgeX)
        .attr('y1', edgeY)
        .attr('x2', stubEndX)
        .attr('y2', stubEndY)
        .attr('stroke', textColor)
        .attr('stroke-width', ctx.structural(1));

      const isRight = stubEndX >= gcx;
      const textAnchor = isRight ? 'start' : 'end';
      let textX = stubEndX + (isRight ? labelTextPad : -labelTextPad);
      const textY = stubEndY;
      const estW = measureText(text, sSetLabelFont);
      if (isRight) textX = Math.min(textX, width - estW - 4);
      else textX = Math.max(textX, estW + 4);

      const renderedTextY = Math.max(
        sSetLabelFont,
        Math.min(height - 4, textY)
      );
      labelG
        .append('text')
        .attr('x', textX)
        .attr('y', renderedTextY)
        .attr('text-anchor', textAnchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', `${sSetLabelFont}px`)
        .attr('font-weight', 'bold')
        .text(text);
      const externalEstW = measureText(text, sSetLabelFont);
      setLabelBBoxes[i] = {
        x: isRight ? textX : textX - externalEstW,
        y: renderedTextY - sSetLabelFont / 2,
        w: externalEstW,
        h: sSetLabelFont,
      };
    }
  });

  // Splits a line into visible segments that skip any of the given rects
  // (with optional padding). Used so overlap leaders don't draw through
  // set name text.
  function clipLineByRects(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rects: Bbox[],
    pad = 4
  ): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const skips: Array<[number, number]> = [];
    for (const raw of rects) {
      const rx = raw.x - pad;
      const ry = raw.y - pad;
      const rw = raw.w + 2 * pad;
      const rh = raw.h + 2 * pad;
      let tMin = 0;
      let tMax = 1;
      if (Math.abs(dx) < 1e-9) {
        if (x1 < rx || x1 > rx + rw) continue;
      } else {
        const t1 = (rx - x1) / dx;
        const t2 = (rx + rw - x1) / dx;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (Math.abs(dy) < 1e-9) {
        if (y1 < ry || y1 > ry + rh) continue;
      } else {
        const t1 = (ry - y1) / dy;
        const t2 = (ry + rh - y1) / dy;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (tMin < tMax) skips.push([Math.max(0, tMin), Math.min(1, tMax)]);
    }
    skips.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const s of skips) {
      const last = merged[merged.length - 1];
      if (!last || s[0] > last[1]) merged.push([s[0], s[1]]);
      else last[1] = Math.max(last[1], s[1]);
    }
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let cursor = 0;
    for (const [s, e] of merged) {
      if (s > cursor)
        segs.push({
          x1: x1 + dx * cursor,
          y1: y1 + dy * cursor,
          x2: x1 + dx * s,
          y2: y1 + dy * s,
        });
      cursor = Math.max(cursor, e);
    }
    if (cursor < 1)
      segs.push({
        x1: x1 + dx * cursor,
        y1: y1 + dy * cursor,
        x2: x2,
        y2: y2,
      });
    return segs;
  }

  // ── Overlap labels (leader line from region centroid to outside the region) ──
  function overlapOutwardDir(centroid: Point, idxs: number[]): Point {
    const excluded = circles.map((_, j) => j).filter((j) => !idxs.includes(j));
    if (excluded.length > 0) {
      let sx = 0,
        sy = 0;
      for (const ei of excluded) {
        // excluded was built from circles' indices.
        sx += circles[ei]!.x;
        sy += circles[ei]!.y;
      }
      sx /= excluded.length;
      sy /= excluded.length;
      const dx = centroid.x - sx;
      const dy = centroid.y - sy;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m >= 1e-6) {
        // Snap floating-point noise to 0 so axis-aligned checks downstream work.
        const nx = Math.abs(dx / m) < 1e-9 ? 0 : dx / m;
        const ny = Math.abs(dy / m) < 1e-9 ? 0 : dy / m;
        return { x: nx, y: ny };
      }
    }
    // Triple overlap in 3-set Venn: point up so the leader doesn't
    // collide with the pair (0,1) leader going down.
    if (n === 3) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  // Where the ray (c0, dir) crosses the lens boundary — the first idxs
  // circle it leaves. This is the visual touch point for pair leaders.
  function lensExit(c0: Point, dir: Point, idxs: number[]): Point {
    let minT = Infinity;
    for (const i of idxs) {
      // idxs only contains valid circle indices (built from regionIdxSets).
      const c = circles[i]!;
      const dx = c0.x - c.x;
      const dy = c0.y - c.y;
      const B = dx * dir.x + dy * dir.y;
      const C = dx * dx + dy * dy - c.r * c.r;
      const disc = B * B - C;
      if (disc < 0) continue;
      const t = -B + Math.sqrt(disc);
      if (t > 0 && t < minT) minT = t;
    }
    if (!isFinite(minT)) return { x: c0.x, y: c0.y };
    return { x: c0.x + dir.x * minT, y: c0.y + dir.y * minT };
  }

  // Where the ray clears the union's visual silhouette — used to position
  // text (and the stub end) so they don't overlap any circle. Walks until
  // outside every circle and, for axis-aligned leaders, also past the
  // union's bounding box on the travel axis.
  function unionExit(c0: Point, dir: Point, idxs: number[]): Point {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const c of circles) {
      minX = Math.min(minX, c.x - c.r);
      maxX = Math.max(maxX, c.x + c.r);
      minY = Math.min(minY, c.y - c.r);
      maxY = Math.max(maxY, c.y + c.r);
    }
    const STEP = 3;
    const MAX_ITERS = 400;
    const axisAligned = dir.x === 0 || dir.y === 0;
    let p = { x: c0.x, y: c0.y };
    let leftOverlap = false;
    for (let i = 0; i < MAX_ITERS; i++) {
      const next = { x: p.x + dir.x * STEP, y: p.y + dir.y * STEP };
      p = next;
      if (!leftOverlap) {
        // ci is a valid circle index by caller's contract.
        leftOverlap = !idxs.every((ci) => pointInCircle(next, circles[ci]!));
        if (!leftOverlap) continue;
      }
      const insideAny = circles.some((c) => pointInCircle(next, c));
      if (insideAny) continue;
      if (axisAligned) {
        const passedX = dir.x > 0 ? next.x >= maxX : next.x <= minX;
        const passedY = dir.y > 0 ? next.y >= maxY : next.y <= minY;
        if (dir.x !== 0 && !passedX) continue;
        if (dir.y !== 0 && !passedY) continue;
      }
      break;
    }
    return p;
  }

  for (const ov of vennOverlaps) {
    if (!ov.label) continue;
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((idx) => idx < 0)) continue;
    const lines = wrappedOverlapLabels.get(ov) ?? [ov.label];
    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    const dir = overlapOutwardDir(centroid, idxs);
    const isTriple = idxs.length === 3 && n === 3;
    const padBoost = isTriple && dir.y < 0 ? 32 : 0;
    const leaderPad = OVERLAP_LEADER_PAD + padBoost;
    // Pair leaders touch the lens exactly; stub end sits past the union
    // silhouette so text doesn't overlap circles.
    const lensPt = lensExit(centroid, dir, idxs);
    const farExit = unionExit(centroid, dir, idxs);
    const stubEndX = farExit.x + dir.x * leaderPad;
    const stubEndY = farExit.y + dir.y * leaderPad;

    const horizontal = Math.abs(dir.x) >= Math.abs(dir.y);
    let textAnchor: string;
    let baseline = 'central';
    if (horizontal) {
      textAnchor = dir.x >= 0 ? 'start' : 'end';
    } else {
      textAnchor = 'middle';
      baseline = dir.y >= 0 ? 'hanging' : 'auto';
    }

    // For horizontal-dominated leaders, offset text only horizontally and
    // align it vertically with the leader endpoint — otherwise multi-line
    // text blocks engulf the leader's tip. Mirror logic for vertical.
    let textX: number, textY: number;
    if (horizontal) {
      const sign = dir.x >= 0 ? 1 : -1;
      textX = stubEndX + sign * OVERLAP_TEXT_GAP;
      textY = stubEndY;
    } else {
      const sign = dir.y >= 0 ? 1 : -1;
      textX = stubEndX;
      textY = stubEndY + sign * OVERLAP_TEXT_GAP;
    }

    const blockW = lines.reduce(
      (m, l) => Math.max(m, measureText(l, OVERLAP_FONT)),
      0
    );
    const blockH = lines.length * OVERLAP_LINE_H;

    if (textAnchor === 'start') textX = Math.min(textX, width - blockW - 4);
    else if (textAnchor === 'end') textX = Math.max(textX, blockW + 4);
    else
      textX = Math.max(blockW / 2 + 4, Math.min(width - blockW / 2 - 4, textX));

    let topY: number, bottomY: number;
    if (baseline === 'hanging') {
      topY = textY;
      bottomY = textY + blockH;
    } else if (baseline === 'auto') {
      bottomY = textY;
      topY = textY - blockH;
    } else {
      topY = textY - blockH / 2;
      bottomY = textY + blockH / 2;
    }
    if (topY < sTitleHeight + 6) textY += sTitleHeight + 6 - topY;
    else if (bottomY > height - 4) textY -= bottomY - (height - 4);

    const startY =
      baseline === 'hanging'
        ? textY
        : baseline === 'auto'
          ? textY - (lines.length - 1) * OVERLAP_LINE_H
          : textY - ((lines.length - 1) * OVERLAP_LINE_H) / 2;

    // Triple leader runs from the centroid (through the diagram) to the
    // text — preserved per the user's "leave the triple alone" request.
    // Pair leaders start exactly on the lens boundary (analytic), so the
    // line touches the shape it describes.
    const leaderStartX = isTriple ? centroid.x : lensPt.x;
    const leaderStartY = isTriple ? centroid.y : lensPt.y;

    // Tint the leader + text with the average of the constituent set
    // colors so the label visually ties to its overlap region. Mix a bit
    // of the body text color in to keep contrast against the bg.
    // idxs is non-empty; its entries are valid indices into setColors (same length as vennSets).
    let tinted = setColors[idxs[0]!]!;
    for (let k = 1; k < idxs.length; k++) {
      const pct = (k / (k + 1)) * 100;
      // k in-bounds by loop; idxs[k] is a valid setColors index.
      tinted = mix(tinted, setColors[idxs[k]!]!, pct);
    }
    const overlapColor = mix(tinted, textColor, 90);

    const ovKey = [...idxs].sort((a, b) => a - b).join('-');
    const ovLabelG = labelGroup
      .append('g')
      .style('cursor', 'default')
      .on('mouseenter', () => showRegionOverlay(idxs))
      .on('mouseleave', () => hideAllOverlays());
    registerLabel(ovKey, ovLabelG);

    const labelRects = setLabelBBoxes.filter((b): b is Bbox => b !== null);
    const segments = clipLineByRects(
      leaderStartX,
      leaderStartY,
      stubEndX,
      stubEndY,
      labelRects,
      4
    );
    for (const seg of segments) {
      ovLabelG
        .append('line')
        .attr('x1', seg.x1)
        .attr('y1', seg.y1)
        .attr('x2', seg.x2)
        .attr('y2', seg.y2)
        .attr('stroke', overlapColor)
        .attr('stroke-width', ctx.structural(1.25))
        .attr('opacity', 0.85);
    }

    const textEl = ovLabelG
      .append('text')
      .attr('text-anchor', textAnchor)
      .attr('dominant-baseline', baseline)
      .attr('fill', overlapColor)
      .attr('font-size', `${OVERLAP_FONT}px`)
      .attr('font-weight', '600');

    lines.forEach((line, i) => {
      const tspan = textEl.append('tspan').attr('x', textX);
      if (i === 0) tspan.attr('y', startY);
      else tspan.attr('dy', OVERLAP_LINE_H);
      tspan.text(line);
    });
  }

  // ── Hover targets ──
  // Exclusive circle targets first (lower z-order), then intersection targets (higher z-order)
  const hoverGroup = svg.append('g');

  circles.forEach((c, i) => {
    hoverGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .attr('class', 'venn-hit-target')
      // vennSets[i] in-bounds: circles.length === vennSets.length.
      .attr('data-line-number', String(vennSets[i]!.lineNumber))
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .style('outline-solid', 'none')
      .on('mouseenter', () => {
        showRegionOverlay([i]);
      })
      .on('mouseleave', () => {
        hideAllOverlays();
      })
      .on('click', function () {
        (this as SVGElement).blur?.();
        if (onClickItem && vennSets[i]!.lineNumber)
          onClickItem(vennSets[i]!.lineNumber);
      });
  });

  // Intersection targets: centroid-based circles for all overlap regions (declared + undeclared)
  const overlayR = scaledR * 0.35;

  const subsets: { idxs: number[]; sets: string[] }[] = [];
  if (n === 2) {
    // n === 2 ⇒ vennSets has at least 2 entries.
    subsets.push({
      idxs: [0, 1],
      sets: [vennSets[0]!.name, vennSets[1]!.name].sort(),
    });
  } else {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        // a and b are valid vennSets indices (n === vennSets.length).
        subsets.push({
          idxs: [a, b],
          sets: [vennSets[a]!.name, vennSets[b]!.name].sort(),
        });
      }
    }
    // n === 3 path ⇒ vennSets has 3 entries.
    subsets.push({
      idxs: [0, 1, 2],
      sets: [vennSets[0]!.name, vennSets[1]!.name, vennSets[2]!.name].sort(),
    });
  }

  for (const subset of subsets) {
    const { idxs, sets } = subset;
    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    const declaredOv = vennOverlaps.find(
      (ov) =>
        ov.sets.length === sets.length && ov.sets.every((s, k) => s === sets[k])
    );
    hoverGroup
      .append('circle')
      .attr('cx', centroid.x)
      .attr('cy', centroid.y)
      .attr('r', overlayR)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .attr('class', 'venn-hit-target')
      .attr('data-line-number', declaredOv ? String(declaredOv.lineNumber) : '')
      .style('cursor', onClickItem && declaredOv ? 'pointer' : 'default')
      .style('outline-solid', 'none')
      .on('mouseenter', () => {
        showRegionOverlay(idxs);
      })
      .on('mouseleave', () => {
        hideAllOverlays();
      })
      .on('click', function () {
        (this as SVGElement).blur?.();
        if (onClickItem && declaredOv) onClickItem(declaredOv.lineNumber);
      });
  }
}

// ============================================================
// Quadrant Chart Renderer
// ============================================================

type QuadrantPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-left'
  | 'bottom-right';

/**
 * Renders a quadrant chart using D3.
 * Displays 4 colored quadrant regions, axis labels, quadrant labels, and data points.
 */
export function renderQuadrant(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const {
    quadrantLabels,
    quadrantPoints,
    quadrantXAxis,
    quadrantYAxis,
    quadrantTitleLineNumber,
    quadrantXAxisLineNumber,
    quadrantYAxisLineNumber,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  if (quadrantPoints.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor } = init;
  const borderColor = palette.border;

  const idealWidth = 600;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  svg.attr('preserveAspectRatio', 'xMidYMid meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const defaultColors = [
    palette.colors.blue,
    palette.colors.green,
    palette.colors.yellow,
    palette.colors.purple,
  ];

  const hasXAxis = !!quadrantXAxis;
  const hasYAxis = !!quadrantYAxis;
  const margin = {
    top: title ? ctx.aesthetic(60) : ctx.aesthetic(30),
    right: ctx.aesthetic(30),
    bottom: hasXAxis ? ctx.aesthetic(70) : ctx.aesthetic(40),
    left: hasYAxis ? ctx.aesthetic(80) : ctx.aesthetic(40),
  };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  // Scales: data uses 0-1 range
  const xScale = d3Scale.scaleLinear().domain([0, 1]).range([0, chartWidth]);
  const yScale = d3Scale.scaleLinear().domain([0, 1]).range([chartHeight, 0]);

  // Title
  renderChartTitle(
    svg,
    title,
    quadrantTitleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Chart group (translated by margins)
  const chartG = svg
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  const bg = isDark ? palette.surface : palette.bg;

  // Full palette color for a quadrant (used for border and label tinting)
  const getQuadrantColor = (
    label: QuadrantLabel | null,
    defaultIdx: number
  ): string => {
    // defaultColors is non-empty; modulo guarantees in-bounds.
    return label?.color ?? defaultColors[defaultIdx % defaultColors.length]!;
  };

  // Muted fill: palette color blended 30% toward bg — matches other chart fill style
  const getQuadrantFill = (
    label: QuadrantLabel | null,
    defaultIdx: number
  ): string => {
    return mix(getQuadrantColor(label, defaultIdx), bg, 30);
  };

  // Quadrant definitions: position, rect bounds, label position
  const quadrantDefs: {
    position: QuadrantPosition;
    x: number;
    y: number;
    w: number;
    h: number;
    labelX: number;
    labelY: number;
    label: QuadrantLabel | null;
    colorIdx: number;
  }[] = [
    {
      position: 'top-left',
      x: 0,
      y: 0,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: chartWidth / 4,
      labelY: chartHeight / 4,
      label: quadrantLabels.topLeft,
      colorIdx: 1, // green
    },
    {
      position: 'top-right',
      x: chartWidth / 2,
      y: 0,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: (chartWidth * 3) / 4,
      labelY: chartHeight / 4,
      label: quadrantLabels.topRight,
      colorIdx: 0, // blue
    },
    {
      position: 'bottom-left',
      x: 0,
      y: chartHeight / 2,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: chartWidth / 4,
      labelY: (chartHeight * 3) / 4,
      label: quadrantLabels.bottomLeft,
      colorIdx: 2, // yellow
    },
    {
      position: 'bottom-right',
      x: chartWidth / 2,
      y: chartHeight / 2,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: (chartWidth * 3) / 4,
      labelY: (chartHeight * 3) / 4,
      label: quadrantLabels.bottomRight,
      colorIdx: 3, // purple
    },
  ];

  // Draw quadrant rectangles
  const quadrantRects = chartG
    .selectAll('rect.quadrant')
    .data(quadrantDefs)
    .enter()
    .append('rect')
    .attr('class', 'quadrant')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .attr('width', (d) => d.w)
    .attr('height', (d) => d.h)
    .attr('fill', (d) => getQuadrantFill(d.label, d.colorIdx))
    .attr('stroke', (d) => getQuadrantColor(d.label, d.colorIdx))
    .attr('stroke-width', ctx.structural(2));

  // White text for points; quadrant labels use a muted text color (consistent across all quadrants)
  const shadowColor = 'rgba(0,0,0,0.4)';

  // Single muted shade of textColor — watermark-style, readable against any quadrant fill
  const quadrantLabelColor = mix(textColor, bg, 35);

  // Scale label font size to fit within quadrant bounds, wrapping into multiple lines if needed
  const LABEL_MAX_FONT = ctx.text(48);
  const LABEL_MIN_FONT = ctx.text(14);
  const LABEL_PAD = ctx.aesthetic(40);

  interface QuadrantLabelLayout {
    lines: string[];
    fontSize: number;
  }

  const quadrantLabelLayout = (
    text: string,
    qw: number,
    qh: number
  ): QuadrantLabelLayout => {
    const availW = qw - LABEL_PAD;
    const availH = qh - LABEL_PAD;

    // Try single line first
    if (measureText(text, LABEL_MAX_FONT) <= availW) {
      const fs = Math.min(LABEL_MAX_FONT, availH);
      return {
        lines: [text],
        fontSize: Math.max(LABEL_MIN_FONT, Math.round(fs)),
      };
    }

    // Try wrapping into 2+ lines: greedily pack words so each line fits availW
    const wrapLines = (fs: number): string[] =>
      wrapTextToWidth(text, fs, availW);

    // Binary-search for largest font size where wrapped text fits both width and height
    let lo = LABEL_MIN_FONT;
    let hi = LABEL_MAX_FONT;
    let bestLines = wrapLines(lo);
    let bestFs = lo;
    while (lo <= hi) {
      const mid = Math.round((lo + hi) / 2);
      const lines = wrapLines(mid);
      const totalH = lines.length * mid * 1.2; // line height ~1.2em
      const maxLineW = Math.max(...lines.map((l) => measureText(l, mid)));
      if (maxLineW <= availW && totalH <= availH) {
        bestFs = mid;
        bestLines = lines;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { lines: bestLines, fontSize: Math.max(LABEL_MIN_FONT, bestFs) };
  };

  // Draw quadrant labels (large, centered, darkened shade of fill — recedes behind points)
  // Pre-compute layout (lines + font size) for each quadrant label
  const qw = chartWidth / 2;
  const qh = chartHeight / 2;
  const quadrantDefsWithLabel = quadrantDefs.filter((d) => d.label !== null);
  const labelLayouts = new Map(
    quadrantDefsWithLabel.map((d) => [
      d.label!.text,
      quadrantLabelLayout(d.label!.text, qw, qh),
    ])
  );

  // Renders the original watermark content (quadrant name) into a text element.
  // Extracted so point hover can swap it for a hover state and restore on leave.
  const renderWatermarkOriginal = (
    textEl: SVGTextElement,
    d: (typeof quadrantDefsWithLabel)[number]
  ) => {
    const layout = labelLayouts.get(d.label!.text)!;
    const el = d3Selection.select(textEl);
    el.text(null)
      .attr('font-size', `${layout.fontSize}px`)
      .attr('font-weight', '700');
    if (layout.lines.length === 1) {
      // In-bounds by length === 1 check.
      el.text(layout.lines[0]!);
    } else {
      const lineH = layout.fontSize * 1.2;
      const totalH = layout.lines.length * lineH;
      const startY = -totalH / 2 + lineH / 2;
      layout.lines.forEach((line, i) => {
        el.append('tspan')
          .attr('x', d.labelX)
          .attr('dy', i === 0 ? `${startY}px` : `${lineH}px`)
          .text(line);
      });
    }
  };

  const quadrantLabelTexts = chartG
    .selectAll('text.quadrant-label')
    .data(quadrantDefsWithLabel)
    .enter()
    .append('text')
    .attr('class', 'quadrant-label')
    .attr('x', (d) => d.labelX)
    .attr('y', (d) => d.labelY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', quadrantLabelColor)
    .attr('data-line-number', (d) =>
      d.label?.lineNumber ? String(d.label.lineNumber) : null
    )
    .style('cursor', (d) =>
      onClickItem && d.label?.lineNumber ? 'pointer' : 'default'
    )
    .each(function (d) {
      renderWatermarkOriginal(this as SVGTextElement, d);
    });

  if (onClickItem) {
    quadrantLabelTexts
      .on('click', (_, d) => {
        if (d.label?.lineNumber) onClickItem(d.label.lineNumber);
      })
      .on('mouseenter', function () {
        d3Selection.select(this).attr('opacity', 0.7);
      })
      .on('mouseleave', function () {
        d3Selection.select(this).attr('opacity', 1);
      });
  }

  const sAxisFont = ctx.text(18);
  const sAxisPad = ctx.aesthetic(20);
  const sAxisX = ctx.aesthetic(22);

  if (quadrantXAxis) {
    const xLowLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', margin.left + chartWidth / 4)
      .attr('y', height - sAxisPad)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr(
        'data-line-number',
        quadrantXAxisLineNumber ? String(quadrantXAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[0]);

    // High label (centered on right half)
    const xHighLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', margin.left + (chartWidth * 3) / 4)
      .attr('y', height - sAxisPad)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr(
        'data-line-number',
        quadrantXAxisLineNumber ? String(quadrantXAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[1]);

    if (onClickItem && quadrantXAxisLineNumber) {
      [xLowLabel, xHighLabel].forEach((label) => {
        label
          .on('click', () => onClickItem(quadrantXAxisLineNumber))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      });
    }
  }

  // Y-axis labels — centered on top/bottom halves
  if (quadrantYAxis) {
    const yMidBottom = margin.top + (chartHeight * 3) / 4;
    const yMidTop = margin.top + chartHeight / 4;

    // Low label (centered on bottom half)
    const yLowLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', sAxisX)
      .attr('y', yMidBottom)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr('transform', `rotate(-90, ${sAxisX}, ${yMidBottom})`)
      .attr(
        'data-line-number',
        quadrantYAxisLineNumber ? String(quadrantYAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[0]);

    // High label (centered on top half)
    const yHighLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', sAxisX)
      .attr('y', yMidTop)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', `${sAxisFont}px`)
      .attr('transform', `rotate(-90, ${sAxisX}, ${yMidTop})`)
      .attr(
        'data-line-number',
        quadrantYAxisLineNumber ? String(quadrantYAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[1]);

    if (onClickItem && quadrantYAxisLineNumber) {
      [yLowLabel, yHighLabel].forEach((label) => {
        label
          .on('click', () => onClickItem(quadrantYAxisLineNumber))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      });
    }
  }

  // Draw center cross lines
  chartG
    .append('line')
    .attr('x1', chartWidth / 2)
    .attr('y1', 0)
    .attr('x2', chartWidth / 2)
    .attr('y2', chartHeight)
    .attr('stroke', borderColor)
    .attr('stroke-width', 1);

  chartG
    .append('line')
    .attr('x1', 0)
    .attr('y1', chartHeight / 2)
    .attr('x2', chartWidth)
    .attr('y2', chartHeight / 2)
    .attr('stroke', borderColor)
    .attr('stroke-width', 1);

  // Get which quadrant a point belongs to
  const getPointQuadrant = (x: number, y: number): QuadrantPosition => {
    if (x >= 0.5 && y >= 0.5) return 'top-right';
    if (x < 0.5 && y >= 0.5) return 'top-left';
    if (x < 0.5 && y < 0.5) return 'bottom-left';
    return 'bottom-right';
  };

  // Build obstacle rects from quadrant watermark labels for collision avoidance
  const POINT_RADIUS = ctx.structural(6);
  const POINT_LABEL_FONT_SIZE = ctx.text(12);
  const quadrantLabelObstacles: LabelRect[] = quadrantDefsWithLabel.map((d) => {
    const layout = labelLayouts.get(d.label!.text)!;
    const totalW = Math.max(
      ...layout.lines.map((l) => measureText(l, layout.fontSize))
    );
    const totalH = layout.lines.length * layout.fontSize * 1.2;
    return {
      x: d.labelX - totalW / 2,
      y: d.labelY - totalH / 2,
      w: totalW,
      h: totalH,
    };
  });

  // Compute collision-free label positions for all points
  const pointPixels = quadrantPoints.map((point) => ({
    label: point.label,
    cx: xScale(point.x),
    cy: yScale(point.y),
  }));

  const placedPointLabels = computeQuadrantPointLabels(
    pointPixels,
    { left: 0, top: 0, right: chartWidth, bottom: chartHeight },
    quadrantLabelObstacles,
    POINT_RADIUS,
    POINT_LABEL_FONT_SIZE
  );

  // Draw data points (circles and labels)
  const pointsG = chartG.append('g').attr('class', 'points');

  quadrantPoints.forEach((point, i) => {
    const cx = xScale(point.x);
    const cy = yScale(point.y);
    const quadrant = getPointQuadrant(point.x, point.y);
    const quadDef = quadrantDefs.find((d) => d.position === quadrant);
    // defaultColors is non-empty; in-bounds by modulo / fallback to index 0.
    const pointColor =
      quadDef?.label?.color ?? defaultColors[quadDef?.colorIdx ?? 0]!;
    // placedPointLabels was produced by computeQuadrantPointLabels from pointPixels,
    // which has the same length as quadrantPoints.
    const placed = placedPointLabels[i]!;

    const pointG = pointsG
      .append('g')
      .attr('class', 'point-group')
      .attr('data-line-number', String(point.lineNumber));

    // Connector line (drawn first so it renders behind circle and label)
    if (placed.connectorLine) {
      pointG
        .append('line')
        .attr('x1', placed.connectorLine.x1)
        .attr('y1', placed.connectorLine.y1)
        .attr('x2', placed.connectorLine.x2)
        .attr('y2', placed.connectorLine.y2)
        .attr('stroke', pointColor)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5);
    }

    // Circle with white fill and colored border for visibility on opaque quadrants
    pointG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', POINT_RADIUS)
      .attr('fill', '#ffffff')
      .attr('stroke', pointColor)
      .attr('stroke-width', ctx.structural(2));

    // Label at computed position. Name is always shown; coords sit below
    // (smaller, lighter weight) and only appear on hover.
    const labelText = pointG
      .append('text')
      .attr('x', placed.x)
      .attr('y', placed.y)
      .attr('text-anchor', placed.anchor)
      .attr('dominant-baseline', 'central')
      .attr('fill', textColor)
      .attr('font-size', `${POINT_LABEL_FONT_SIZE}px`)
      .attr('font-weight', '700')
      .style('text-shadow', `0 1px 2px ${shadowColor}`)
      .style('transition', 'y 120ms ease-out');

    labelText.append('tspan').text(point.label);

    const coordsTspan = labelText
      .append('tspan')
      .attr('class', 'point-coords')
      .attr('x', placed.x)
      .attr('dy', `${POINT_LABEL_FONT_SIZE}px`)
      .attr('font-size', `${ctx.text(10)}px`)
      .attr('font-weight', '500')
      .attr('opacity', 0)
      .text(`${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);

    const COORDS_LINE_H = ctx.structural(14);
    const bumpDy = placed.y < cy ? -COORDS_LINE_H : COORDS_LINE_H;

    pointG
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', () => {
        pointG.select('circle').attr('r', ctx.structural(8));
        labelText.attr('y', placed.y + bumpDy);
        coordsTspan.attr('opacity', 1);
        quadrantRects.attr('opacity', (qd) =>
          qd.position === quadrant ? 1 : 0.3
        );
        quadrantLabelTexts.attr('opacity', (qd) =>
          qd.position === quadrant ? 1 : 0.3
        );
        pointsG
          .selectAll<SVGGElement, unknown>('g.point-group')
          .filter((_, j) => j !== i)
          .attr('opacity', 0.3);
      })
      .on('mouseleave', () => {
        pointG.select('circle').attr('r', POINT_RADIUS);
        labelText.attr('y', placed.y);
        coordsTspan.attr('opacity', 0);
        quadrantRects.attr('opacity', 1);
        quadrantLabelTexts.attr('opacity', 1);
        pointsG.selectAll('g.point-group').attr('opacity', 1);
      })
      .on('click', () => {
        if (onClickItem && point.lineNumber) onClickItem(point.lineNumber);
      });
  });

  // Quadrant highlighting on hover and click-to-navigate
  quadrantRects
    .style('cursor', onClickItem ? 'pointer' : 'default')
    .on('mouseenter', function (_, d) {
      // Dim other quadrants
      quadrantRects.attr('opacity', (qd) =>
        qd.position === d.position ? 1 : 0.3
      );
      quadrantLabelTexts.attr('opacity', (qd) =>
        qd.position === d.position ? 1 : 0.3
      );
      // Dim points not in this quadrant
      pointsG.selectAll('g.point-group').each(function (_, i) {
        // selectAll iterates over point-group elements, so i indexes into quadrantPoints.
        const pt = quadrantPoints[i]!;
        const ptQuad = getPointQuadrant(pt.x, pt.y);
        d3Selection
          .select(this)
          .attr('opacity', ptQuad === d.position ? 1 : 0.2);
      });
    })
    .on('mouseleave', () => {
      quadrantRects.attr('opacity', 1);
      quadrantLabelTexts.attr('opacity', 1);
      pointsG.selectAll('g.point-group').attr('opacity', 1);
    })
    .on('click', (_, d) => {
      // Navigate to the quadrant label's line in the source
      if (onClickItem && d.label?.lineNumber) {
        onClickItem(d.label.lineNumber);
      }
    });
}

// ============================================================
// Export Renderer
// ============================================================

/**
 * Renders a D3 chart to an SVG string for export.
 * Creates a detached DOM element, renders into it, extracts the SVG, then cleans up.
 */
type RenderForExportOptions = {
  c4Level?: 'context' | 'containers' | 'components' | 'deployment';
  c4System?: string;
  c4Container?: string;
  tagGroup?: string;
  exportMode?: boolean;
  // Browser callers (the app / Obsidian) bundle the map JSON and inject it
  // here — the Node fs `loadMapData()` seam can't run in a browser. CLI/SSR
  // omit this and fall back to the fs loader.
  mapData?: import('./map/resolved-types').MapData;
  // WYSIWYG map export: the live preview pane's displayed aspect (w/h). When
  // set, the map canvas adopts it + stretch-fills so the PNG matches the
  // on-screen map. The app passes this; headless consumers omit it.
  mapAspect?: number;
};

/** Everything an export handler needs — one bundle threaded through dispatch. */
interface ExportContext {
  content: string;
  theme: 'light' | 'dark' | 'transparent';
  palette: PaletteColors | undefined;
  viewState: import('./sharing').CompactViewState | undefined;
  options: RenderForExportOptions | undefined;
  exportMode: boolean;
}

type DiagramExportHandler = (ctx: ExportContext) => Promise<string>;

/**
 * Export-render dispatch, keyed by detected chart type. Story 109.1 (arch-review)
 * replaced a 22-branch per-type if-ladder with this table.
 * `chart-type-registry.test.ts` asserts every diagram/visualization id in
 * CHART_TYPE_REGISTRY is covered here (or by the visualization fallthrough), so a
 * newly-registered type can no longer silently render an empty string.
 */
export const DIAGRAM_EXPORT_HANDLERS: Record<string, DiagramExportHandler> = {
  org: exportOrg,
  sitemap: exportSitemap,
  kanban: exportKanban,
  class: exportClass,
  er: exportEr,
  'boxes-and-lines': exportBoxesAndLines,
  mindmap: exportMindmap,
  wireframe: exportWireframe,
  c4: exportC4,
  flowchart: exportFlowchart,
  infra: exportInfra,
  pert: exportPert,
  gantt: exportGantt,
  state: exportState,
  'tech-radar': exportTechRadar,
  'journey-map': exportJourneyMap,
  cycle: exportCycle,
  map: exportMap,
  pyramid: exportPyramid,
  ring: exportRing,
  raci: exportRaci,
  rasci: exportRaci,
  daci: exportRaci,
  // D3 visualizations — own handler per type (Story 109.2). Only `sequence`
  // still falls through to exportVisualization (no chart-type of its own).
  slope: exportSlope,
  arc: exportArc,
  timeline: exportTimeline,
  wordcloud: exportWordcloud,
  venn: exportVenn,
  quadrant: exportQuadrant,
};

export async function renderForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors,
  viewState?: import('./sharing').CompactViewState,
  options?: RenderForExportOptions
): Promise<string> {
  const exportMode = options?.exportMode ?? false;
  const { parseDgmoChartType } = await import('./dgmo-router');
  const detectedType = parseDgmoChartType(content);
  const ctx: ExportContext = {
    content,
    theme,
    palette,
    viewState,
    options,
    exportMode,
  };
  // Generic dispatch: every structured diagram AND every D3 visualization now
  // resolves through the handler table. Only `sequence` — which has no chart
  // type of its own and is auto-detected from arrow syntax — falls through to
  // exportVisualization.
  const handler =
    detectedType !== null ? DIAGRAM_EXPORT_HANDLERS[detectedType] : undefined;
  return (handler ?? exportVisualization)(ctx);
}

async function exportOrg(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseOrg } = await import('./org/parser');
  const { layoutOrg } = await import('./org/layout');
  const { collapseOrgTree } = await import('./org/collapse');
  const { renderOrg } = await import('./org/renderer');

  const isDark = theme === 'dark';
  const effectivePalette = await resolveExportPalette(theme, palette);

  const orgParsed = parseOrg(content, effectivePalette);
  if (orgParsed.error) return '';

  // Apply interactive collapse state when provided (read from unified viewState)
  const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
  const activeTagGroup = resolveActiveTagGroup(
    orgParsed.tagGroups,
    orgParsed.options['active-tag'],
    viewState?.tag ?? options?.tagGroup
  );
  const hiddenAttributes = viewState?.ha ? new Set(viewState.ha) : undefined;

  const { parsed: effectiveParsed, hiddenCounts } =
    collapsedNodes && collapsedNodes.size > 0
      ? collapseOrgTree(orgParsed, collapsedNodes)
      : { parsed: orgParsed, hiddenCounts: new Map<string, number>() };

  const orgLayout = layoutOrg(
    effectiveParsed,
    hiddenCounts.size > 0 ? hiddenCounts : undefined,
    activeTagGroup,
    hiddenAttributes,
    false // expandAllLegend off — collapsed-by-default per §1.3
  );

  const PADDING = 20;
  const titleOffset = effectiveParsed.title ? 30 : 0;
  const exportWidth = orgLayout.width + PADDING * 2;
  const exportHeight = orgLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderOrg(
    container,
    effectiveParsed,
    orgLayout,
    effectivePalette,
    isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    activeTagGroup,
    hiddenAttributes,
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportSitemap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseSitemap } = await import('./sitemap/parser');
  const { layoutSitemap } = await import('./sitemap/layout');
  const { collapseSitemapTree } = await import('./sitemap/collapse');
  const { renderSitemap } = await import('./sitemap/renderer');

  const isDark = theme === 'dark';
  const effectivePalette = await resolveExportPalette(theme, palette);

  const sitemapParsed = parseSitemap(content, effectivePalette);
  if (sitemapParsed.error || sitemapParsed.roots.length === 0) return '';

  // Apply interactive collapse state when provided (read from unified viewState)
  const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
  const activeTagGroup = resolveActiveTagGroup(
    sitemapParsed.tagGroups,
    sitemapParsed.options['active-tag'],
    viewState?.tag ?? options?.tagGroup
  );
  const hiddenAttributes = viewState?.ha ? new Set(viewState.ha) : undefined;

  const { parsed: effectiveParsed, hiddenCounts } =
    collapsedNodes && collapsedNodes.size > 0
      ? collapseSitemapTree(sitemapParsed, collapsedNodes)
      : { parsed: sitemapParsed, hiddenCounts: new Map<string, number>() };

  const sitemapLayout = layoutSitemap(
    effectiveParsed,
    hiddenCounts.size > 0 ? hiddenCounts : undefined,
    activeTagGroup,
    hiddenAttributes,
    true
  );

  const PADDING = 20;
  const titleOffset = effectiveParsed.title ? 30 : 0;
  const exportWidth = sitemapLayout.width + PADDING * 2;
  const exportHeight = sitemapLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderSitemap(
    container,
    effectiveParsed,
    sitemapLayout,
    effectivePalette,
    isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    activeTagGroup,
    hiddenAttributes,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportKanban(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseKanban } = await import('./kanban/parser');
  const { renderKanban } = await import('./kanban/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const kanbanParsed = parseKanban(content, effectivePalette);
  if (kanbanParsed.error || kanbanParsed.columns.length === 0) return '';

  // Kanban renderer self-sizes — no explicit width/height needed
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const kanbanCollapsedLanes = viewState?.cl
    ? new Set(viewState.cl)
    : undefined;
  const kanbanCollapsedColumns = viewState?.cc
    ? new Set(viewState.cc)
    : undefined;
  renderKanban(container, kanbanParsed, effectivePalette, theme === 'dark', {
    activeTagGroup: resolveActiveTagGroup(
      kanbanParsed.tagGroups,
      kanbanParsed.options['active-tag'],
      viewState?.tag ?? options?.tagGroup
    ),
    currentSwimlaneGroup: viewState?.swim ?? null,
    ...(kanbanCollapsedLanes !== undefined && {
      collapsedLanes: kanbanCollapsedLanes,
    }),
    ...(kanbanCollapsedColumns !== undefined && {
      collapsedColumns: kanbanCollapsedColumns,
    }),
    ...(viewState?.cm !== undefined && { compactMeta: viewState.cm }),
    exportMode,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportClass(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, exportMode } = ctx;
  const { parseClassDiagram } = await import('./class/parser');
  const { layoutClassDiagram } = await import('./class/layout');
  const { renderClassDiagram } = await import('./class/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const classParsed = parseClassDiagram(content, effectivePalette);
  if (classParsed.error || classParsed.classes.length === 0) return '';

  const classLayout = layoutClassDiagram(classParsed);
  const PADDING = 20;
  const titleOffset = classParsed.title ? 40 : 0;
  const exportWidth = classLayout.width + PADDING * 2;
  const exportHeight = classLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderClassDiagram(
    container,
    classParsed,
    classLayout,
    effectivePalette,
    theme === 'dark',
    undefined,
    { width: exportWidth, height: exportHeight },
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportEr(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseERDiagram } = await import('./er/parser');
  const { layoutERDiagram } = await import('./er/layout');
  const { renderERDiagram } = await import('./er/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const erParsed = parseERDiagram(content, effectivePalette);
  if (erParsed.error || erParsed.tables.length === 0) return '';

  const erLayout = layoutERDiagram(erParsed);
  const PADDING = 20;
  const titleOffset = erParsed.title ? 40 : 0;
  const exportWidth = erLayout.width + PADDING * 2;
  const exportHeight = erLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderERDiagram(
    container,
    erParsed,
    erLayout,
    effectivePalette,
    theme === 'dark',
    undefined,
    { width: exportWidth, height: exportHeight },
    resolveActiveTagGroup(
      erParsed.tagGroups,
      erParsed.options['active-tag'],
      viewState?.tag ?? options?.tagGroup
    ),
    viewState?.sem,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportBoxesAndLines(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseBoxesAndLines } = await import('./boxes-and-lines/parser');
  const effectivePalette = await resolveExportPalette(theme, palette);
  const blParsed = parseBoxesAndLines(content, effectivePalette);
  if (blParsed.error || blParsed.nodes.length === 0) return '';

  // Convert viewState.htv (Record<string, string[]>) to Map<string, Set<string>>
  let blHiddenTagValues: Map<string, Set<string>> | undefined;
  if (viewState?.htv) {
    blHiddenTagValues = new Map();
    for (const [k, v] of Object.entries(viewState.htv)) {
      blHiddenTagValues.set(k, new Set(v));
    }
  }

  const { renderBoxesAndLinesForExport } =
    await import('./boxes-and-lines/renderer');
  const { layoutBoxesAndLines } = await import('./boxes-and-lines/layout');
  const blLayout = await layoutBoxesAndLines(blParsed);
  const PADDING = 20;
  const titleOffset = blParsed.title ? 40 : 0;
  const exportWidth = blLayout.width + PADDING * 2;
  const exportHeight = blLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  const blActiveTagGroup = viewState?.tag ?? options?.tagGroup;
  renderBoxesAndLinesForExport(
    container,
    blParsed,
    blLayout,
    effectivePalette,
    theme === 'dark',
    {
      exportDims: { width: exportWidth, height: exportHeight },
      ...(blActiveTagGroup !== undefined && {
        activeTagGroup: blActiveTagGroup,
      }),
      ...(blHiddenTagValues !== undefined && {
        hiddenTagValues: blHiddenTagValues,
      }),
      exportMode,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportMindmap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseMindmap } = await import('./mindmap/parser');
  const { layoutMindmap } = await import('./mindmap/layout');
  const { collapseMindmapTree } = await import('./mindmap/collapse');
  const { renderMindmap } = await import('./mindmap/renderer');

  const isDark = theme === 'dark';
  const effectivePalette = await resolveExportPalette(theme, palette);

  const mmParsed = parseMindmap(content, effectivePalette);
  if (mmParsed.error) return '';

  const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
  const activeTagGroup = resolveActiveTagGroup(
    mmParsed.tagGroups,
    mmParsed.options['active-tag'],
    viewState?.tag ?? options?.tagGroup
  );
  const hideDescriptions =
    mmParsed.options['no-descriptions'] === 'true' || viewState?.hd === true;

  const { roots: effectiveRoots, hiddenCounts } =
    collapsedNodes && collapsedNodes.size > 0
      ? collapseMindmapTree(mmParsed.roots, collapsedNodes)
      : { roots: mmParsed.roots, hiddenCounts: new Map<string, number>() };

  const effectiveParsed = { ...mmParsed, roots: effectiveRoots };

  const mmLayout = layoutMindmap(effectiveParsed, effectivePalette, {
    interactive: false,
    ...(hiddenCounts.size > 0 && { hiddenCounts }),
    activeTagGroup,
    hideDescriptions,
  });

  const PADDING = 20;
  const titleOffset = effectiveParsed.title ? 30 : 0;
  const exportWidth = mmLayout.width + PADDING * 2;
  const exportHeight = mmLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  const colorByDepth = viewState?.cbd === true;

  renderMindmap(
    container,
    effectiveParsed,
    mmLayout,
    effectivePalette,
    isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    undefined,
    hideDescriptions,
    colorByDepth ? null : activeTagGroup,
    colorByDepth ? { colorByDepth: true, exportMode } : { exportMode }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportWireframe(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseWireframe } = await import('./wireframe/parser');
  const { layoutWireframe } = await import('./wireframe/layout');
  const { renderWireframe } = await import('./wireframe/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const wireframeParsed = parseWireframe(content);
  if (
    wireframeParsed.error ||
    (wireframeParsed.roots.length === 0 && wireframeParsed.modals.length === 0)
  )
    return '';

  const wireframeLayout = layoutWireframe(wireframeParsed);

  const exportWidth = wireframeLayout.width;
  const exportHeight = wireframeLayout.height;
  const container = createExportContainer(exportWidth, exportHeight);

  renderWireframe(
    container,
    wireframeParsed,
    wireframeLayout,
    effectivePalette,
    theme === 'dark',
    undefined,
    { width: exportWidth, height: exportHeight },
    theme
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportC4(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseC4 } = await import('./c4/parser');
  const {
    layoutC4Context,
    layoutC4Containers,
    layoutC4Components,
    layoutC4Deployment,
  } = await import('./c4/layout');
  const { renderC4Context, renderC4Containers } = await import('./c4/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const c4Parsed = parseC4(content, effectivePalette);
  if (c4Parsed.error || c4Parsed.elements.length === 0) return '';

  // Container/component-level rendering (viewState fallback for share links)
  const c4Level =
    options?.c4Level ??
    (viewState?.c4l as
      | 'context'
      | 'containers'
      | 'components'
      | 'deployment'
      | undefined) ??
    'context';
  const c4System = options?.c4System ?? viewState?.c4s;
  const c4Container = options?.c4Container ?? viewState?.c4c;

  const c4Layout =
    c4Level === 'deployment'
      ? layoutC4Deployment(c4Parsed)
      : c4Level === 'components' && c4System && c4Container
        ? layoutC4Components(c4Parsed, c4System, c4Container)
        : c4Level === 'containers' && c4System
          ? layoutC4Containers(c4Parsed, c4System)
          : layoutC4Context(c4Parsed);

  if (c4Layout.nodes.length === 0) return '';

  const PADDING = 20;
  const titleOffset = c4Parsed.title ? 40 : 0;
  const exportWidth = c4Layout.width + PADDING * 2;
  const exportHeight = c4Layout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  const renderFn =
    c4Level === 'deployment' ||
    (c4Level === 'components' && c4System && c4Container) ||
    (c4Level === 'containers' && c4System)
      ? renderC4Containers
      : renderC4Context;

  renderFn(
    container,
    c4Parsed,
    c4Layout,
    effectivePalette,
    theme === 'dark',
    undefined,
    { width: exportWidth, height: exportHeight },
    resolveActiveTagGroup(
      c4Parsed.tagGroups,
      c4Parsed.options['active-tag'],
      viewState?.tag ?? options?.tagGroup
    ),
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportFlowchart(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseFlowchart } = await import('./graph/flowchart-parser');
  const { layoutGraph } = await import('./graph/layout');
  const { renderFlowchart } = await import('./graph/flowchart-renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const fcParsed = parseFlowchart(content, effectivePalette);
  if (fcParsed.error || fcParsed.nodes.length === 0) return '';

  const layout = layoutGraph(fcParsed);
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

  renderFlowchart(
    container,
    fcParsed,
    layout,
    effectivePalette,
    theme === 'dark',
    undefined,
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportInfra(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options } = ctx;
  const { parseInfra } = await import('./infra/parser');
  const { computeInfra } = await import('./infra/compute');
  const { layoutInfra } = await import('./infra/layout');
  const { renderInfra, computeInfraLegendGroups } =
    await import('./infra/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const infraParsed = parseInfra(content);
  if (infraParsed.error || infraParsed.nodes.length === 0) return '';

  const infraComputed = computeInfra(infraParsed);
  const infraLayout = layoutInfra(infraComputed);
  const activeTagGroup = resolveActiveTagGroup(
    infraParsed.tagGroups,
    infraParsed.options['active-tag'],
    viewState?.tag ?? options?.tagGroup
  );

  const showInfraTitle =
    !!infraParsed.title && infraParsed.options['no-title'] !== 'on';
  const titleOffset = showInfraTitle ? 40 : 0;
  const infraTagGroups = [...infraParsed.tagGroups];
  const legendGroups = computeInfraLegendGroups(
    infraLayout.nodes,
    infraTagGroups,
    effectivePalette
  );
  const legendOffset = legendGroups.length > 0 ? 28 : 0;
  const exportWidth = infraLayout.width;
  const exportHeight = infraLayout.height + titleOffset + legendOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderInfra(
    container,
    infraLayout,
    effectivePalette,
    theme === 'dark',
    showInfraTitle ? infraParsed.title : null,
    showInfraTitle ? infraParsed.titleLineNumber : null,
    infraTagGroups,
    activeTagGroup,
    false,
    null,
    null,
    true,
    viewState?.cg ? new Set(viewState.cg) : null
  );
  // Restore explicit pixel dimensions for resvg (renderer uses 100%/viewBox for app scaling)
  const infraSvg = container.querySelector('svg');
  if (infraSvg) {
    infraSvg.setAttribute('width', String(exportWidth));
    infraSvg.setAttribute('height', String(exportHeight));
  }
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportPert(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const { parsePert } = await import('./pert/parser');
  const { analyzePert } = await import('./pert/analyzer');
  const { layoutPert } = await import('./pert/layout');
  const { renderPert, measurePertAnalysisBlock } =
    await import('./pert/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const pertParsed = parsePert(content, { palette: effectivePalette });
  if (pertParsed.error || pertParsed.activities.length === 0) return '';

  const pertResolved = analyzePert(pertParsed);
  const pertLayout = layoutPert(pertResolved);

  const titleHeight = pertParsed.title && !pertParsed.options.noTitle ? 80 : 0;
  const PERT_PADDING = 20;
  // Analysis layer renders by default whenever MC ran. Precedence:
  // an explicit viewState.an (app toggle / share link) wins; else the
  // `no-analysis` source directive suppresses it; else on. The
  // renderer silently omits it in analytical mode (no MC output).
  const analysisOn = viewState?.an ?? !pertParsed.options.noAnalysis;
  const fieldLabelsOn = viewState?.fl === true;
  const exportW = pertLayout.width + PERT_PADDING * 2;
  const analysisMeasured =
    analysisOn || fieldLabelsOn
      ? measurePertAnalysisBlock(pertResolved, exportW - 2 * PERT_PADDING, {
          showSummary: false,
          showTornado: analysisOn,
          showScurve: analysisOn,
          showFieldLegend: fieldLabelsOn,
        })
      : { width: 0, height: 0 };
  const exportH =
    pertLayout.height +
    PERT_PADDING * 2 +
    titleHeight +
    analysisMeasured.height;
  const container = createExportContainer(exportW, exportH);

  renderPert(
    container,
    pertResolved,
    pertLayout,
    effectivePalette,
    theme === 'dark',
    {
      title: pertParsed.title,
      exportDims: { width: exportW, height: exportH },
      showSummary: false,
      showTornado: analysisOn,
      showScurve: analysisOn,
      showFieldLegend: fieldLabelsOn,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportGantt(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const { parseGantt } = await import('./gantt/parser');
  const { calculateSchedule } = await import('./gantt/calculator');
  const { renderGantt } = await import('./gantt/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const ganttParsed = parseGantt(content, effectivePalette);
  const resolved = calculateSchedule(ganttParsed);
  if (resolved.tasks.length === 0) return '';

  const EXPORT_W = 1200;
  const EXPORT_H = 800;
  const container = createExportContainer(EXPORT_W, EXPORT_H);

  const ganttCollapsedGroups = viewState?.cg
    ? new Set(viewState.cg)
    : undefined;
  const ganttSwimlaneGroup = viewState?.swim ?? undefined;
  const ganttCollapsedLanes = viewState?.cl ? new Set(viewState.cl) : undefined;
  renderGantt(
    container,
    resolved,
    effectivePalette,
    theme === 'dark',
    {
      ...(ganttCollapsedGroups !== undefined && {
        collapsedGroups: ganttCollapsedGroups,
      }),
      ...(ganttSwimlaneGroup !== undefined && {
        currentSwimlaneGroup: ganttSwimlaneGroup,
      }),
      ...(ganttCollapsedLanes !== undefined && {
        collapsedLanes: ganttCollapsedLanes,
      }),
      currentActiveGroup: resolveActiveTagGroup(
        resolved.tagGroups,
        resolved.options.activeTag ?? undefined,
        viewState?.tag ?? options?.tagGroup
      ),
      exportMode,
    },
    { width: EXPORT_W, height: EXPORT_H }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportState(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseState } = await import('./graph/state-parser');
  const { layoutGraph } = await import('./graph/layout');
  const { renderState } = await import('./graph/state-renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const stateParsed = parseState(content, effectivePalette);
  if (stateParsed.error || stateParsed.nodes.length === 0) return '';

  const layout = layoutGraph(stateParsed);
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

  renderState(
    container,
    stateParsed,
    layout,
    effectivePalette,
    theme === 'dark',
    undefined,
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportTechRadar(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseTechRadar } = await import('./tech-radar/parser');
  const { renderTechRadarForExport } = await import('./tech-radar/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const radarParsed = parseTechRadar(content);
  if (radarParsed.error || radarParsed.quadrants.length === 0) return '';

  const RADAR_EXPORT_W = 1300;
  const RADAR_EXPORT_H = 1500;
  const container = createExportContainer(RADAR_EXPORT_W, RADAR_EXPORT_H);
  renderTechRadarForExport(
    container,
    radarParsed,
    effectivePalette,
    theme === 'dark',
    { width: RADAR_EXPORT_W, height: RADAR_EXPORT_H },
    viewState,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportJourneyMap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, exportMode } = ctx;
  const { parseJourneyMap } = await import('./journey-map/parser');
  const { renderJourneyMap } = await import('./journey-map/renderer');
  const { layoutJourneyMap } = await import('./journey-map/layout');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const jmParsed = parseJourneyMap(content, effectivePalette);
  if (
    jmParsed.error ||
    (jmParsed.phases.length === 0 && jmParsed.steps.length === 0)
  )
    return '';

  const jmLayout = layoutJourneyMap(jmParsed, effectivePalette, {
    isDark: theme === 'dark',
  });
  const container = createExportContainer(
    jmLayout.totalWidth,
    jmLayout.totalHeight
  );
  renderJourneyMap(container, jmParsed, effectivePalette, theme === 'dark', {
    exportDims: { width: jmLayout.totalWidth, height: jmLayout.totalHeight },
    exportMode,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportCycle(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseCycle } = await import('./cycle/parser');
  const { renderCycleForExport } = await import('./cycle/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const cycleParsed = parseCycle(content);
  if (cycleParsed.error || cycleParsed.nodes.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderCycleForExport(
    container,
    cycleParsed,
    effectivePalette,
    theme === 'dark',
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
    viewState,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportMap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, options } = ctx;
  const { parseMap } = await import('./map/parser');
  const { resolveMap } = await import('./map/resolver');
  const { renderMapForExport } = await import('./map/renderer');
  const { mapExportDimensions } = await import('./map/dimensions');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const mapParsed = parseMap(content, effectivePalette);
  // Always render — an empty or partially-resolved map still draws the
  // inferred base map (§24B.10 / layout AC23); diagnostics surface separately.
  // Prefer injected `mapData` (browser bundles it; the fs loader can't run
  // there); fall back to the Node fs loader for CLI/SSR. Degrade like every
  // other branch (return '') if neither yields data.
  let mapData = options?.mapData;
  if (!mapData) {
    const { loadMapData } = await import('./map/load-data');
    try {
      mapData = await loadMapData();
    } catch {
      return '';
    }
  }
  const mapResolved = resolveMap(mapParsed, mapData);

  // Content-aware canvas: derive the height from the map's intrinsic projected
  // aspect (world ~2.3:1, a region taller, etc.) instead of the fixed 800, so the
  // export matches the content's natural shape — no vertical stretch, no
  // letterbox bands. `preferContain` rides along to the renderer.
  const dims = mapExportDimensions(
    mapResolved,
    mapData,
    EXPORT_WIDTH,
    options?.mapAspect
  );
  const container = createExportContainer(dims.width, dims.height);
  renderMapForExport(
    container,
    mapResolved,
    mapData,
    effectivePalette,
    theme === 'dark',
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportPyramid(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parsePyramid } = await import('./pyramid/parser');
  const { renderPyramidForExport } = await import('./pyramid/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const pyramidParsed = parsePyramid(content);
  if (pyramidParsed.error || pyramidParsed.layers.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderPyramidForExport(
    container,
    pyramidParsed,
    effectivePalette,
    theme === 'dark',
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportRing(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseRing } = await import('./ring/parser');
  const { renderRingForExport } = await import('./ring/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const ringParsed = parseRing(content);
  if (ringParsed.error || ringParsed.layers.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderRingForExport(
    container,
    ringParsed,
    effectivePalette,
    theme === 'dark',
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportRaci(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseRaci } = await import('./raci/parser');
  const { renderRaciForExport } = await import('./raci/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const raciParsed = parseRaci(content, effectivePalette);
  if (raciParsed.error) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderRaciForExport(
    container,
    raciParsed,
    effectivePalette,
    theme === 'dark',
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

/**
 * Shared export prelude for the D3 visualizations: offscreen container + the
 * canonical export dimensions. Each per-viz handler renders into the container
 * then finalizes it.
 */
function beginVizExport(): {
  container: HTMLDivElement;
  dims: D3ExportDimensions;
} {
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  const dims: D3ExportDimensions = {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  };
  return { container, dims };
}

async function exportSlope(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseVisualization(content, palette);
  if (parsed.error || parsed.data.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderSlopeChart(
    container,
    parsed,
    effectivePalette,
    theme === 'dark',
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportArc(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseVisualization(content, palette);
  if (parsed.error || parsed.links.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderArcDiagram(
    container,
    parsed,
    effectivePalette,
    theme === 'dark',
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportTimeline(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options, exportMode } = ctx;
  const parsed = parseVisualization(content, palette);
  if (parsed.error || parsed.timelineEvents.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderTimeline(
    container,
    parsed,
    effectivePalette,
    theme === 'dark',
    undefined,
    dims,
    resolveActiveTagGroup(
      parsed.timelineTagGroups,
      parsed.timelineActiveTag,
      viewState?.tag ?? options?.tagGroup
    ),
    viewState?.swim,
    undefined,
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportWordcloud(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseVisualization(content, palette);
  if (parsed.error || parsed.words.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  await renderWordCloudAsync(
    container,
    parsed,
    effectivePalette,
    theme === 'dark',
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportVenn(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseVisualization(content, palette);
  if (parsed.error || parsed.vennSets.length < 2) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderVenn(
    container,
    parsed,
    effectivePalette,
    theme === 'dark',
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportQuadrant(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseVisualization(content, palette);
  if (parsed.error || parsed.quadrantPoints.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderQuadrant(
    container,
    parsed,
    effectivePalette,
    theme === 'dark',
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

/**
 * Fallthrough export for `sequence` — the only type without a chart-type of its
 * own (auto-detected from arrow syntax, parsed by parseSequenceDgmo). All other
 * D3 visualizations now have their own handler in DIAGRAM_EXPORT_HANDLERS.
 */
async function exportVisualization(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, options } = ctx;
  const parsed = parseVisualization(content, palette);
  // Allow sequence diagrams through even if parseVisualization errors —
  // sequence is parsed by its own dedicated parser (parseSequenceDgmo)
  // and may not have a "chart:" line (auto-detected from arrow syntax).
  if (parsed.type !== 'sequence') {
    if (parsed.error) {
      const looksLikeSequence = /->|~>|<-/.test(content);
      if (!looksLikeSequence) return '';
    } else {
      return '';
    }
  }

  const effectivePalette = await resolveExportPalette(theme, palette);
  const isDark = theme === 'dark';
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

  const { parseSequenceDgmo } = await import('./sequence/parser');
  const { renderSequenceDiagram } = await import('./sequence/renderer');
  const seqParsed = parseSequenceDgmo(content, effectivePalette);
  if (seqParsed.error || seqParsed.participants.length === 0) return '';
  // Apply interactive view state from share links (read from unified viewState).
  // Sequences key both sections and groups by source line number; `cg` is the
  // shared string[] field, so coerce its entries back to numbers.
  const collapsedSections = viewState?.cs ? new Set(viewState.cs) : undefined;
  const collapsedGroups = viewState?.cg
    ? new Set(viewState.cg.map(Number).filter((n) => Number.isFinite(n)))
    : undefined;
  const seqActiveTagGroup = viewState?.tag ?? options?.tagGroup;
  renderSequenceDiagram(
    container,
    seqParsed,
    effectivePalette,
    isDark,
    undefined,
    {
      exportWidth: EXPORT_WIDTH,
      ...(seqActiveTagGroup !== undefined && {
        activeTagGroup: seqActiveTagGroup,
      }),
      ...(collapsedSections !== undefined && { collapsedSections }),
      ...(collapsedGroups !== undefined && { collapsedGroups }),
    }
  );

  return finalizeSvgExport(container, theme, effectivePalette);
}
