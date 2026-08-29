// ============================================================
// Flowchart SVG Renderer
// ============================================================

import { serializeSvg } from '../utils/svg-serialize';
import * as d3Selection from 'd3-selection';
import { fillModeFromOptions } from '../utils/parsing';
import { appendArrowheadMarkers } from '../utils/arrow-markers';
import { fitDiagramToCanvas } from '../utils/fit-canvas';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, shapeFill } from '../palettes/color-utils';
import type { ParsedGraph, GraphShape } from './types';
import type { LayoutResult, LayoutNode } from './layout';
import { parseFlowchart } from './flowchart-parser';
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
import {
  EDGE_LABEL_KNOCKOUT_OPACITY,
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
  ARROWHEAD_WIDTH,
  ARROWHEAD_HEIGHT,
} from '../utils/visual-conventions'; // shared (Story 111.1)
const IO_SKEW = 15;
const SUBROUTINE_INSET = 8;
const DOC_WAVE_HEIGHT = 10;

// ============================================================
// Edge endpoint clipping
// ============================================================

// dagre trims edge endpoints to each node's rectangular bounding box.
// A decision node renders as a diamond inscribed in that box, so an edge
// approaching diagonally lands on the bbox side — short of the diamond's
// slanted face, leaving a visible gap. Re-project such an endpoint onto
// the diamond boundary along the ray from the node centre toward the
// adjacent waypoint (|dx|/halfW + |dy|/halfH = 1).
function clipPointToDiamond(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  towardX: number,
  towardY: number
): { x: number; y: number } {
  const dx = towardX - cx;
  const dy = towardY - cy;
  const denom = Math.abs(dx) / halfW + Math.abs(dy) / halfH;
  if (denom === 0) return { x: cx, y: cy };
  const s = 1 / denom;
  return { x: cx + dx * s, y: cy + dy * s };
}

// ============================================================
// Color helpers
// ============================================================

function shapeDefaultColor(
  shape: GraphShape,
  palette: PaletteColors,
  isEndTerminal?: boolean,
  colorOff?: boolean
): string {
  if (colorOff) return palette.textMuted;
  switch (shape) {
    case 'terminal':
      return isEndTerminal ? palette.colors.red : palette.colors.green;
    case 'process':
      return palette.colors.blue;
    case 'decision':
      return palette.colors.yellow;
    case 'io':
      return palette.colors.purple;
    case 'subroutine':
      return palette.colors.teal;
    case 'document':
      return palette.colors.orange;
    default:
      return palette.colors.blue;
  }
}

function nodeFill(
  palette: PaletteColors,
  isDark: boolean,
  shape: GraphShape,
  nodeColor?: string,
  isEndTerminal?: boolean,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline'
): string {
  const color =
    nodeColor ?? shapeDefaultColor(shape, palette, isEndTerminal, colorOff);
  return shapeFill(palette, color, isDark, { mode: fillMode });
}

function nodeStroke(
  palette: PaletteColors,
  shape: GraphShape,
  nodeColor?: string,
  isEndTerminal?: boolean,
  colorOff?: boolean
): string {
  return (
    nodeColor ?? shapeDefaultColor(shape, palette, isEndTerminal, colorOff)
  );
}

// ============================================================
// Shape renderers
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

function renderTerminal(
  g: GSelection,
  node: LayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  isEnd: boolean,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline',
  sNodeStrokeWidth = NODE_STROKE_WIDTH
): void {
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
    .attr(
      'fill',
      nodeFill(
        palette,
        isDark,
        node.shape,
        node.color,
        isEnd,
        colorOff,
        fillMode
      )
    )
    .attr(
      'stroke',
      nodeStroke(palette, node.shape, node.color, isEnd, colorOff)
    )
    .attr('stroke-width', sNodeStrokeWidth);
}

function renderProcess(
  g: GSelection,
  node: LayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline',
  sNodeStrokeWidth = NODE_STROKE_WIDTH
): void {
  const w = node.width;
  const h = node.height;
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr(
      'fill',
      nodeFill(
        palette,
        isDark,
        node.shape,
        node.color,
        undefined,
        colorOff,
        fillMode
      )
    )
    .attr(
      'stroke',
      nodeStroke(palette, node.shape, node.color, undefined, colorOff)
    )
    .attr('stroke-width', sNodeStrokeWidth);
}

function renderDecision(
  g: GSelection,
  node: LayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline',
  sNodeStrokeWidth = NODE_STROKE_WIDTH
): void {
  const w = node.width / 2;
  const h = node.height / 2;
  const points = [`${0},${-h}`, `${w},${0}`, `${0},${h}`, `${-w},${0}`].join(
    ' '
  );
  g.append('polygon')
    .attr('points', points)
    .attr(
      'fill',
      nodeFill(
        palette,
        isDark,
        node.shape,
        node.color,
        undefined,
        colorOff,
        fillMode
      )
    )
    .attr(
      'stroke',
      nodeStroke(palette, node.shape, node.color, undefined, colorOff)
    )
    .attr('stroke-width', sNodeStrokeWidth);
}

function renderIO(
  g: GSelection,
  node: LayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline',
  sNodeStrokeWidth = NODE_STROKE_WIDTH,
  sIoSkew = IO_SKEW
): void {
  const w = node.width / 2;
  const h = node.height / 2;
  const sk = sIoSkew;
  const points = [
    `${-w + sk},${-h}`,
    `${w + sk},${-h}`,
    `${w - sk},${h}`,
    `${-w - sk},${h}`,
  ].join(' ');
  g.append('polygon')
    .attr('points', points)
    .attr(
      'fill',
      nodeFill(
        palette,
        isDark,
        node.shape,
        node.color,
        undefined,
        colorOff,
        fillMode
      )
    )
    .attr(
      'stroke',
      nodeStroke(palette, node.shape, node.color, undefined, colorOff)
    )
    .attr('stroke-width', sNodeStrokeWidth);
}

function renderSubroutine(
  g: GSelection,
  node: LayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline',
  sNodeStrokeWidth = NODE_STROKE_WIDTH,
  sSubroutineInset = SUBROUTINE_INSET
): void {
  const w = node.width;
  const h = node.height;
  const s = nodeStroke(palette, node.shape, node.color, undefined, colorOff);
  const fill = nodeFill(
    palette,
    isDark,
    node.shape,
    node.color,
    undefined,
    colorOff,
    fillMode
  );
  const innerStroke =
    fillMode === 'solid'
      ? contrastText(fill, palette.textOnFillLight, palette.textOnFillDark)
      : s;
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', fill)
    .attr('stroke', s)
    .attr('stroke-width', sNodeStrokeWidth);
  g.append('line')
    .attr('x1', -w / 2 + sSubroutineInset)
    .attr('y1', -h / 2)
    .attr('x2', -w / 2 + sSubroutineInset)
    .attr('y2', h / 2)
    .attr('stroke', innerStroke)
    .attr('stroke-width', sNodeStrokeWidth);
  g.append('line')
    .attr('x1', w / 2 - sSubroutineInset)
    .attr('y1', -h / 2)
    .attr('x2', w / 2 - sSubroutineInset)
    .attr('y2', h / 2)
    .attr('stroke', innerStroke)
    .attr('stroke-width', sNodeStrokeWidth);
}

function renderDocument(
  g: GSelection,
  node: LayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline',
  sNodeStrokeWidth = NODE_STROKE_WIDTH,
  sDocWaveHeight = DOC_WAVE_HEIGHT
): void {
  const w = node.width;
  const h = node.height;
  const waveH = sDocWaveHeight;
  const left = -w / 2;
  const right = w / 2;
  const top = -h / 2;
  const bottom = h / 2 - waveH;

  const d = [
    `M ${left} ${top}`,
    `L ${right} ${top}`,
    `L ${right} ${bottom}`,
    `C ${right - w * 0.25} ${bottom + waveH * 2}, ${left + w * 0.25} ${bottom - waveH}, ${left} ${bottom}`,
    'Z',
  ].join(' ');

  g.append('path')
    .attr('d', d)
    .attr(
      'fill',
      nodeFill(
        palette,
        isDark,
        node.shape,
        node.color,
        undefined,
        colorOff,
        fillMode
      )
    )
    .attr(
      'stroke',
      nodeStroke(palette, node.shape, node.color, undefined, colorOff)
    )
    .attr('stroke-width', sNodeStrokeWidth);
}

function renderNodeShape(
  g: GSelection,
  node: LayoutNode,
  palette: PaletteColors,
  isDark: boolean,
  endTerminalIds: Set<string>,
  colorOff?: boolean,
  fillMode?: 'solid' | 'outline',
  sNodeStrokeWidth = NODE_STROKE_WIDTH,
  sIoSkew = IO_SKEW,
  sSubroutineInset = SUBROUTINE_INSET,
  sDocWaveHeight = DOC_WAVE_HEIGHT
): void {
  switch (node.shape) {
    case 'terminal':
      renderTerminal(
        g,
        node,
        palette,
        isDark,
        endTerminalIds.has(node.id),
        colorOff,
        fillMode,
        sNodeStrokeWidth
      );
      break;
    case 'process':
      renderProcess(
        g,
        node,
        palette,
        isDark,
        colorOff,
        fillMode,
        sNodeStrokeWidth
      );
      break;
    case 'decision':
      renderDecision(
        g,
        node,
        palette,
        isDark,
        colorOff,
        fillMode,
        sNodeStrokeWidth
      );
      break;
    case 'io':
      renderIO(
        g,
        node,
        palette,
        isDark,
        colorOff,
        fillMode,
        sNodeStrokeWidth,
        sIoSkew
      );
      break;
    case 'subroutine':
      renderSubroutine(
        g,
        node,
        palette,
        isDark,
        colorOff,
        fillMode,
        sNodeStrokeWidth,
        sSubroutineInset
      );
      break;
    case 'document':
      renderDocument(
        g,
        node,
        palette,
        isDark,
        colorOff,
        fillMode,
        sNodeStrokeWidth,
        sDocWaveHeight
      );
      break;
    default:
      break;
  }
}

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
  const sEdgeStrokeWidth = ctx.structural(EDGE_STROKE_WIDTH);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sArrowheadW = ctx.structural(ARROWHEAD_WIDTH);
  const sArrowheadH = ctx.structural(ARROWHEAD_HEIGHT);
  const sIoSkew = ctx.structural(IO_SKEW);
  const sSubroutineInset = ctx.structural(SUBROUTINE_INSET);
  const sDocWaveHeight = ctx.structural(DOC_WAVE_HEIGHT);

  const showTitle = !!graph.title && graph.options['no-title'] !== 'on';
  const titleHeight = showTitle ? 40 : 0;

  const diagramW = layout.width;
  const diagramH = layout.height;
  const { scale, offsetX, offsetY, canvasHeight } = fitDiagramToCanvas({
    width,
    height,
    diagramW,
    diagramH,
    padding: sDiagramPadding,
    titleHeight,
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
    idPrefix: 'fc',
    width: sArrowheadW,
    height: sArrowheadH,
    baseFill: palette.textMuted,
    colors: edgeColors,
  });

  if (showTitle) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', sTitleY)
      .attr('text-anchor', 'middle')
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

  const contentG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

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
    if (!edge.label || edge.points.length < 2) continue;
    const midIdx = Math.floor(edge.points.length / 2);
    const midPt = edge.points[midIdx]!;
    const bgW = measureText(edge.label, sEdgeLabelFontSize) + LABEL_PAD;

    const prev = edge.points[Math.max(0, midIdx - 1)]!;
    const next = edge.points[Math.min(edge.points.length - 1, midIdx + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    let lx = midPt.x;
    let ly = midPt.y;
    if (len > 0) {
      lx += (-dy / len) * PERP_OFFSET;
      ly += (dx / len) * PERP_OFFSET;
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

  // Node geometry, keyed by id, for shape-aware edge endpoint clipping.
  const nodeGeom = new Map<
    string,
    { x: number; y: number; halfW: number; halfH: number; shape: GraphShape }
  >();
  for (const n of layout.nodes) {
    nodeGeom.set(n.id, {
      x: n.x,
      y: n.y,
      halfW: n.width / 2,
      halfH: n.height / 2,
      shape: n.shape,
    });
  }

  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei]!;
    if (edge.points.length < 2) continue;
    const edgeG = contentG
      .append('g')
      .attr('class', 'fc-edge-group')
      .attr('data-line-number', String(edge.lineNumber))
      // Endpoint node ids for baked-CSS connection-highlight (hover-styles.ts).
      .attr('data-source', edge.source)
      .attr('data-target', edge.target);

    const edgeColor = palette.textMuted;
    const markerId = 'fc-arrow';

    // Re-project endpoints that touch a diamond so the arrow meets the
    // slanted face instead of the (inscribing) bounding box.
    let drawPoints: ReadonlyArray<{ readonly x: number; readonly y: number }> =
      edge.points;
    const src = nodeGeom.get(edge.source);
    const tgt = nodeGeom.get(edge.target);
    if (src?.shape === 'decision' || tgt?.shape === 'decision') {
      const pts = edge.points.map((p) => ({ x: p.x, y: p.y }));
      const last = pts.length - 1;
      if (tgt?.shape === 'decision') {
        pts[last] = clipPointToDiamond(
          tgt.x,
          tgt.y,
          tgt.halfW,
          tgt.halfH,
          pts[last - 1]!.x,
          pts[last - 1]!.y
        );
      }
      if (src?.shape === 'decision') {
        pts[0] = clipPointToDiamond(
          src.x,
          src.y,
          src.halfW,
          src.halfH,
          pts[1]!.x,
          pts[1]!.y
        );
      }
      drawPoints = pts;
    }

    const pathD = edgeSplinePath(drawPoints);
    if (pathD) {
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', sEdgeStrokeWidth)
        .attr('marker-end', `url(#${markerId})`)
        .attr('class', 'fc-edge');
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
        .attr('class', 'fc-edge-label-bg');

      edgeG
        .append('text')
        .attr('x', lp.x)
        .attr('y', lp.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', sEdgeLabelFontSize)
        .attr('class', 'fc-edge-label')
        .text(edge.label);
    }
  }

  const nodesWithOutgoing = new Set<string>();
  for (const edge of layout.edges) nodesWithOutgoing.add(edge.source);
  const endTerminalIds = new Set<string>();
  for (const node of layout.nodes) {
    if (node.shape === 'terminal' && !nodesWithOutgoing.has(node.id)) {
      endTerminalIds.add(node.id);
    }
  }

  const colorOff = graph.options?.['color'] === 'off';
  const fillMode = fillModeFromOptions(graph.options ?? {});
  const noNotes = graph.options?.['no-notes'] === 'on';
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

    // The shape is drawn at its dagre position — a note never moves it,
    // so its edges stay connected. The note floats beside it.
    const hasNote = !!node.note && !noNotes;

    renderNodeShape(
      nodeG as GSelection,
      node,
      palette,
      isDark,
      endTerminalIds,
      colorOff,
      fillMode,
      sNodeStrokeWidth,
      sIoSkew,
      sSubroutineInset,
      sDocWaveHeight
    );

    const isEnd = endTerminalIds.has(node.id);
    const resolvedFill = nodeFill(
      palette,
      isDark,
      node.shape,
      node.color,
      isEnd,
      colorOff,
      fillMode
    );
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

    if (hasNote && node.note) {
      if (node.note.collapsed) {
        // Collapsed → comment-bubble badge in the node's top-right corner.
        renderNoteBadge(
          nodeG as GSelection,
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
        renderNoteConnector(nodeG as GSelection, cx1, cy1, cx2, cy2, palette);
        renderNoteBox(
          nodeG as GSelection,
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

export function renderFlowchartForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseFlowchart(content, palette);
  if (parsed.error || parsed.nodes.length === 0) return '';

  const layout = layoutGraph(parsed);
  const isDark = theme === 'dark';

  const container = document.createElement('div');
  container.style.width = `${layout.width + DIAGRAM_PADDING * 2}px`;
  container.style.height = `${layout.height + DIAGRAM_PADDING * 2 + (parsed.title && parsed.options['no-title'] !== 'on' ? 40 : 0)}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    layout.height +
    DIAGRAM_PADDING * 2 +
    (parsed.title && parsed.options['no-title'] !== 'on' ? 40 : 0);

  try {
    renderFlowchart(container, parsed, layout, palette, isDark, undefined, {
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
