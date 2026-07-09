// ============================================================
// Sketch diagram — Renderer (spec §31, visual conventions §1/§2/§4/§5)
// ============================================================
//
// One drawing code path for every surface: the app canvas calls this renderer
// directly with a scene-graph-derived model; embeds/CLI reach it via render()
// with parsed text (spec decision 21 — parity by construction).
//
// Node recipe: an org-style card (renderNodeCard) — 25% tint fill (shapeFill),
// 2px tag stroke, a header with the name (one line, shrink → ellipsis) + a type
// badge, a rule, and one metadata row per tag (Group: value). Untagged = neutral
// gray (decision 26a), name centered. `note` is the one non-card shape. Boxes
// reserve a top band for a big/thick/faded label. Edges leave ports at 90° on
// cubic curves, 12×8 arrowheads, '6 3' dash for the ~ family. No manual colors.

import * as d3 from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { renderCollapseBar, renderNodeCard } from '../utils/card';
import { drawMarkdownBlock } from './markdown-card';
import type { LegendGroupData } from '../utils/legend-types';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  resolveActiveTagGroup,
  resolveTagColor,
  tagAttrKey,
} from '../utils/tag-groups';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import { CARD_RADIUS, CONTAINER_RADIUS } from '../utils/visual-conventions';
import type { ParsedSketch, SketchShapeKind } from './types';
import type { SketchLayout, SketchLayoutBox, SketchLayoutNode } from './layout';

// ── Local constants ─────────────────────────────────────────

const DIAGRAM_PADDING = 20;
const TITLE_Y = 32;
const TITLE_FONT_SIZE = 18;
// Sketch overrides the shared visual weights for a bolder, less-washed look.
const NODE_STROKE_WIDTH = 2;
const EDGE_STROKE_WIDTH = 2;
const ARROWHEAD_W = 12;
const ARROWHEAD_H = 8;
const DASH = '6 3';
const BAND_LABEL_FONT_SIZE = 19;
const BAND_LABEL_OPACITY = 0.55;
const NOTE_FONT_SIZE = 11;
const COLLAPSE_BAR_HEIGHT = 4;
const EDGE_LABEL_FONT_SIZE = 12;
const CURVE_HANDLE_MIN = 24;
const CURVE_HANDLE_MAX = 90;

export interface SketchRenderOptions {
  exportDims?: { width?: number; height?: number };
  activeTagGroup?: string | null;
  exportMode?: boolean;
  onClickItem?: (lineNumber: number) => void;
  /** View-state `hd` (hide descriptions): drop the metadata rows so each card
   *  is just its header/name — the standard mindmap toggle, shelf-driven. */
  hideDescriptions?: boolean;
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

// ── Sticky-note body (the one non-card shape) ───────────────

function drawNoteBody(g: Sel, w: number, h: number, colors: NodeColors): void {
  const f = 14;
  g.append('path')
    .attr(
      'd',
      `M0 2 a2 2 0 0 1 2 -2 h${w - f - 2} l${f} ${f} v${h - f - 2} a2 2 0 0 1 -2 2 h-${w - 4} a2 2 0 0 1 -2 -2 Z`
    )
    .attr('fill', colors.fill)
    .attr('stroke', colors.stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('path')
    .attr('d', `M${w - f} 0 v${f} h${f}`)
    .attr('fill', 'none')
    .attr('stroke', colors.stroke)
    .attr('stroke-width', 1.2);
}

// ── Type badge (org-card header) ────────────────────────────
// A small monochrome glyph in the card header marks a non-default shape kind
// (database / queue / document / person). The card outline itself is a uniform
// rounded rect — type is a hint, not a silhouette. Drawn in a 16×16 box at
// (bx, by). `rectangle` and `note` get no badge.

function drawTypeBadge(
  g: Sel,
  kind: SketchShapeKind,
  color: string,
  bx: number,
  by: number
): void {
  const b = g
    .append('g')
    .attr('transform', `translate(${bx},${by})`)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.3)
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round');
  switch (kind) {
    case 'database':
      b.append('ellipse')
        .attr('cx', 8)
        .attr('cy', 3)
        .attr('rx', 6)
        .attr('ry', 2.4);
      b.append('path').attr('d', 'M2 3 v10 a6 2.4 0 0 0 12 0 v-10');
      return;
    case 'queue':
      b.append('path').attr('d', 'M3 1 h8 a3 6.5 0 0 1 0 13 h-8 Z');
      b.append('ellipse')
        .attr('cx', 3)
        .attr('cy', 7.5)
        .attr('rx', 3)
        .attr('ry', 6.5);
      return;
    case 'document':
      b.append('path').attr('d', 'M2 1 h9 v11 q-4.5 2 -9 0 q0 0 0 0 Z');
      return;
    case 'person':
      b.append('circle').attr('cx', 8).attr('cy', 5).attr('r', 3);
      b.append('path').attr('d', 'M2 15 a6 5 0 0 1 12 0');
      return;
    default:
      return;
  }
}

/** Ordered metadata rows for a card: each declared tag group the node carries,
 *  in declaration order, as [group display name, value]. */
function metaRows(
  metadata: Record<string, string>,
  tagGroups: readonly { name: string }[]
): Array<readonly [string, string]> {
  const rows: Array<readonly [string, string]> = [];
  for (const grp of tagGroups) {
    const v = metadata[tagAttrKey(grp.name)];
    if (v !== undefined) rows.push([grp.name, v]);
  }
  return rows;
}

const CARD_HEADER_H = 34;
const CARD_LABEL_MAX = 15;
const CARD_LABEL_MIN = 11;
const CARD_META_FONT = 12;
/** Header font ceiling when the name fills a card with no rows. */
const CARD_TITLE_MAX = 30;

/** Largest header font in [MIN, maxFont] that fits the label on one line, else
 *  the min font with a middle-ellipsized label. */
function fitOneLine(
  label: string,
  maxWidth: number,
  maxFont: number = CARD_LABEL_MAX
): { text: string; fontSize: number } {
  for (let fs = maxFont; fs >= CARD_LABEL_MIN; fs--) {
    if (measureText(label, fs) <= maxWidth)
      return { text: label, fontSize: fs };
  }
  let text = label;
  while (
    text.length > 1 &&
    measureText(`${text}…`, CARD_LABEL_MIN) > maxWidth
  ) {
    text = text.slice(0, -1);
  }
  return { text: `${text}…`, fontSize: CARD_LABEL_MIN };
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
  const {
    activeTagGroup,
    exportMode = false,
    hideDescriptions = false,
  } = options;
  // Hide the metadata rows when the source directive OR the shelf/view-state
  // toggle asks — the name then takes the whole card.
  const hideDesc = hideDescriptions || parsed.options.noDescriptions;

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
      // Label text takes the shape's own (tag) color — but for solid fills the
      // tag color would vanish into the fill, so keep a contrast color there.
      text: parsed.options.solidFill
        ? contrastText(fill, palette.textOnFillLight, palette.textOnFillDark)
        : tagColor,
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
  // Lines are neutral by default: a line is colored only when it carries its
  // OWN tag (via the active group). Newly created lines are untagged, so they
  // read as plain connectors rather than inheriting a shape's meaning.
  const flowColor = (edge: {
    sourceId: string;
    metadata: Record<string, string>;
  }): string => edgeColorFor(edge.metadata);
  const edgeColors = new Set(layout.edges.map((e) => flowColor(e)));
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
      .attr('font-size', TITLE_FONT_SIZE)
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
    from: string;
    to: string;
  }> = [];
  for (const edge of layout.edges) {
    const source = rectById.get(edge.sourceId);
    const target = rectById.get(edge.targetId);
    if (!source || !target) continue;
    const color = flowColor(edge);
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
      labelLayerData.push({
        x: mid.x,
        y: mid.y,
        text: edge.label,
        color,
        from: edge.sourceId,
        to: edge.targetId,
      });
    }
  }

  // ── Nodes ───────────────────────────────────────────────────
  const nodeLayer = root.append('g').attr('class', 'sk-nodes');
  for (const node of layout.nodes) {
    drawNode(
      nodeLayer,
      node,
      colorsFor(node.metadata),
      palette,
      isDark,
      hideDesc ? [] : tagGroups
    );
  }

  // ── Edge labels (above nodes, with a bg halo) ───────────────
  const labelLayer = root.append('g').attr('class', 'sk-edge-labels');
  for (const l of labelLayerData) {
    const g = labelLayer
      .append('g')
      .attr('class', 'sk-edge-label')
      .attr('data-from', l.from)
      .attr('data-to', l.to);
    const textWidth = l.text.length * EDGE_LABEL_FONT_SIZE * 0.56;
    g.append('rect')
      .attr('x', l.x - textWidth / 2 - 3)
      .attr('y', l.y - EDGE_LABEL_FONT_SIZE / 2 - 3)
      .attr('width', textWidth + 6)
      .attr('height', EDGE_LABEL_FONT_SIZE + 6)
      .attr('rx', 3)
      .attr('fill', palette.bg);
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
  isDark: boolean,
  tagGroups: readonly { name: string }[]
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

  if (node.shape === 'note') {
    // Sticky-style: folded-corner body, smaller left-aligned multiline text.
    drawNoteBody(g, node.w, node.h, colors);
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
  } else {
    // Org-style card: header (badge + name) → rule → metadata rows. A card with
    // no tags centers its name vertically (header band = full height).
    const rows = node.isCollapsedBox ? [] : metaRows(node.metadata, tagGroups);
    const badge = node.shape !== 'rectangle';
    const labelInset = badge ? 22 : 0;
    // Solid-fill: the stroke IS the fill, so a stroke-colored rule/text would
    // vanish — use the (contrast-aware) label color instead, like the org card.
    const solid = colors.stroke === colors.fill;
    const ruleColor = solid ? colors.text : colors.stroke;

    // Free-text markdown description: header band + rule, then the rendered
    // markdown block fills the body (in place of the tag rows). Wrapped, with a
    // small subset (bold/bullets/indent/links); clamps to the fixed card body.
    if (node.description && !node.isCollapsedBox) {
      const fitH = fitOneLine(
        node.label,
        node.w - 24 - labelInset,
        CARD_LABEL_MAX
      );
      renderNodeCard(g, {
        width: node.w,
        height: node.h,
        rx: CARD_RADIUS,
        fill: colors.fill,
        stroke: colors.stroke,
        strokeWidth: NODE_STROKE_WIDTH,
        label: fitH.text,
        labelColor: colors.text,
        labelFontSize: fitH.fontSize,
        headerHeight: CARD_HEADER_H,
      });
      g.append('line')
        .attr('x1', 0)
        .attr('y1', CARD_HEADER_H)
        .attr('x2', node.w)
        .attr('y2', CARD_HEADER_H)
        .attr('stroke', ruleColor)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);
      const inset = 12;
      const bodyGap = 8;
      const lh = CARD_META_FONT + 4;
      const avail = node.h - CARD_HEADER_H - bodyGap - 8;
      const body = g
        .append('g')
        .attr('class', 'sk-desc')
        .attr('transform', `translate(${inset} ${CARD_HEADER_H + bodyGap})`);
      drawMarkdownBlock(body, node.description, {
        width: node.w - inset * 2,
        fontSize: CARD_META_FONT,
        lineHeight: lh,
        color: colors.text, // match the header label (contrast-aware in solid)
        linkColor: colors.text,
        maxLines: Math.max(1, Math.floor(avail / lh)),
      });
      if (badge) {
        drawTypeBadge(g, node.shape, colors.text, 10, (CARD_HEADER_H - 16) / 2);
      }
      return;
    }

    const headerH = rows.length ? CARD_HEADER_H : node.h;
    // No rows (descriptions off, or an untagged shape — but not a collapsed
    // card): the name grows to fill the card. renderNodeCard centers it in the
    // full-height header band.
    const fillTitle = rows.length === 0 && !node.isCollapsedBox;
    const fit = fitOneLine(
      node.label,
      node.w - 24 - labelInset,
      fillTitle ? CARD_TITLE_MAX : CARD_LABEL_MAX
    );
    renderNodeCard(g, {
      width: node.w,
      height: node.h,
      rx: CARD_RADIUS,
      fill: colors.fill,
      stroke: colors.stroke,
      strokeWidth: NODE_STROKE_WIDTH,
      label: fit.text,
      labelColor: colors.text,
      labelFontSize: fit.fontSize,
      headerHeight: headerH,
      ...(rows.length
        ? {
            meta: {
              rows,
              fontSize: CARD_META_FONT,
              lineHeight: CARD_META_FONT + 5,
              separatorGap: 8,
              separatorColor: ruleColor,
              textColor: solid ? colors.text : palette.text,
              keyX: 12,
            },
          }
        : {}),
    });
    if (badge) {
      // Badge stays in the top-left corner in both modes (a full-height header
      // would otherwise sink it to the vertical center).
      // colors.text (not stroke): in solid-fill the stroke IS the fill, so a
      // stroke-colored badge would vanish; colors.text stays contrast-aware.
      drawTypeBadge(g, node.shape, colors.text, 10, (CARD_HEADER_H - 16) / 2);
    }
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
  // Straight-when-aligned: attach both ends at the CENTER OF THE VERTICAL (or
  // horizontal) OVERLAP of the two rects instead of each rect's own center. So
  // a node aligned with a child inside a tall group gets a straight line
  // entering the group at that row — no forced angle to the group's midline.
  // No overlap → fall back to center-to-center (angle is unavoidable).
  const overlap = (
    a0: number,
    a1: number,
    b0: number,
    b1: number
  ): number | null => {
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    return lo < hi ? (lo + hi) / 2 : null;
  };
  if (horiz) {
    const sign = bcx >= acx ? 1 : -1;
    const yOv = overlap(
      source.y,
      source.y + source.h,
      target.y,
      target.y + target.h
    );
    const y0 = yOv ?? acy;
    const y1 = yOv ?? bcy;
    p0 = { x: sign > 0 ? source.x + source.w : source.x, y: y0 };
    p1 = { x: sign > 0 ? target.x : target.x + target.w, y: y1 };
    const k = Math.max(
      CURVE_HANDLE_MIN,
      Math.min(CURVE_HANDLE_MAX, Math.abs(p1.x - p0.x) / 2)
    );
    h0 = { x: p0.x + sign * k, y: p0.y };
    h1 = { x: p1.x - sign * k, y: p1.y };
  } else {
    const sign = bcy >= acy ? 1 : -1;
    const xOv = overlap(
      source.x,
      source.x + source.w,
      target.x,
      target.x + target.w
    );
    const x0 = xOv ?? acx;
    const x1 = xOv ?? bcx;
    p0 = { x: x0, y: sign > 0 ? source.y + source.h : source.y };
    p1 = { x: x1, y: sign > 0 ? target.y : target.y + target.h };
    const k = Math.max(
      CURVE_HANDLE_MIN,
      Math.min(CURVE_HANDLE_MAX, Math.abs(p1.y - p0.y) / 2)
    );
    h0 = { x: p0.x, y: p0.y + sign * k };
    h1 = { x: p1.x, y: p1.y - sign * k };
  }
  return {
    d: `M ${p0.x} ${p0.y} C ${h0.x} ${h0.y}, ${h1.x} ${h1.y}, ${p1.x} ${p1.y}`,
    // Centered ON the line (no vertical offset): the opaque label halo masks
    // the segment behind it cleanly, so the label reads as sitting on the line
    // rather than floating awkwardly just above it.
    mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
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
    hideDescriptions?: boolean;
  } = {}
): void {
  renderSketch(container, parsed, layout, palette, isDark, {
    ...options,
    exportMode: options.exportMode ?? true,
  });
}
