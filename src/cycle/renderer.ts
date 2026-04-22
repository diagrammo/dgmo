// ============================================================
// Cycle Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
  ControlsGroupToggle,
} from '../utils/legend-types';
import { contrastText, mix } from '../palettes/color-utils';
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
import { computeCycleLayout } from './layout';

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

  // Clear previous render
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const hideDescriptions =
    (renderOptions?.hideDescriptions ?? false) ||
    parsed.options['hide-descriptions'] === 'true' ||
    viewState?.hd === true;
  const showDescriptions = !hideDescriptions;

  // Check if descriptions exist in the diagram
  const hasDescriptions =
    parsed.nodes.some((n) => n.description.length > 0) ||
    parsed.edges.some((e) => e.description.length > 0);
  const hasLegend = hasDescriptions && !!renderOptions?.onToggleDescriptions;

  // Layout
  const legendOffset = hasLegend ? LEGEND_HEIGHT : 0;
  const layoutHeight =
    height - (parsed.title ? TITLE_AREA_HEIGHT : 0) - legendOffset;
  const layout = computeCycleLayout(parsed, {
    width,
    height: layoutHeight,
    hideDescriptions,
  });

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  // Background
  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  // Title
  if (parsed.title) {
    const titleText = svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
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
    const legendConfig: LegendConfig = {
      groups: [],
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: 'fixed',
      controlsGroup,
    };
    const legendState: LegendState = {
      activeGroup: null,
      controlsExpanded: renderOptions?.controlsExpanded,
    };
    const legendCallbacks: LegendCallbacks = {
      onControlsExpand: renderOptions?.onToggleControlsExpand,
      onControlsToggle: (toggleId, active) => {
        if (
          toggleId === 'descriptions' &&
          renderOptions?.onToggleDescriptions
        ) {
          renderOptions.onToggleDescriptions(active);
        }
      },
    };
    const titleOffset = parsed.title ? TITLE_AREA_HEIGHT : 0;
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0, ${titleOffset + 4})`);
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      legendCallbacks,
      width
    );
  }

  // Main diagram group
  const diagramTop = (parsed.title ? TITLE_AREA_HEIGHT : 0) + legendOffset;
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

  // ── Render edges (below nodes) ──
  for (let i = 0; i < layout.edges.length; i++) {
    const le = layout.edges[i];
    const edge = parsed.edges[i];
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

    // Edge path
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

    // Edge label + descriptions — positioned outside the circle
    const hasEdgeLabel = !!le.label;
    const hasEdgeDesc = showDescriptions && edge.description.length > 0;

    if (hasEdgeLabel || hasEdgeDesc) {
      // Determine text-anchor based on which side of the circle the label is on
      const normAngle =
        ((le.labelAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const isRight = normAngle < Math.PI * 0.4 || normAngle > Math.PI * 1.6;
      const isLeft = normAngle > Math.PI * 0.6 && normAngle < Math.PI * 1.4;
      const anchor = isRight ? 'start' : isLeft ? 'end' : 'middle';

      // Estimate text block dimensions for background
      let lineCount = 0;
      let maxCharLen = 0;
      if (hasEdgeLabel) {
        lineCount++;
        maxCharLen = Math.max(maxCharLen, le.label!.length);
      }
      if (hasEdgeDesc) {
        lineCount += edge.description.length;
        for (const dl of edge.description) {
          maxCharLen = Math.max(maxCharLen, dl.length);
        }
      }
      const bgW = maxCharLen * 7 + 12; // estimated text width + padding
      const bgH = lineCount * DESC_LINE_HEIGHT + 6;
      const bgX = isRight
        ? le.labelX - 4
        : isLeft
          ? le.labelX - bgW + 4
          : le.labelX - bgW / 2;
      const bgY = le.labelY - EDGE_LABEL_FONT_SIZE - 2;

      // Background rect behind edge label text
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

      if (hasEdgeLabel) {
        const labelText = edgeG
          .append('text')
          .attr('x', le.labelX)
          .attr('y', textY)
          .attr('text-anchor', anchor)
          .attr('fill', palette.text)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', EDGE_LABEL_FONT_SIZE)
          .attr('font-weight', '600');
        renderInlineText(labelText, le.label!, palette, EDGE_LABEL_FONT_SIZE);
        textY += DESC_LINE_HEIGHT;
      }

      if (hasEdgeDesc) {
        edge.description.forEach((line) => {
          const descText = edgeG
            .append('text')
            .attr('x', le.labelX)
            .attr('y', textY)
            .attr('text-anchor', anchor)
            .attr('fill', palette.textMuted)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', DESC_FONT_SIZE);
          renderInlineText(descText, line, palette, DESC_FONT_SIZE);
          textY += DESC_LINE_HEIGHT;
        });
      }
    }
  }

  // ── Render nodes ──
  const HEADER_H = 36 * layout.scale;
  const scaledNodeFont = Math.max(9, Math.round(NODE_FONT_SIZE * layout.scale));
  const CIRCLE_LABEL_FONT_SIZE = 16;
  const scaledCircleLabelFont = Math.max(
    11,
    Math.round(CIRCLE_LABEL_FONT_SIZE * layout.scale)
  );
  const scaledDescFont = Math.max(8, Math.round(DESC_FONT_SIZE * layout.scale));
  const scaledDescLineH = Math.max(
    11,
    Math.round(DESC_LINE_HEIGHT * layout.scale)
  );

  for (let i = 0; i < layout.nodes.length; i++) {
    const ln = layout.nodes[i];
    const node = parsed.nodes[i];
    const solidColor = resolveNodeColor(node.color, palette, defaultNodeColor);
    // Muted fill (mix color with background), solid border
    const fillColor = mix(
      solidColor,
      isDark ? palette.surface : palette.bg,
      30
    );
    const textColor = contrastText(fillColor, '#eceff4', '#2e3440');
    const nodeW = ln.width;
    const nodeH = ln.height;
    const wrappedDesc = ln.wrappedDesc;
    const hasDesc = showDescriptions && wrappedDesc.length > 0;

    const nodeG = g
      .append('g')
      .attr('class', 'cycle-node')
      .attr('data-line-number', node.lineNumber)
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
            .attr('fill', palette.textMuted)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', scaledDescFont);
          renderInlineText(descText, line, palette, DESC_FONT_SIZE);
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
          .attr('stroke', solidColor)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        const descStartY = sepY + 4 + scaledDescFont;
        wrappedDesc.forEach((line, li) => {
          const descText = nodeG
            .append('text')
            .attr('x', ln.x)
            .attr('y', descStartY + li * scaledDescLineH)
            .attr('text-anchor', 'middle')
            .attr('fill', palette.textMuted)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', scaledDescFont);
          renderInlineText(descText, line, palette, DESC_FONT_SIZE);
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
  viewState?: CompactViewState
): void {
  renderCycle(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims,
    viewState
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
