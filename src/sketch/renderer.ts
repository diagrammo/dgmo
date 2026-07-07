// ============================================================
// Sketch diagram — Renderer (spec §31, visual conventions §1/§2/§4/§5)
// ============================================================
//
// One drawing code path for every surface: the app canvas calls this renderer
// directly with a scene-graph-derived model; embeds/CLI reach it via render()
// with parsed text (spec decision 21 — parity by construction).
//
// Node recipe: 25% tint fill (shapeFill), 1.5 stroke, rx 6, 13pt bold label
// that ALWAYS fits (shrink → smart-wrap → ellipsis; the footprint never
// grows). Untagged = neutral gray (decision 26a). Boxes reserve a top band
// for a big/thick/faded label. Edges leave ports at 90° on cubic curves,
// 10×7 arrowheads, '6 3' dash for the ~ family. No manual colors anywhere.

import * as d3 from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { renderCollapseBar } from '../utils/card';
import type { LegendGroupData } from '../utils/legend-types';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  resolveActiveTagGroup,
  resolveTagColor,
  tagAttrKey,
} from '../utils/tag-groups';
import { fitTextToBox, wrapTextToWidth } from '../utils/text-measure';
import {
  CARD_RADIUS,
  CONTAINER_RADIUS,
  EDGE_STROKE_WIDTH,
  LABEL_FONT_SIZE,
  NODE_STROKE_WIDTH,
} from '../utils/visual-conventions';
import type { ParsedSketch, SketchShapeKind } from './types';
import type { SketchLayout, SketchLayoutBox, SketchLayoutNode } from './layout';

// ── Local constants ─────────────────────────────────────────

const DIAGRAM_PADDING = 20;
const TITLE_Y = 30;
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
const DASH = '6 3';
const BAND_LABEL_FONT_SIZE = 19;
const BAND_LABEL_OPACITY = 0.55;
const NOTE_FONT_SIZE = 11;
const COLLAPSE_BAR_HEIGHT = 4;
const LABEL_MAX_LINES = 2;
const EDGE_LABEL_FONT_SIZE = 11;
const CURVE_HANDLE_MIN = 24;
const CURVE_HANDLE_MAX = 90;

export interface SketchRenderOptions {
  exportDims?: { width?: number; height?: number };
  activeTagGroup?: string | null;
  exportMode?: boolean;
  onClickItem?: (lineNumber: number) => void;
}

type Sel = d3.Selection<SVGGElement, unknown, null, undefined>;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface NodeColors {
  fill: string;
  stroke: string;
  text: string;
}

// ── Shape bodies (drawn at origin, w×h) ─────────────────────

function drawShapeBody(
  g: Sel,
  kind: SketchShapeKind,
  w: number,
  h: number,
  colors: NodeColors
): void {
  const apply = <E extends SVGElement>(
    sel: d3.Selection<E, unknown, null, undefined>
  ): d3.Selection<E, unknown, null, undefined> =>
    sel
      .attr('fill', colors.fill)
      .attr('stroke', colors.stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

  switch (kind) {
    case 'database': {
      const ry = h * 0.14;
      apply(
        g
          .append('path')
          .attr(
            'd',
            `M0 ${ry} v${h - 2 * ry} a${w / 2} ${ry} 0 0 0 ${w} 0 v-${h - 2 * ry}`
          )
      );
      apply(
        g
          .append('ellipse')
          .attr('cx', w / 2)
          .attr('cy', ry)
          .attr('rx', w / 2)
          .attr('ry', ry)
      );
      return;
    }
    case 'queue': {
      const rx = w * 0.08;
      apply(
        g
          .append('path')
          .attr(
            'd',
            `M${rx} 0 h${w - 2 * rx} a${rx} ${h / 2} 0 0 1 0 ${h} h-${w - 2 * rx} Z`
          )
      );
      apply(
        g
          .append('ellipse')
          .attr('cx', rx)
          .attr('cy', h / 2)
          .attr('rx', rx)
          .attr('ry', h / 2)
      );
      return;
    }
    case 'cloud': {
      // Mockup-v11 cloud, normalized to a 132×97 design box (arc bulges
      // included) and stretched to the footprint — never escapes it.
      const sx = w / 132;
      const sy = h / 97;
      apply(
        g
          .append('path')
          .attr(
            'd',
            `M${20 * sx} ${97 * sy} a${26 * sx} ${26 * sy} 0 0 1 ${-6 * sx} ${-51 * sy} a${34 * sx} ${34 * sy} 0 0 1 ${62 * sx} ${-22 * sy} a${28 * sx} ${28 * sy} 0 0 1 ${42 * sx} ${22 * sy} a${26 * sx} ${24 * sy} 0 0 1 ${8 * sx} ${51 * sy} Z`
          )
      );
      return;
    }
    case 'document':
      apply(
        g
          .append('path')
          .attr(
            'd',
            `M0 4 a4 4 0 0 1 4 -4 h${w - 8} a4 4 0 0 1 4 4 v${h - 14} q-${w * 0.25} ${h * 0.16} -${w * 0.5} 0 q-${w * 0.25} -${h * 0.16} -${w * 0.5} 0 Z`
          )
      );
      return;
    case 'note': {
      const f = 14;
      apply(
        g
          .append('path')
          .attr(
            'd',
            `M0 2 a2 2 0 0 1 2 -2 h${w - f - 2} l${f} ${f} v${h - f - 2} a2 2 0 0 1 -2 2 h-${w - 4} a2 2 0 0 1 -2 -2 Z`
          )
      );
      g.append('path')
        .attr('d', `M${w - f} 0 v${f} h${f}`)
        .attr('fill', 'none')
        .attr('stroke', colors.stroke)
        .attr('stroke-width', 1.2);
      return;
    }
    case 'person':
    case 'rectangle':
    default: {
      apply(
        g
          .append('rect')
          .attr('width', w)
          .attr('height', h)
          .attr('rx', CARD_RADIUS)
      );
      if (kind === 'person') {
        const cx = 26;
        const cy = h / 2 - 8;
        const icon = g.append('g').attr('fill', colors.stroke);
        icon.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 7);
        icon
          .append('path')
          .attr('d', `M${cx - 12} ${cy + 22} a12 12 0 0 1 24 0 Z`);
      }
      return;
    }
  }
}

/** Centered, fitted label — the text-fit chain from spec §31.2. */
function drawFittedLabel(
  g: Sel,
  label: string,
  cx: number,
  cy: number,
  maxWidth: number,
  color: string
): void {
  const fit = fitTextToBox(label, {
    maxWidth,
    maxLines: LABEL_MAX_LINES,
    fontSize: LABEL_FONT_SIZE,
  });
  const lineHeight = fit.fontSize + 3;
  const startY = cy - ((fit.lines.length - 1) * lineHeight) / 2;
  fit.lines.forEach((line, i) => {
    g.append('text')
      .attr('x', cx)
      .attr('y', startY + i * lineHeight)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', fit.fontSize)
      .attr('font-weight', 700)
      .attr('fill', color)
      .text(line);
  });
}

// ── Main renderer ───────────────────────────────────────────

export function renderSketch(
  container: HTMLDivElement,
  parsed: ParsedSketch,
  layout: SketchLayout,
  palette: PaletteColors,
  isDark: boolean,
  options: SketchRenderOptions = {}
): void {
  const { activeTagGroup, exportMode = false } = options;

  const neutralFill = mix(palette.surface, palette.bg, 40);
  const tagGroups = [...parsed.tagGroups];
  const activeName = resolveActiveTagGroup(
    tagGroups,
    undefined,
    activeTagGroup
  );
  const activeKey = activeName === null ? null : tagAttrKey(activeName);

  const colorsFor = (
    metadata: Record<string, string>,
    isContainer = false
  ): NodeColors => {
    const tagged = activeKey !== null && metadata[activeKey] !== undefined;
    const tagColor = tagged
      ? resolveTagColor(metadata, tagGroups, activeName, isContainer)
      : undefined;
    if (!tagColor) {
      return {
        fill: neutralFill,
        stroke: palette.textMuted,
        text: palette.text,
      };
    }
    const fill = shapeFill(palette, tagColor, isDark, {
      solid: parsed.options.solidFill,
    });
    return {
      fill,
      stroke: tagColor,
      text: contrastText(fill, palette.textOnFillLight, palette.textOnFillDark),
    };
  };

  // ── Frame: title + legend reservation ──────────────────────
  const showTitle = !!parsed.title;
  const titleOffset = showTitle ? 40 : 0;
  const legendGroups: readonly LegendGroupData[] = parsed.options.noLegend
    ? []
    : tagGroups;
  const contentWidth = layout.width + 2 * DIAGRAM_PADDING;
  const width = Math.max(contentWidth, options.exportDims?.width ?? 0);
  const legendHeight =
    legendGroups.length > 0
      ? getMaxLegendReservedHeight(
          {
            groups: legendGroups,
            position: { placement: 'top-center', titleRelation: 'below-title' },
            mode: exportMode ? 'export' : 'preview',
          },
          width
        )
      : 0;
  const contentTop = titleOffset + legendHeight + DIAGRAM_PADDING;
  const height = Math.max(
    contentTop + layout.height + DIAGRAM_PADDING,
    options.exportDims?.height ?? 0
  );

  d3.select(container).selectAll('*').remove();
  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('font-family', FONT_FAMILY);

  // ── Arrow markers: forward + reverse per edge color ─────────
  const defs = svg.append('defs');
  const edgeColorFor = (metadata: Record<string, string>): string => {
    if (activeKey !== null && metadata[activeKey] !== undefined) {
      const c = resolveTagColor(metadata, tagGroups, activeName);
      if (c && c !== '#999999') return c;
    }
    return palette.textMuted;
  };
  const edgeColors = new Set(layout.edges.map((e) => edgeColorFor(e.metadata)));
  for (const color of edgeColors) {
    const hex = color.replace('#', '');
    defs
      .append('marker')
      .attr('id', `sk-arrow-${hex}`)
      .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
      .attr('refX', ARROWHEAD_W)
      .attr('refY', ARROWHEAD_H / 2)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('markerUnits', 'userSpaceOnUse')
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
      .attr('fill', color);
    defs
      .append('marker')
      .attr('id', `sk-arrow-rev-${hex}`)
      .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
      .attr('refX', 0)
      .attr('refY', ARROWHEAD_H / 2)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('markerUnits', 'userSpaceOnUse')
      .attr('orient', 'auto')
      .append('polygon')
      .attr(
        'points',
        `${ARROWHEAD_W},0 0,${ARROWHEAD_H / 2} ${ARROWHEAD_W},${ARROWHEAD_H}`
      )
      .attr('fill', color);
  }

  // ── Title ───────────────────────────────────────────────────
  if (showTitle) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-size', 15)
      .attr('font-weight', 700)
      .attr('fill', palette.text)
      .text(parsed.title!);
  }

  // ── Legend ──────────────────────────────────────────────────
  if (legendGroups.length > 0) {
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0,${titleOffset + 4})`);
    renderIntegratedLegend(legendG, {
      groups: legendGroups,
      ...(activeName !== null && { activeGroup: activeName }),
      mode: exportMode ? 'export' : 'preview',
      showInactivePills: true,
      palette,
      isDark,
      width,
    });
    legendG.selectAll('[data-legend-group]').classed('sk-legend-group', true);
  }

  // ── Content root (centers narrow content when exportDims pad us out) ──
  const contentX = DIAGRAM_PADDING + Math.max(0, (width - contentWidth) / 2);
  const root = svg
    .append('g')
    .attr('class', 'sk-root')
    .attr('transform', `translate(${contentX},${contentTop})`);

  const rectById = new Map<string, Rect>();
  for (const node of layout.nodes) {
    rectById.set(node.id, { x: node.x, y: node.y, w: node.w, h: node.h });
  }
  for (const box of layout.boxes) {
    rectById.set(box.id, { x: box.x, y: box.y, w: box.w, h: box.h });
  }

  // ── Boxes (frames) ──────────────────────────────────────────
  const boxLayer = root.append('g').attr('class', 'sk-boxes');
  for (const box of layout.boxes) {
    drawBoxFrame(boxLayer, box, colorsFor(box.metadata, true), palette);
  }

  // ── Edges ───────────────────────────────────────────────────
  const edgeLayer = root.append('g').attr('class', 'sk-edges');
  const labelLayerData: Array<{
    x: number;
    y: number;
    text: string;
    color: string;
  }> = [];
  for (const edge of layout.edges) {
    const source = rectById.get(edge.sourceId);
    const target = rectById.get(edge.targetId);
    if (!source || !target) continue;
    const color = edgeColorFor(edge.metadata);
    const hex = color.replace('#', '');
    const { d, mid } = edgePath(source, target);
    const g = edgeLayer
      .append('g')
      .attr('class', 'sk-edge-group')
      .attr('data-from', edge.sourceId)
      .attr('data-to', edge.targetId)
      .attr('data-line-number', edge.lineNumber);
    const path = g
      .append('path')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', EDGE_STROKE_WIDTH);
    if (edge.dashed) path.attr('stroke-dasharray', DASH);
    if (edge.heads === 'one' || edge.heads === 'both') {
      path.attr('marker-end', `url(#sk-arrow-${hex})`);
    }
    if (edge.heads === 'both') {
      path.attr('marker-start', `url(#sk-arrow-rev-${hex})`);
    }
    if (edge.label) {
      labelLayerData.push({ x: mid.x, y: mid.y, text: edge.label, color });
    }
  }

  // ── Nodes ───────────────────────────────────────────────────
  const nodeLayer = root.append('g').attr('class', 'sk-nodes');
  for (const node of layout.nodes) {
    drawNode(nodeLayer, node, colorsFor(node.metadata), palette, isDark);
  }

  // ── Edge labels (above nodes, with a bg halo) ───────────────
  const labelLayer = root.append('g').attr('class', 'sk-edge-labels');
  for (const l of labelLayerData) {
    const g = labelLayer.append('g').attr('class', 'sk-edge-label');
    const textWidth = l.text.length * EDGE_LABEL_FONT_SIZE * 0.56;
    g.append('rect')
      .attr('x', l.x - textWidth / 2 - 3)
      .attr('y', l.y - EDGE_LABEL_FONT_SIZE / 2 - 3)
      .attr('width', textWidth + 6)
      .attr('height', EDGE_LABEL_FONT_SIZE + 6)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.72);
    g.append('text')
      .attr('x', l.x)
      .attr('y', l.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', EDGE_LABEL_FONT_SIZE)
      .attr('fill', l.color)
      .text(l.text);
  }

  // ── Click plumbing (app preview) ────────────────────────────
  if (options.onClickItem) {
    const handler = options.onClickItem;
    svg
      .selectAll<SVGElement, unknown>('[data-line-number]')
      .on('click', function () {
        const ln = Number(this.getAttribute('data-line-number'));
        if (Number.isFinite(ln) && ln > 0) handler(ln);
      });
  }
}

// ── Pieces ──────────────────────────────────────────────────

function drawBoxFrame(
  layer: Sel,
  box: SketchLayoutBox,
  colors: NodeColors,
  palette: PaletteColors
): void {
  const g = layer
    .append('g')
    .attr('class', 'sk-box')
    .attr('data-node-id', box.id)
    .attr('data-group-toggle', box.label)
    .attr('data-line-number', box.lineNumber);
  g.append('rect')
    .attr('x', box.x)
    .attr('y', box.y)
    .attr('width', box.w)
    .attr('height', box.h)
    .attr('rx', CONTAINER_RADIUS)
    .attr('fill', colors.fill)
    .attr('fill-opacity', 0.4)
    .attr('stroke', colors.stroke)
    .attr('stroke-opacity', 0.7)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('text')
    .attr('x', box.x + box.w / 2)
    .attr('y', box.y + box.bandH / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', BAND_LABEL_FONT_SIZE)
    .attr('font-weight', 800)
    .attr('fill', palette.text)
    .attr('opacity', BAND_LABEL_OPACITY)
    .text(box.label);
}

function drawNode(
  layer: Sel,
  node: SketchLayoutNode,
  colors: NodeColors,
  palette: PaletteColors,
  isDark: boolean
): void {
  void isDark;
  const g = layer
    .append('g')
    .attr('class', node.isCollapsedBox ? 'sk-node sk-box-collapsed' : 'sk-node')
    .attr('transform', `translate(${node.x},${node.y})`)
    .attr('data-node-id', node.id)
    .attr('data-line-number', node.lineNumber);
  for (const [k, v] of Object.entries(node.metadata)) {
    g.attr(`data-tag-${k}`, v);
  }
  if (node.isCollapsedBox) {
    g.attr('data-group-toggle', node.label);
  }

  drawShapeBody(g, node.shape, node.w, node.h, colors);

  if (node.shape === 'note') {
    // Sticky-style: smaller, regular weight, left-aligned, multiline.
    const lines = wrapTextToWidth(node.label, NOTE_FONT_SIZE, node.w - 34);
    const lineHeight = NOTE_FONT_SIZE + 4;
    lines.slice(0, 5).forEach((line, i) => {
      g.append('text')
        .attr('x', 10)
        .attr('y', 20 + i * lineHeight)
        .attr('font-size', NOTE_FONT_SIZE)
        .attr('fill', colors.text)
        .text(line);
    });
  } else if (node.shape === 'person') {
    const offset = 40;
    drawFittedLabel(
      g,
      node.label,
      offset + (node.w - offset) / 2,
      node.h / 2,
      node.w - offset - 16,
      colors.text
    );
  } else {
    drawFittedLabel(
      g,
      node.label,
      node.w / 2,
      node.h / 2,
      node.w - 20,
      colors.text
    );
  }

  if (node.isCollapsedBox) {
    renderCollapseBar(g, {
      width: node.w,
      height: node.h,
      barHeight: COLLAPSE_BAR_HEIGHT,
      inset: 0,
      rx: CARD_RADIUS,
      fill:
        colors.stroke === palette.textMuted ? palette.textMuted : colors.stroke,
      clipId: `sk-clip-${node.id.replace(/[^a-zA-Z0-9_-]/g, '')}-${node.lineNumber}`,
      className: 'sk-collapse-bar',
    });
  }
}

/** Cubic edge leaving both ports at 90° (spec decision 15 — never elbowed). */
function edgePath(
  source: Rect,
  target: Rect
): { d: string; mid: { x: number; y: number } } {
  const acx = source.x + source.w / 2;
  const acy = source.y + source.h / 2;
  const bcx = target.x + target.w / 2;
  const bcy = target.y + target.h / 2;
  const horiz = Math.abs(bcx - acx) >= Math.abs(bcy - acy);
  let p0: { x: number; y: number };
  let p1: { x: number; y: number };
  let h0: { x: number; y: number };
  let h1: { x: number; y: number };
  if (horiz) {
    const sign = bcx >= acx ? 1 : -1;
    p0 = { x: sign > 0 ? source.x + source.w : source.x, y: acy };
    p1 = { x: sign > 0 ? target.x : target.x + target.w, y: bcy };
    const k = Math.max(
      CURVE_HANDLE_MIN,
      Math.min(CURVE_HANDLE_MAX, Math.abs(p1.x - p0.x) / 2)
    );
    h0 = { x: p0.x + sign * k, y: p0.y };
    h1 = { x: p1.x - sign * k, y: p1.y };
  } else {
    const sign = bcy >= acy ? 1 : -1;
    p0 = { x: acx, y: sign > 0 ? source.y + source.h : source.y };
    p1 = { x: bcx, y: sign > 0 ? target.y : target.y + target.h };
    const k = Math.max(
      CURVE_HANDLE_MIN,
      Math.min(CURVE_HANDLE_MAX, Math.abs(p1.y - p0.y) / 2)
    );
    h0 = { x: p0.x, y: p0.y + sign * k };
    h1 = { x: p1.x, y: p1.y - sign * k };
  }
  return {
    d: `M ${p0.x} ${p0.y} C ${h0.x} ${h0.y}, ${h1.x} ${h1.y}, ${p1.x} ${p1.y}`,
    mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 - 8 },
  };
}

/** Export wrapper — the b&l precedent (thin spread). */
export function renderSketchForExport(
  container: HTMLDivElement,
  parsed: ParsedSketch,
  layout: SketchLayout,
  palette: PaletteColors,
  isDark: boolean,
  options: {
    exportDims?: { width: number; height: number };
    activeTagGroup?: string | null;
    exportMode?: boolean;
  } = {}
): void {
  renderSketch(container, parsed, layout, palette, isDark, {
    ...options,
    exportMode: options.exportMode ?? true,
  });
}
