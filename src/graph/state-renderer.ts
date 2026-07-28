// ============================================================
// State Diagram SVG Renderer
// ============================================================

import { serializeSvg } from '../utils/svg-serialize';
import * as d3Selection from 'd3-selection';
import {
  fillModeFromOptions,
  legendSuppressed,
  legendInlineRequested,
} from '../utils/parsing';
import { layoutInlineHeader } from '../utils/inline-header';
import { appendArrowheadMarkers } from '../utils/arrow-markers';
import { fitDiagramToCanvas } from '../utils/fit-canvas';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import {
  resolveActiveTagGroup,
  resolveTagColor,
  tagAttrKey,
} from '../utils/tag-groups';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  getMaxLegendReservedHeight,
  getLegendExtent,
} from '../utils/legend-layout';
import type { LegendGroupData } from '../utils/legend-types';
import type { ParsedGraph } from './types';
import type { LayoutResult, LayoutNode } from './layout';
import { parseState } from './state-parser';
import { layoutGraph } from './layout';
import { edgeSplinePath } from './edge-spline';
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

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const NODE_FONT_SIZE = 13;
const EDGE_LABEL_FONT_SIZE = 11;
const GROUP_LABEL_FONT_SIZE = 11;
import {
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
} from '../utils/visual-conventions'; // shared (Story 111.1)
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
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline'
): string {
  const color = nodeColor ?? stateDefaultColor(palette, colorOff);
  return shapeFill(palette, color, isDark, { mode: fillMode });
}

function stateStroke(
  palette: PaletteColors,
  nodeColor?: string,
  colorOff?: boolean
): string {
  return nodeColor ?? stateDefaultColor(palette, colorOff);
}

// ============================================================
// Self-loop path
// ============================================================

function selfLoopPath(node: LayoutNode): string {
  const cx = node.x;
  const cy = node.y;
  const r = node.width / 2;
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

  const ctx = ScaleContext.identity();

  const sDiagramPadding = ctx.aesthetic(DIAGRAM_PADDING);
  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sTitleY = ctx.structural(TITLE_Y);
  const sNodeFontSize = ctx.text(NODE_FONT_SIZE);
  const sEdgeLabelFontSize = ctx.text(EDGE_LABEL_FONT_SIZE);
  const sGroupLabelFontSize = ctx.text(GROUP_LABEL_FONT_SIZE);
  const sEdgeStrokeWidth = ctx.structural(EDGE_STROKE_WIDTH);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sArrowheadW = ctx.structural(ARROWHEAD_W);
  const sArrowheadH = ctx.structural(ARROWHEAD_H);
  const sPseudostateRadius = ctx.structural(PSEUDOSTATE_RADIUS);
  const sStateCornerRadius = ctx.structural(STATE_CORNER_RADIUS);
  const sGroupExtraPadding = ctx.aesthetic(GROUP_EXTRA_PADDING);

  const showTitle = !!graph.title && graph.options['no-title'] !== 'on';
  const titleHeight = showTitle ? 40 : 0;

  // ── Tag channel (decision #48) ─────────────────────────────
  const tagGroups = graph.tagGroups ?? [];
  const activeTagGroup = resolveActiveTagGroup(
    tagGroups,
    graph.options['active-tag']
  );
  const legendGroups: readonly LegendGroupData[] = tagGroups;
  const hasLegend = legendGroups.length > 0 && !legendSuppressed(graph.options);
  const legendH = hasLegend
    ? ctx.structural(
        getMaxLegendReservedHeight(
          {
            groups: legendGroups,
            position: { placement: 'top-center', titleRelation: 'below-title' },
            mode: exportDims ? 'export' : 'preview',
          },
          width
        )
      ) + 8
    : 0;

  // §1.9 `legend-inline` (decision #50): try a one-line header (title left,
  // legend flushed right). Falls back to the stacked band when it can't fit.
  const inlineRequested = legendInlineRequested(graph.options);
  const legendExtent =
    inlineRequested && hasLegend
      ? getLegendExtent(
          {
            groups: legendGroups,
            position: {
              placement: 'top-center',
              titleRelation: 'inline-with-title',
            },
            mode: exportDims ? 'export' : 'preview',
            showInactivePills: true,
          },
          { activeGroup: activeTagGroup },
          width
        )
      : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: graph.title ?? '',
    hasLegend,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth: width,
    titleBandHeight: titleHeight,
    legendReserve: legendH,
    titleBaselineY: sTitleY,
    titleFontSize: sTitleFontSize,
  });

  const diagramW = layout.width;
  const diagramH = layout.height;
  const { scale, offsetX, offsetY, canvasHeight } = fitDiagramToCanvas({
    width,
    height,
    diagramW,
    diagramH,
    padding: sDiagramPadding,
    // Inline → one band (title only); stacked → title + legend band.
    titleHeight: header.inline ? titleHeight : titleHeight + legendH,
    maxScale: MAX_SCALE,
    exportMode: !!exportDims,
  });

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', canvasHeight)
    .attr('viewBox', `0 0 ${width} ${canvasHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const defs = svg.append('defs');

  const edgeColors = new Set<string>();
  appendArrowheadMarkers(defs, {
    idPrefix: 'st',
    width: sArrowheadW,
    height: sArrowheadH,
    baseFill: palette.textMuted,
    colors: edgeColors,
  });

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
        onClickItem && graph.titleLineNumber ? 'pointer' : 'default'
      )
      .text(graph.title!);

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

  if (hasLegend) {
    const legendG = svg
      .append('g')
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0, ${titleHeight + 4})`
      );
    renderIntegratedLegend(legendG, {
      groups: legendGroups,
      activeGroup: activeTagGroup,
      mode: exportDims ? 'export' : 'preview',
      // Inactive sibling groups stay visible as collapsed pills so the user
      // can click one to flip the active colouring dimension (as in b&l).
      showInactivePills: true,
      // Inline → left-origin so the wrapper's right-flush translate lands the
      // legend at the chart's right edge; stacked → centered below the title.
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      palette,
      isDark,
      width,
    });
    legendG.selectAll('[data-legend-group]').classed('st-legend-group', true);
  }

  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  for (const group of layout.groups) {
    if (group.collapsed) continue;
    if (group.width === 0 && group.height === 0) continue;
    const gx = group.x - sGroupExtraPadding;
    const gy = group.y - sGroupExtraPadding - sGroupLabelFontSize - 4;
    const gw = group.width + sGroupExtraPadding * 2;
    const gh = group.height + sGroupExtraPadding * 2 + sGroupLabelFontSize + 4;

    // §1.9 fill-outline: group areas drop their wash — bg fill, colored frame.
    const groupOutline = fillModeFromOptions(graph.options ?? {}) === 'outline';
    const fillColor = groupOutline
      ? themeBaseBg(palette, isDark)
      : group.color
        ? mix(group.color, themeBaseBg(palette, isDark), 10)
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
      .attr('y', gy + sGroupLabelFontSize + 4)
      .attr('fill', strokeColor)
      .attr('font-size', sGroupLabelFontSize)
      .attr('font-weight', 'bold')
      .attr('opacity', 0.7)
      .attr('class', 'st-group-label')
      .text(group.label);
  }

  const selfLoopEdges = new Set<number>();
  for (const edge of layout.edges) {
    if (edge.source === edge.target) selfLoopEdges.add(edge.lineNumber);
  }

  const nodePositionMap = new Map<string, LayoutNode>();
  for (const node of layout.nodes) {
    nodePositionMap.set(node.id, node);
  }

  const LABEL_PAD = 8;
  const LABEL_H = 16;
  const PERP_OFFSET = 10;

  interface LabelPos {
    x: number;
    y: number;
    w: number;
    h: number;
    edgeIdx: number;
  }
  const labelPositions: LabelPos[] = [];

  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei]!;
    if (!edge.label) continue;
    const bgW = measureText(edge.label, sEdgeLabelFontSize) + LABEL_PAD;
    let lx: number, ly: number;

    if (edge.source === edge.target) {
      const node = nodePositionMap.get(edge.source);
      if (!node) continue;
      lx = node.x + node.width / 2 + 30;
      ly = node.y;
    } else if (edge.points.length >= 2) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPt = edge.points[midIdx]!;
      const prev = edge.points[Math.max(0, midIdx - 1)]!;
      const next = edge.points[Math.min(edge.points.length - 1, midIdx + 1)]!;
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
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

  labelPositions.sort((a, b) => a.y - b.y);
  for (let i = 0; i < labelPositions.length; i++) {
    for (let j = i + 1; j < labelPositions.length; j++) {
      const a = labelPositions[i]!;
      const b = labelPositions[j]!;
      const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
      const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      if (overlapX && overlapY) {
        b.y = a.y + (a.h + b.h) / 2 + 2;
      }
    }
  }

  const labelPosMap = new Map<number, LabelPos>();
  for (const lp of labelPositions) labelPosMap.set(lp.edgeIdx, lp);

  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei]!;
    const edgeG = contentG
      .append('g')
      .attr('class', 'st-edge-group')
      .attr('data-line-number', String(edge.lineNumber))
      // Endpoint node ids for baked-CSS connection-highlight (hover-styles.ts).
      .attr('data-source', edge.source)
      .attr('data-target', edge.target);

    const edgeColor = palette.textMuted;
    const markerId = 'st-arrow';

    if (edge.source === edge.target) {
      const node = nodePositionMap.get(edge.source);
      if (node) {
        edgeG
          .append('path')
          .attr('d', selfLoopPath(node))
          .attr('fill', 'none')
          .attr('stroke', edgeColor)
          .attr('stroke-width', sEdgeStrokeWidth)
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
            .attr('font-size', sEdgeLabelFontSize)
            .attr('class', 'st-edge-label')
            .text(edge.label);
        }
      }
    } else if (edge.points.length >= 2) {
      const pathD = edgeSplinePath(edge.points);
      if (pathD) {
        edgeG
          .append('path')
          .attr('d', pathD)
          .attr('fill', 'none')
          .attr('stroke', edgeColor)
          .attr('stroke-width', sEdgeStrokeWidth)
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
          .attr('font-size', sEdgeLabelFontSize)
          .attr('class', 'st-edge-label')
          .text(edge.label);
      }
    }
  }

  const collapsedGroupIds = new Set<string>();
  for (const group of layout.groups) {
    if (group.collapsed) collapsedGroupIds.add(group.id);
  }

  const colorOff = graph.options?.['color'] === 'off';
  const fillMode = fillModeFromOptions(graph.options ?? {});
  const noNotes = graph.options?.['no-notes'] === 'on';
  const mutableTagGroups = [...tagGroups];

  /**
   * Intent color for a state: an explicit color (only collapsed-group
   * stand-ins carry one) wins, then the active tag group's value, then the
   * default blue. `resolveTagColor` applies the §1.3 first-value fallback
   * for untagged states.
   */
  const nodeIntentColor = (node: LayoutNode): string | undefined =>
    node.color ??
    (activeTagGroup
      ? resolveTagColor(
          (node.metadata ?? {}) as Record<string, string>,
          mutableTagGroups,
          activeTagGroup
        )
      : undefined);

  for (const node of layout.nodes) {
    const isCollapsedGroup = collapsedGroupIds.has(node.id);

    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('class', isCollapsedGroup ? 'st-group-wrapper st-node' : 'st-node')
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id)
      .style('cursor', 'pointer');

    // Expose the active tag group's value for legend hover-dimming (F9:
    // exactly one `data-tag-*` per mark, the active group).
    if (activeTagGroup && node.shape !== 'pseudostate') {
      const tagKey = tagAttrKey(activeTagGroup);
      const metaValue = node.metadata?.[tagKey];
      if (metaValue) {
        nodeG.attr(`data-tag-${tagKey}`, metaValue.toLowerCase());
      }
    }

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

    // The shape draws at its dagre position — a note never moves it, so
    // its edges stay connected. The note floats beside it.
    const hasNote = !!node.note && !noNotes;

    if (node.shape === 'pseudostate') {
      nodeG
        .append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', sPseudostateRadius)
        .attr('fill', palette.text)
        .attr('stroke', 'none');
    } else if (isCollapsedGroup) {
      const w = node.width;
      const h = node.height;
      const groupColor =
        nodeIntentColor(node) ?? stateDefaultColor(palette, colorOff);
      const fillColor = shapeFill(palette, groupColor, isDark, {
        mode: fillMode,
      });
      const strokeColor = groupColor;
      const COLLAPSE_BAR_H = 6;

      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', sStateCornerRadius)
        .attr('ry', sStateCornerRadius)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', sNodeStrokeWidth);

      const clipId = `st-clip-${node.id.replace(/[[\]:\s]/g, '')}`;
      nodeG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', sStateCornerRadius);
      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', h / 2 - COLLAPSE_BAR_H)
        .attr('width', w)
        .attr('height', COLLAPSE_BAR_H)
        .attr('fill', strokeColor)
        .attr('opacity', 0.5)
        .attr('clip-path', `url(#${clipId})`);

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
        .attr('font-size', sNodeFontSize)
        .text(node.label);
    } else {
      const w = node.width;
      const h = node.height;
      const intentColor = nodeIntentColor(node);
      const resolvedFill = stateFill(
        palette,
        isDark,
        intentColor,
        colorOff,
        fillMode
      );
      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', sStateCornerRadius)
        .attr('ry', sStateCornerRadius)
        .attr('fill', resolvedFill)
        .attr('stroke', stateStroke(palette, intentColor, colorOff))
        .attr('stroke-width', sNodeStrokeWidth);

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
        .attr('font-size', sNodeFontSize)
        .text(node.label);
    }

    if (hasNote && node.note) {
      if (node.note.collapsed) {
        // Collapsed → comment-bubble badge in the node's top-right corner.
        renderNoteBadge(
          nodeG,
          {
            x: node.width / 2 - NOTE_BADGE_RADIUS - 3,
            y: -node.height / 2 + NOTE_BADGE_RADIUS + 3,
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
        // Solid tether from the shape edge to the floated note, on whichever
        // side the collision-aware placement chose.
        const [cx1, cy1, cx2, cy2] = noteConnectorPoints(node, node.note);
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
    layout.height +
    DIAGRAM_PADDING * 2 +
    (parsed.title && parsed.options['no-title'] !== 'on' ? 40 : 0);
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
    } else if (!svgEl.style.background) {
      svgEl.style.background = palette.bg;
    }

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return serializeSvg(svgEl);
  } finally {
    document.body.removeChild(container);
  }
}
