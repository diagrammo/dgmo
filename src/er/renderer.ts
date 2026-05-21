// ============================================================
// ER Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, shapeFill } from '../palettes/color-utils';
import { getSeriesColors } from '../palettes';
import { resolveTagColor } from '../utils/tag-groups';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import type { ParsedERDiagram, ERConstraint } from './types';
import type { ERLayoutResult } from './layout';
import { parseERDiagram } from './parser';
import { layoutERDiagram } from './layout';
import {
  classifyEREntities,
  ROLE_COLORS,
  ROLE_LABELS,
  ROLE_ORDER,
} from './classify';
import type { EntityRole } from './classify';

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
// Constraint icons (text glyphs for resvg compat)
// ============================================================

function constraintIcon(constraint: ERConstraint): string {
  switch (constraint) {
    case 'pk':
      return '\u2666'; // ♦
    case 'fk':
      return '\u2192'; // →
    case 'unique':
      return '\u25C6'; // ◆
    case 'nullable':
      return '\u25CB'; // ○
  }
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
    const labelText =
      cardinality === '1' ? '1' : cardinality === '*' ? '*' : '0..1';
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
  const spread = 9; // half-width of the perpendicular bar / prong span

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
    const forkEnd = 5; // distance from entity where prongs terminate

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
  exportDims?: { width?: number; height?: number },
  activeTagGroup?: string | null,
  /** When false, semantic role colors are suppressed and entities use a neutral color. */
  semanticColorsActive?: boolean,
  exportMode?: boolean
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const useSemanticColors =
    parsed.tagGroups.length === 0 && layout.nodes.every((n) => !n.color);
  const LEGEND_FIXED_GAP = 8;
  const hasTagLegend = parsed.tagGroups.length > 0;
  const legendReserveH = useSemanticColors
    ? LEGEND_HEIGHT + LEGEND_FIXED_GAP
    : hasTagLegend
      ? LEGEND_HEIGHT + LEGEND_FIXED_GAP
      : 0;

  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const titleHeight = showTitle ? 40 : 0;
  const diagramW = layout.width;
  const diagramH = layout.height;

  // Natural dimensions derived purely from the layout — no dependency on container
  // size at render time, which eliminates the stagger caused by reading clientWidth/
  // clientHeight before the container has stabilized.
  const naturalW = diagramW + DIAGRAM_PADDING * 2;
  const naturalH =
    diagramH + titleHeight + legendReserveH + DIAGRAM_PADDING * 2;

  // For export: scale the natural layout to fit the requested pixel dimensions.
  // For live preview: render at natural scale (scale=1) and let the SVG viewBox
  // handle fitting to the container via CSS.
  let viewW: number;
  let viewH: number;
  let scale: number;
  let offsetX: number;
  let offsetY: number;

  if (exportDims) {
    viewW = exportDims.width ?? naturalW;
    viewH = exportDims.height ?? naturalH;
    const availH = viewH - titleHeight - legendReserveH;
    const scaleX = (viewW - DIAGRAM_PADDING * 2) / diagramW;
    const scaleY = (availH - DIAGRAM_PADDING * 2) / diagramH;
    scale = Math.min(MAX_SCALE, scaleX, scaleY);
    const scaledW = diagramW * scale;
    offsetX = (viewW - scaledW) / 2;
    offsetY = titleHeight + legendReserveH + DIAGRAM_PADDING;
  } else {
    viewW = naturalW;
    viewH = naturalH;
    scale = 1;
    offsetX = DIAGRAM_PADDING;
    offsetY = titleHeight + legendReserveH + DIAGRAM_PADDING;
  }

  if (viewW <= 0 || viewH <= 0) return;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', exportDims ? viewW : '100%')
    .attr('height', exportDims ? viewH : '100%')
    .attr('viewBox', `0 0 ${viewW} ${viewH}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('font-family', FONT_FAMILY);

  // ── Title ──
  if (showTitle) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', viewW / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .style(
        'cursor',
        onClickItem && parsed.titleLineNumber ? 'pointer' : 'default'
      )
      .text(parsed.title!);

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

  // ── Auto-assign colors ──
  const seriesColors = getSeriesColors(palette);

  // ── Semantic coloring gate ──
  // Classify entities whenever conditions allow; suppress colors when user collapses the legend.
  // (useSemanticColors was computed above for legend reserve height)
  const semanticRoles: Map<string, EntityRole> | null = useSemanticColors
    ? classifyEREntities(parsed.tables, parsed.relationships)
    : null;
  // semanticColorsActive defaults to true; false = legend collapsed, neutral color applied
  const semanticActive =
    semanticRoles !== null && (semanticColorsActive ?? true);

  // ── Edges (behind nodes) ──
  const useLabels = parsed.options['notation'] === 'labels';

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
    // Source side (from cardinality) — in-bounds: edge.points.length < 2 was skipped above.
    drawCardinality(
      edgeG,
      pts[0]!,
      pts[1]!,
      edge.cardinality.from,
      edgeColor,
      useLabels
    );
    // Target side (to cardinality) — in-bounds: pts.length >= 2 guaranteed above.
    drawCardinality(
      edgeG,
      pts[pts.length - 1]!,
      pts[pts.length - 2]!,
      edge.cardinality.to,
      edgeColor,
      useLabels
    );

    // Edge label at midpoint
    if (edge.label) {
      const midIdx = Math.floor(pts.length / 2);
      // In-bounds: midIdx is in [0, pts.length-1] since pts.length >= 2.
      const midPt = pts[midIdx]!;
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
        .attr('class', 'er-edge-label-bg');

      edgeG
        .append('text')
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
    // In-bounds by loop guard.
    const node = layout.nodes[ni]!;
    const tagColor = resolveTagColor(
      node.metadata,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    const semanticColor = semanticActive
      ? palette.colors[
          ROLE_COLORS[semanticRoles!.get(node.id) ?? 'unclassified']
        ]
      : semanticRoles
        ? palette.primary // neutral color when legend is collapsed
        : undefined;
    const nodeColor =
      node.color ??
      tagColor ??
      semanticColor ??
      // In-bounds by modulo: seriesColors is non-empty from the palette.
      seriesColors[ni % seriesColors.length]!;

    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', 'er-table')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id);

    // Set data-tag-* attributes for legend hover
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const tagValue = node.metadata[tagKey];
      if (tagValue) {
        nodeG.attr(`data-tag-${tagKey}`, tagValue.toLowerCase());
      }
    }

    // Set data-er-role for semantic coloring (CSS targeting + test assertions)
    if (semanticRoles) {
      const role = semanticRoles.get(node.id);
      if (role) nodeG.attr('data-er-role', role);
    }

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    const w = node.width;
    const h = node.height;
    const fill = shapeFill(palette, nodeColor, isDark, {
      solid: parsed.options['solid-fill'] === 'on',
    });
    const stroke = nodeColor;
    const onFillText = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

    // Outer rectangle
    nodeG
      .append('rect')
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

    nodeG
      .append('text')
      .attr('x', 0)
      .attr('y', headerCenterY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', onFillText)
      .attr('font-size', TABLE_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(node.name);

    yPos += node.headerHeight;

    // Columns compartment
    if (node.columns.length > 0) {
      // Separator line
      nodeG
        .append('line')
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
          nodeG
            .append('text')
            .attr('x', iconX)
            .attr('y', memberY + MEMBER_LINE_HEIGHT / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', onFillText)
            .attr('font-size', COLUMN_FONT_SIZE)
            .text(constraintIcon(primaryConstraint));
        }

        // Column name + type
        const textX = -w / 2 + MEMBER_PADDING_X + (primaryConstraint ? 16 : 0);
        let colText = col.name;
        if (col.type) colText += `: ${col.type}`;

        nodeG
          .append('text')
          .attr('x', textX)
          .attr('y', memberY + MEMBER_LINE_HEIGHT / 2)
          .attr('dominant-baseline', 'central')
          .attr('fill', onFillText)
          .attr('font-size', COLUMN_FONT_SIZE)
          .text(colText);

        memberY += MEMBER_LINE_HEIGHT;
      }
    }
  }

  // ── Tag Legend ──
  if (parsed.tagGroups.length > 0) {
    const legendY = DIAGRAM_PADDING + titleHeight;
    const legendConfig: LegendConfig = {
      groups: parsed.tagGroups,
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: exportMode ? 'export' : 'preview',
    };
    const legendState: LegendState = { activeGroup: activeTagGroup ?? null };
    const legendG = svg
      .append('g')
      .attr('class', 'er-tag-legend')
      .attr('transform', `translate(0,${legendY})`);
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      undefined,
      viewW
    );
    legendG.selectAll('[data-legend-group]').classed('er-legend-group', true);
  }

  // ── Semantic Legend ──
  if (semanticRoles) {
    const presentRoles = ROLE_ORDER.filter((role) => {
      for (const r of semanticRoles.values()) {
        if (r === role) return true;
      }
      return false;
    });

    if (presentRoles.length > 0) {
      const legendY = DIAGRAM_PADDING + titleHeight;
      const semanticGroups = [
        {
          name: 'Role',
          entries: presentRoles.map((role) => ({
            value: ROLE_LABELS[role],
            color: palette.colors[ROLE_COLORS[role]],
          })),
        },
      ];
      const legendConfig: LegendConfig = {
        groups: semanticGroups,
        position: { placement: 'top-center', titleRelation: 'below-title' },
        mode: exportMode ? 'export' : 'preview',
      };
      const legendState: LegendState = {
        activeGroup: semanticActive ? 'Role' : null,
      };
      const legendG = svg
        .append('g')
        .attr('class', 'er-semantic-legend')
        .attr('transform', `translate(0,${legendY})`);
      renderLegendD3(
        legendG,
        legendConfig,
        legendState,
        palette,
        isDark,
        undefined,
        viewW
      );
      legendG.selectAll('[data-legend-group]').classed('er-legend-group', true);
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
  const exportHeight =
    layout.height +
    DIAGRAM_PADDING * 2 +
    (parsed.title && parsed.options['no-title'] !== 'on' ? 40 : 0);
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
      {
        width: exportWidth,
        height: exportHeight,
      },
      undefined,
      undefined,
      true
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
