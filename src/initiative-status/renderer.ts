// ============================================================
// Initiative Status Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import { contrastText } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes';
import type { ParsedInitiativeStatus, InitiativeStatus } from './types';
import type { ISLayoutResult, ISLayoutNode, ISLayoutEdge } from './layout';
import { parseInitiativeStatus } from './parser';
import { layoutInitiativeStatus } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const NODE_FONT_SIZE = 13;
const MIN_NODE_FONT_SIZE = 9;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 2;
const NODE_STROKE_WIDTH = 2;
const NODE_RX = 8;
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
const CHAR_WIDTH_RATIO = 0.6; // approx char width / font size for Helvetica
const NODE_TEXT_PADDING = 12; // horizontal padding inside node for text

// ============================================================
// Color helpers
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

function statusColor(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  switch (status) {
    case 'done': return palette.colors.green;
    case 'wip':  return palette.colors.yellow;
    case 'todo': return palette.colors.red;
    case 'na':   return isDark ? palette.colors.gray : '#2e3440';
    default:     return palette.textMuted;
  }
}

function nodeFill(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  const color = statusColor(status, palette, isDark);
  return mix(color, isDark ? palette.surface : palette.bg, 30);
}

function nodeStroke(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  return statusColor(status, palette, isDark);
}

function nodeTextColor(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  const fill = nodeFill(status, palette, isDark);
  return contrastText(fill, '#eceff4', '#2e3440');
}

function edgeStrokeColor(status: InitiativeStatus, palette: PaletteColors, isDark: boolean): string {
  return statusColor(status, palette, isDark);
}

// ============================================================
// Edge path generator
// ============================================================

const lineGenerator = d3Shape.line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

// ============================================================
// Text fitting — wrap or shrink to fit fixed-size nodes
// ============================================================

interface FittedText {
  lines: string[];
  fontSize: number;
}

function fitTextToNode(label: string, nodeWidth: number, nodeHeight: number): FittedText {
  const maxTextWidth = nodeWidth - NODE_TEXT_PADDING * 2;
  const lineHeight = 1.3;

  // Try at full font size first, then shrink
  for (let fontSize = NODE_FONT_SIZE; fontSize >= MIN_NODE_FONT_SIZE; fontSize--) {
    const charWidth = fontSize * CHAR_WIDTH_RATIO;
    const maxCharsPerLine = Math.floor(maxTextWidth / charWidth);
    const maxLines = Math.floor((nodeHeight - 8) / (fontSize * lineHeight));

    if (maxCharsPerLine < 2 || maxLines < 1) continue;

    // If it fits on one line, done
    if (label.length <= maxCharsPerLine) {
      return { lines: [label], fontSize };
    }

    // Try word-wrapping
    const words = label.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= maxCharsPerLine) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    // If all lines fit, check each line width
    if (lines.length <= maxLines && lines.every((l) => l.length <= maxCharsPerLine)) {
      return { lines, fontSize };
    }

    // Lines don't fit — try hard-breaking long words
    const hardLines: string[] = [];
    for (const line of lines) {
      if (line.length <= maxCharsPerLine) {
        hardLines.push(line);
      } else {
        for (let i = 0; i < line.length; i += maxCharsPerLine) {
          hardLines.push(line.slice(i, i + maxCharsPerLine));
        }
      }
    }

    if (hardLines.length <= maxLines) {
      return { lines: hardLines, fontSize };
    }
  }

  // Last resort: smallest font, truncate with ellipsis
  const charWidth = MIN_NODE_FONT_SIZE * CHAR_WIDTH_RATIO;
  const maxChars = Math.floor((nodeWidth - NODE_TEXT_PADDING * 2) / charWidth);
  const truncated = label.length > maxChars ? label.slice(0, maxChars - 1) + '\u2026' : label;
  return { lines: [truncated], fontSize: MIN_NODE_FONT_SIZE };
}

// ============================================================
// Main renderer
// ============================================================

export function renderInitiativeStatus(
  container: HTMLDivElement,
  parsed: ParsedInitiativeStatus,
  layout: ISLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number }
): void {
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleHeight = parsed.title ? 40 : 0;

  // Scale to fit
  const diagramW = layout.width;
  const diagramH = layout.height;
  const availH = height - titleHeight;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const scaledH = diagramH * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + (availH - scaledH) / 2;

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // Defs: arrowhead markers per status color
  const defs = svg.append('defs');
  const markerColors = new Set<string>();
  for (const edge of layout.edges) {
    markerColors.add(edgeStrokeColor(edge.status, palette, isDark));
  }
  // Default marker
  markerColors.add(palette.textMuted);

  for (const color of markerColors) {
    const id = `is-arrow-${color.replace('#', '')}`;
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
  if (parsed.title) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', '20px')
      .attr('font-weight', '700')
      .style('cursor', onClickItem && parsed.titleLineNumber ? 'pointer' : 'default')
      .text(parsed.title);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(parsed.titleLineNumber!))
          .on('mouseenter', function () { d3Selection.select(this).attr('opacity', 0.7); })
          .on('mouseleave', function () { d3Selection.select(this).attr('opacity', 1); });
      }
    }
  }

  // Content group
  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Render edges (below nodes)
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;
    const edgeColor = edgeStrokeColor(edge.status, palette, isDark);
    const markerId = `is-arrow-${edgeColor.replace('#', '')}`;

    const edgeG = contentG
      .append('g')
      .attr('class', 'is-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', EDGE_STROKE_WIDTH)
        .attr('marker-end', `url(#${markerId})`)
        .attr('class', 'is-edge');
    }

    // Edge label at midpoint
    if (edge.label) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPt = edge.points[midIdx];

      const labelLen = edge.label.length;
      const bgW = labelLen * 7 + 10;
      const bgH = 18;
      edgeG
        .append('rect')
        .attr('x', midPt.x - bgW / 2)
        .attr('y', midPt.y - bgH / 2 - 1)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.9)
        .attr('class', 'is-edge-label-bg');

      edgeG
        .append('text')
        .attr('x', midPt.x)
        .attr('y', midPt.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', EDGE_LABEL_FONT_SIZE)
        .attr('class', 'is-edge-label')
        .text(edge.label);
    }

    if (onClickItem) {
      edgeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(edge.lineNumber);
      });
    }
  }

  // Render nodes (top layer)
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'is-node')
      .attr('data-line-number', String(node.lineNumber));

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    // Rounded rect
    nodeG
      .append('rect')
      .attr('x', -node.width / 2)
      .attr('y', -node.height / 2)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', NODE_RX)
      .attr('ry', NODE_RX)
      .attr('fill', nodeFill(node.status, palette, isDark))
      .attr('stroke', nodeStroke(node.status, palette, isDark))
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Label — fit text into fixed-size box
    const fitted = fitTextToNode(node.label, node.width, node.height);
    const textColor = nodeTextColor(node.status, palette, isDark);
    const totalTextHeight = fitted.lines.length * fitted.fontSize * 1.3;
    const startY = -totalTextHeight / 2 + fitted.fontSize * 0.65;

    for (let li = 0; li < fitted.lines.length; li++) {
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', startY + li * fitted.fontSize * 1.3)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', fitted.fontSize)
        .attr('font-weight', '600')
        .text(fitted.lines[li]);
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderInitiativeStatusForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseInitiativeStatus(content);
  if (parsed.error || parsed.nodes.length === 0) return '';

  const layout = layoutInitiativeStatus(parsed);
  const isDark = theme === 'dark';

  const titleOffset = parsed.title ? 40 : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  const container = document.createElement('div');
  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderInitiativeStatus(
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
