// ============================================================
// ER Diagram SVG Renderer
// ============================================================

import { serializeSvg } from '../utils/svg-serialize';
import { tagAttrKey } from '../utils/tag-groups';
import {
  fillModeFromOptions,
  legendSuppressed,
  legendInlineRequested,
} from '../utils/parsing';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, shapeFill } from '../palettes/color-utils';
import { getSeriesColors } from '../palettes';
import { resolveTagColor } from '../utils/tag-groups';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { getLegendExtent } from '../utils/legend-layout';
import { layoutInlineHeader } from '../utils/inline-header';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { ScaleContext } from '../utils/scaling';
import { measureText } from '../utils/text-measure';
import {
  renderNoteBox,
  renderNoteConnector,
  renderNoteBadge,
  noteConnectorPoints,
  NOTE_BADGE_RADIUS,
} from '../utils/note-box';
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
import {
  EDGE_LABEL_KNOCKOUT_OPACITY,
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
} from '../utils/visual-conventions'; // shared (Story 111.1)
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
  useLabels: boolean,
  edgeLabelFontSize = EDGE_LABEL_FONT_SIZE,
  edgeStrokeWidth = EDGE_STROKE_WIDTH
): void {
  const dx = point.x - prevPoint.x;
  const dy = point.y - prevPoint.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const sw = edgeStrokeWidth + 0.5;

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
      .attr('font-size', edgeLabelFontSize)
      .text(labelText);
    return;
  }

  const barOffset = 14;
  const spread = 9;

  if (cardinality === '1') {
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
    const forkOrigin = 18;
    const forkEnd = 5;

    const ox = point.x - ux * forkOrigin;
    const oy = point.y - uy * forkOrigin;

    const ex = point.x - ux * forkEnd;
    const ey = point.y - uy * forkEnd;

    g.append('line')
      .attr('x1', ox)
      .attr('y1', oy)
      .attr('x2', ex + px * spread)
      .attr('y2', ey + py * spread)
      .attr('stroke', color)
      .attr('stroke-width', sw);
    g.append('line')
      .attr('x1', ox)
      .attr('y1', oy)
      .attr('x2', ex - px * spread)
      .attr('y2', ey - py * spread)
      .attr('stroke', color)
      .attr('stroke-width', sw);
    g.append('line')
      .attr('x1', ox)
      .attr('y1', oy)
      .attr('x2', ex)
      .attr('y2', ey)
      .attr('stroke', color)
      .attr('stroke-width', sw);
  } else if (cardinality === '?') {
    const circleR = 5;
    const circleCenter = barOffset + circleR * 2 + 2;
    const cx = point.x - ux * circleCenter;
    const cy = point.y - uy * circleCenter;
    g.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', circleR)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', sw);
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
  const noLegend = legendSuppressed(parsed.options);
  const hasTagLegend = parsed.tagGroups.length > 0 && !noLegend;
  const legendReserveH =
    !noLegend && (useSemanticColors || hasTagLegend)
      ? LEGEND_HEIGHT + LEGEND_FIXED_GAP
      : 0;

  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const titleHeight = showTitle ? 40 : 0;
  const diagramW = layout.width;
  const diagramH = layout.height;

  const ctx = ScaleContext.identity();

  const sDiagramPadding = ctx.aesthetic(DIAGRAM_PADDING);
  const sTableFontSize = ctx.text(TABLE_FONT_SIZE);
  const sColumnFontSize = ctx.text(COLUMN_FONT_SIZE);
  const sEdgeLabelFontSize = ctx.text(EDGE_LABEL_FONT_SIZE);
  const sEdgeStrokeWidth = ctx.structural(EDGE_STROKE_WIDTH);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sMemberLineHeight = ctx.structural(MEMBER_LINE_HEIGHT);
  const sCompartmentPaddingY = ctx.structural(COMPARTMENT_PADDING_Y);
  const sMemberPaddingX = ctx.structural(MEMBER_PADDING_X);
  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sTitleY = ctx.structural(TITLE_Y);

  const naturalW = diagramW + sDiagramPadding * 2;

  // ── Semantic role classification (also feeds the legend below) ──
  // Computed here — rather than beside the content group — so the §1.9
  // inline-header fit test can measure the semantic (Role) legend's extent.
  const semanticRoles: Map<string, EntityRole> | null = useSemanticColors
    ? classifyEREntities([...parsed.tables], [...parsed.relationships])
    : null;
  // semanticColorsActive defaults to true; false = legend collapsed, neutral color applied
  const semanticActive =
    semanticRoles !== null && (semanticColorsActive ?? true);
  const presentRoles: EntityRole[] = semanticRoles
    ? ROLE_ORDER.filter((role) => {
        for (const r of semanticRoles.values()) {
          if (r === role) return true;
        }
        return false;
      })
    : [];
  const semanticGroups =
    presentRoles.length > 0
      ? [
          {
            name: 'Role',
            entries: presentRoles.map((role) => ({
              value: ROLE_LABELS[role],
              color: palette.colors[ROLE_COLORS[role]],
            })),
          },
        ]
      : [];
  const showSemanticLegend =
    semanticRoles !== null && !noLegend && presentRoles.length > 0;

  // §1.9 `legend-inline` (decision #50): try a one-line header (title left,
  // legend flushed right). ER shows EITHER the tag legend OR the semantic
  // (Role) legend — never both — so measure whichever will render. Falls back
  // to the stacked band when it can't fit on one row beside the title.
  const inlineRequested = legendInlineRequested(parsed.options);
  const hasLegend = hasTagLegend || showSemanticLegend;
  const inlineLegendGroups = hasTagLegend ? parsed.tagGroups : semanticGroups;
  const inlineActiveGroup = hasTagLegend
    ? (activeTagGroup ?? null)
    : semanticActive
      ? 'Role'
      : null;
  const inlineContainerW = exportDims?.width ?? naturalW;
  const legendExtent =
    inlineRequested && hasLegend
      ? getLegendExtent(
          {
            groups: inlineLegendGroups,
            position: {
              placement: 'top-center',
              titleRelation: 'inline-with-title',
            },
            mode: exportMode ? 'export' : 'preview',
          },
          { activeGroup: inlineActiveGroup },
          inlineContainerW
        )
      : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: parsed.title ?? '',
    hasLegend,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth: inlineContainerW,
    titleBandHeight: titleHeight,
    legendReserve: legendReserveH,
    titleBaselineY: sTitleY,
    titleFontSize: sTitleFontSize,
  });
  // Inline → the legend rides in the title band; drop the stacked reserve from
  // the content offset. Stacked → unchanged.
  const effectiveReserveH = header.inline ? 0 : legendReserveH;

  const naturalH =
    diagramH + titleHeight + effectiveReserveH + sDiagramPadding * 2;

  let viewW: number;
  let viewH: number;
  let scale: number;
  let offsetX: number;
  let offsetY: number;

  if (exportDims) {
    viewW = exportDims.width ?? naturalW;
    viewH = exportDims.height ?? naturalH;
    const availH = viewH - titleHeight - effectiveReserveH;
    const scaleX = (viewW - sDiagramPadding * 2) / diagramW;
    const scaleY = (availH - sDiagramPadding * 2) / diagramH;
    scale = Math.min(MAX_SCALE, scaleX, scaleY);
    const scaledW = diagramW * scale;
    offsetX = (viewW - scaledW) / 2;
    offsetY = titleHeight + effectiveReserveH + sDiagramPadding;
  } else {
    viewW = naturalW;
    viewH = naturalH;
    scale = 1;
    offsetX = sDiagramPadding;
    offsetY = titleHeight + effectiveReserveH + sDiagramPadding;
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

  if (showTitle) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', header.titleX)
      .attr('y', sTitleY)
      .attr('text-anchor', header.titleAnchor)
      .attr('fill', palette.text)
      .attr('font-size', sTitleFontSize)
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
  // `semanticRoles` / `semanticActive` were computed above (before the header)
  // so the §1.9 inline-header fit test could measure the semantic legend.

  // ── Edges (behind nodes) ──
  const useLabels = parsed.options['notation'] === 'labels';

  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const edgeG = contentG
      .append('g')
      .attr('class', 'er-edge-group')
      .attr('data-line-number', String(edge.lineNumber))
      // Endpoint node ids for baked-CSS connection-highlight (hover-styles.ts).
      .attr('data-source', edge.source)
      .attr('data-target', edge.target);

    const edgeColor = palette.textMuted;

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', sEdgeStrokeWidth)
        .attr('class', 'er-edge');
    }

    const pts = edge.points;
    drawCardinality(
      edgeG,
      pts[0]!,
      pts[1]!,
      edge.cardinality.from,
      edgeColor,
      useLabels,
      sEdgeLabelFontSize,
      sEdgeStrokeWidth
    );
    drawCardinality(
      edgeG,
      pts[pts.length - 1]!,
      pts[pts.length - 2]!,
      edge.cardinality.to,
      edgeColor,
      useLabels,
      sEdgeLabelFontSize,
      sEdgeStrokeWidth
    );

    // Edge label at midpoint
    if (edge.label) {
      const midIdx = Math.floor(pts.length / 2);
      // In-bounds: midIdx is in [0, pts.length-1] since pts.length >= 2.
      const midPt = pts[midIdx]!;
      const bgW = measureText(edge.label, sEdgeLabelFontSize) + 8;
      const bgH = 16;

      edgeG
        .append('rect')
        .attr('x', midPt.x - bgW / 2)
        .attr('y', midPt.y - bgH / 2 - 1)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', EDGE_LABEL_KNOCKOUT_OPACITY)
        .attr('class', 'er-edge-label-bg');

      edgeG
        .append('text')
        .attr('x', midPt.x)
        .attr('y', midPt.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', sEdgeLabelFontSize)
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
      [...parsed.tagGroups],
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
      const tagKey = tagAttrKey(activeTagGroup);
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
      mode: fillModeFromOptions(parsed.options),
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
      .attr('stroke-width', sNodeStrokeWidth);

    let yPos = -h / 2;
    const headerCenterY = yPos + node.headerHeight / 2;

    nodeG
      .append('text')
      .attr('x', 0)
      .attr('y', headerCenterY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', onFillText)
      .attr('font-size', sTableFontSize)
      .attr('font-weight', 'bold')
      .text(node.name);

    yPos += node.headerHeight;

    if (node.columns.length > 0) {
      nodeG
        .append('line')
        .attr('x1', -w / 2)
        .attr('y1', yPos)
        .attr('x2', w / 2)
        .attr('y2', yPos)
        .attr('stroke', stroke)
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.5);

      let memberY = yPos + sCompartmentPaddingY;
      for (const col of node.columns) {
        const iconX = -w / 2 + sMemberPaddingX;
        const primaryConstraint = col.constraints[0];
        if (primaryConstraint) {
          nodeG
            .append('text')
            .attr('x', iconX)
            .attr('y', memberY + sMemberLineHeight / 2)
            .attr('dominant-baseline', 'central')
            .attr('fill', onFillText)
            .attr('font-size', sColumnFontSize)
            .text(constraintIcon(primaryConstraint));
        }

        const textX = -w / 2 + sMemberPaddingX + (primaryConstraint ? 16 : 0);
        let colText = col.name;
        if (col.type) colText += `: ${col.type}`;

        nodeG
          .append('text')
          .attr('x', textX)
          .attr('y', memberY + sMemberLineHeight / 2)
          .attr('dominant-baseline', 'central')
          .attr('fill', onFillText)
          .attr('font-size', sColumnFontSize)
          .text(colText);

        memberY += sMemberLineHeight;
      }
    }

    // ── Note (floated beside the table, or a collapsed corner badge) ──
    // The table keeps its layout position; the note floats in adjacent
    // space. Coords are node-center-local (the node `<g>` is at the center).
    if (node.note) {
      if (node.note.collapsed) {
        renderNoteBadge(
          nodeG,
          {
            x: w / 2 - NOTE_BADGE_RADIUS - 3,
            y: -h / 2 + NOTE_BADGE_RADIUS + 3,
          },
          palette,
          {
            isDark,
            ...(node.note.color && { color: node.note.color }),
            lineNumber: node.note.lineNumber,
            endLineNumber: node.note.endLineNumber,
          }
        );
      } else {
        const [cx1, cy1, cx2, cy2] = noteConnectorPoints(
          { width: w, height: h },
          node.note
        );
        renderNoteConnector(nodeG, cx1, cy1, cx2, cy2, palette);
        renderNoteBox(
          nodeG,
          {
            x: node.note.x,
            y: node.note.y,
            width: node.note.width,
            height: node.note.height,
          },
          node.note.lines,
          palette,
          {
            isDark,
            ...(node.note.color && { color: node.note.color }),
            lineNumber: node.note.lineNumber,
            endLineNumber: node.note.endLineNumber,
            interactive: true,
          }
        );
      }
    }
  }

  // ── Tag Legend ──
  if (hasTagLegend) {
    const legendY = sDiagramPadding + titleHeight;
    const legendG = svg
      .append('g')
      .attr('class', 'er-tag-legend')
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0,${legendY})`
      );
    renderIntegratedLegend(legendG, {
      groups: parsed.tagGroups,
      activeGroup: activeTagGroup ?? null,
      mode: exportMode ? 'export' : 'preview',
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      palette,
      isDark,
      width: viewW,
    });
    legendG.selectAll('[data-legend-group]').classed('er-legend-group', true);
  }

  // ── Semantic Legend ──
  // `presentRoles` / `semanticGroups` / `showSemanticLegend` were computed above
  // (before the header) so the inline fit test could measure this legend.
  if (showSemanticLegend) {
    const legendY = sDiagramPadding + titleHeight;
    const legendG = svg
      .append('g')
      .attr('class', 'er-semantic-legend')
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0,${legendY})`
      );
    renderIntegratedLegend(legendG, {
      groups: semanticGroups,
      activeGroup: semanticActive ? 'Role' : null,
      mode: exportMode ? 'export' : 'preview',
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      palette,
      isDark,
      width: viewW,
    });
    legendG.selectAll('[data-legend-group]').classed('er-legend-group', true);
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

    return serializeSvg(svgEl);
  } finally {
    document.body.removeChild(container);
  }
}
