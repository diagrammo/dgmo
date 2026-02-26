// ============================================================
// C4 Context Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import type { ParsedC4 } from './types';
import type { C4Shape } from './types';
import type { C4LayoutResult, C4LayoutNode, C4LayoutEdge, C4LayoutBoundary } from './layout';
import { parseC4 } from './parser';
import { layoutC4Context, layoutC4Containers, collectCardMetadata } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const TITLE_HEIGHT = 30;
const TITLE_FONT_SIZE = 20;
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
const TECH_LINE_HEIGHT = 16;
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
const LEGEND_HEIGHT = 28;
const LEGEND_PILL_FONT_SIZE = 11;
const LEGEND_PILL_FONT_W = LEGEND_PILL_FONT_SIZE * 0.6;
const LEGEND_PILL_PAD = 16;
const LEGEND_DOT_R = 4;
const LEGEND_ENTRY_FONT_SIZE = 10;
const LEGEND_ENTRY_FONT_W = LEGEND_ENTRY_FONT_SIZE * 0.6;
const LEGEND_ENTRY_DOT_GAP = 4;
const LEGEND_ENTRY_TRAIL = 8;
const LEGEND_CAPSULE_PAD = 4;

// ============================================================
// Color helpers
// ============================================================

function mix(a: string, b: string, pct: number): string {
  const parse = (h: string) => {
    const r = h.replace('#', '');
    const f = r.length === 3 ? r[0] + r[0] + r[1] + r[1] + r[2] + r[2] : r;
    return [
      parseInt(f.substring(0, 2), 16),
      parseInt(f.substring(2, 4), 16),
      parseInt(f.substring(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a),
    [br, bg, bb] = parse(b),
    t = pct / 100;
  const c = (x: number, y: number) =>
    Math.round(x * t + y * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

function typeColor(
  type: 'person' | 'system' | 'container' | 'component',
  palette: PaletteColors,
  nodeColor?: string
): string {
  if (nodeColor) return nodeColor;
  switch (type) {
    case 'person': return palette.colors.blue;
    case 'container': return palette.colors.purple;
    case 'component': return palette.colors.green;
    default: return palette.colors.teal;
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
  const diagramH = layout.height;
  const availH = height - titleHeight;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const scaledH = diagramH * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + (availH - scaledH) / 2;

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
      .attr('font-size', `${TITLE_FONT_SIZE}px`)
      .attr('font-weight', '700')
      .style('cursor', onClickItem && parsed.titleLineNumber ? 'pointer' : 'default')
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
          .attr('y', (labelText ? textY + 18 : textY + 4))
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

    // Description (wrapping, muted)
    if (node.description) {
      const contentWidth = w - CARD_H_PAD * 2;
      const lines = wrapText(node.description, contentWidth, DESC_CHAR_WIDTH);
      for (const line of lines) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', yPos + DESC_FONT_SIZE / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', palette.textMuted)
          .attr('font-size', DESC_FONT_SIZE)
          .text(line);
        yPos += DESC_LINE_HEIGHT;
      }
    }

    // Drillable accent bar — solid bar at bottom of card, clipped to rounded corners
    if (node.drillable) {
      const clipId = `clip-drill-${node.id.replace(/\s+/g, '-')}`;
      nodeG.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('x', -w / 2).attr('y', -h / 2)
        .attr('width', w).attr('height', h)
        .attr('rx', CARD_RADIUS);
      nodeG.append('rect')
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
  if (!exportDims) {
    for (const group of layout.legend) {
      const isActive =
        activeTagGroup != null &&
        group.name.toLowerCase() === (activeTagGroup ?? '').toLowerCase();

      if (activeTagGroup != null && !isActive) continue;

      const groupBg = isDark
        ? mix(palette.surface, palette.bg, 50)
        : mix(palette.surface, palette.bg, 30);

      const pillLabel = group.name;
      const pillWidth = pillLabel.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;

      const gEl = contentG
        .append('g')
        .attr('transform', `translate(${group.x}, ${group.y})`)
        .attr('class', 'c4-legend-group')
        .attr('data-legend-group', group.name.toLowerCase())
        .style('cursor', 'pointer');

      if (isActive) {
        gEl
          .append('rect')
          .attr('width', group.width)
          .attr('height', LEGEND_HEIGHT)
          .attr('rx', LEGEND_HEIGHT / 2)
          .attr('fill', groupBg);
      }

      const pillX = isActive ? LEGEND_CAPSULE_PAD : 0;
      const pillY = isActive ? LEGEND_CAPSULE_PAD : 0;
      const pillH = LEGEND_HEIGHT - (isActive ? LEGEND_CAPSULE_PAD * 2 : 0);

      gEl
        .append('rect')
        .attr('x', pillX)
        .attr('y', pillY)
        .attr('width', pillWidth)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', isActive ? palette.bg : groupBg);

      if (isActive) {
        gEl
          .append('rect')
          .attr('x', pillX)
          .attr('y', pillY)
          .attr('width', pillWidth)
          .attr('height', pillH)
          .attr('rx', pillH / 2)
          .attr('fill', 'none')
          .attr('stroke', mix(palette.textMuted, palette.bg, 50))
          .attr('stroke-width', 0.75);
      }

      gEl
        .append('text')
        .attr('x', pillX + pillWidth / 2)
        .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
        .attr('font-size', LEGEND_PILL_FONT_SIZE)
        .attr('font-weight', '500')
        .attr('fill', isActive ? palette.text : palette.textMuted)
        .attr('text-anchor', 'middle')
        .text(pillLabel);

      if (isActive) {
        let entryX = pillX + pillWidth + 4;
        for (const entry of group.entries) {
          const entryG = gEl
            .append('g')
            .attr('data-legend-entry', entry.value.toLowerCase())
            .style('cursor', 'pointer');

          entryG
            .append('circle')
            .attr('cx', entryX + LEGEND_DOT_R)
            .attr('cy', LEGEND_HEIGHT / 2)
            .attr('r', LEGEND_DOT_R)
            .attr('fill', entry.color);

          const textX = entryX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
          entryG
            .append('text')
            .attr('x', textX)
            .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1)
            .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
            .attr('fill', palette.textMuted)
            .text(entry.value);

          entryX = textX + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
        }
      }
    }
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
  onClickItem?: (lineNumber: number) => void
): void {
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

    // Label at midpoint
    if (edge.label || edge.technology) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPt = edge.points[midIdx];

      const labelText = edge.label ?? '';
      const techText = edge.technology ? `[${edge.technology}]` : '';

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
}

function renderLegend(
  contentG: GSelection,
  layout: C4LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  activeTagGroup?: string | null
): void {
  for (const group of layout.legend) {
    const isActive =
      activeTagGroup != null &&
      group.name.toLowerCase() === (activeTagGroup ?? '').toLowerCase();

    if (activeTagGroup != null && !isActive) continue;

    const groupBg = isDark
      ? mix(palette.surface, palette.bg, 50)
      : mix(palette.surface, palette.bg, 30);

    const pillLabel = group.name;
    const pillWidth = pillLabel.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;

    const gEl = contentG
      .append('g')
      .attr('transform', `translate(${group.x}, ${group.y})`)
      .attr('class', 'c4-legend-group')
      .attr('data-legend-group', group.name.toLowerCase())
      .style('cursor', 'pointer');

    if (isActive) {
      gEl
        .append('rect')
        .attr('width', group.width)
        .attr('height', LEGEND_HEIGHT)
        .attr('rx', LEGEND_HEIGHT / 2)
        .attr('fill', groupBg);
    }

    const pillX = isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillY = isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillH = LEGEND_HEIGHT - (isActive ? LEGEND_CAPSULE_PAD * 2 : 0);

    gEl
      .append('rect')
      .attr('x', pillX)
      .attr('y', pillY)
      .attr('width', pillWidth)
      .attr('height', pillH)
      .attr('rx', pillH / 2)
      .attr('fill', isActive ? palette.bg : groupBg);

    if (isActive) {
      gEl
        .append('rect')
        .attr('x', pillX)
        .attr('y', pillY)
        .attr('width', pillWidth)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', 'none')
        .attr('stroke', mix(palette.textMuted, palette.bg, 50))
        .attr('stroke-width', 0.75);
    }

    gEl
      .append('text')
      .attr('x', pillX + pillWidth / 2)
      .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('font-weight', '500')
      .attr('fill', isActive ? palette.text : palette.textMuted)
      .attr('text-anchor', 'middle')
      .text(pillLabel);

    if (isActive) {
      let entryX = pillX + pillWidth + 4;
      for (const entry of group.entries) {
        const entryG = gEl
          .append('g')
          .attr('data-legend-entry', entry.value.toLowerCase())
          .style('cursor', 'pointer');

        entryG
          .append('circle')
          .attr('cx', entryX + LEGEND_DOT_R)
          .attr('cy', LEGEND_HEIGHT / 2)
          .attr('r', LEGEND_DOT_R)
          .attr('fill', entry.color);

        const textX = entryX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
        entryG
          .append('text')
          .attr('x', textX)
          .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1)
          .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(entry.value);

        entryX = textX + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
      }
    }
  }
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
  const diagramH = layout.height;
  const availH = height - titleHeight;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const scaledH = diagramH * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + (availH - scaledH) / 2;

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
      .attr('font-size', `${TITLE_FONT_SIZE}px`)
      .attr('font-weight', '700')
      .style('cursor', onClickItem && parsed.titleLineNumber ? 'pointer' : 'default')
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
      .attr('stroke-width', BOUNDARY_STROKE_WIDTH)
      .attr('stroke-dasharray', '8 4');

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

  // ── Edges (behind nodes) ──
  renderEdges(contentG as GSelection, layout.edges, palette, onClickItem);

  // ── Nodes ──
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'c4-card')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id);

    if (node.shape) {
      nodeG.attr('data-shape', node.shape);
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
      drawCylinderCard(nodeG as GSelection, w, h, fill, stroke, shape === 'cache');
    } else {
      drawCardRect(nodeG as GSelection, w, h, fill, stroke, isExternalShape);
    }

    let yPos = -h / 2 + CARD_V_PAD;

    // For cylinder shapes, offset content down past the top ellipse
    if (shape === 'database' || shape === 'cache') {
      yPos += CYLINDER_RY;
    }

    // Type label — only for external elements (person/system); containers are the default
    if (node.type !== 'container') {
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

      drawPersonIcon(nodeG as GSelection, iconCx, yPos + NAME_FONT_SIZE / 2 - 2, stroke);

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

      // Description (above divider)
      if (node.description) {
        const contentWidth = w - CARD_H_PAD * 2;
        const lines = wrapText(node.description, contentWidth, DESC_CHAR_WIDTH);
        for (const line of lines) {
          nodeG
            .append('text')
            .attr('x', 0)
            .attr('y', yPos + DESC_FONT_SIZE / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.textMuted)
            .attr('font-size', DESC_FONT_SIZE)
            .text(line);
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

      // Description
      if (node.description) {
        const contentWidth = w - CARD_H_PAD * 2;
        const lines = wrapText(node.description, contentWidth, DESC_CHAR_WIDTH);
        for (const line of lines) {
          nodeG
            .append('text')
            .attr('x', 0)
            .attr('y', yPos + DESC_FONT_SIZE / 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.textMuted)
            .attr('font-size', DESC_FONT_SIZE)
            .text(line);
          yPos += DESC_LINE_HEIGHT;
        }
      }
    }
  }

  // ── Legend ──
  if (!exportDims) {
    renderLegend(contentG as GSelection, layout, palette, isDark, activeTagGroup);
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
