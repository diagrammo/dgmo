// ============================================================
// Cycle Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { fillModeFromOptions } from '../utils/parsing';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import type {
  LegendCallbacks,
  ControlsGroupToggle,
} from '../utils/legend-types';
import { contrastText, shapeFill } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { renderInlineText } from '../utils/inline-markdown';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { CompactViewState } from '../sharing';
import {
  DEFAULT_EDGE_WIDTH,
  MIN_EDGE_WIDTH,
  arrowHeadLength,
  type ParsedCycle,
} from './types';
import { computeCycleLayout, wrapEdgeLabelText } from './layout';
import { ScaleContext } from '../utils/scaling';
import { measureText } from '../utils/text-measure';

// ── Constants ────────────────────────────────────────────────
const NODE_FONT_SIZE = 13;
const DESC_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;
const DESC_LINE_HEIGHT = 15;
const TITLE_AREA_HEIGHT = 50;

export interface CycleRenderOptions {
  onClickItem?: (lineNumber: number) => void;
  exportDims?: D3ExportDimensions;
  viewState?: CompactViewState;
  hideDescriptions?: boolean;
  controlsExpanded?: boolean;
  onToggleDescriptions?: (active: boolean) => void;
  onToggleControlsExpand?: () => void;
  exportMode?: boolean;
  /** When 'app', the description toggle is hosted by the app overlay strip:
   *  the inline gear is suppressed and a controls row + anchor are reserved.
   *  Default (inline) renders the gear as before. */
  controlsHost?: 'app' | 'inline';
}

/**
 * Render a cycle diagram into the given container.
 */
export function renderCycle(
  container: HTMLDivElement,
  parsed: ParsedCycle,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  viewState?: CompactViewState,
  renderOptions?: CycleRenderOptions
): void {
  if (parsed.nodes.length === 0) return;
  const fillMode = fillModeFromOptions(parsed.options ?? {});

  // Clear previous render
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const idealWidth = width;
  const sctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sTitleFontSize = sctx.text(TITLE_FONT_SIZE);
  const sTitleY = sctx.structural(TITLE_Y);
  const sTitleAreaHeight = sctx.structural(TITLE_AREA_HEIGHT);
  const sLegendHeight = sctx.structural(LEGEND_HEIGHT);

  const hideDescriptions =
    (renderOptions?.hideDescriptions ?? false) ||
    parsed.options['no-descriptions'] === 'true' ||
    viewState?.hd === true;
  const showDescriptions = !hideDescriptions;

  // Check if descriptions exist in the diagram
  const hasDescriptions =
    parsed.nodes.some((n) => n.description.length > 0) ||
    parsed.edges.some((e) => e.description.length > 0);
  // App-hosted: controls live in the app overlay strip. Cycle has no tag groups,
  // so there's no in-SVG legend left to render — don't reserve a legend band.
  const appHostedControls = renderOptions?.controlsHost === 'app';
  const hasLegend =
    !appHostedControls &&
    hasDescriptions &&
    !!renderOptions?.onToggleDescriptions;

  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const legendOffset = hasLegend ? sLegendHeight : 0;
  const layoutHeight =
    height - (showTitle ? sTitleAreaHeight : 0) - legendOffset;
  const layout = computeCycleLayout(parsed, {
    width,
    height: layoutHeight,
    hideDescriptions,
  });

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  if (sctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  if (showTitle) {
    const titleText = svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', sTitleY)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber)
      .text(parsed.title)
      .style('cursor', onClickItem ? 'pointer' : 'default');
    if (onClickItem) {
      titleText.on('click', () => onClickItem(parsed.titleLineNumber));
    }
  }

  // Legend (controls toggle for descriptions)
  if (hasLegend) {
    const controlsGroup: { toggles: ControlsGroupToggle[] } = {
      toggles: [
        {
          id: 'descriptions',
          type: 'toggle',
          label: 'Descriptions',
          active: !hideDescriptions,
          onToggle: () => {},
        },
      ],
    };
    const legendCallbacks: LegendCallbacks = {
      ...(renderOptions?.onToggleControlsExpand !== undefined && {
        onControlsExpand: renderOptions.onToggleControlsExpand,
      }),
      onControlsToggle: (toggleId, active) => {
        if (
          toggleId === 'descriptions' &&
          renderOptions?.onToggleDescriptions
        ) {
          renderOptions.onToggleDescriptions(active);
        }
      },
    };
    const titleOffsetForLegend = showTitle ? sTitleAreaHeight : 0;
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0, ${titleOffsetForLegend + 4})`);
    renderIntegratedLegend(legendG, {
      groups: [],
      activeGroup: null,
      mode: renderOptions?.exportMode ? 'export' : 'preview',
      controlsGroup,
      ...(renderOptions?.controlsHost !== undefined && {
        controlsHost: renderOptions.controlsHost,
      }),
      ...(renderOptions?.controlsExpanded !== undefined && {
        controlsExpanded: renderOptions.controlsExpanded,
      }),
      callbacks: legendCallbacks,
      palette,
      isDark,
      width,
    });
  }

  const diagramTop = (showTitle ? sTitleAreaHeight : 0) + legendOffset;
  const g = svg.append('g').attr('transform', `translate(0, ${diagramTop})`);

  // Defs for arrowheads
  const defs = svg.append('defs');

  // Resolve default node color: first palette color (uniform)
  const defaultNodeColor = palette.primary;

  // ── Arrowhead markers (per color+width, markerUnits=strokeWidth) ──
  const markerKeys = new Set<string>();
  for (const edge of parsed.edges) {
    const color = resolveEdgeColor(edge, parsed, palette, defaultNodeColor);
    const sw = Math.max(edge.width ?? DEFAULT_EDGE_WIDTH, MIN_EDGE_WIDTH);
    const key = `${color}|${sw}`;
    if (!markerKeys.has(key)) {
      markerKeys.add(key);
      ensureArrowMarker(defs, color, sw);
    }
  }

  // ── Render edges paths (below nodes); labels rendered later, on top ──
  const edgeLabelInfo: Array<{
    le: (typeof layout.edges)[number];
    edge: (typeof parsed.edges)[number];
  }> = [];
  for (let i = 0; i < layout.edges.length; i++) {
    // In-bounds by loop guard; layout.edges and parsed.edges are parallel arrays.
    const le = layout.edges[i]!;
    const edge = parsed.edges[i]!;
    const color = resolveEdgeColor(edge, parsed, palette, defaultNodeColor);
    const strokeWidth = Math.max(
      edge.width ?? DEFAULT_EDGE_WIDTH,
      MIN_EDGE_WIDTH
    );
    const markerId = arrowMarkerId(color, strokeWidth);

    const edgeG = g.append('g').attr('class', 'cycle-edge');

    if (edge.lineNumber) {
      edgeG.attr('data-line-number', edge.lineNumber);
    }
    // Endpoint node indices for baked-CSS connection-highlight.
    edgeG
      .attr('data-from', String(edge.sourceIndex))
      .attr('data-to', String(edge.targetIndex));

    const pathEl = edgeG
      .append('path')
      .attr('d', le.path)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', strokeWidth)
      .attr('marker-end', `url(#${markerId})`);

    if (onClickItem && edge.lineNumber) {
      const ln = edge.lineNumber;
      pathEl.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }

    edgeLabelInfo.push({ le, edge });
  }

  // ── Render nodes ──
  const HEADER_H = 36 * layout.scale;
  // Font floors are intentionally low (≈ half the natural size) so text keeps
  // shrinking alongside the shrinking nodes when the canvas is small. Higher
  // floors decouple text from shape scale, causing labels to overflow node
  // boundaries at small canvas sizes.
  const scaledNodeFont = Math.max(6, Math.round(NODE_FONT_SIZE * layout.scale));
  const scaledEdgeLabelFont = Math.max(
    6,
    Math.round(EDGE_LABEL_FONT_SIZE * layout.scale)
  );
  const CIRCLE_LABEL_FONT_SIZE = 16;
  const scaledCircleLabelFont = Math.max(
    8,
    Math.round(CIRCLE_LABEL_FONT_SIZE * layout.scale)
  );
  const scaledDescFont = Math.max(5, Math.round(DESC_FONT_SIZE * layout.scale));
  const scaledDescLineH = Math.max(
    7,
    Math.round(DESC_LINE_HEIGHT * layout.scale)
  );
  const scaledEdgeLineH = Math.max(
    8,
    Math.round(DESC_LINE_HEIGHT * layout.scale)
  );

  for (let i = 0; i < layout.nodes.length; i++) {
    // In-bounds by loop guard; layout.nodes and parsed.nodes are parallel arrays.
    const ln = layout.nodes[i]!;
    const node = parsed.nodes[i]!;
    const solidColor = resolveNodeColor(node.color, palette, defaultNodeColor);
    // Canonical 25% tinted fill via shapeFill() (or full intent when solid-fill is on).
    const fillColor = shapeFill(palette, solidColor, isDark, {
      mode: fillMode,
    });
    const textColor = contrastText(
      fillColor,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    // Description text sits on top of the node fill — must follow the same
    // contrast rule as the title, NOT use a fixed `palette.textMuted` gray
    // (which is only legible against bg/surface, not against saturated fills).
    const descColor = textColor;
    const nodeW = ln.width;
    const nodeH = ln.height;
    const wrappedDesc = ln.wrappedDesc;
    const hasDesc = showDescriptions && wrappedDesc.length > 0;

    const nodeG = g
      .append('g')
      .attr('class', 'cycle-node')
      .attr('data-line-number', node.lineNumber)
      // Node index for baked-CSS connection-highlight (cycle nodes have no
      // string id; edges key on the same index).
      .attr('data-node-index', String(i))
      .style('cursor', onClickItem ? 'pointer' : 'default');

    if (onClickItem) {
      const lineNum = node.lineNumber;
      nodeG.on('click', () => onClickItem(lineNum));
    }

    if (ln.isCircle) {
      // ── Circle node shape ──
      const r = nodeW / 2;
      nodeG
        .append('circle')
        .attr('cx', ln.x)
        .attr('cy', ln.y)
        .attr('r', r)
        .attr('fill', fillColor)
        .attr('stroke', solidColor)
        .attr('stroke-width', 2);

      if (hasDesc) {
        // Label + descriptions vertically centered in circle
        const labelFont = scaledCircleLabelFont;
        const blockH = labelFont + 4 + wrappedDesc.length * scaledDescLineH;
        const startY = ln.y - blockH / 2 + labelFont;

        const labelText = nodeG
          .append('text')
          .attr('x', ln.x)
          .attr('y', startY)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', labelFont)
          .attr('font-weight', '600');
        renderInlineText(labelText, node.label, palette, labelFont);

        let descY = startY + scaledDescLineH + 4;
        wrappedDesc.forEach((line) => {
          const descText = nodeG
            .append('text')
            .attr('x', ln.x)
            .attr('y', descY)
            .attr('text-anchor', 'middle')
            .attr('fill', descColor)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', scaledDescFont);
          renderInlineText(descText, line.text, palette, DESC_FONT_SIZE);
          descY += scaledDescLineH;
        });
      } else {
        // Label centered in circle
        const labelFont = scaledCircleLabelFont;
        const labelText = nodeG
          .append('text')
          .attr('x', ln.x)
          .attr('y', ln.y + labelFont / 3)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', labelFont)
          .attr('font-weight', '600');
        renderInlineText(labelText, node.label, palette, labelFont);
      }
    } else {
      // ── Rectangular node shape ──
      const rx = 6;
      nodeG
        .append('rect')
        .attr('x', ln.x - nodeW / 2)
        .attr('y', ln.y - nodeH / 2)
        .attr('width', nodeW)
        .attr('height', nodeH)
        .attr('rx', rx)
        .attr('ry', rx)
        .attr('fill', fillColor)
        .attr('stroke', solidColor)
        .attr('stroke-width', 2);

      if (hasDesc) {
        // ── Described node: header + separator + description ──
        const headerCenterY = ln.y - nodeH / 2 + HEADER_H / 2;
        const labelText = nodeG
          .append('text')
          .attr('x', ln.x)
          .attr('y', headerCenterY + scaledNodeFont / 3)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', scaledNodeFont)
          .attr('font-weight', '600');
        renderInlineText(labelText, node.label, palette, scaledNodeFont);

        const sepY = ln.y - nodeH / 2 + HEADER_H;
        nodeG
          .append('line')
          .attr('x1', ln.x - nodeW / 2)
          .attr('y1', sepY)
          .attr('x2', ln.x + nodeW / 2)
          .attr('y2', sepY)
          .attr('stroke', fillMode === 'solid' ? descColor : solidColor)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        const descStartY = sepY + 4 + scaledDescFont;
        const descPadX = Math.max(8, 12 * layout.scale);
        const descX = ln.x - nodeW / 2 + descPadX;
        // Bullet body column — body of bullet items + their continuations
        // share this x so wrapped text aligns under the first word past "•".
        const bulletBodyX = descX + Math.max(8, 12 * layout.scale);
        wrappedDesc.forEach((line, li) => {
          const lineY = descStartY + li * scaledDescLineH;
          if (line.kind === 'bullet-first') {
            // Bullet glyph as its own text element at descX
            nodeG
              .append('text')
              .attr('x', descX)
              .attr('y', lineY)
              .attr('text-anchor', 'start')
              .attr('fill', descColor)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', scaledDescFont)
              .text('•');
            // Body text at the bullet column
            const bodyText = nodeG
              .append('text')
              .attr('x', bulletBodyX)
              .attr('y', lineY)
              .attr('text-anchor', 'start')
              .attr('fill', descColor)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', scaledDescFont);
            renderInlineText(bodyText, line.text, palette, DESC_FONT_SIZE);
          } else {
            const x = line.kind === 'bullet-cont' ? bulletBodyX : descX;
            const descText = nodeG
              .append('text')
              .attr('x', x)
              .attr('y', lineY)
              .attr('text-anchor', 'start')
              .attr('fill', descColor)
              .attr('font-family', FONT_FAMILY)
              .attr('font-size', scaledDescFont);
            renderInlineText(descText, line.text, palette, DESC_FONT_SIZE);
          }
        });
      } else {
        // ── Plain node: label centered ──
        const labelText = nodeG
          .append('text')
          .attr('x', ln.x)
          .attr('y', ln.y + scaledNodeFont / 3)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', scaledNodeFont)
          .attr('font-weight', '600');
        renderInlineText(labelText, node.label, palette, scaledNodeFont);
      }
    }
  }

  // ── Render edge labels (in a new group appended after nodes so they sit
  // on top of nodes in document order, regardless of append-time ordering). ──
  const labelLayer = g.append('g').attr('class', 'cycle-edge-labels');
  for (const { le, edge } of edgeLabelInfo) {
    const hasEdgeLabel = !!le.label;
    const hasEdgeDesc = showDescriptions && edge.description.length > 0;
    const { labelLines, descLines } = wrapEdgeLabelText(
      hasEdgeLabel ? le.label : undefined,
      hasEdgeDesc ? edge.description : []
    );
    if (labelLines.length === 0 && descLines.length === 0) continue;
    const edgeG = labelLayer.append('g').attr('class', 'cycle-edge');
    if (edge.lineNumber) {
      edgeG.attr('data-line-number', edge.lineNumber);
    }

    const normAngle =
      ((le.labelAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const isRight = normAngle < Math.PI * 0.4 || normAngle > Math.PI * 1.6;
    const isLeft = normAngle > Math.PI * 0.6 && normAngle < Math.PI * 1.4;
    const anchor = isRight ? 'start' : isLeft ? 'end' : 'middle';

    const lineCount = labelLines.length + descLines.length;
    // Measure the widest rendered line in pixels at the scaled edge-label font
    // so the background box matches the actual ink (same measurer the layout
    // uses to size + place the label).
    let maxLineW = 0;
    for (const l of labelLines)
      maxLineW = Math.max(maxLineW, measureText(l, scaledEdgeLabelFont));
    for (const l of descLines)
      maxLineW = Math.max(maxLineW, measureText(l, scaledDescFont));

    const bgW = maxLineW + 12;
    const bgH = lineCount * scaledEdgeLineH + 6;
    const bgX = isRight
      ? le.labelX - 4
      : isLeft
        ? le.labelX - bgW + 4
        : le.labelX - bgW / 2;
    const bgY = le.labelY - scaledEdgeLabelFont - 2;

    edgeG
      .append('rect')
      .attr('x', bgX)
      .attr('y', bgY)
      .attr('width', bgW)
      .attr('height', bgH)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('fill-opacity', 0.85);

    let textY = le.labelY;
    for (const line of labelLines) {
      const labelText = edgeG
        .append('text')
        .attr('x', le.labelX)
        .attr('y', textY)
        .attr('text-anchor', anchor)
        .attr('fill', palette.text)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', scaledEdgeLabelFont)
        .attr('font-weight', '600');
      renderInlineText(labelText, line, palette, scaledEdgeLabelFont);
      textY += scaledEdgeLineH;
    }
    for (const line of descLines) {
      const descText = edgeG
        .append('text')
        .attr('x', le.labelX)
        .attr('y', textY)
        .attr('text-anchor', anchor)
        .attr('fill', palette.textMuted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', scaledDescFont);
      renderInlineText(descText, line, palette, scaledDescFont);
      textY += scaledEdgeLineH;
    }
  }
}

/**
 * Render for CLI/export (no click handlers).
 */
export function renderCycleForExport(
  container: HTMLDivElement,
  parsed: ParsedCycle,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  viewState?: CompactViewState,
  exportMode?: boolean
): void {
  renderCycle(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims,
    viewState,
    { ...(exportMode !== undefined && { exportMode }) }
  );
}

// ── Helpers ──────────────────────────────────────────────────

function resolveNodeColor(
  color: string | undefined,
  palette: PaletteColors,
  defaultColor: string
): string {
  if (!color) return defaultColor;
  return resolveColor(color, palette) ?? defaultColor;
}

function resolveEdgeColor(
  edge: ParsedCycle['edges'][0],
  parsed: ParsedCycle,
  palette: PaletteColors,
  defaultNodeColor: string
): string {
  if (edge.color) {
    return resolveColor(edge.color, palette) ?? defaultNodeColor;
  }
  // Inherit from source node
  const sourceNode = parsed.nodes[edge.sourceIndex];
  if (sourceNode?.color) {
    return resolveColor(sourceNode.color, palette) ?? defaultNodeColor;
  }
  return defaultNodeColor;
}

/** Stable marker ID for a (color, strokeWidth) pair. */
function arrowMarkerId(color: string, strokeWidth: number): string {
  return `cycle-arrow-${color.replace('#', '')}-w${strokeWidth}`;
}

/**
 * Create an arrowhead marker using markerUnits="strokeWidth" (SVG default)
 * with per-edge dimensions.  The marker base automatically equals the stroke
 * width — no gaps or lollipop effects.  Marker dimensions are computed so
 * the rendered arrowhead length follows a sublinear formula:
 *
 *   rendered length = markerWidth × strokeWidth = arrowHeadLength(sw)
 *   → markerWidth = arrowHeadLength(sw) / sw
 *
 * The height is fixed at 1 strokeWidth unit so the base = stroke width.
 */
function ensureArrowMarker(
  defs: d3Selection.Selection<SVGDefsElement, unknown, null, undefined>,
  color: string,
  strokeWidth: number
): void {
  const id = arrowMarkerId(color, strokeWidth);
  // Marker dimensions in strokeWidth units.
  // Rendered size = mw × sw  (length)  and  mh × sw  (height).
  const mw = arrowHeadLength(strokeWidth) / strokeWidth;
  // Height proportional to length (½ ratio) but at least 1.5× stroke width
  // so the arrowhead is always visibly wider than the stroke.
  const mh = Math.max(1.5, mw * 0.5);

  defs
    .append('marker')
    .attr('id', id)
    .attr('viewBox', `0 0 ${mw} ${mh}`)
    .attr('refX', mw * 0.1)
    .attr('refY', mh / 2)
    .attr('markerWidth', mw)
    .attr('markerHeight', mh)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${mw},${mh / 2} 0,${mh}`)
    .attr('fill', color);
}
