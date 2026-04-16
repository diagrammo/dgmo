// ============================================================
// C4 Context Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import { renderInlineText } from '../utils/inline-markdown';
import { preprocessDescriptionLine } from '../utils/description-helpers';
import type { ParsedC4 } from './types';
import type { C4LayoutResult, C4LayoutEdge } from './layout';
import { parseC4 } from './parser';
import {
  layoutC4Context,
  layoutC4Containers,
  layoutC4Components,
  layoutC4Deployment,
  collectCardMetadata,
} from './layout';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const TITLE_HEIGHT = 30;
const TYPE_FONT_SIZE = 10;
const NAME_FONT_SIZE = 14;
const DESC_FONT_SIZE = 11;
const DESC_LINE_HEIGHT = 16;
const DESC_CHAR_WIDTH = 6.5;
const EDGE_LABEL_FONT_SIZE = 11;
const TECH_FONT_SIZE = 10;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const CARD_RADIUS = 6;
const CARD_H_PAD = 20;
const CARD_V_PAD = 14;
const TYPE_LABEL_HEIGHT = 18;
const DIVIDER_GAP = 6;
const NAME_HEIGHT = 20;
const META_FONT_SIZE = 11;
const META_CHAR_WIDTH = 6.5;
const META_LINE_HEIGHT = 16;
const BOUNDARY_LABEL_FONT_SIZE = 12;
const BOUNDARY_STROKE_WIDTH = 1.5;
const BOUNDARY_RADIUS = 8;

// Drillable accent bar (matches org chart collapse bar)
const DRILL_BAR_HEIGHT = 6;

// Cylinder (database/cache) shape constants
const CYLINDER_RY = 8;

// Person stick-figure dimensions (sequence-diagram style, scaled for cards)
const PERSON_HEAD_R = 4;
const PERSON_ARM_SPAN = 10;
const PERSON_LEG_SPAN = 7;
const PERSON_ICON_W = PERSON_ARM_SPAN * 2; // total width including arms
const PERSON_SW = 1.5;

// Legend constants (match org)

// ============================================================
// Color helpers
// ============================================================

function typeColor(
  type: 'person' | 'system' | 'container' | 'component',
  palette: PaletteColors,
  nodeColor?: string
): string {
  if (nodeColor) return nodeColor;
  switch (type) {
    case 'person':
      return palette.colors.blue;
    case 'container':
      return palette.colors.purple;
    case 'component':
      return palette.colors.green;
    default:
      return palette.colors.teal;
  }
}

function nodeFill(
  palette: PaletteColors,
  isDark: boolean,
  type: 'person' | 'system' | 'container' | 'component',
  nodeColor?: string
): string {
  const color = typeColor(type, palette, nodeColor);
  return mix(color, isDark ? palette.surface : palette.bg, 25);
}

function nodeStroke(
  palette: PaletteColors,
  type: 'person' | 'system' | 'container' | 'component',
  nodeColor?: string
): string {
  return typeColor(type, palette, nodeColor);
}

// ============================================================
// Text wrapping helper
// ============================================================

function wrapText(text: string, maxWidth: number, charWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length * charWidth > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
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
// Edge line style helpers
// ============================================================

function isDashedEdge(arrowType: string): boolean {
  return arrowType === 'async' || arrowType === 'bidirectional-async';
}

function hasBidirectionalMarkers(arrowType: string): boolean {
  return arrowType === 'bidirectional' || arrowType === 'bidirectional-async';
}

// ============================================================
// Person stick-figure icon
// ============================================================

/**
 * Stick-figure person icon matching the sequence diagram actor style.
 * Drawn centered at (cx, cy) with total height ~22px.
 */
function drawPersonIcon(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  cx: number,
  cy: number,
  color: string
): void {
  const headY = cy - 7;
  const bodyTopY = headY + PERSON_HEAD_R + 1;
  const bodyBottomY = cy + 4;
  const legY = cy + 10;

  // Head
  g.append('circle')
    .attr('cx', cx)
    .attr('cy', headY)
    .attr('r', PERSON_HEAD_R)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', PERSON_SW);

  // Body
  g.append('line')
    .attr('x1', cx)
    .attr('y1', bodyTopY)
    .attr('x2', cx)
    .attr('y2', bodyBottomY)
    .attr('stroke', color)
    .attr('stroke-width', PERSON_SW);

  // Arms
  g.append('line')
    .attr('x1', cx - PERSON_ARM_SPAN)
    .attr('y1', bodyTopY + 3)
    .attr('x2', cx + PERSON_ARM_SPAN)
    .attr('y2', bodyTopY + 3)
    .attr('stroke', color)
    .attr('stroke-width', PERSON_SW);

  // Left leg
  g.append('line')
    .attr('x1', cx)
    .attr('y1', bodyBottomY)
    .attr('x2', cx - PERSON_LEG_SPAN)
    .attr('y2', legY)
    .attr('stroke', color)
    .attr('stroke-width', PERSON_SW);

  // Right leg
  g.append('line')
    .attr('x1', cx)
    .attr('y1', bodyBottomY)
    .attr('x2', cx + PERSON_LEG_SPAN)
    .attr('y2', legY)
    .attr('stroke', color)
    .attr('stroke-width', PERSON_SW);
}

// ============================================================
// Main Renderer
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

export function renderC4Context(
  container: HTMLDivElement,
  parsed: ParsedC4,
  layout: C4LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  activeTagGroup?: string | null
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleHeight = parsed.title ? TITLE_HEIGHT + 10 : 0;
  const diagramW = layout.width;
  const hasLegend = layout.legend.length > 0;
  // In app mode, legend is a fixed overlay outside the scaled group.
  // C4 layout adds MARGIN(40) + LEGEND_HEIGHT below content — remove that from diagramH.
  const C4_LAYOUT_MARGIN = 40;
  const LEGEND_FIXED_GAP = 8;
  const fixedLegend = !exportDims && hasLegend;
  const legendLayoutSpace = C4_LAYOUT_MARGIN + LEGEND_HEIGHT;
  const legendReserveH = fixedLegend ? LEGEND_HEIGHT + LEGEND_FIXED_GAP : 0;
  const diagramH = fixedLegend
    ? layout.height - legendLayoutSpace
    : layout.height;
  const availH = height - titleHeight - legendReserveH;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + DIAGRAM_PADDING + legendReserveH;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // ── Marker defs ──
  const defs = svg.append('defs');
  const AW = 10;
  const AH = 7;

  // Filled triangle — end marker
  defs
    .append('marker')
    .attr('id', 'c4-arrow-end')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', palette.textMuted);

  // Filled triangle — start marker (for bidirectional)
  defs
    .append('marker')
    .attr('id', 'c4-arrow-start')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', 0)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `${AW},0 0,${AH / 2} ${AW},${AH}`)
    .attr('fill', palette.textMuted);

  // ── Title ──
  if (parsed.title) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .style(
        'cursor',
        onClickItem && parsed.titleLineNumber ? 'pointer' : 'default'
      )
      .text(parsed.title);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(parsed.titleLineNumber!))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      }
    }
  }

  // ── Content group ──
  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // ── Edges (behind nodes) ──
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const edgeG = contentG
      .append('g')
      .attr('class', 'c4-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    if (onClickItem) {
      edgeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(edge.lineNumber);
      });
    }

    const edgeColor = palette.textMuted;
    const dashed = isDashedEdge(edge.arrowType);
    const bidir = hasBidirectionalMarkers(edge.arrowType);

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      const pathEl = edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', EDGE_STROKE_WIDTH)
        .attr('class', 'c4-edge')
        .attr('marker-end', 'url(#c4-arrow-end)');

      if (dashed) {
        pathEl.attr('stroke-dasharray', '6 3');
      }

      if (bidir) {
        pathEl.attr('marker-start', 'url(#c4-arrow-start)');
      }
    }

    // Label at midpoint
    if (edge.label || edge.technology) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPt = edge.points[midIdx];

      const labelText = edge.label ?? '';
      const techText = edge.technology ? `[${edge.technology}]` : '';

      // Background rect
      const textLen = Math.max(labelText.length, techText.length);
      const bgW = textLen * 7 + 12;
      const bgH = (labelText ? 16 : 0) + (techText ? 14 : 0) + 4;

      edgeG
        .append('rect')
        .attr('x', midPt.x - bgW / 2)
        .attr('y', midPt.y - bgH / 2)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.9)
        .attr('class', 'c4-edge-label-bg');

      let textY = midPt.y;
      if (labelText && techText) {
        textY = midPt.y - 4;
      }

      if (labelText) {
        edgeG
          .append('text')
          .attr('x', midPt.x)
          .attr('y', textY + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', edgeColor)
          .attr('font-size', EDGE_LABEL_FONT_SIZE)
          .attr('class', 'c4-edge-label')
          .text(labelText);
      }

      if (techText) {
        edgeG
          .append('text')
          .attr('x', midPt.x)
          .attr('y', labelText ? textY + 18 : textY + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', edgeColor)
          .attr('font-size', TECH_FONT_SIZE)
          .attr('font-style', 'italic')
          .attr('class', 'c4-edge-tech')
          .text(techText);
      }
    }
  }

  // ── Nodes (top layer) ──
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'c4-card')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id);

    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const tagValue = node.metadata[tagKey];
      if (tagValue) {
        nodeG.attr(`data-tag-${tagKey}`, tagValue.toLowerCase());
      } else {
        // Fall back to the group's defaultValue so hover-dimming works for
        // nodes that inherit the default (e.g. sc: Internal default).
        const tagGroup = parsed.tagGroups.find(
          (g) =>
            g.name.toLowerCase() === tagKey || g.alias?.toLowerCase() === tagKey
        );
        if (tagGroup?.defaultValue) {
          nodeG.attr(`data-tag-${tagKey}`, tagGroup.defaultValue.toLowerCase());
        }
      }
    }

    if (node.importPath) {
      nodeG.attr('data-import-path', node.importPath);
    }

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    const w = node.width;
    const h = node.height;
    const fill = nodeFill(palette, isDark, node.type, node.color);
    const stroke = nodeStroke(palette, node.type, node.color);

    // Card background
    nodeG
      .append('rect')
      .attr('x', -w / 2)
      .attr('y', -h / 2)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', CARD_RADIUS)
      .attr('ry', CARD_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    let yPos = -h / 2 + CARD_V_PAD;

    // Type label (e.g. «person» or «system»)
    const typeLabel = `\u00AB${node.type}\u00BB`;
    nodeG
      .append('text')
      .attr('x', 0)
      .attr('y', yPos + TYPE_FONT_SIZE / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', palette.textMuted)
      .attr('font-size', TYPE_FONT_SIZE)
      .attr('font-style', 'italic')
      .text(typeLabel);

    yPos += TYPE_LABEL_HEIGHT;

    // Name (bold) — above divider
    if (node.type === 'person') {
      // Person icon to the left of name
      const nameCharWidth = NAME_FONT_SIZE * 0.6;
      const textWidth = node.name.length * nameCharWidth;
      const gap = 6;
      const totalWidth = PERSON_ICON_W + gap + textWidth;
      const iconCx = -totalWidth / 2 + PERSON_ICON_W / 2;
      const textX = iconCx + PERSON_ICON_W / 2 + gap;

      drawPersonIcon(
        nodeG as GSelection,
        iconCx,
        yPos + NAME_FONT_SIZE / 2 - 2,
        stroke
      );

      nodeG
        .append('text')
        .attr('x', textX)
        .attr('y', yPos + NAME_FONT_SIZE / 2)
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.text)
        .attr('font-size', NAME_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(node.name);
    } else {
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', yPos + NAME_FONT_SIZE / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.text)
        .attr('font-size', NAME_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(node.name);
    }

    yPos += NAME_HEIGHT;

    // Subtle divider — between name and description
    nodeG
      .append('line')
      .attr('x1', -w / 2 + CARD_H_PAD / 2)
      .attr('y1', yPos)
      .attr('x2', w / 2 - CARD_H_PAD / 2)
      .attr('y2', yPos)
      .attr('stroke', stroke)
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.4);

    yPos += DIVIDER_GAP;

    // Description (wrapping, muted, inline markdown)
    if (node.description) {
      const contentWidth = w - CARD_H_PAD * 2;
      const lines = wrapText(node.description, contentWidth, DESC_CHAR_WIDTH);
      for (const line of lines) {
        const textEl = nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', yPos + DESC_FONT_SIZE / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', palette.textMuted)
          .attr('font-size', DESC_FONT_SIZE);
        renderInlineText(
          textEl,
          preprocessDescriptionLine(line),
          palette,
          DESC_FONT_SIZE
        );
        yPos += DESC_LINE_HEIGHT;
      }
    }

    // Drillable accent bar — solid bar at bottom of card, clipped to rounded corners
    if (node.drillable) {
      const clipId = `clip-drill-${node.id.replace(/\s+/g, '-')}`;
      nodeG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', CARD_RADIUS);
      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', h / 2 - DRILL_BAR_HEIGHT)
        .attr('width', w)
        .attr('height', DRILL_BAR_HEIGHT)
        .attr('fill', stroke)
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'c4-drill-bar');
    }
  }

  // ── Legend ──
  if (hasLegend) {
    // App mode: fixed overlay at SVG top so it's always readable regardless of scale.
    // Export mode: render inside scaled contentG at layout coordinates.
    const legendParent = fixedLegend
      ? svg
          .append('g')
          .attr('class', 'c4-legend-fixed')
          .attr('transform', `translate(0, ${DIAGRAM_PADDING + titleHeight})`)
      : contentG.append('g').attr('class', 'c4-legend');
    if (activeTagGroup) {
      legendParent.attr('data-legend-active', activeTagGroup.toLowerCase());
    }
    renderLegend(
      legendParent as GSelection,
      layout,
      palette,
      isDark,
      activeTagGroup,
      fixedLegend ? width : null
    );
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderC4ContextForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseC4(content, palette);
  if (parsed.error || parsed.elements.length === 0) return '';

  const layout = layoutC4Context(parsed);
  const isDark = theme === 'dark';

  const container = document.createElement('div');
  const titleOffset = parsed.title ? TITLE_HEIGHT + 10 : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderC4Context(container, parsed, layout, palette, isDark, undefined, {
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

// ============================================================
// Shape card backgrounds
// ============================================================

/**
 * Draw a cylinder-shaped card background (for database/cache shapes).
 * Replaces the simple rounded rect with a cylinder shape.
 */
function drawCylinderCard(
  nodeG: GSelection,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  dashed: boolean
): void {
  const ry = CYLINDER_RY;
  // Build cylinder path: top ellipse, sides, bottom ellipse
  const path = [
    `M ${-w / 2} ${-h / 2 + ry}`,
    `A ${w / 2} ${ry} 0 0 1 ${w / 2} ${-h / 2 + ry}`,
    `L ${w / 2} ${h / 2 - ry}`,
    `A ${w / 2} ${ry} 0 0 1 ${-w / 2} ${h / 2 - ry}`,
    'Z',
  ].join(' ');

  const el = nodeG
    .append('path')
    .attr('d', path)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  if (dashed) {
    el.attr('stroke-dasharray', '6 3');
  }

  // Top ellipse highlight (inner curve)
  nodeG
    .append('ellipse')
    .attr('cx', 0)
    .attr('cy', -h / 2 + ry)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

/**
 * Draw a standard card background rect, optionally dashed.
 */
function drawCardRect(
  nodeG: GSelection,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  dashed: boolean
): void {
  const el = nodeG
    .append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', CARD_RADIUS)
    .attr('ry', CARD_RADIUS)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  if (dashed) {
    el.attr('stroke-dasharray', '6 3');
  }
}

// ============================================================
// Shared rendering helpers
// ============================================================

function renderEdges(
  contentG: GSelection,
  edges: C4LayoutEdge[],
  palette: PaletteColors,
  onClickItem?: (lineNumber: number) => void,
  obstacleRects?: { x: number; y: number; w: number; h: number }[]
): void {
  // Collect labels for deferred rendering with collision avoidance
  const pendingLabels: {
    edgeG: GSelection;
    labelText: string;
    techText: string;
    bgW: number;
    bgH: number;
    x: number;
    y: number;
    edgeColor: string;
    edgeIdx: number;
  }[] = [];

  for (const edge of edges) {
    if (edge.points.length < 2) continue;

    const edgeG = contentG
      .append('g')
      .attr('class', 'c4-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    if (onClickItem) {
      edgeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(edge.lineNumber);
      });
    }

    const edgeColor = palette.textMuted;
    const dashed = isDashedEdge(edge.arrowType);
    const bidir = hasBidirectionalMarkers(edge.arrowType);

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      const pathEl = edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', EDGE_STROKE_WIDTH)
        .attr('class', 'c4-edge')
        .attr('marker-end', 'url(#c4-arrow-end)');

      if (dashed) {
        pathEl.attr('stroke-dasharray', '6 3');
      }

      if (bidir) {
        pathEl.attr('marker-start', 'url(#c4-arrow-start)');
      }
    }

    // Collect label info for deferred placement
    if (edge.label || edge.technology) {
      const labelText = edge.label ?? '';
      const techText = edge.technology ? `[${edge.technology}]` : '';
      const textLen = Math.max(labelText.length, techText.length);
      const bgW = textLen * 7 + 12;
      const bgH = (labelText ? 16 : 0) + (techText ? 14 : 0) + 4;

      pendingLabels.push({
        edgeG,
        labelText,
        techText,
        bgW,
        bgH,
        x: 0,
        y: 0,
        edgeColor,
        edgeIdx: edges.indexOf(edge),
      });
    }
  }

  // Place labels using maximum-clearance algorithm: for each label,
  // find the position along its own edge that is farthest from all
  // other edges and already-placed labels.
  placeEdgeLabels(pendingLabels, edges, obstacleRects);

  // Render all labels
  for (const lbl of pendingLabels) {
    lbl.edgeG
      .append('rect')
      .attr('x', lbl.x - lbl.bgW / 2)
      .attr('y', lbl.y - lbl.bgH / 2)
      .attr('width', lbl.bgW)
      .attr('height', lbl.bgH)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.9)
      .attr('class', 'c4-edge-label-bg');

    let textY = lbl.y;
    if (lbl.labelText && lbl.techText) {
      textY = lbl.y - 4;
    }

    if (lbl.labelText) {
      lbl.edgeG
        .append('text')
        .attr('x', lbl.x)
        .attr('y', textY + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', lbl.edgeColor)
        .attr('font-size', EDGE_LABEL_FONT_SIZE)
        .attr('class', 'c4-edge-label')
        .text(lbl.labelText);
    }

    if (lbl.techText) {
      lbl.edgeG
        .append('text')
        .attr('x', lbl.x)
        .attr('y', lbl.labelText ? textY + 18 : textY + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', lbl.edgeColor)
        .attr('font-size', TECH_FONT_SIZE)
        .attr('font-style', 'italic')
        .attr('class', 'c4-edge-tech')
        .text(lbl.techText);
    }
  }
}

// ============================================================
// Edge Label Placement (Maximum Clearance)
// ============================================================

/** Interpolate a point at fraction t (0–1) along a polyline path. */
function interpolateAlongPath(
  points: { x: number; y: number }[],
  t: number
): { x: number; y: number } {
  if (points.length < 2) return points[0]!;

  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }

  const targetLen = t * totalLen;
  let accumulated = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (accumulated + segLen >= targetLen) {
      const segT = segLen > 0 ? (targetLen - accumulated) / segLen : 0;
      return {
        x: points[i - 1]!.x + dx * segT,
        y: points[i - 1]!.y + dy * segT,
      };
    }
    accumulated += segLen;
  }
  return points[points.length - 1]!;
}

/** Minimum distance from point p to a line segment (a, b). */
function pointToSegmentDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const ex = p.x - projX;
  const ey = p.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Minimum distance from point p to a polyline path. */
function pointToPolylineDist(
  p: { x: number; y: number },
  points: { x: number; y: number }[]
): number {
  let minDist = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = pointToSegmentDist(p, points[i - 1]!, points[i]!);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Check if a rect overlaps another rect. */
function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad: number
): boolean {
  return !(
    ax + aw / 2 + pad < bx - bw / 2 - pad ||
    bx + bw / 2 + pad < ax - aw / 2 - pad ||
    ay + ah / 2 + pad < by - bh / 2 - pad ||
    by + bh / 2 + pad < ay - ah / 2 - pad
  );
}

/**
 * Place edge labels using maximum-clearance algorithm.
 *
 * For each edge with a label, samples candidate positions along the edge
 * path (avoiding the endpoints near nodes) and scores each by:
 *   1. Minimum distance to all OTHER edge paths (want: far from other lines)
 *   2. No overlap with already-placed labels (hard constraint)
 *
 * Labels are placed greedily: edges with fewer good positions go first.
 */
/** Compute the tangent direction at fraction t along a polyline. */
function tangentAt(
  points: { x: number; y: number }[],
  t: number
): { x: number; y: number } {
  if (points.length < 2) return { x: 0, y: 1 };
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }
  const targetLen = t * totalLen;
  let accumulated = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (accumulated + segLen >= targetLen || i === points.length - 1) {
      return { x: dx, y: dy };
    }
    accumulated += segLen;
  }
  return { x: 0, y: 1 };
}

function placeEdgeLabels(
  labels: {
    edgeIdx: number;
    bgW: number;
    bgH: number;
    x: number;
    y: number;
  }[],
  edges: C4LayoutEdge[],
  obstacleRects?: { x: number; y: number; w: number; h: number }[]
): void {
  if (labels.length === 0) return;

  // Collect all edge polylines
  const allPaths = edges.map((e) => e.points);

  // Already-placed label rects for overlap checking
  const placedRects: { x: number; y: number; w: number; h: number }[] = [];

  // Bias samples toward target end (50–90%) where edges have diverged
  const SAMPLES = [0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

  // Pre-compute candidate positions for each label
  const candidates = labels.map((lbl) => {
    const ownPath = allPaths[lbl.edgeIdx]!;
    return SAMPLES.map((t) => ({ pt: interpolateAlongPath(ownPath, t), t }));
  });

  // Place greedily — label with fewest high-scoring candidates goes first
  const order = labels.map((_, i) => i);

  // Sort: labels on edges with more nearby edges go first (hardest to place)
  order.sort((a, b) => {
    const midA = interpolateAlongPath(allPaths[labels[a]!.edgeIdx]!, 0.5);
    const midB = interpolateAlongPath(allPaths[labels[b]!.edgeIdx]!, 0.5);
    let nearA = 0,
      nearB = 0;
    for (let e = 0; e < allPaths.length; e++) {
      if (e === labels[a]!.edgeIdx) continue;
      if (pointToPolylineDist(midA, allPaths[e]!) < 100) nearA++;
    }
    for (let e = 0; e < allPaths.length; e++) {
      if (e === labels[b]!.edgeIdx) continue;
      if (pointToPolylineDist(midB, allPaths[e]!) < 100) nearB++;
    }
    return nearB - nearA; // Most constrained first
  });

  for (const idx of order) {
    const lbl = labels[idx]!;
    const ownEdgeIdx = lbl.edgeIdx;
    const ownPath = allPaths[ownEdgeIdx]!;
    const cands = candidates[idx]!;

    let bestScore = -Infinity;
    let bestPt = cands[Math.floor(cands.length / 2)]!.pt;
    let bestT = 0.5;

    for (const { pt, t } of cands) {
      // Min distance to all OTHER edge paths
      let minEdgeDist = Infinity;
      for (let e = 0; e < allPaths.length; e++) {
        if (e === ownEdgeIdx) continue;
        const d = pointToPolylineDist(pt, allPaths[e]!);
        if (d < minEdgeDist) minEdgeDist = d;
      }

      // Penalty for overlapping already-placed labels
      let labelOverlapPenalty = 0;
      for (const placed of placedRects) {
        if (
          rectsOverlap(
            pt.x,
            pt.y,
            lbl.bgW,
            lbl.bgH,
            placed.x,
            placed.y,
            placed.w,
            placed.h,
            6
          )
        ) {
          labelOverlapPenalty += 200;
        }
      }

      // Penalty for overlapping boundary/obstacle rects (e.g. boundary labels)
      if (obstacleRects) {
        for (const obs of obstacleRects) {
          if (
            rectsOverlap(
              pt.x,
              pt.y,
              lbl.bgW,
              lbl.bgH,
              obs.x + obs.w / 2,
              obs.y + obs.h / 2,
              obs.w,
              obs.h,
              6
            )
          ) {
            labelOverlapPenalty += 200;
          }
        }
      }

      const score = minEdgeDist - labelOverlapPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestPt = pt;
        bestT = t;
      }
    }

    // Perpendicular offset: push label to the side of its edge with more
    // clearance from other edges. This makes it unambiguous which line a
    // label belongs to even when edges are close together.
    const tan = tangentAt(ownPath, bestT);
    const tLen = Math.sqrt(tan.x * tan.x + tan.y * tan.y);
    if (tLen > 0) {
      // Normal perpendicular to edge tangent
      const nx = -tan.y / tLen;
      const ny = tan.x / tLen;
      const offsetDist = lbl.bgH / 2 + 4;
      const sideA = {
        x: bestPt.x + nx * offsetDist,
        y: bestPt.y + ny * offsetDist,
      };
      const sideB = {
        x: bestPt.x - nx * offsetDist,
        y: bestPt.y - ny * offsetDist,
      };

      // Score each side: clearance from other edges + overlap with placed labels
      let scoreA = Infinity,
        scoreB = Infinity;
      for (let e = 0; e < allPaths.length; e++) {
        if (e === ownEdgeIdx) continue;
        scoreA = Math.min(scoreA, pointToPolylineDist(sideA, allPaths[e]!));
        scoreB = Math.min(scoreB, pointToPolylineDist(sideB, allPaths[e]!));
      }
      for (const placed of placedRects) {
        if (
          rectsOverlap(
            sideA.x,
            sideA.y,
            lbl.bgW,
            lbl.bgH,
            placed.x,
            placed.y,
            placed.w,
            placed.h,
            6
          )
        ) {
          scoreA -= 200;
        }
        if (
          rectsOverlap(
            sideB.x,
            sideB.y,
            lbl.bgW,
            lbl.bgH,
            placed.x,
            placed.y,
            placed.w,
            placed.h,
            6
          )
        ) {
          scoreB -= 200;
        }
      }
      if (obstacleRects) {
        for (const obs of obstacleRects) {
          const cx = obs.x + obs.w / 2,
            cy = obs.y + obs.h / 2;
          if (
            rectsOverlap(
              sideA.x,
              sideA.y,
              lbl.bgW,
              lbl.bgH,
              cx,
              cy,
              obs.w,
              obs.h,
              6
            )
          ) {
            scoreA -= 200;
          }
          if (
            rectsOverlap(
              sideB.x,
              sideB.y,
              lbl.bgW,
              lbl.bgH,
              cx,
              cy,
              obs.w,
              obs.h,
              6
            )
          ) {
            scoreB -= 200;
          }
        }
      }

      const finalPt = scoreA >= scoreB ? sideA : sideB;
      lbl.x = finalPt.x;
      lbl.y = finalPt.y;
    } else {
      lbl.x = bestPt.x;
      lbl.y = bestPt.y;
    }

    placedRects.push({ x: lbl.x, y: lbl.y, w: lbl.bgW, h: lbl.bgH });
  }
}

function renderLegend(
  parent: GSelection,
  layout: C4LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  activeTagGroup?: string | null,
  fixedWidth?: number | null
): void {
  const groups = layout.legend.map((g) => ({
    name: g.name,
    entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
  }));
  const legendConfig: LegendConfig = {
    groups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode: 'fixed',
  };
  const legendState: LegendState = { activeGroup: activeTagGroup ?? null };
  const containerWidth = fixedWidth ?? layout.width;
  renderLegendD3(
    parent,
    legendConfig,
    legendState,
    palette,
    isDark,
    undefined,
    containerWidth
  );
  parent.selectAll('[data-legend-group]').classed('c4-legend-group', true);
}

// ============================================================
// Container-Level Renderer
// ============================================================

/**
 * Render a C4 container-level diagram showing containers inside a system boundary
 * with external elements outside.
 */
export function renderC4Containers(
  container: HTMLDivElement,
  parsed: ParsedC4,
  layout: C4LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  activeTagGroup?: string | null
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleHeight = parsed.title ? TITLE_HEIGHT + 10 : 0;
  const diagramW = layout.width;
  const hasLegend = layout.legend.length > 0;
  // In app mode, legend is a fixed overlay outside the scaled group.
  // C4 layout adds MARGIN(40) + LEGEND_HEIGHT below content — remove that from diagramH.
  const C4_LAYOUT_MARGIN = 40;
  const LEGEND_FIXED_GAP = 8;
  const fixedLegend = !exportDims && hasLegend;
  const legendLayoutSpace = C4_LAYOUT_MARGIN + LEGEND_HEIGHT;
  const legendReserveH = fixedLegend ? LEGEND_HEIGHT + LEGEND_FIXED_GAP : 0;
  const diagramH = fixedLegend
    ? layout.height - legendLayoutSpace
    : layout.height;
  const availH = height - titleHeight - legendReserveH;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + DIAGRAM_PADDING + legendReserveH;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // ── Marker defs ──
  const defs = svg.append('defs');
  const AW = 10;
  const AH = 7;

  defs
    .append('marker')
    .attr('id', 'c4-arrow-end')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', AW)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${AW},${AH / 2} 0,${AH}`)
    .attr('fill', palette.textMuted);

  defs
    .append('marker')
    .attr('id', 'c4-arrow-start')
    .attr('viewBox', `0 0 ${AW} ${AH}`)
    .attr('refX', 0)
    .attr('refY', AH / 2)
    .attr('markerWidth', AW)
    .attr('markerHeight', AH)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `${AW},0 0,${AH / 2} ${AW},${AH}`)
    .attr('fill', palette.textMuted);

  // ── Title ──
  if (parsed.title) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .style(
        'cursor',
        onClickItem && parsed.titleLineNumber ? 'pointer' : 'default'
      )
      .text(parsed.title);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(parsed.titleLineNumber!))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      }
    }
  }

  // ── Content group ──
  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // ── Boundary box (background layer) ──
  if (layout.boundary) {
    const b = layout.boundary;
    const boundaryFill = mix(palette.surface, palette.bg, 30);
    const boundaryStroke = mix(palette.textMuted, palette.bg, 50);

    const boundaryG = contentG
      .append('g')
      .attr('class', 'c4-boundary')
      .attr('data-line-number', String(b.lineNumber));

    if (onClickItem) {
      boundaryG.style('cursor', 'pointer').on('click', () => {
        onClickItem(b.lineNumber);
      });
    }

    boundaryG
      .append('rect')
      .attr('x', b.x)
      .attr('y', b.y)
      .attr('width', b.width)
      .attr('height', b.height)
      .attr('rx', BOUNDARY_RADIUS)
      .attr('ry', BOUNDARY_RADIUS)
      .attr('fill', boundaryFill)
      .attr('stroke', boundaryStroke)
      .attr('stroke-width', BOUNDARY_STROKE_WIDTH);

    // Boundary label
    boundaryG
      .append('text')
      .attr('x', b.x + 12)
      .attr('y', b.y + 16)
      .attr('fill', palette.textMuted)
      .attr('font-size', BOUNDARY_LABEL_FONT_SIZE)
      .attr('font-style', 'italic')
      .text(`${b.label} \u2014 ${b.typeLabel}`);
  }

  // ── Group boundaries (between parent boundary and edges) ──
  if (layout.groupBoundaries.length > 0) {
    const groupFill = mix(palette.surface, palette.bg, 15);
    const groupStroke = mix(palette.textMuted, palette.bg, 60);

    for (const gb of layout.groupBoundaries) {
      const gbG = contentG
        .append('g')
        .attr('class', 'c4-group-boundary')
        .attr('data-line-number', String(gb.lineNumber));

      if (onClickItem) {
        gbG.style('cursor', 'pointer').on('click', () => {
          onClickItem(gb.lineNumber);
        });
      }

      gbG
        .append('rect')
        .attr('x', gb.x)
        .attr('y', gb.y)
        .attr('width', gb.width)
        .attr('height', gb.height)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr('fill', groupFill)
        .attr('stroke', groupStroke)
        .attr('stroke-width', 1);

      // Group label — top-left, italic, name only
      gbG
        .append('text')
        .attr('x', gb.x + 10)
        .attr('y', gb.y + 14)
        .attr('fill', palette.textMuted)
        .attr('font-size', BOUNDARY_LABEL_FONT_SIZE)
        .attr('font-style', 'italic')
        .text(gb.label);
    }
  }

  // ── Collect boundary label rects as obstacles for edge label placement ──
  const boundaryLabelObstacles: {
    x: number;
    y: number;
    w: number;
    h: number;
  }[] = [];
  if (layout.boundary) {
    const b = layout.boundary;
    const labelText = `${b.label} \u2014 ${b.typeLabel}`;
    const w = labelText.length * 7 + 12;
    const h = BOUNDARY_LABEL_FONT_SIZE + 4;
    boundaryLabelObstacles.push({ x: b.x + 12, y: b.y + 16 - h + 4, w, h });
  }
  for (const gb of layout.groupBoundaries) {
    const w = gb.label.length * 7 + 12;
    const h = BOUNDARY_LABEL_FONT_SIZE + 4;
    boundaryLabelObstacles.push({ x: gb.x + 10, y: gb.y + 14 - h + 4, w, h });
  }

  // ── Edges (behind nodes) ──
  renderEdges(
    contentG as GSelection,
    layout.edges,
    palette,
    onClickItem,
    boundaryLabelObstacles
  );

  // ── Nodes ──
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'c4-card')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id);

    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const tagValue = node.metadata[tagKey];
      if (tagValue) {
        nodeG.attr(`data-tag-${tagKey}`, tagValue.toLowerCase());
      } else {
        // Fall back to the group's defaultValue so hover-dimming works for
        // nodes that inherit the default (e.g. sc: Internal default).
        const tagGroup = parsed.tagGroups.find(
          (g) =>
            g.name.toLowerCase() === tagKey || g.alias?.toLowerCase() === tagKey
        );
        if (tagGroup?.defaultValue) {
          nodeG.attr(`data-tag-${tagKey}`, tagGroup.defaultValue.toLowerCase());
        }
      }
    }

    if (node.shape) {
      nodeG.attr('data-shape', node.shape);
    }

    if (node.importPath) {
      nodeG.attr('data-import-path', node.importPath);
    }

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    const w = node.width;
    const h = node.height;
    const fill = nodeFill(palette, isDark, node.type, node.color);
    const stroke = nodeStroke(palette, node.type, node.color);
    const shape = node.shape ?? 'default';
    const isExternalShape = shape === 'external';

    // Card background — shape-specific
    if (shape === 'database' || shape === 'cache') {
      drawCylinderCard(
        nodeG as GSelection,
        w,
        h,
        fill,
        stroke,
        shape === 'cache'
      );
    } else {
      drawCardRect(nodeG as GSelection, w, h, fill, stroke, isExternalShape);
    }

    let yPos = -h / 2 + CARD_V_PAD;

    // For cylinder shapes, offset content down past the top ellipse
    if (shape === 'database' || shape === 'cache') {
      yPos += CYLINDER_RY;
    }

    // Type label — only for external elements (person/system); containers/components are the default
    if (node.type !== 'container' && node.type !== 'component') {
      const typeLabel = `\u00AB${node.type}\u00BB`;
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', yPos + TYPE_FONT_SIZE / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.textMuted)
        .attr('font-size', TYPE_FONT_SIZE)
        .attr('font-style', 'italic')
        .text(typeLabel);

      yPos += TYPE_LABEL_HEIGHT;
    }

    // Name (bold)
    if (node.type === 'person') {
      const nameCharWidth = NAME_FONT_SIZE * 0.6;
      const textWidth = node.name.length * nameCharWidth;
      const gap = 6;
      const totalWidth = PERSON_ICON_W + gap + textWidth;
      const iconCx = -totalWidth / 2 + PERSON_ICON_W / 2;
      const textX = iconCx + PERSON_ICON_W / 2 + gap;

      drawPersonIcon(
        nodeG as GSelection,
        iconCx,
        yPos + NAME_FONT_SIZE / 2 - 2,
        stroke
      );

      nodeG
        .append('text')
        .attr('x', textX)
        .attr('y', yPos + NAME_FONT_SIZE / 2)
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.text)
        .attr('font-size', NAME_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(node.name);
    } else {
      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', yPos + NAME_FONT_SIZE / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.text)
        .attr('font-size', NAME_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(node.name);
    }

    yPos += NAME_HEIGHT;

    if (node.type === 'container') {
      // Container cards: description above divider, metadata below

      // Description (above divider, inline markdown)
      if (node.description) {
        const contentWidth = w - CARD_H_PAD * 2;
        const lines = wrapText(node.description, contentWidth, DESC_CHAR_WIDTH);
        for (const line of lines) {
          const textEl = nodeG
            .append('text')
            .attr('x', 0)
            .attr('y', yPos + DESC_FONT_SIZE / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.textMuted)
            .attr('font-size', DESC_FONT_SIZE);
          renderInlineText(
            textEl,
            preprocessDescriptionLine(line),
            palette,
            DESC_FONT_SIZE
          );
          yPos += DESC_LINE_HEIGHT;
        }
      }

      // Metadata rows below divider (org-chart style: "Key: Value")
      const metaEntries = collectCardMetadata(node.metadata);
      if (metaEntries.length > 0) {
        // Divider
        nodeG
          .append('line')
          .attr('x1', -w / 2 + CARD_H_PAD / 2)
          .attr('y1', yPos)
          .attr('x2', w / 2 - CARD_H_PAD / 2)
          .attr('y2', yPos)
          .attr('stroke', stroke)
          .attr('stroke-width', 0.5)
          .attr('stroke-opacity', 0.4);

        yPos += DIVIDER_GAP;

        const maxKeyLen = Math.max(...metaEntries.map((e) => e.key.length));
        const valueX = -w / 2 + CARD_H_PAD + (maxKeyLen + 2) * META_CHAR_WIDTH;

        for (const entry of metaEntries) {
          // Key (muted)
          nodeG
            .append('text')
            .attr('x', -w / 2 + CARD_H_PAD)
            .attr('y', yPos + META_FONT_SIZE / 2)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.textMuted)
            .attr('font-size', META_FONT_SIZE)
            .text(`${entry.key}:`);

          // Value (normal)
          nodeG
            .append('text')
            .attr('x', valueX)
            .attr('y', yPos + META_FONT_SIZE / 2)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.text)
            .attr('font-size', META_FONT_SIZE)
            .text(entry.value);

          yPos += META_LINE_HEIGHT;
        }
      }
    } else {
      // External cards (person/system): same as context — divider then description

      // Divider
      nodeG
        .append('line')
        .attr('x1', -w / 2 + CARD_H_PAD / 2)
        .attr('y1', yPos)
        .attr('x2', w / 2 - CARD_H_PAD / 2)
        .attr('y2', yPos)
        .attr('stroke', stroke)
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.4);

      yPos += DIVIDER_GAP;

      // Description (inline markdown)
      if (node.description) {
        const contentWidth = w - CARD_H_PAD * 2;
        const lines = wrapText(node.description, contentWidth, DESC_CHAR_WIDTH);
        for (const line of lines) {
          const textEl = nodeG
            .append('text')
            .attr('x', 0)
            .attr('y', yPos + DESC_FONT_SIZE / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.textMuted)
            .attr('font-size', DESC_FONT_SIZE);
          renderInlineText(
            textEl,
            preprocessDescriptionLine(line),
            palette,
            DESC_FONT_SIZE
          );
          yPos += DESC_LINE_HEIGHT;
        }
      }
    }

    // Drillable accent bar — solid bar at bottom of card, clipped to rounded corners
    if (node.drillable) {
      const clipId = `clip-drill-${node.id.replace(/\s+/g, '-')}`;
      nodeG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', CARD_RADIUS);
      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', h / 2 - DRILL_BAR_HEIGHT)
        .attr('width', w)
        .attr('height', DRILL_BAR_HEIGHT)
        .attr('fill', stroke)
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'c4-drill-bar');
    }
  }

  // ── Legend ──
  if (hasLegend) {
    // App mode: fixed overlay at SVG top so it's always readable regardless of scale.
    // Export mode: render inside scaled contentG at layout coordinates.
    const legendParent = fixedLegend
      ? svg
          .append('g')
          .attr('class', 'c4-legend-fixed')
          .attr('transform', `translate(0, ${DIAGRAM_PADDING + titleHeight})`)
      : contentG.append('g').attr('class', 'c4-legend');
    if (activeTagGroup) {
      legendParent.attr('data-legend-active', activeTagGroup.toLowerCase());
    }
    renderLegend(
      legendParent as GSelection,
      layout,
      palette,
      isDark,
      activeTagGroup,
      fixedLegend ? width : null
    );
  }
}

// ============================================================
// Container Export convenience function
// ============================================================

export function renderC4ContainersForExport(
  content: string,
  systemName: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseC4(content, palette);
  if (parsed.error || parsed.elements.length === 0) return '';

  const layout = layoutC4Containers(parsed, systemName);
  if (layout.nodes.length === 0) return '';

  const isDark = theme === 'dark';

  const el = document.createElement('div');
  const titleOffset = parsed.title ? TITLE_HEIGHT + 10 : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  el.style.width = `${exportWidth}px`;
  el.style.height = `${exportHeight}px`;
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);

  try {
    renderC4Containers(el, parsed, layout, palette, isDark, undefined, {
      width: exportWidth,
      height: exportHeight,
    });

    const svgEl = el.querySelector('svg');
    if (!svgEl) return '';

    if (theme === 'transparent') {
      svgEl.style.background = 'none';
    }

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(el);
  }
}

// ============================================================
// Component Export convenience function
// ============================================================

export function renderC4ComponentsForExport(
  content: string,
  systemName: string,
  containerName: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseC4(content, palette);
  if (parsed.error || parsed.elements.length === 0) return '';

  const layout = layoutC4Components(parsed, systemName, containerName);
  if (layout.nodes.length === 0) return '';

  const isDark = theme === 'dark';

  const el = document.createElement('div');
  const titleOffset = parsed.title ? TITLE_HEIGHT + 10 : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  el.style.width = `${exportWidth}px`;
  el.style.height = `${exportHeight}px`;
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);

  try {
    // Reuse the container renderer — it handles all node types generically
    renderC4Containers(el, parsed, layout, palette, isDark, undefined, {
      width: exportWidth,
      height: exportHeight,
    });

    const svgEl = el.querySelector('svg');
    if (!svgEl) return '';

    if (theme === 'transparent') {
      svgEl.style.background = 'none';
    }

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(el);
  }
}

// ============================================================
// Deployment Diagram Renderer
// ============================================================

/**
 * Render a C4 deployment diagram interactively.
 * Reuses the container renderer — infrastructure boundaries are rendered
 * as group boundaries and container refs as cards (same visual pattern).
 */
export function renderC4Deployment(
  container: HTMLDivElement,
  parsed: ParsedC4,
  layout: C4LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  activeTagGroup?: string | null
): void {
  renderC4Containers(
    container,
    parsed,
    layout,
    palette,
    isDark,
    onClickItem,
    exportDims,
    activeTagGroup
  );
}

/**
 * Export convenience function for deployment diagrams.
 */
export function renderC4DeploymentForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseC4(content, palette);
  if (parsed.error || parsed.deployment.length === 0) return '';

  const layout = layoutC4Deployment(parsed);
  if (layout.nodes.length === 0) return '';

  const isDark = theme === 'dark';

  const el = document.createElement('div');
  const titleOffset = parsed.title ? TITLE_HEIGHT + 10 : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  el.style.width = `${exportWidth}px`;
  el.style.height = `${exportHeight}px`;
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);

  try {
    renderC4Containers(el, parsed, layout, palette, isDark, undefined, {
      width: exportWidth,
      height: exportHeight,
    });

    const svgEl = el.querySelector('svg');
    if (!svgEl) return '';

    if (theme === 'transparent') {
      svgEl.style.background = 'none';
    }

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(el);
  }
}
