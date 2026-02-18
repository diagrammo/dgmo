// ============================================================
// Flowchart SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import type { ParsedGraph } from './types';
import type { LayoutResult, LayoutNode, LayoutEdge, LayoutGroup } from './layout';
import { parseFlowchart } from './flowchart-parser';
import { layoutGraph } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const TITLE_HEIGHT = 30;
const TITLE_FONT_SIZE = 18;
const NODE_FONT_SIZE = 13;
const EDGE_LABEL_FONT_SIZE = 11;
const GROUP_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
const IO_SKEW = 15;
const SUBROUTINE_INSET = 8;
const DOC_WAVE_HEIGHT = 10;
const GROUP_EXTRA_PADDING = 12;

// ============================================================
// Color helpers (inline mix to avoid cross-module import issues)
// ============================================================

function mix(a: string, b: string, pct: number): string {
  const parse = (h: string) => {
    const r = h.replace('#', '');
    const f = r.length === 3 ? r[0]+r[0]+r[1]+r[1]+r[2]+r[2] : r;
    return [parseInt(f.substring(0,2),16), parseInt(f.substring(2,4),16), parseInt(f.substring(4,6),16)];
  };
  const [ar,ag,ab] = parse(a), [br,bg,bb] = parse(b), t = pct/100;
  const c = (x: number, y: number) => Math.round(x*t + y*(1-t)).toString(16).padStart(2,'0');
  return `#${c(ar,br)}${c(ag,bg)}${c(ab,bb)}`;
}

function nodeFill(palette: PaletteColors, isDark: boolean, nodeColor?: string): string {
  if (nodeColor) {
    return mix(nodeColor, isDark ? palette.surface : palette.bg, 25);
  }
  return mix(palette.primary, isDark ? palette.surface : palette.bg, 15);
}

function nodeStroke(palette: PaletteColors, nodeColor?: string): string {
  return nodeColor ?? palette.textMuted;
}

// ============================================================
// Shape renderers
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

function renderTerminal(g: GSelection, node: LayoutNode, palette: PaletteColors, isDark: boolean): void {
  const w = node.width;
  const h = node.height;
  const rx = h / 2;
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', rx)
    .attr('ry', rx)
    .attr('fill', nodeFill(palette, isDark, node.color))
    .attr('stroke', nodeStroke(palette, node.color))
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderProcess(g: GSelection, node: LayoutNode, palette: PaletteColors, isDark: boolean): void {
  const w = node.width;
  const h = node.height;
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', nodeFill(palette, isDark, node.color))
    .attr('stroke', nodeStroke(palette, node.color))
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderDecision(g: GSelection, node: LayoutNode, palette: PaletteColors, isDark: boolean): void {
  const w = node.width / 2;
  const h = node.height / 2;
  const points = [
    `${0},${-h}`,   // top
    `${w},${0}`,    // right
    `${0},${h}`,    // bottom
    `${-w},${0}`,   // left
  ].join(' ');
  g.append('polygon')
    .attr('points', points)
    .attr('fill', nodeFill(palette, isDark, node.color))
    .attr('stroke', nodeStroke(palette, node.color))
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderIO(g: GSelection, node: LayoutNode, palette: PaletteColors, isDark: boolean): void {
  const w = node.width / 2;
  const h = node.height / 2;
  const sk = IO_SKEW;
  const points = [
    `${-w + sk},${-h}`,   // top-left (shifted right)
    `${w + sk},${-h}`,    // top-right (shifted right)
    `${w - sk},${h}`,     // bottom-right (shifted left)
    `${-w - sk},${h}`,    // bottom-left (shifted left)
  ].join(' ');
  g.append('polygon')
    .attr('points', points)
    .attr('fill', nodeFill(palette, isDark, node.color))
    .attr('stroke', nodeStroke(palette, node.color))
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderSubroutine(g: GSelection, node: LayoutNode, palette: PaletteColors, isDark: boolean): void {
  const w = node.width;
  const h = node.height;
  const s = nodeStroke(palette, node.color);
  // Outer rectangle
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', nodeFill(palette, isDark, node.color))
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  // Left inner border
  g.append('line')
    .attr('x1', -w / 2 + SUBROUTINE_INSET)
    .attr('y1', -h / 2)
    .attr('x2', -w / 2 + SUBROUTINE_INSET)
    .attr('y2', h / 2)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  // Right inner border
  g.append('line')
    .attr('x1', w / 2 - SUBROUTINE_INSET)
    .attr('y1', -h / 2)
    .attr('x2', w / 2 - SUBROUTINE_INSET)
    .attr('y2', h / 2)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderDocument(g: GSelection, node: LayoutNode, palette: PaletteColors, isDark: boolean): void {
  const w = node.width;
  const h = node.height;
  const waveH = DOC_WAVE_HEIGHT;
  const left = -w / 2;
  const right = w / 2;
  const top = -h / 2;
  const bottom = h / 2 - waveH;

  // Path: straight top, straight right side, wavy bottom, straight left side
  const d = [
    `M ${left} ${top}`,
    `L ${right} ${top}`,
    `L ${right} ${bottom}`,
    `C ${right - w * 0.25} ${bottom + waveH * 2}, ${left + w * 0.25} ${bottom - waveH}, ${left} ${bottom}`,
    'Z',
  ].join(' ');

  g.append('path')
    .attr('d', d)
    .attr('fill', nodeFill(palette, isDark, node.color))
    .attr('stroke', nodeStroke(palette, node.color))
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderNodeShape(g: GSelection, node: LayoutNode, palette: PaletteColors, isDark: boolean): void {
  switch (node.shape) {
    case 'terminal':
      renderTerminal(g, node, palette, isDark);
      break;
    case 'process':
      renderProcess(g, node, palette, isDark);
      break;
    case 'decision':
      renderDecision(g, node, palette, isDark);
      break;
    case 'io':
      renderIO(g, node, palette, isDark);
      break;
    case 'subroutine':
      renderSubroutine(g, node, palette, isDark);
      break;
    case 'document':
      renderDocument(g, node, palette, isDark);
      break;
  }
}

// ============================================================
// Edge path generator
// ============================================================

const lineGenerator = d3Shape.line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

// ============================================================
// Main renderer
// ============================================================

export function renderFlowchart(
  container: HTMLDivElement,
  graph: ParsedGraph,
  layout: LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number }
): void {
  // Clear existing content (preserve tooltips)
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleOffset = graph.title ? TITLE_HEIGHT : 0;

  // Compute scale to fit diagram in viewport
  const diagramW = layout.width;
  const diagramH = layout.height + titleOffset;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (height - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(1, scaleX, scaleY);

  // Center the diagram
  const scaledW = diagramW * scale;
  const scaledH = diagramH * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = (height - scaledH) / 2;

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // Defs: arrowhead markers
  const defs = svg.append('defs');

  // Default arrowhead
  defs
    .append('marker')
    .attr('id', 'fc-arrow')
    .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
    .attr('refX', ARROWHEAD_W)
    .attr('refY', ARROWHEAD_H / 2)
    .attr('markerWidth', ARROWHEAD_W)
    .attr('markerHeight', ARROWHEAD_H)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
    .attr('fill', palette.textMuted);

  // Collect unique edge colors for custom markers
  const edgeColors = new Set<string>();
  for (const edge of layout.edges) {
    if (edge.color) edgeColors.add(edge.color);
  }
  for (const color of edgeColors) {
    const id = `fc-arrow-${color.replace('#', '')}`;
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

  // Main content group with scale/translate
  const mainG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Title
  if (graph.title) {
    const titleEl = mainG
      .append('text')
      .attr('x', diagramW / 2)
      .attr('y', TITLE_FONT_SIZE)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', 'bold')
      .attr('class', 'fc-title chart-title')
      .style('cursor', onClickItem && graph.titleLineNumber ? 'pointer' : 'default')
      .text(graph.title);

    if (graph.titleLineNumber) {
      titleEl.attr('data-line-number', graph.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(graph.titleLineNumber!))
          .on('mouseenter', function () { d3Selection.select(this).attr('opacity', 0.7); })
          .on('mouseleave', function () { d3Selection.select(this).attr('opacity', 1); });
      }
    }
  }

  // Content group (offset by title)
  const contentG = mainG
    .append('g')
    .attr('transform', `translate(0, ${titleOffset})`);

  // Render groups (background layer)
  for (const group of layout.groups) {
    if (group.width === 0 && group.height === 0) continue;
    const gx = group.x - GROUP_EXTRA_PADDING;
    const gy = group.y - GROUP_EXTRA_PADDING - GROUP_LABEL_FONT_SIZE - 4;
    const gw = group.width + GROUP_EXTRA_PADDING * 2;
    const gh = group.height + GROUP_EXTRA_PADDING * 2 + GROUP_LABEL_FONT_SIZE + 4;

    const fillColor = group.color
      ? mix(group.color, isDark ? palette.surface : palette.bg, 10)
      : isDark
        ? palette.surface
        : mix(palette.border, palette.bg, 30);
    const strokeColor = group.color ?? palette.textMuted;

    contentG
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
      .attr('class', 'fc-group');

    contentG
      .append('text')
      .attr('x', gx + 8)
      .attr('y', gy + GROUP_LABEL_FONT_SIZE + 4)
      .attr('fill', strokeColor)
      .attr('font-size', GROUP_LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .attr('opacity', 0.7)
      .attr('class', 'fc-group-label')
      .text(group.label);
  }

  // Render edges (middle layer)
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;
    const edgeG = contentG
      .append('g')
      .attr('class', 'fc-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    const edgeColor = edge.color ?? palette.textMuted;
    const markerId = edge.color
      ? `fc-arrow-${edge.color.replace('#', '')}`
      : 'fc-arrow';

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', EDGE_STROKE_WIDTH)
        .attr('marker-end', `url(#${markerId})`)
        .attr('class', 'fc-edge');
    }

    // Edge label at midpoint
    if (edge.label) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPt = edge.points[midIdx];

      // Background rect for legibility
      const labelLen = edge.label.length;
      const bgW = labelLen * 7 + 8;
      const bgH = 16;
      edgeG
        .append('rect')
        .attr('x', midPt.x - bgW / 2)
        .attr('y', midPt.y - bgH / 2 - 1)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.85)
        .attr('class', 'fc-edge-label-bg');

      edgeG
        .append('text')
        .attr('x', midPt.x)
        .attr('y', midPt.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', EDGE_LABEL_FONT_SIZE)
        .attr('class', 'fc-edge-label')
        .text(edge.label);
    }
  }

  // Render nodes (top layer)
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'fc-node')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id);

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    // Shape
    renderNodeShape(nodeG as GSelection, node, palette, isDark);

    // Label
    nodeG
      .append('text')
      .attr('x', 0)
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', palette.text)
      .attr('font-size', NODE_FONT_SIZE)
      .text(node.label);
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderFlowchartForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseFlowchart(content, palette);
  if (parsed.error || parsed.nodes.length === 0) return '';

  const layout = layoutGraph(parsed);
  const isDark = theme === 'dark';

  // Create offscreen container
  const container = document.createElement('div');
  container.style.width = `${layout.width + DIAGRAM_PADDING * 2}px`;
  container.style.height = `${layout.height + DIAGRAM_PADDING * 2 + (parsed.title ? TITLE_HEIGHT : 0)}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + (parsed.title ? TITLE_HEIGHT : 0);

  try {
    renderFlowchart(
      container,
      parsed,
      layout,
      palette,
      isDark,
      undefined,
      { width: exportWidth, height: exportHeight }
    );

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
