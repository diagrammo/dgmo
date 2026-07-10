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
// A wide, invisible stroke laid over each edge so it's easy to click/select even
// though the drawn line is thin. pointer-events:stroke makes the transparent
// paint catch clicks; it sits last in the group so `.sk-edge-group path` (first
// path) still resolves to the VISIBLE line.
const EDGE_HIT_WIDTH = 18;
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

/** Largest font in [minFont, maxFont] whose word-wrap of `label` fits `maxWidth`
 *  in ≤ maxLines lines. Wraps (multi-line) before it shrinks, so a long label
 *  reads at a comfortable size across several lines rather than collapsing to a
 *  tiny one-liner. If even minFont can't fit within maxLines, the last shown
 *  line is middle-ellipsized so the block stays bounded. */
function fitWrapped(
  label: string,
  maxWidth: number,
  maxFont: number = CARD_LABEL_MAX,
  minFont: number = CARD_LABEL_MIN,
  maxLines: number = 2
): { lines: string[]; fontSize: number } {
  for (let fs = maxFont; fs >= minFont; fs--) {
    const lines = wrapTextToWidth(label, fs, maxWidth, { hardBreak: true });
    if (lines.length <= maxLines) return { lines, fontSize: fs };
  }
  const lines = wrapTextToWidth(label, minFont, maxWidth, { hardBreak: true });
  if (lines.length <= maxLines) return { lines, fontSize: minFont };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last.length > 1 && measureText(`${last}…`, minFont) > maxWidth)
    last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return { lines: kept, fontSize: minFont };
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

  // Untagged shapes still read as filled cards, not empty outlines: a slight
  // gray tint (muted mixed into the bg) — subtle on light, a touch lighter than
  // the bg on dark.
  const neutralFill = mix(palette.textMuted, palette.bg, 12);
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

  // ── Boxes (frames) ──────────────────────────────────────────
  const boxLayer = root.append('g').attr('class', 'sk-boxes');
  for (const box of layout.boxes) {
    drawBoxFrame(boxLayer, box, colorsFor(box.metadata, true), palette);
  }

  // ── Edges ───────────────────────────────────────────────────
  // Same pipeline the app`s live-drag preview uses (sketchEdgeGeometry), so a
  // dragged edge previews exactly as it commits.
  const edgeGeom = sketchEdgeGeometry(layout);
  const edgeLayer = root.append('g').attr('class', 'sk-edges');
  const labelLayerData: Array<{
    x: number;
    y: number;
    text: string;
    color: string;
    from: string;
    to: string;
  }> = [];
  for (let ei = 0; ei < layout.edges.length; ei++) {
    const edge = layout.edges[ei]!;
    const geo = edgeGeom[ei];
    if (!geo) continue;
    const color = flowColor(edge);
    const hex = color.replace('#', '');
    const { d, mid } = geo;
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
    // Wide transparent hit target (appended last → visible path stays first).
    g.append('path')
      .attr('class', 'sk-edge-hit')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', EDGE_HIT_WIDTH)
      .attr('stroke-linecap', 'round')
      .attr('pointer-events', 'stroke');
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
    // "Descriptions" toggle hides BOTH tag-metadata rows (empty tagGroups) and a
    // node's free-text markdown description (strip it so the card renders as a
    // plain centered-title node).
    let n = node;
    if (hideDesc && node.description) {
      n = { ...node };
      delete (n as { description?: string }).description;
    }
    drawNode(
      nodeLayer,
      n,
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
  // Wrap the group name (up to 2 lines) so a long label stays legible in the
  // fixed top band instead of overflowing the box width.
  const fit = fitWrapped(box.label, box.w - 16, BAND_LABEL_FONT_SIZE, 12, 2);
  const lineH = fit.fontSize * 1.2;
  const bandMid = box.y + box.bandH / 2;
  const startY = bandMid - ((fit.lines.length - 1) * lineH) / 2;
  for (let li = 0; li < fit.lines.length; li++) {
    g.append('text')
      .attr('x', box.x + box.w / 2)
      .attr('y', startY + li * lineH)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', fit.fontSize)
      .attr('font-weight', 800)
      .attr('fill', palette.text)
      .attr('opacity', BAND_LABEL_OPACITY)
      // In-bounds by loop guard.
      .text(fit.lines[li]!);
  }
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
      // Single-line title: its 34px band sits directly above the rule + body,
      // so it stays one (ellipsized) line rather than wrapping into the rule.
      const fitH = fitWrapped(
        node.label,
        node.w - 24 - labelInset,
        CARD_LABEL_MAX,
        CARD_LABEL_MIN,
        1
      );
      renderNodeCard(g, {
        width: node.w,
        height: node.h,
        rx: CARD_RADIUS,
        fill: colors.fill,
        stroke: colors.stroke,
        strokeWidth: NODE_STROKE_WIDTH,
        label: fitH.lines[0] ?? node.label,
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
    // No rows (descriptions off, an untagged shape, OR a collapsed group card):
    // the name grows to fill the card, centered in the full-height header band.
    // A collapsed group is styled exactly like a plain node — same big centered
    // name — and differs only by the collapse bar drawn at its bottom.
    const fillTitle = rows.length === 0;
    // Wrap the name onto multiple lines before shrinking it: a full-height title
    // (no rows) gets up to 3 lines; a header-band title (with rows below) gets 2.
    const fit = fitWrapped(
      node.label,
      node.w - 24 - labelInset,
      fillTitle ? CARD_TITLE_MAX : CARD_LABEL_MAX,
      CARD_LABEL_MIN,
      fillTitle ? 3 : 2
    );
    renderNodeCard(g, {
      width: node.w,
      height: node.h,
      rx: CARD_RADIUS,
      fill: colors.fill,
      stroke: colors.stroke,
      strokeWidth: NODE_STROKE_WIDTH,
      label: fit.lines.join(' '),
      labelLines: fit.lines,
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
interface Ports {
  ys: number[];
  xs: number[];
}
type Side = 'T' | 'B' | 'L' | 'R';

/**
 * Assign each edge a side on its source and target box, avoiding side
 * collisions on shared nodes. Each edge prefers the side its dominant axis
 * points at (a mostly-horizontal edge → left/right; mostly-vertical → top/
 * bottom). Strongly-directional edges are placed first; a near-diagonal edge
 * whose preferred side is already claimed on either end flips to the free
 * perpendicular side — so a hub with left+right edges routes a third,
 * up-and-over edge out its TOP rather than crowding a side.
 */
function assignEdgeSides(
  edges: readonly { sourceId: string; targetId: string }[],
  rectById: Map<string, Rect>
): Array<{ s: Side; t: Side } | null> {
  const cx = (r: Rect): number => r.x + r.w / 2;
  const cy = (r: Rect): number => r.y + r.h / 2;
  // The side of a box facing (dx,dy): the dominant-axis side, and the
  // perpendicular fallback toward the same point.
  const opposite = (s: Side): Side =>
    s === 'L' ? 'R' : s === 'R' ? 'L' : s === 'T' ? 'B' : 'T';
  // The dominant-axis side facing (dx,dy), plus the perpendicular fallback.
  const facing = (dx: number, dy: number): { primary: Side; alt: Side } => {
    const horiz = Math.abs(dx) >= Math.abs(dy);
    return horiz
      ? { primary: dx >= 0 ? 'R' : 'L', alt: dy >= 0 ? 'B' : 'T' }
      : { primary: dy >= 0 ? 'B' : 'T', alt: dx >= 0 ? 'R' : 'L' };
  };
  // Below this min/max axis ratio an edge counts as ~aligned (drawn straight,
  // opposite sides); above it, diagonal (drawn as a corner — perpendicular
  // sides).
  const DIAG = 0.4;
  const descs = edges
    .map((e, i) => {
      const s = rectById.get(e.sourceId);
      const t = rectById.get(e.targetId);
      if (!s || !t) return null;
      const dx = cx(t) - cx(s);
      const dy = cy(t) - cy(s);
      const ratio =
        Math.min(Math.abs(dx), Math.abs(dy)) /
        Math.max(Math.abs(dx), Math.abs(dy), 1);
      return {
        i,
        sId: e.sourceId,
        tId: e.targetId,
        dx,
        dy,
        diagonal: ratio >= DIAG,
        dominance: Math.abs(Math.abs(dx) - Math.abs(dy)),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const used = new Map<string, Set<Side>>();
  const has = (id: string, side: Side): boolean =>
    used.get(id)?.has(side) ?? false;
  const take = (id: string, side: Side): void => {
    const set = used.get(id) ?? new Set<Side>();
    set.add(side);
    used.set(id, set);
  };
  // Pick a side for one endpoint: its preferred side if free, else the fallback
  // if free, else share the preferred side.
  const pick = (id: string, sides: { primary: Side; alt: Side }): Side => {
    const side = !has(id, sides.primary)
      ? sides.primary
      : !has(id, sides.alt)
        ? sides.alt
        : sides.primary;
    take(id, side);
    return side;
  };

  const out: Array<{ s: Side; t: Side } | null> = edges.map(() => null);
  // Strongest-axis edges claim their side first; ambiguous ones adapt. The
  // source takes its dominant-axis side (flipping to the perpendicular only if
  // that side is congested). The target then either mirrors it (aligned →
  // straight) or attaches on the PERPENDICULAR side facing the source (diagonal
  // → clean corner, e.g. source-right + target-top for a box below-and-right).
  for (const d of [...descs].sort((a, b) => b.dominance - a.dominance)) {
    const sSide = pick(d.sId, facing(d.dx, d.dy));
    const sHoriz = sSide === 'L' || sSide === 'R';
    // Perpendicular-axis side of the target facing the source.
    const perp: Side = sHoriz ? (d.dy <= 0 ? 'B' : 'T') : d.dx <= 0 ? 'R' : 'L';
    const tgt = d.diagonal
      ? { primary: perp, alt: opposite(sSide) }
      : { primary: opposite(sSide), alt: perp };
    out[d.i] = { s: sSide, t: pick(d.tId, tgt) };
  }
  return out;
}

function edgePath(
  source: Rect,
  target: Rect,
  sSide: Side,
  tSide: Side,
  sourcePorts?: Ports,
  targetPorts?: Ports
): { d: string; mid: { x: number; y: number } } {
  const acx = source.x + source.w / 2;
  const acy = source.y + source.h / 2;
  const bcx = target.x + target.w / 2;
  const bcy = target.y + target.h / 2;
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, v));
  // Keep a port off the corners: clamp into the middle band of the side (a
  // corner is never a valid attachment — an edge always meets a side mid-
  // section). CORNER_FRAC trims this fraction off each end of the side.
  const CORNER_FRAC = 0.25;
  const midClamp = (v: number, lo: number, hi: number): number => {
    const m = (hi - lo) * CORNER_FRAC;
    return clamp(v, lo + m, hi - m);
  };
  const nearest = (arr: number[], v: number): number =>
    arr.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), arr[0]!);
  // Attachment point on `side` of `rect`. A GROUP endpoint snaps the cross-axis
  // coordinate to its nearest discrete child port (row for L/R, column for
  // T/B); a BARE node attaches at that side's midpoint (its center on that
  // axis). `toward` is the other end's center, which the port snaps nearest to.
  const attach = (
    side: Side,
    rect: Rect,
    ports: Ports | undefined,
    toward: { x: number; y: number }
  ): { x: number; y: number } => {
    if (side === 'L' || side === 'R') {
      const x = side === 'L' ? rect.x : rect.x + rect.w;
      const y = ports
        ? midClamp(nearest(ports.ys, toward.y), rect.y, rect.y + rect.h)
        : rect.y + rect.h / 2;
      return { x, y };
    }
    const y = side === 'T' ? rect.y : rect.y + rect.h;
    const x = ports
      ? midClamp(nearest(ports.xs, toward.x), rect.x, rect.x + rect.w)
      : rect.x + rect.w / 2;
    return { x, y };
  };
  const normal = (side: Side): { x: number; y: number } =>
    side === 'L'
      ? { x: -1, y: 0 }
      : side === 'R'
        ? { x: 1, y: 0 }
        : side === 'T'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  const p0 = attach(sSide, source, sourcePorts, { x: bcx, y: bcy });
  const p1 = attach(tSide, target, targetPorts, { x: acx, y: acy });
  const n0 = normal(sSide);
  const n1 = normal(tSide);
  const k = Math.max(
    CURVE_HANDLE_MIN,
    Math.min(CURVE_HANDLE_MAX, Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2)
  );
  const h0 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k };
  const h1 = { x: p1.x + n1.x * k, y: p1.y + n1.y * k };
  return {
    d: `M ${p0.x} ${p0.y} C ${h0.x} ${h0.y}, ${h1.x} ${h1.y}, ${p1.x} ${p1.y}`,
    // Centered ON the line (no vertical offset): the opaque label halo masks
    // the segment behind it cleanly, so the label reads as sitting on the line
    // rather than floating awkwardly just above it.
    mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
  };
}

export interface SketchEdgeGeometry {
  sourceId: string;
  targetId: string;
  d: string;
  mid: { x: number; y: number };
}

/**
 * The full edge-routing pipeline (side assignment + curved paths + group-port
 * snapping) as a pure function, so the renderer AND the app`s live-drag preview
 * draw edges with IDENTICAL geometry. `offsets` shifts individual nodes/boxes
 * by live pixel deltas (a dragged shape and its box children) — pass none for
 * the committed layout.
 */
export function sketchEdgeGeometry(
  layout: SketchLayout,
  offsets?: ReadonlyMap<string, { dx: number; dy: number }>
): Array<SketchEdgeGeometry | null> {
  const off = (id: string): { dx: number; dy: number } =>
    offsets?.get(id) ?? { dx: 0, dy: 0 };
  const rectById = new Map<string, Rect>();
  for (const n of layout.nodes) {
    const o = off(n.id);
    rectById.set(n.id, { x: n.x + o.dx, y: n.y + o.dy, w: n.w, h: n.h });
  }
  for (const b of layout.boxes) {
    const o = off(b.id);
    rectById.set(b.id, { x: b.x + o.dx, y: b.y + o.dy, w: b.w, h: b.h });
  }
  const portsById = new Map<string, Ports>();
  for (const box of layout.boxes) {
    const o = off(box.id);
    const kids = layout.nodes.filter((n) => n.boxLabel === box.label);
    const ys = kids.map((k) => k.y + off(k.id).dy + k.h / 2);
    const xs = kids.map((k) => k.x + off(k.id).dx + k.w / 2);
    ys.push(box.y + o.dy + box.h / 2);
    xs.push(box.x + o.dx + box.w / 2);
    portsById.set(box.id, { ys, xs });
  }
  const sides = assignEdgeSides(layout.edges, rectById);
  return layout.edges.map((edge, i) => {
    const source = rectById.get(edge.sourceId);
    const target = rectById.get(edge.targetId);
    if (!source || !target) return null;
    const sd = sides[i] ?? { s: 'R' as Side, t: 'L' as Side };
    const { d, mid } = edgePath(
      source,
      target,
      sd.s,
      sd.t,
      portsById.get(edge.sourceId),
      portsById.get(edge.targetId)
    );
    return { sourceId: edge.sourceId, targetId: edge.targetId, d, mid };
  });
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
