// ============================================================
// State Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import type { ParsedGraph } from './types';
import type { LayoutResult, LayoutNode } from './layout';
import { parseState } from './state-parser';
import { layoutGraph } from './layout';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const NODE_FONT_SIZE = 13;
const EDGE_LABEL_FONT_SIZE = 11;
const GROUP_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
const PSEUDOSTATE_RADIUS = 10;
const STATE_CORNER_RADIUS = 10;
const GROUP_EXTRA_PADDING = 12;

// ============================================================
// Color helpers
// ============================================================

function stateDefaultColor(palette: PaletteColors, colorOff?: boolean): string {
  return colorOff ? palette.textMuted : palette.colors.blue;
}

function stateFill(
  palette: PaletteColors,
  isDark: boolean,
  nodeColor?: string,
  colorOff?: boolean
): string {
  const color = nodeColor ?? stateDefaultColor(palette, colorOff);
  return shapeFill(palette, color, isDark);
}

function stateStroke(
  palette: PaletteColors,
  nodeColor?: string,
  colorOff?: boolean
): string {
  return nodeColor ?? stateDefaultColor(palette, colorOff);
}

// ============================================================
// Edge path generator
// ============================================================

const lineGenerator = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

// ============================================================
// Self-loop path
// ============================================================

function selfLoopPath(node: LayoutNode): string {
  const cx = node.x;
  const cy = node.y;
  const r = node.width / 2;
  // Loop from right side, arc above, back to right side
  const startX = cx + r;
  const startY = cy - 5;
  const endX = cx + r;
  const endY = cy + 5;
  const loopR = 25;
  return `M ${startX} ${startY} C ${startX + loopR * 2} ${startY - loopR * 2}, ${endX + loopR * 2} ${endY + loopR * 2}, ${endX} ${endY}`;
}

// ============================================================
// Main renderer
// ============================================================

export function renderState(
  container: HTMLDivElement,
  graph: ParsedGraph,
  layout: LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number }
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleHeight = graph.title ? 40 : 0;

  const diagramW = layout.width;
  const diagramH = layout.height;
  const availH = height - titleHeight;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + DIAGRAM_PADDING;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // Defs: arrowhead markers
  const defs = svg.append('defs');

  defs
    .append('marker')
    .attr('id', 'st-arrow')
    .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
    .attr('refX', ARROWHEAD_W)
    .attr('refY', ARROWHEAD_H / 2)
    .attr('markerWidth', ARROWHEAD_W)
    .attr('markerHeight', ARROWHEAD_H)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
    .attr('fill', palette.textMuted);

  // Custom colored markers
  const edgeColors = new Set<string>();
  for (const edge of layout.edges) {
    if (edge.color) edgeColors.add(edge.color);
  }
  for (const color of edgeColors) {
    const id = `st-arrow-${color.replace('#', '')}`;
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
      .attr('refX', ARROWHEAD_W)
      .attr('refY', ARROWHEAD_H / 2)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
      .attr('fill', color);
  }

  // Title
  if (graph.title) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .style(
        'cursor',
        onClickItem && graph.titleLineNumber ? 'pointer' : 'default'
      )
      .text(graph.title);

    if (graph.titleLineNumber) {
      titleEl.attr('data-line-number', graph.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(graph.titleLineNumber!))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      }
    }
  }

  // Content group
  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Render groups (background layer)
  // Collapsed groups are rendered in the node layer instead — skip them here
  for (const group of layout.groups) {
    if (group.collapsed) continue;
    if (group.width === 0 && group.height === 0) continue;
    const gx = group.x - GROUP_EXTRA_PADDING;
    const gy = group.y - GROUP_EXTRA_PADDING - GROUP_LABEL_FONT_SIZE - 4;
    const gw = group.width + GROUP_EXTRA_PADDING * 2;
    const gh =
      group.height + GROUP_EXTRA_PADDING * 2 + GROUP_LABEL_FONT_SIZE + 4;

    const fillColor = group.color
      ? mix(group.color, isDark ? palette.surface : palette.bg, 10)
      : isDark
        ? palette.surface
        : mix(palette.border, palette.bg, 30);
    const strokeColor = group.color ?? palette.textMuted;

    const groupWrapper = contentG
      .append('g')
      .attr('class', 'st-group-wrapper')
      .attr('data-line-number', String(group.lineNumber))
      .attr('data-group-id', group.id)
      .attr('data-group-toggle', group.id)
      .attr('tabindex', '0')
      .attr('role', 'button')
      .attr('aria-expanded', 'true')
      .attr('aria-label', `Collapse group ${group.label}`)
      .style('cursor', 'pointer');

    groupWrapper
      .append('rect')
      .attr('x', gx)
      .attr('y', gy)
      .attr('width', gw)
      .attr('height', gh)
      .attr('rx', 6)
      .attr('fill', fillColor)
      .attr('stroke', strokeColor)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .attr('class', 'st-group');

    groupWrapper
      .append('text')
      .attr('x', gx + 8)
      .attr('y', gy + GROUP_LABEL_FONT_SIZE + 4)
      .attr('fill', strokeColor)
      .attr('font-size', GROUP_LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .attr('opacity', 0.7)
      .attr('class', 'st-group-label')
      .text(group.label);
  }

  // Build self-loop lookup
  const selfLoopEdges = new Set<number>();
  for (const edge of layout.edges) {
    if (edge.source === edge.target) selfLoopEdges.add(edge.lineNumber);
  }

  // Build node position map for self-loops
  const nodePositionMap = new Map<string, LayoutNode>();
  for (const node of layout.nodes) {
    nodePositionMap.set(node.id, node);
  }

  // Compute edge label positions with perpendicular offset to hug their path,
  // then resolve remaining collisions.
  const LABEL_CHAR_W = 7;
  const LABEL_PAD = 8;
  const LABEL_H = 16;
  const PERP_OFFSET = 10; // px offset perpendicular to edge direction

  interface LabelPos {
    x: number;
    y: number;
    w: number;
    h: number;
    edgeIdx: number;
  }
  const labelPositions: LabelPos[] = [];

  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei];
    if (!edge.label) continue;
    const bgW = edge.label.length * LABEL_CHAR_W + LABEL_PAD;
    let lx: number, ly: number;

    if (edge.source === edge.target) {
      const node = nodePositionMap.get(edge.source);
      if (!node) continue;
      lx = node.x + node.width / 2 + 30;
      ly = node.y;
    } else if (edge.points.length >= 2) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPt = edge.points[midIdx];
      // Compute perpendicular offset from edge direction at midpoint
      const prev = edge.points[Math.max(0, midIdx - 1)];
      const next = edge.points[Math.min(edge.points.length - 1, midIdx + 1)];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        // Normal vector (right-hand side of travel direction)
        lx = midPt.x + (-dy / len) * PERP_OFFSET;
        ly = midPt.y + (dx / len) * PERP_OFFSET;
      } else {
        lx = midPt.x;
        ly = midPt.y;
      }
    } else {
      continue;
    }
    labelPositions.push({ x: lx, y: ly, w: bgW, h: LABEL_H, edgeIdx: ei });
  }

  // Resolve remaining label collisions: nudge overlapping labels apart.
  labelPositions.sort((a, b) => a.y - b.y);
  for (let i = 0; i < labelPositions.length; i++) {
    for (let j = i + 1; j < labelPositions.length; j++) {
      const a = labelPositions[i];
      const b = labelPositions[j];
      const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
      const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      if (overlapX && overlapY) {
        b.y = a.y + (a.h + b.h) / 2 + 2;
      }
    }
  }

  // Build lookup: edgeIdx → adjusted label position
  const labelPosMap = new Map<number, LabelPos>();
  for (const lp of labelPositions) labelPosMap.set(lp.edgeIdx, lp);

  // Render edges (middle layer)
  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei];
    const edgeG = contentG
      .append('g')
      .attr('class', 'st-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    const edgeColor = edge.color ?? palette.textMuted;
    const markerId = edge.color
      ? `st-arrow-${edge.color.replace('#', '')}`
      : 'st-arrow';

    if (edge.source === edge.target) {
      // Self-loop
      const node = nodePositionMap.get(edge.source);
      if (node) {
        edgeG
          .append('path')
          .attr('d', selfLoopPath(node))
          .attr('fill', 'none')
          .attr('stroke', edgeColor)
          .attr('stroke-width', EDGE_STROKE_WIDTH)
          .attr('marker-end', `url(#${markerId})`)
          .attr('class', 'st-edge');

        const lp = labelPosMap.get(ei);
        if (edge.label && lp) {
          edgeG
            .append('rect')
            .attr('x', lp.x - lp.w / 2)
            .attr('y', lp.y - lp.h / 2 - 1)
            .attr('width', lp.w)
            .attr('height', lp.h)
            .attr('rx', 3)
            .attr('fill', palette.bg)
            .attr('opacity', 0.85)
            .attr('class', 'st-edge-label-bg');
          edgeG
            .append('text')
            .attr('x', lp.x)
            .attr('y', lp.y + 4)
            .attr('text-anchor', 'middle')
            .attr('fill', edgeColor)
            .attr('font-size', EDGE_LABEL_FONT_SIZE)
            .attr('class', 'st-edge-label')
            .text(edge.label);
        }
      }
    } else if (edge.points.length >= 2) {
      const pathD = lineGenerator(edge.points);
      if (pathD) {
        edgeG
          .append('path')
          .attr('d', pathD)
          .attr('fill', 'none')
          .attr('stroke', edgeColor)
          .attr('stroke-width', EDGE_STROKE_WIDTH)
          .attr('marker-end', `url(#${markerId})`)
          .attr('class', 'st-edge');
      }

      const lp = labelPosMap.get(ei);
      if (edge.label && lp) {
        edgeG
          .append('rect')
          .attr('x', lp.x - lp.w / 2)
          .attr('y', lp.y - lp.h / 2 - 1)
          .attr('width', lp.w)
          .attr('height', lp.h)
          .attr('rx', 3)
          .attr('fill', palette.bg)
          .attr('opacity', 0.85)
          .attr('class', 'st-edge-label-bg');
        edgeG
          .append('text')
          .attr('x', lp.x)
          .attr('y', lp.y + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', edgeColor)
          .attr('font-size', EDGE_LABEL_FONT_SIZE)
          .attr('class', 'st-edge-label')
          .text(edge.label);
      }
    }
  }

  // Build set of collapsed group IDs for special rendering
  const collapsedGroupIds = new Set<string>();
  for (const group of layout.groups) {
    if (group.collapsed) collapsedGroupIds.add(group.id);
  }

  // Render nodes (top layer)
  const colorOff = graph.options?.color === 'off';
  for (const node of layout.nodes) {
    const isCollapsedGroup = collapsedGroupIds.has(node.id);

    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', isCollapsedGroup ? 'st-group-wrapper st-node' : 'st-node')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id)
      .style('cursor', 'pointer');

    if (isCollapsedGroup) {
      nodeG
        .attr('data-group-toggle', node.id)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', 'false')
        .attr('aria-label', `Expand group ${node.label}`);
    }

    if (onClickItem && !isCollapsedGroup) {
      nodeG.on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    if (node.shape === 'pseudostate') {
      // Filled circle
      nodeG
        .append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', PSEUDOSTATE_RADIUS)
        .attr('fill', palette.text)
        .attr('stroke', 'none');
    } else if (isCollapsedGroup) {
      // Collapsed group — distinctive rounded rect with collapse bar
      const w = node.width;
      const h = node.height;
      const groupColor = node.color ?? stateDefaultColor(palette, colorOff);
      const fillColor = mix(
        groupColor,
        isDark ? palette.surface : palette.bg,
        15
      );
      const strokeColor = groupColor;
      const COLLAPSE_BAR_H = 6;

      // Main rect
      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', STATE_CORNER_RADIUS)
        .attr('ry', STATE_CORNER_RADIUS)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', NODE_STROKE_WIDTH);

      // Collapse indicator bar at bottom (clipped to rounded corners)
      const clipId = `st-clip-${node.id.replace(/[[\]:\s]/g, '')}`;
      nodeG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', STATE_CORNER_RADIUS);
      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', h / 2 - COLLAPSE_BAR_H)
        .attr('width', w)
        .attr('height', COLLAPSE_BAR_H)
        .attr('fill', strokeColor)
        .attr('opacity', 0.5)
        .attr('clip-path', `url(#${clipId})`);

      // Label — contrast against the collapsed-group fill
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr(
          'fill',
          contrastText(
            fillColor,
            palette.textOnFillLight,
            palette.textOnFillDark
          )
        )
        .attr('font-size', NODE_FONT_SIZE)
        .text(node.label);
    } else {
      // State — rounded rectangle
      const w = node.width;
      const h = node.height;
      const resolvedFill = stateFill(palette, isDark, node.color, colorOff);
      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', STATE_CORNER_RADIUS)
        .attr('ry', STATE_CORNER_RADIUS)
        .attr('fill', resolvedFill)
        .attr('stroke', stateStroke(palette, node.color, colorOff))
        .attr('stroke-width', NODE_STROKE_WIDTH);

      // Label — contrast against the state fill
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr(
          'fill',
          contrastText(
            resolvedFill,
            palette.textOnFillLight,
            palette.textOnFillDark
          )
        )
        .attr('font-size', NODE_FONT_SIZE)
        .text(node.label);
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderStateForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseState(content, palette);
  if (parsed.error || parsed.nodes.length === 0) return '';

  const layout = layoutGraph(parsed);
  const isDark = theme === 'dark';

  const container = document.createElement('div');
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    layout.height + DIAGRAM_PADDING * 2 + (parsed.title ? 40 : 0);
  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderState(container, parsed, layout, palette, isDark, undefined, {
      width: exportWidth,
      height: exportHeight,
    });

    const svgEl = container.querySelector('svg');
    if (!svgEl) return '';

    if (theme === 'transparent') {
      svgEl.style.background = 'none';
    }

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(container);
  }
}
