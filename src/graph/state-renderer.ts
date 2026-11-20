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
import {
  INLINE_HEADER_PAD,
  layoutInlineHeader,
  measureTitleWidth,
} from '../utils/inline-header';
import { Bounds } from '../utils/bounds';
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
  resolveGroupTagColor,
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
import { parseState, FINAL_PSEUDOSTATE_ID } from './state-parser';
import { layoutGraph } from './layout';
import { storyGround } from '../utils/emphasis';
import { resolveGraphHighlight } from './highlight';
import { renderGraphTitle } from './title';
import { growChartFrame } from '../utils/chart-frame';
import { edgeSplinePath, selfLoopArcPath } from './edge-spline';
import { withoutApproach } from './edge-ports';
import {
  clearEdgeLabel,
  labelClear,
  type ObstacleBox,
} from './edge-label-place';
import {
  LEGEND_BODY_GAP,
  TITLE_FONT_SIZE,
  TITLE_Y,
} from '../utils/title-constants';
import { legendInkBottom } from '../utils/legend-constants';
import { ScaleContext } from '../utils/scaling';
import { renderCollapseBar } from '../utils/card';
import { measureText } from '../utils/text-measure';
import { renderNodeNote, NOTE_FONT_SIZE } from '../utils/note-box';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const NODE_FONT_SIZE = 13;
const EDGE_LABEL_FONT_SIZE = 11;
const GROUP_LABEL_FONT_SIZE = 11;
import {
  EDGE_LABEL_KNOCKOUT_OPACITY,
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
  ARROWHEAD_WIDTH,
  ARROWHEAD_HEIGHT,
} from '../utils/visual-conventions'; // shared (Story 111.1)
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
  const sArrowheadW = ctx.structural(ARROWHEAD_WIDTH);
  const sArrowheadH = ctx.structural(ARROWHEAD_HEIGHT);
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

  const LABEL_PAD = 8;
  const LABEL_H = 16;
  const PERP_OFFSET = 10;

  const nodeCenters = new Map<string, LayoutNode>();
  for (const node of layout.nodes) nodeCenters.set(node.id, node);

  interface LabelPos {
    x: number;
    y: number;
    w: number;
    h: number;
    edgeIdx: number;
  }
  const labelPositions: LabelPos[] = [];

  // What an edge label must not cover: every state, and every group's title
  // band (#1948).
  const labelObstacles: ObstacleBox[] = layout.nodes.map((n) => ({
    x: n.x - n.width / 2,
    y: n.y - n.height / 2,
    w: n.width,
    h: n.height,
  }));
  for (const g of layout.groups) {
    if (g.collapsed) continue;
    labelObstacles.push({
      x: g.x - sGroupExtraPadding,
      y: g.y - sGroupExtraPadding - sGroupLabelFontSize - 4,
      w: g.width + sGroupExtraPadding * 2,
      h: sGroupLabelFontSize + 8,
    });
  }

  // Each edge's middle waypoint by `source\0target`, so a two-way pair can
  // put its labels on the outside of the pair.
  const reverseMid = new Map<string, { x: number; y: number }>();
  for (const edge of layout.edges) {
    if (edge.source === edge.target || edge.points.length < 2) continue;
    const route = withoutApproach(edge.points);
    const key = `${edge.source}\u0000${edge.target}`;
    if (!reverseMid.has(key))
      reverseMid.set(key, route[Math.floor(route.length / 2)]!);
  }

  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei]!;
    if (!edge.label) continue;
    const bgW = measureText(edge.label, sEdgeLabelFontSize) + LABEL_PAD;
    let lx: number, ly: number;

    if (edge.points.length >= 2) {
      // The label sits on dagre's middle waypoint, not one a square arrival
      // added near the arrowhead (#1839).
      const route = withoutApproach(edge.points);
      const midIdx = Math.floor(route.length / 2);
      const midPt = route[midIdx]!;
      const prev = route[Math.max(0, midIdx - 1)]!;
      const next = route[Math.min(route.length - 1, midIdx + 1)]!;
      const self = edge.source === edge.target;
      const node = self ? nodeCenters.get(edge.source) : undefined;
      if (self && node) {
        // A self-loop's midpoint is the far apex of the arc, and the two
        // waypoints around it are parallel to the node's edge — so the
        // perpendicular used below is ambiguous in sign and half the time
        // pushes the label back over the node. Push it straight out from
        // the node center instead, which is correct in every `rankdir`.
        const ox = midPt.x - node.x;
        const oy = midPt.y - node.y;
        const olen = Math.sqrt(ox * ox + oy * oy);
        if (olen > 0) {
          lx = midPt.x + (ox / olen) * PERP_OFFSET;
          ly = midPt.y + (oy / olen) * PERP_OFFSET;
        } else {
          lx = midPt.x;
          ly = midPt.y;
        }
      } else {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          // Left of the direction, unless the edge has a reverse partner on
          // that side: then the label goes on the far side, so each label of
          // a two-way pair sits beside its own curve, not between them (#2072).
          let sign = 1;
          const partner = reverseMid.get(`${edge.target}\u0000${edge.source}`);
          if (partner) {
            const toPartner =
              (-dy / len) * (partner.x - midPt.x) +
              (dx / len) * (partner.y - midPt.y);
            if (toPartner > 0) sign = -1;
          }
          lx = midPt.x + (-dy / len) * PERP_OFFSET * sign;
          ly = midPt.y + (dx / len) * PERP_OFFSET * sign;
        } else {
          lx = midPt.x;
          ly = midPt.y;
        }
        // A label on a state slides along its edge until it is clear (#1948).
        ({ x: lx, y: ly } = clearEdgeLabel(
          route,
          { x: lx, y: ly },
          bgW,
          LABEL_H,
          labelObstacles
        ));
      }
    } else {
      continue;
    }
    labelPositions.push({ x: lx, y: ly, w: bgW, h: LABEL_H, edgeIdx: ei });
  }

  // A placed label as an obstacle, in the box `labelClear` tests against.
  const labelBox = (l: LabelPos): ObstacleBox => ({
    x: l.x - l.w / 2,
    y: l.y - l.h / 2 - 1,
    w: l.w,
    h: l.h,
  });
  labelPositions.sort((a, b) => a.y - b.y);
  for (let i = 0; i < labelPositions.length; i++) {
    for (let j = i + 1; j < labelPositions.length; j++) {
      const a = labelPositions[i]!;
      const b = labelPositions[j]!;
      const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
      const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      if (overlapX && overlapY) {
        // Below `a`, unless that lands on a state and above `a` does not:
        // a label is drawn under the states, so one pushed onto a box is
        // hidden (#2072).
        const down = a.y + (a.h + b.h) / 2 + 2;
        const up = a.y - (a.h + b.h) / 2 - 2;
        const others = labelPositions.filter((o) => o !== b);
        const free = (y: number): boolean =>
          labelClear(b.x, y, b.w, b.h, labelObstacles) &&
          labelClear(b.x, y, b.w, b.h, others.map(labelBox));
        const downOnState = !labelClear(b.x, down, b.w, b.h, labelObstacles);
        b.y = downOnState && free(up) ? up : down;
      }
    }
  }

  const labelPosMap = new Map<number, LabelPos>();
  for (const lp of labelPositions) labelPosMap.set(lp.edgeIdx, lp);

  // The drawing's own extent: states, open notes, group frames, every edge's
  // waypoints (a curve stays inside them) and every edge label. The layout's
  // size reaches 40 px past the last state and nothing above the first, so
  // fitting to it left a dead band right and below and let a label or curve
  // above the top state climb into the title band (#1838, #2072). The plot
  // is fitted to this box and moved so its corner sits at the origin.
  const noNotes = graph.options?.['no-notes'] === 'on';
  const ext = new Bounds();
  for (const n of layout.nodes) {
    ext.addCentred(n);
    if (n.note && !n.note.collapsed && !noNotes)
      ext.add(
        n.x + n.note.x,
        n.y + n.note.y,
        n.x + n.note.x + n.note.width,
        n.y + n.note.y + n.note.height
      );
  }
  for (const g of layout.groups) {
    if (g.collapsed || (g.width === 0 && g.height === 0)) continue;
    ext.add(
      g.x - sGroupExtraPadding,
      g.y - sGroupExtraPadding - sGroupLabelFontSize - 4,
      g.x + g.width + sGroupExtraPadding,
      g.y + g.height + sGroupExtraPadding
    );
  }
  // Allow for the stroke.
  for (const e of layout.edges)
    for (const pt of e.points) ext.add(pt.x - 1, pt.y - 1, pt.x + 1, pt.y + 1);
  for (const lp of labelPositions) {
    const b = labelBox(lp);
    ext.add(b.x, b.y, b.x + b.w, b.y + b.h);
  }
  ext.orZero();
  // With a title, the drawing starts LEGEND_BODY_GAP under the legend's ink
  // (#1838). The legend is drawn 4 below the title band; the drawing sits one
  // padding under the band this reserves.
  const stackedLegendBand =
    hasLegend && showTitle
      ? legendInkBottom(legendH - 8) + LEGEND_BODY_GAP + 4 - sDiagramPadding
      : legendH;
  const diagramW = ext.maxX - ext.minX;
  const diagramH = ext.maxY - ext.minY;
  // An export never scales text under the 7px floor (#1688): hold the scale
  // for the smallest text this diagram really draws, and widen the sheet.
  const smallestTextPx = Math.min(
    sNodeFontSize,
    layout.edges.some((e) => e.label) ? sEdgeLabelFontSize : Infinity,
    layout.groups.length > 0 ? sGroupLabelFontSize : Infinity,
    !noNotes && layout.nodes.some((n) => n.note && !n.note.collapsed)
      ? NOTE_FONT_SIZE
      : Infinity
  );
  const fit = fitDiagramToCanvas({
    width,
    height,
    diagramW,
    diagramH,
    padding: sDiagramPadding,
    smallestTextPx,
    // Inline → one band (title only); stacked → title + legend band.
    titleHeight: header.inline ? titleHeight : titleHeight + stackedLegendBand,
    maxScale: MAX_SCALE,
    exportMode: !!exportDims,
  });
  const { scale, canvasHeight } = fit;
  let { canvasWidth } = fit;
  let offsetX = fit.offsetX - ext.minX * scale;
  const offsetY = fit.offsetY - ext.minY * scale;
  // An export canvas shrinks to the drawing, so a title wider than the drawing
  // widens the canvas, as flowchart does (#1420): otherwise it ran off the
  // right edge (#2072). An inline header keeps its own layout.
  if (showTitle && exportDims && !header.inline) {
    const titleW = Math.ceil(
      measureTitleWidth(graph.title ?? '', sTitleFontSize) +
        INLINE_HEADER_PAD * 2
    );
    if (titleW > canvasWidth) {
      offsetX += (titleW - canvasWidth) / 2;
      canvasWidth = titleW;
    }
  }

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', canvasWidth)
    .attr('height', canvasHeight)
    .attr('viewBox', `0 0 ${canvasWidth} ${canvasHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const defs = svg.append('defs');

  const edgeColors = new Set<string>();
  // `highlight` story view (#2041): what is not lit is painted the ground.
  const story = resolveGraphHighlight(graph.emphasis, graph.nodes, graph.edges);
  const ground = story.active ? storyGround(palette, isDark) : null;
  if (ground) edgeColors.add(ground.groundStroke);
  appendArrowheadMarkers(defs, {
    idPrefix: 'st',
    width: sArrowheadW,
    height: sArrowheadH,
    baseFill: palette.textMuted,
    colors: edgeColors,
  });

  if (showTitle) {
    renderGraphTitle(svg, {
      title: graph.title ?? '',
      titleLineNumber: graph.titleLineNumber,
      x: header.titleX,
      y: sTitleY,
      anchor: header.titleAnchor,
      fontSize: sTitleFontSize,
      color: palette.text,
      onClickItem,
    });
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
      frame: graph.frame,
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

    // The frame's color: a value from the active tag group if the author put
    // one on the group line, else the §1.8 trailing palette word. The tag wins
    // for the same reason it wins on a state — when a tag group is the active
    // dimension, that dimension is what the picture is colored by.
    //
    // Until 2026-08-30 a tag value here was not merely ignored: the whole
    // group was destroyed at parse time (#585). See `state-parser.ts`.
    const groupColor =
      resolveGroupTagColor(group.metadata, tagGroups, activeTagGroup) ??
      group.color;

    // §1.9 fill-outline: group areas drop their wash — bg fill, colored frame.
    const groupOutline = fillModeFromOptions(graph.options ?? {}) === 'outline';
    const fillColor = groupOutline
      ? themeBaseBg(palette, isDark)
      : groupColor
        ? mix(groupColor, themeBaseBg(palette, isDark), 10)
        : isDark
          ? palette.surface
          : mix(palette.border, palette.bg, 30);
    const frameReceded =
      !!ground &&
      !(graph.groups ?? [])
        .find((g) => g.id === group.id)
        ?.nodeIds.some((id) => story.litNodeIds.has(id));
    const strokeColor = frameReceded
      ? ground.groundStroke
      : (groupColor ?? palette.textMuted);

    const groupWrapper = contentG
      .append('g')
      .attr('class', 'st-group-wrapper')
      .attr('data-line-number', String(group.lineNumber))
      .attr('data-group-id', group.id)
      .attr('data-group-toggle', group.id)
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
      .attr('fill', frameReceded ? ground.groundFill : fillColor)
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

    // An expanded group folds: its hover preview of the bar (#1741).
    renderCollapseBar(groupWrapper, {
      expanded: true,
      x: gx,
      y: gy,
      width: gw,
      height: gh,
      rx: 6,
      fill: strokeColor,
      clipId: `st-group-clip-${group.id.replace(/[[\]:\s]/g, '')}`,
      prefix: 'state',
      scale: ctx,
    });
  }

  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei]!;
    const edgeG = contentG
      .append('g')
      .attr('class', 'st-edge-group')
      .attr('data-line-number', String(edge.lineNumber))
      // Endpoint node ids for baked-CSS connection-highlight (hover-styles.ts).
      .attr('data-source', edge.source)
      .attr('data-target', edge.target);

    const edgeReceded = !!ground && !story.litEdgeIdx.has(ei);
    const edgeColor = edgeReceded ? ground.groundStroke : palette.textMuted;
    const markerId = edgeReceded
      ? `st-arrow-${ground.groundStroke.replace('#', '')}`
      : 'st-arrow';

    if (edge.points.length >= 2) {
      // A self-loop keeps dagre's placement but not its waypoints — see
      // `selfLoopArcPath`.
      const pathD =
        edge.source === edge.target
          ? (selfLoopArcPath(edge.points) ?? edgeSplinePath(edge.points))
          : edgeSplinePath(edge.points);
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
          .attr('opacity', EDGE_LABEL_KNOCKOUT_OPACITY)
          .attr('class', 'st-edge-label-bg');
        edgeG
          .append('text')
          .attr('x', lp.x)
          .attr('y', lp.y + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', edgeReceded ? ground.groundText : edgeColor)
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
      ? resolveTagColor(node.metadata ?? {}, mutableTagGroups, activeTagGroup)
      : undefined);

  for (const node of layout.nodes) {
    const isCollapsedGroup = collapsedGroupIds.has(node.id);
    const nodeReceded = !!ground && !story.litNodeIds.has(node.id);

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
        nodeG.attr(`data-tag-${tagAttrKey(tagKey)}`, metaValue.toLowerCase());
      }
    }

    if (isCollapsedGroup) {
      nodeG
        .attr('data-group-toggle', node.id)
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

    if (node.shape === 'pseudostate' && node.id === FINAL_PSEUDOSTATE_ID) {
      // Final state: UML bullseye — a ring around a smaller filled dot.
      const ink = nodeReceded ? ground.groundStroke : palette.text;
      nodeG
        .append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', sPseudostateRadius - sNodeStrokeWidth / 2)
        .attr('fill', 'none')
        .attr('stroke', ink)
        .attr('stroke-width', sNodeStrokeWidth);
      nodeG
        .append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', sPseudostateRadius * 0.6)
        .attr('fill', ink)
        .attr('stroke', 'none');
    } else if (node.shape === 'pseudostate') {
      nodeG
        .append('circle')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('r', sPseudostateRadius)
        .attr('fill', nodeReceded ? ground.groundStroke : palette.text)
        .attr('stroke', 'none');
    } else if (isCollapsedGroup) {
      const w = node.width;
      const h = node.height;
      const groupColor =
        nodeIntentColor(node) ?? stateDefaultColor(palette, colorOff);
      const fillColor = shapeFill(palette, groupColor, isDark, {
        mode: fillMode,
      });
      const strokeColor = nodeReceded ? ground.groundStroke : groupColor;

      nodeG
        .append('rect')
        .attr('x', -w / 2)
        .attr('y', -h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', sStateCornerRadius)
        .attr('ry', sStateCornerRadius)
        .attr('fill', nodeReceded ? ground.groundFill : fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', sNodeStrokeWidth);

      renderCollapseBar(nodeG, {
        x: -w / 2,
        y: -h / 2,
        width: w,
        height: h,
        rx: sStateCornerRadius,
        fill: strokeColor,
        clipId: `st-clip-${node.id.replace(/[[\]:\s]/g, '')}`,
        prefix: 'state',
        scale: ctx,
      });

      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr(
          'fill',
          nodeReceded
            ? ground.groundText
            : contrastText(
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
        .attr('fill', nodeReceded ? ground.groundFill : resolvedFill)
        .attr(
          'stroke',
          nodeReceded
            ? ground.groundStroke
            : stateStroke(palette, intentColor, colorOff)
        )
        .attr('stroke-width', sNodeStrokeWidth);

      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr(
          'fill',
          nodeReceded
            ? ground.groundText
            : contrastText(
                resolvedFill,
                palette.textOnFillLight,
                palette.textOnFillDark
              )
        )
        .attr('font-size', sNodeFontSize)
        .text(node.label);
    }

    if (hasNote && node.note) {
      renderNodeNote(nodeG, node, node.note, palette, isDark);
    }
  }

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), graph.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });
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
