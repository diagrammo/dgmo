// ============================================================
// ER Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { getSeriesColors } from '../palettes';
import type { ParsedERDiagram, ERConstraint } from './types';
import type { ERLayoutResult, ERLayoutNode, ERLayoutEdge } from './layout';
import { parseERDiagram } from './parser';
import { layoutERDiagram } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const TABLE_FONT_SIZE = 13;
const COLUMN_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const MEMBER_LINE_HEIGHT = 18;
const COMPARTMENT_PADDING_Y = 8;
const MEMBER_PADDING_X = 10;

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

// ============================================================
// Constraint icons (text glyphs for resvg compat)
// ============================================================

function constraintIcon(constraint: ERConstraint): string {
  switch (constraint) {
    case 'pk': return '\u2666'; // ♦
    case 'fk': return '\u2192'; // →
    case 'unique': return '\u25C6'; // ◆
    case 'nullable': return '\u25CB'; // ○
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
// Crow's foot marker drawing
// ============================================================

/**
 * Draw a crow's foot cardinality indicator at the given endpoint.
 *
 * Crow's foot notation:
 *   1  = perpendicular bar across the line
 *   *  = three prongs splaying outward from the line toward the entity
 *   ?  = open circle on the line + perpendicular bar
 *
 * The prongs fan out from a point on the line toward the entity edge,
 * like a bird's foot — NOT converging inward like an arrowhead.
 *
 * @param g - parent SVG group
 * @param point - endpoint position (where edge meets the entity)
 * @param prevPoint - previous point to determine angle
 * @param cardinality - '1', '*', or '?'
 * @param color - stroke color
 * @param useLabels - if true, render text labels instead of crow's foot
 */
function drawCardinality(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  point: { x: number; y: number },
  prevPoint: { x: number; y: number },
  cardinality: string,
  color: string,
  useLabels: boolean
): void {
  const dx = point.x - prevPoint.x;
  const dy = point.y - prevPoint.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;

  // Unit vector from prev toward endpoint (direction of edge arriving at entity)
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular
  const px = -uy;
  const py = ux;

  const sw = EDGE_STROKE_WIDTH + 0.5; // slightly heavier for visibility

  if (useLabels) {
    const offset = 15;
    const bx = point.x - ux * offset;
    const by = point.y - uy * offset;
    const labelText = cardinality === '1' ? '1' : cardinality === '*' ? '*' : '0..1';
    g.append('text')
      .attr('x', bx + px * 12)
      .attr('y', by + py * 12)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', color)
      .attr('font-size', EDGE_LABEL_FONT_SIZE)
      .text(labelText);
    return;
  }

  // Crow's foot notation
  const barOffset = 14; // how far back from the entity the bar sits
  const spread = 9;     // half-width of the perpendicular bar / prong span

  if (cardinality === '1') {
    // Single perpendicular bar
    const bx = point.x - ux * barOffset;
    const by = point.y - uy * barOffset;
    g.append('line')
      .attr('x1', bx + px * spread)
      .attr('y1', by + py * spread)
      .attr('x2', bx - px * spread)
      .attr('y2', by - py * spread)
      .attr('stroke', color)
      .attr('stroke-width', sw);
  } else if (cardinality === '*') {
    // Crow's foot: three prongs fan out FROM a point on the line
    // TOWARD the entity — the fork opens at the entity side.
    const forkOrigin = 18; // distance back from entity where prongs originate
    const forkEnd = 5;     // distance from entity where prongs terminate

    // Origin point (on the line, away from entity)
    const ox = point.x - ux * forkOrigin;
    const oy = point.y - uy * forkOrigin;

    // End points (near entity, splayed outward)
    const ex = point.x - ux * forkEnd;
    const ey = point.y - uy * forkEnd;

    // Top prong
    g.append('line')
      .attr('x1', ox)
      .attr('y1', oy)
      .attr('x2', ex + px * spread)
      .attr('y2', ey + py * spread)
      .attr('stroke', color)
      .attr('stroke-width', sw);
    // Bottom prong
    g.append('line')
      .attr('x1', ox)
      .attr('y1', oy)
      .attr('x2', ex - px * spread)
      .attr('y2', ey - py * spread)
      .attr('stroke', color)
      .attr('stroke-width', sw);
    // Middle prong (straight to entity)
    g.append('line')
      .attr('x1', ox)
      .attr('y1', oy)
      .attr('x2', ex)
      .attr('y2', ey)
      .attr('stroke', color)
      .attr('stroke-width', sw);
  } else if (cardinality === '?') {
    // Circle (zero) + perpendicular bar (one)
    const circleR = 5;
    const circleCenter = barOffset + circleR * 2 + 2; // circle sits behind the bar
    const cx = point.x - ux * circleCenter;
    const cy = point.y - uy * circleCenter;
    g.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', circleR)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', sw);
    // Perpendicular bar
    const bx = point.x - ux * barOffset;
    const by = point.y - uy * barOffset;
    g.append('line')
      .attr('x1', bx + px * spread)
      .attr('y1', by + py * spread)
      .attr('x2', bx - px * spread)
      .attr('y2', by - py * spread)
      .attr('stroke', color)
      .attr('stroke-width', sw);
  }
}

// ============================================================
// Main renderer
// ============================================================

export function renderERDiagram(
  container: HTMLDivElement,
  parsed: ParsedERDiagram,
  layout: ERLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number }
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleHeight = parsed.title ? 40 : 0;
  const diagramW = layout.width;
  const diagramH = layout.height;
  const availH = height - titleHeight;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const scaledH = diagramH * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = titleHeight + DIAGRAM_PADDING;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // ── Title ──
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

  // ── Content group ──
  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // ── Auto-assign colors ──
  const seriesColors = getSeriesColors(palette);

  // ── Edges (behind nodes) ──
  const useLabels = parsed.options.notation === 'labels';

  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const edgeG = contentG
      .append('g')
      .attr('class', 'er-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    const edgeColor = palette.textMuted;

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', EDGE_STROKE_WIDTH)
        .attr('class', 'er-edge');
    }

    // Cardinality markers at endpoints
    const pts = edge.points;
    // Source side (from cardinality)
    drawCardinality(
      edgeG,
      pts[0],
      pts[1],
      edge.cardinality.from,
      edgeColor,
      useLabels
    );
    // Target side (to cardinality)
    drawCardinality(
      edgeG,
      pts[pts.length - 1],
      pts[pts.length - 2],
      edge.cardinality.to,
      edgeColor,
      useLabels
    );

    // Edge label at midpoint
    if (edge.label) {
      const midIdx = Math.floor(pts.length / 2);
      const midPt = pts[midIdx];
      const labelLen = edge.label.length;
      const bgW = labelLen * 7 + 8;
      const bgH = 16;

      edgeG.append('rect')
        .attr('x', midPt.x - bgW / 2)
        .attr('y', midPt.y - bgH / 2 - 1)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.85)
        .attr('class', 'er-edge-label-bg');

      edgeG.append('text')
        .attr('x', midPt.x)
        .attr('y', midPt.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', EDGE_LABEL_FONT_SIZE)
        .attr('class', 'er-edge-label')
        .text(edge.label);
    }
  }

  // ── Nodes (top layer) ──
  for (let ni = 0; ni < layout.nodes.length; ni++) {
    const node = layout.nodes[ni];
    const nodeColor = node.color ?? seriesColors[ni % seriesColors.length];

    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'er-table')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id);

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    const w = node.width;
    const h = node.height;
    const fill = mix(nodeColor, isDark ? palette.surface : palette.bg, 25);
    const stroke = nodeColor;

    // Outer rectangle
    nodeG.append('rect')
      .attr('x', -w / 2)
      .attr('y', -h / 2)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Header section — table name
    let yPos = -h / 2;
    const headerCenterY = yPos + node.headerHeight / 2;

    nodeG.append('text')
      .attr('x', 0)
      .attr('y', headerCenterY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', palette.text)
      .attr('font-size', TABLE_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(node.name);

    yPos += node.headerHeight;

    // Columns compartment
    if (node.columns.length > 0) {
      // Separator line
      nodeG.append('line')
        .attr('x1', -w / 2)
        .attr('y1', yPos)
        .attr('x2', w / 2)
        .attr('y2', yPos)
        .attr('stroke', stroke)
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.5);

      let memberY = yPos + COMPARTMENT_PADDING_Y;
      for (const col of node.columns) {
        // Constraint icon (leftmost)
        const iconX = -w / 2 + MEMBER_PADDING_X;
        const primaryConstraint = col.constraints[0];
        if (primaryConstraint) {
          nodeG.append('text')
            .attr('x', iconX)
            .attr('y', memberY + MEMBER_LINE_HEIGHT / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', palette.textMuted)
            .attr('font-size', COLUMN_FONT_SIZE)
            .text(constraintIcon(primaryConstraint));
        }

        // Column name + type
        const textX = -w / 2 + MEMBER_PADDING_X + (primaryConstraint ? 16 : 0);
        let colText = col.name;
        if (col.type) colText += `: ${col.type}`;

        nodeG.append('text')
          .attr('x', textX)
          .attr('y', memberY + MEMBER_LINE_HEIGHT / 2)
          .attr('dominant-baseline', 'central')
          .attr('fill', palette.text)
          .attr('font-size', COLUMN_FONT_SIZE)
          .text(colText);

        memberY += MEMBER_LINE_HEIGHT;
      }
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderERDiagramForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseERDiagram(content, palette);
  if (parsed.error || parsed.tables.length === 0) return '';

  const layout = layoutERDiagram(parsed);
  const isDark = theme === 'dark';

  const container = document.createElement('div');
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + (parsed.title ? 40 : 0);
  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderERDiagram(
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
