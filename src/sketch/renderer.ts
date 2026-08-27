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
import { renderCollapseBar, renderNodeCard } from '../utils/card';
import { drawMarkdownBlock } from './markdown-card';
import type { LegendGroupData } from '../utils/legend-types';
import {
  getMaxLegendReservedHeight,
  getLegendExtent,
} from '../utils/legend-layout';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { layoutInlineHeader } from '../utils/inline-header';
import {
  resolveActiveTagGroup,
  resolveTagColor,
  tagAttrKey,
} from '../utils/tag-groups';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import {
  CARD_RADIUS,
  COLLAPSE_BAR_HEIGHT as SHARED_COLLAPSE_BAR_HEIGHT,
  CONTAINER_RADIUS,
} from '../utils/visual-conventions';
import {
  CONTAINER_FILL_OPACITY,
  CONTAINER_STROKE_OPACITY,
  sketchColors,
} from './colors';
import { SKETCH_VISUALS } from './visuals';
import type { ParsedSketch, SketchShapeKind } from './types';
import type { SketchLayout, SketchLayoutBox, SketchLayoutNode } from './layout';

// ── Local constants ─────────────────────────────────────────

// 🔴 The weights now live in `./visuals`, exported, because the app's live
// canvas draws this same chart type and had its own set — see the note there.
const DIAGRAM_PADDING = SKETCH_VISUALS.diagramPadding;
const TITLE_Y = SKETCH_VISUALS.titleY;
const TITLE_FONT_SIZE = SKETCH_VISUALS.titleFontSize;
const NODE_STROKE_WIDTH = SKETCH_VISUALS.nodeStrokeWidth;
const EDGE_STROKE_WIDTH = SKETCH_VISUALS.edgeStrokeWidth;
// A wide, invisible stroke laid over each edge so it's easy to click/select even
// though the drawn line is thin. pointer-events:stroke makes the transparent
// paint catch clicks; it sits last in the group so `.sk-edge-group path` (first
// path) still resolves to the VISIBLE line.
const EDGE_HIT_WIDTH = 18;
const ARROWHEAD_W = SKETCH_VISUALS.arrowheadW;
const ARROWHEAD_H = SKETCH_VISUALS.arrowheadH;
const DASH = SKETCH_VISUALS.dash;
const BAND_LABEL_FONT_SIZE = SKETCH_VISUALS.bandLabelFontSize;
const BAND_LABEL_OPACITY = SKETCH_VISUALS.bandLabelOpacity;
const BAND_LABEL_WEIGHT = SKETCH_VISUALS.bandLabelFontWeight;
const NOTE_FONT_SIZE = 11;
// Shared. It was a bare 4 with no comment, against the conventions' 6 —
// boxes-and-lines deviates here too, but records it in the shared file's own
// list; sketch never did.
const COLLAPSE_BAR_HEIGHT = SHARED_COLLAPSE_BAR_HEIGHT;
const EDGE_LABEL_FONT_SIZE = SKETCH_VISUALS.edgeLabelFontSize;
const CURVE_HANDLE_MIN = 24;
const CURVE_HANDLE_MAX = 90;

export interface SketchRenderOptions {
  exportDims?: { width?: number; height?: number };
  activeTagGroup?: string | null;
  exportMode?: boolean;
  onClickItem?: (lineNumber: number) => void;
  /** View-state `hd` (hide descriptions): drop each card's description so it
   *  is just its header/name — the standard mindmap toggle, shelf-driven. */
  hideDescriptions?: boolean;
  /** Render these cards with the header + empty-body split even without a
   *  description — the app's selected-card state, so the description area is
   *  visible to type into. */
  splitCardIds?: readonly string[];
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

// 🔴 All four from the shared conventions now, via `SKETCH_VISUALS`. They read
// 34 / 15 / 12 and a 30px ceiling for a card with no rows — more than twice
// what any other chart type prints — which is most of why a sketch did not look
// like the rest of the product (2026-08-27).
const CARD_HEADER_H = SKETCH_VISUALS.cardHeaderHeight;
const CARD_LABEL_MAX = SKETCH_VISUALS.nodeLabelFontSize;
const CARD_LABEL_MIN = SKETCH_VISUALS.nodeLabelFontSizeMin;
const CARD_META_FONT = SKETCH_VISUALS.cardMetaFontSize;
/** Header font ceiling when the name fills a card with no rows. Shared: a name
 *  is a name, whether or not the card also carries rows. */
const CARD_TITLE_MAX = SKETCH_VISUALS.nodeLabelFontSize;

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
  // Every caller draws these lines bold — the group band at 800, the two card
  // headers at 700 through renderNodeCard — and 800, 700 and 600 all resolve to
  // the one Bold face that ships.
  const BOLD = { hardBreak: true, bold: true } as const;
  for (let fs = maxFont; fs >= minFont; fs--) {
    const lines = wrapTextToWidth(label, fs, maxWidth, BOLD);
    if (lines.length <= maxLines) return { lines, fontSize: fs };
  }
  const lines = wrapTextToWidth(label, minFont, maxWidth, BOLD);
  if (lines.length <= maxLines) return { lines, fontSize: minFont };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (
    last.length > 1 &&
    measureText(`${last}…`, minFont, { bold: true }) > maxWidth
  )
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
    splitCardIds,
  } = options;
  // Hide the descriptions when the source directive OR the shelf/view-state
  // toggle asks — the name then takes the whole card.
  const hideDesc = hideDescriptions || parsed.options.noDescriptions;

  // 🔴 The colour model lives in `./colors` so the app's live canvas can share
  // it rather than invent one — which it had, and which is why a container bled
  // through its children there (#516). This closure stays only as the name the
  // rest of this function already calls.
  const tagGroups = [...parsed.tagGroups];
  const activeName = resolveActiveTagGroup(
    tagGroups,
    undefined,
    activeTagGroup
  );
  const activeKey = activeName === null ? null : tagAttrKey(activeName);
  const colorsFor = sketchColors({
    palette,
    isDark,
    tagGroups,
    activeTagGroup,
    fillMode: parsed.options.fillMode,
  });

  // ── Frame: title + legend reservation ──────────────────────
  const showTitle = !!parsed.title;
  const titleOffset = showTitle ? 40 : 0;
  const legendGroups: readonly LegendGroupData[] = parsed.options.noLegend
    ? []
    : tagGroups;
  // Route edges up front (same pure pipeline the app drag-preview + the edge
  // layer below use) so the diagram bounds can grow to CONTAIN them: a reroute
  // that bulges outside the node/box footprint — and its on-line label — must
  // stay on-canvas, not clip at the frame edge.
  const edgeGeom = sketchEdgeGeometry(layout);
  let minX = 0;
  let minY = 0;
  let maxX = layout.width;
  let maxY = layout.height;
  for (let i = 0; i < edgeGeom.length; i++) {
    const g = edgeGeom[i];
    if (!g) continue;
    const nums = (g.d.match(/-?[\d.]+/g) ?? []).map(Number);
    for (let k = 0; k + 1 < nums.length; k += 2) {
      minX = Math.min(minX, nums[k]!);
      maxX = Math.max(maxX, nums[k]!);
      minY = Math.min(minY, nums[k + 1]!);
      maxY = Math.max(maxY, nums[k + 1]!);
    }
    const label = layout.edges[i]?.label;
    if (label) {
      const hw = measureText(label, EDGE_LABEL_FONT_SIZE) / 2 + 6;
      const hh = EDGE_LABEL_FONT_SIZE / 2 + 4;
      minX = Math.min(minX, g.mid.x - hw);
      maxX = Math.max(maxX, g.mid.x + hw);
      minY = Math.min(minY, g.mid.y - hh);
      maxY = Math.max(maxY, g.mid.y + hh);
    }
  }
  const extraLeft = Math.max(0, -minX);
  const extraTop = Math.max(0, -minY);
  const boundW = maxX + extraLeft;

  const contentWidth = boundW + 2 * DIAGRAM_PADDING;
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

  // §1.9 `legend-inline` (decision #50): try a one-line header (title left,
  // legend flushed right). Falls back to the stacked band when it can't fit.
  const hasLegend = legendGroups.length > 0;
  const inlineRequested = parsed.options.legendInline === true;
  const legendExtent =
    inlineRequested && hasLegend
      ? getLegendExtent(
          {
            groups: legendGroups,
            position: {
              placement: 'top-center',
              titleRelation: 'inline-with-title',
            },
            mode: exportMode ? 'export' : 'preview',
            showInactivePills: true,
          },
          { activeGroup: activeName },
          width
        )
      : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: parsed.title ?? '',
    hasLegend,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth: width,
    titleBandHeight: titleOffset,
    legendReserve: legendHeight,
    titleBaselineY: TITLE_Y,
    titleFontSize: TITLE_FONT_SIZE,
  });
  const contentTop =
    titleOffset +
    (header.inline ? 0 : legendHeight) +
    DIAGRAM_PADDING +
    extraTop;
  const height = Math.max(
    contentTop + maxY + DIAGRAM_PADDING,
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
      .attr('class', 'chart-title')
      .attr('x', header.titleX)
      .attr('y', TITLE_Y)
      .attr('text-anchor', header.titleAnchor)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', 700)
      .attr('fill', palette.text)
      .text(parsed.title!);
  }

  // ── Legend ──────────────────────────────────────────────────
  if (legendGroups.length > 0) {
    const legendG = svg
      .append('g')
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0,${titleOffset + 4})`
      );
    renderIntegratedLegend(legendG, {
      groups: legendGroups,
      ...(activeName !== null && { activeGroup: activeName }),
      mode: exportMode ? 'export' : 'preview',
      showInactivePills: true,
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      palette,
      isDark,
      width,
    });
    legendG.selectAll('[data-legend-group]').classed('sk-legend-group', true);
  }

  // ── Content root (centers narrow content when exportDims pad us out) ──
  // extraLeft shifts local coords right so an edge bulging to negative x lands
  // inside the frame rather than clipping past the left edge.
  const contentX =
    DIAGRAM_PADDING + extraLeft + Math.max(0, (width - contentWidth) / 2);
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
  // `edgeGeom` was computed above (same pipeline the app`s live-drag preview
  // uses) so a dragged edge previews exactly as it commits.
  const edgeLayer = root.append('g').attr('class', 'sk-edges');
  const labelLayerData: Array<{
    x: number;
    y: number;
    text: string;
    color: string;
    from: string;
    to: string;
    /** edge index (so declutter can skip the label`s OWN line) */
    ei: number;
    /** cubic control points [x0,y0,hx0,hy0,hx1,hy1,x1,y1] for on-line nudging */
    cp: number[];
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
      // Visible stroke uses the hopped path when this edge jumps another; the
      // hit-path + all geometry consumers keep the pure cubic `d`.
      .attr('d', geo.dRender ?? d)
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
        ei,
        cp: (d.match(/-?[\d.]+/g) ?? []).map(Number),
      });
    }
  }

  // ── Edge-label declutter ────────────────────────────────────
  // A label must read as belonging to exactly ONE line. It fails that when it
  // overlaps another label, sits on a shape, or sits on top of a DIFFERENT
  // edge`s line (most obviously at a crossing, where the naive midpoint lands
  // right where two lines meet). Slide each label ALONG ITS OWN CURVE to the
  // nearest parameter clear of all three — it stays on its line while stepping
  // off the ambiguous spot.
  {
    const labelW = (t: string): number =>
      t.length * EDGE_LABEL_FONT_SIZE * 0.56;
    const halfH = EDGE_LABEL_FONT_SIZE / 2 + 3;
    const GAP = 4; // breathing room around each label box
    const shapeRects: Rect[] = [
      ...layout.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
      ...layout.boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
    ];
    const cubicPt = (cp: number[], t: number): Pt => {
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const dd = t * t * t;
      return {
        x: a * cp[0]! + b * cp[2]! + c * cp[4]! + dd * cp[6]!,
        y: a * cp[1]! + b * cp[3]! + c * cp[5]! + dd * cp[7]!,
      };
    };
    // Densely sampled polyline per edge, so a label can detect a foreign line
    // running under it (not only at the exact crossing vertex).
    const allPolys: Array<Pt[] | null> = edgeGeom.map((g) => {
      if (!g) return null;
      const cp = (g.d.match(/-?[\d.]+/g) ?? []).map(Number);
      if (cp.length < 8) return null;
      const pts: Pt[] = [];
      for (let s = 0; s <= 32; s++) pts.push(cubicPt(cp, s / 32));
      return pts;
    });
    // Does a label box centred at (cx,cy), half-extents (hw,halfH), cover the
    // point (ox,oy) padded by (ohw,ohh)?
    const covers = (
      cx: number,
      cy: number,
      hw: number,
      ox: number,
      oy: number,
      ohw: number,
      ohh: number
    ): boolean =>
      Math.abs(cx - ox) < hw + ohw + GAP &&
      Math.abs(cy - oy) < halfH + ohh + GAP;
    const placed: Array<{ x: number; y: number; hw: number }> = [];
    // t=0.5 first, then step outward toward each end.
    const TS = [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75, 0.18, 0.82];
    for (const l of labelLayerData) {
      const hw = labelW(l.text) / 2 + 3;
      let bestT = 0.5;
      let bestScore = Infinity;
      for (const t of TS) {
        const p = cubicPt(l.cp, t);
        let labelHits = 0;
        for (const q of placed)
          if (covers(p.x, p.y, hw, q.x, q.y, q.hw, halfH)) labelHits++;
        let shapeHits = 0;
        for (const r of shapeRects)
          if (
            covers(p.x, p.y, hw, r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2)
          )
            shapeHits++;
        // Foreign line under the label box → ambiguous ownership.
        let lineHits = 0;
        for (let k = 0; k < allPolys.length; k++) {
          if (k === l.ei) continue;
          const poly = allPolys[k];
          if (poly?.some((pt) => covers(p.x, p.y, hw, pt.x, pt.y, 0, 0)))
            lineHits++;
        }
        if (labelHits === 0 && shapeHits === 0 && lineHits === 0) {
          bestT = t; // TS is preference-ordered → first fully-clear t wins
          break;
        }
        const score =
          labelHits * 10 + shapeHits * 6 + lineHits * 4 + Math.abs(t - 0.5);
        if (score < bestScore) {
          bestScore = score;
          bestT = t;
        }
      }
      const p = cubicPt(l.cp, bestT);
      l.x = p.x;
      l.y = p.y;
      placed.push({ x: p.x, y: p.y, hw });
    }
  }

  // ── Nodes ───────────────────────────────────────────────────
  const nodeLayer = root.append('g').attr('class', 'sk-nodes');
  for (const node of layout.nodes) {
    // "Descriptions" toggle hides a node's free-text markdown description
    // (strip it so the card renders as a plain centered-title node).
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
      !hideDesc && (splitCardIds?.includes(node.id) ?? false)
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
    // No bg rect — a bg-colored stroke halo painted UNDER the fill (paint-order)
    // hugs each glyph, so the line is masked behind the text without a visible
    // rectangle of whitespace around it.
    g.append('text')
      .attr('x', l.x)
      .attr('y', l.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', EDGE_LABEL_FONT_SIZE)
      .attr('fill', l.color)
      .attr('stroke', palette.bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
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
    .attr('fill-opacity', CONTAINER_FILL_OPACITY)
    .attr('stroke', colors.stroke)
    .attr('stroke-opacity', CONTAINER_STROKE_OPACITY)
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
      .attr('font-weight', BAND_LABEL_WEIGHT)
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
  splitCard: boolean
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
    // Org-style card: header (badge + name) → rule → free-text description.
    // Tags color the card (border/fill/legend) but do NOT print as body rows —
    // the body belongs to the description. A card without one centers its name
    // full-height; `splitCard` (the app's selected-card state) forces the
    // header + empty-body layout so the description area is visible to type in.
    const badge = node.shape !== 'rectangle';
    const labelInset = badge ? 22 : 0;
    // Solid-fill: the stroke IS the fill, so a stroke-colored rule/text would
    // vanish — use the (contrast-aware) label color instead, like the org card.
    const solidLike = colors.stroke === colors.fill;
    const ruleColor = solidLike ? colors.text : colors.stroke;

    if (!node.isCollapsedBox && (node.description || splitCard)) {
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
      if (node.description) {
        const inset = 12;
        const bodyGap = 8;
        const lh = CARD_META_FONT + 4;
        const avail = node.h - CARD_HEADER_H - bodyGap - 8;
        const body = g
          .append('g')
          .attr('class', 'sk-desc')
          .attr('transform', `translate(${inset} ${CARD_HEADER_H + bodyGap})`);
        const block = drawMarkdownBlock(body, node.description, {
          width: node.w - inset * 2,
          fontSize: CARD_META_FONT,
          lineHeight: lh,
          color: colors.text, // match the header label (contrast-aware in solid)
          linkColor: colors.text,
          maxLines: Math.max(1, Math.floor(avail / lh)),
          noEllipsis: true,
        });
        // Authored overflow (source written in the editor exceeds the card's
        // line budget): render the budget and mark the rest honestly — the
        // app wires the marker to jump the editor to those lines.
        if (block.total > block.shown) {
          g.append('text')
            .attr('class', 'sk-desc-more')
            .attr('x', node.w - 8)
            .attr('y', node.h - 5)
            .attr('text-anchor', 'end')
            .attr('font-size', 9)
            .attr('fill', palette.textMuted)
            .attr('data-line-number', node.lineNumber)
            .style('cursor', 'pointer')
            .text(`+${block.total - block.shown} more in source`);
        }
      }
      if (badge) {
        drawTypeBadge(g, node.shape, colors.text, 10, (CARD_HEADER_H - 16) / 2);
      }
      return;
    }

    // No description: the name grows to fill the card, centered in the
    // full-height header band. A collapsed group is styled exactly like a
    // plain node — same big centered name — and differs only by the collapse
    // bar drawn at its bottom.
    const fit = fitWrapped(
      node.label,
      node.w - 24 - labelInset,
      CARD_TITLE_MAX,
      CARD_LABEL_MIN,
      3
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
      headerHeight: node.h,
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
 * Assign each edge a side on its source and target box: each endpoint attaches
 * on the side CLOSEST to the other box. Orientation is decided by axis overlap,
 * not a center-to-center dominant axis — the latter mis-picks a side when one
 * endpoint is a wide group the other sits directly under/beside (a node below a
 * broad group would leave its RIGHT because the group's center was slightly
 * more to the side than above). If the two boxes share a column band (their
 * x-ranges intersect) the link is vertical → top/bottom ports; if they share a
 * row band it's horizontal → left/right ports; a true diagonal (no overlap on
 * either axis) faces the other box's center. The port then snaps to the nearest
 * child (attach()), so a group lands the line on the aligned child. The later
 * relaxation pass still flips sides where it removes a real node/edge crossing.
 */
function assignEdgeSides(
  edges: readonly { sourceId: string; targetId: string }[],
  rectById: Map<string, Rect>
): Array<{ s: Side; t: Side } | null> {
  const cx = (r: Rect): number => r.x + r.w / 2;
  const cy = (r: Rect): number => r.y + r.h / 2;
  // The dominant-axis side facing (dx,dy) — diagonal fallback only.
  const facing = (dx: number, dy: number): Side =>
    Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'R' : 'L') : dy >= 0 ? 'B' : 'T';
  return edges.map((e) => {
    const s = rectById.get(e.sourceId);
    const t = rectById.get(e.targetId);
    if (!s || !t) return null;
    const dx = cx(t) - cx(s);
    const dy = cy(t) - cy(s);
    // Overlap span on each axis (negative = a gap between the two rects).
    const xOverlap = Math.min(s.x + s.w, t.x + t.w) - Math.max(s.x, t.x);
    const yOverlap = Math.min(s.y + s.h, t.y + t.h) - Math.max(s.y, t.y);
    if (xOverlap >= 0 && xOverlap >= yOverlap) {
      // Shared column band → vertical link, top/bottom ports.
      const below = dy >= 0;
      return { s: below ? 'B' : 'T', t: below ? 'T' : 'B' };
    }
    if (yOverlap >= 0 && yOverlap >= xOverlap) {
      // Shared row band → horizontal link, left/right ports.
      const right = dx >= 0;
      return { s: right ? 'R' : 'L', t: right ? 'L' : 'R' };
    }
    // True diagonal: each faces the other's center (target points back).
    return { s: facing(dx, dy), t: facing(-dx, -dy) };
  });
}

type Pt = { x: number; y: number };
interface EdgeGeom {
  d: string;
  mid: Pt;
  p0: Pt;
  h0: Pt;
  h1: Pt;
  p1: Pt;
}

function edgePath(
  source: Rect,
  target: Rect,
  sSide: Side,
  tSide: Side,
  sourcePorts?: Ports,
  targetPorts?: Ports
): EdgeGeom {
  const acx = source.x + source.w / 2;
  const acy = source.y + source.h / 2;
  const bcx = target.x + target.w / 2;
  const bcy = target.y + target.h / 2;
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, v));
  const nearest = (arr: number[], v: number): number =>
    arr.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), arr[0]!);
  // Attachment point on `side` of `rect`. A GROUP endpoint snaps the cross-axis
  // coordinate to its nearest discrete child port (row for L/R, column for
  // T/B) — a synthetic port aligned with that child's midpoint, used VERBATIM so
  // an aligned edge runs dead straight into it. (No corner trim: a child center
  // is already inset by the band + padding, well clear of the frame corners, and
  // clamping it to the tall side's middle band would bend an otherwise-straight
  // line.) A BARE node attaches at that side's MIDPOINT — one port per side (4
  // per node). `toward` is the other end's center, which the group port snaps to.
  const attach = (
    side: Side,
    rect: Rect,
    ports: Ports | undefined,
    toward: { x: number; y: number }
  ): { x: number; y: number } => {
    if (side === 'L' || side === 'R') {
      const x = side === 'L' ? rect.x : rect.x + rect.w;
      const y = ports
        ? clamp(nearest(ports.ys, toward.y), rect.y, rect.y + rect.h)
        : rect.y + rect.h / 2;
      return { x, y };
    }
    const y = side === 'T' ? rect.y : rect.y + rect.h;
    const x = ports
      ? clamp(nearest(ports.xs, toward.x), rect.x, rect.x + rect.w)
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
    // Centered ON the line at its ARC midpoint (t=0.5 on the cubic), not the
    // endpoint average: for a straight edge the two coincide, but for a curve
    // that bulges out to route around a shape the arc midpoint sits at the
    // bulge apex — in open space — while the endpoint average would land on the
    // very shape the edge detoured past. The opaque halo masks the line behind.
    mid: {
      x: 0.125 * p0.x + 0.375 * h0.x + 0.375 * h1.x + 0.125 * p1.x,
      y: 0.125 * p0.y + 0.375 * h0.y + 0.375 * h1.y + 0.125 * p1.y,
    },
    p0,
    h0,
    h1,
    p1,
  };
}

const SIDES: readonly Side[] = ['T', 'B', 'L', 'R'];

/** Point on a cubic Bézier at parameter t. */
function cubicAt(g: EdgeGeom, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const dd = t * t * t;
  return {
    x: a * g.p0.x + b * g.h0.x + c * g.h1.x + dd * g.p1.x,
    y: a * g.p0.y + b * g.h0.y + c * g.h1.y + dd * g.p1.y,
  };
}

/**
 * How many sampled points of a cubic fall INSIDE any obstacle rect (shrunk by
 * `inset` so a curve grazing a neighbour's edge doesn't count). The endpoints'
 * own boxes/nodes are pre-excluded by the caller; a positive count means the
 * line visibly cuts through an unrelated shape.
 */
const EDGE_OBSTACLE_INSET = 6;
const EDGE_SAMPLES = 24;

/** Sample a cubic into a polyline for segment-level intersection tests. ODD on
 *  purpose: t=0.5 is never a sample, so a crossing at two mirror-symmetric
 *  curves` shared midpoint lands MID-segment where `segmentsCross` (strict, so
 *  blind to a crossing exactly on a vertex) can still see it. */
const POLY_SAMPLES = 19;
function polyline(g: EdgeGeom): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= POLY_SAMPLES; i++)
    pts.push(cubicAt(g, i / POLY_SAMPLES));
  return pts;
}

/** Do open segments p→p2 and q→q2 properly cross? (shared endpoints excluded) */
function segmentsCross(p: Pt, p2: Pt, q: Pt, q2: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p, p2, q);
  const d2 = o(p, p2, q2);
  const d3 = o(q, q2, p);
  const d4 = o(q, q2, p2);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Count how many times two sampled edge polylines cross. */
function polyCrossings(a: Pt[], b: Pt[]): number {
  let n = 0;
  for (let i = 0; i + 1 < a.length; i++)
    for (let j = 0; j + 1 < b.length; j++)
      if (segmentsCross(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) n++;
  return n;
}

/** Intersection point of two crossing polylines, or null if they don't cross. */
function polyIntersection(a: Pt[], b: Pt[]): Pt | null {
  for (let i = 0; i + 1 < a.length; i++) {
    const p = a[i]!;
    const p2 = a[i + 1]!;
    for (let j = 0; j + 1 < b.length; j++) {
      const q = b[j]!;
      const q2 = b[j + 1]!;
      if (!segmentsCross(p, p2, q, q2)) continue;
      const rx = p2.x - p.x;
      const ry = p2.y - p.y;
      const sx = q2.x - q.x;
      const sy = q2.y - q.y;
      const denom = rx * sy - ry * sx;
      if (denom === 0) continue;
      const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / denom;
      return { x: p.x + t * rx, y: p.y + t * ry };
    }
  }
  return null;
}

// Radius (half-chord) of the little semicircular hop drawn where one line jumps
// another so the two read as distinct (circuit-diagram convention).
const HOP_R = 7;

/**
 * Render-path for a cubic that HOPS over the given crossing points: a small
 * rounded hump replaces the line at each crossing so it reads as passing over,
 * not joining. Returns null when there`s nothing to hop (caller uses the plain
 * cubic `d`). The hump is a short cubic bulging to the side of least y (a
 * consistent "up-and-over"), so only the visible stroke changes — `d`/`mid`
 * stay the pure cubic every other consumer parses.
 */
function hoppedPath(g: EdgeGeom, hops: readonly Pt[]): string | null {
  if (hops.length === 0) return null;
  // ODD: t=0.5 is never a vertex, so a crossing at two symmetric curves' shared
  // midpoint lands MID-segment — the hump`s A/B straddle the crossing inside one
  // segment instead of overshooting a vertex (which left a backward stub).
  const N = 49;
  const pts: Pt[] = [];
  for (let s = 0; s <= N; s++) pts.push(cubicAt(g, s / N));
  // Snap each hop to the nearest interior segment of this edge`s fine polyline.
  const onSeg = new Map<number, Pt>();
  for (const hp of hops) {
    let bestSeg = -1;
    let bestD = Infinity;
    let bestPt: Pt | null = null;
    for (let k = 1; k <= N; k++) {
      const a = pts[k - 1]!;
      const b = pts[k]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let f = ((hp.x - a.x) * dx + (hp.y - a.y) * dy) / len2;
      f = Math.max(0, Math.min(1, f));
      const px = a.x + f * dx;
      const py = a.y + f * dy;
      const d = Math.hypot(hp.x - px, hp.y - py);
      if (d < bestD) {
        bestD = d;
        bestSeg = k;
        bestPt = { x: px, y: py };
      }
    }
    // Skip hops too near an endpoint (no room for the hump).
    if (bestSeg >= 3 && bestSeg <= N - 3 && bestPt && !onSeg.has(bestSeg))
      onSeg.set(bestSeg, bestPt);
  }
  if (onSeg.size === 0) return null;
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let k = 1; k <= N; k++) {
    const a = pts[k - 1]!;
    const b = pts[k]!;
    const hp = onSeg.get(k);
    if (hp) {
      const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const dir = { x: (b.x - a.x) / segLen, y: (b.y - a.y) / segLen };
      // Perpendicular pointing "up" (toward smaller y) for a consistent arch.
      let perp = { x: dir.y, y: -dir.x };
      if (perp.y > 0) perp = { x: -perp.x, y: -perp.y };
      const A = { x: hp.x - dir.x * HOP_R, y: hp.y - dir.y * HOP_R };
      const B = { x: hp.x + dir.x * HOP_R, y: hp.y + dir.y * HOP_R };
      const k1 = {
        x: A.x + perp.x * HOP_R * 1.33,
        y: A.y + perp.y * HOP_R * 1.33,
      };
      const k2 = {
        x: B.x + perp.x * HOP_R * 1.33,
        y: B.y + perp.y * HOP_R * 1.33,
      };
      d += ` L ${A.x} ${A.y} C ${k1.x} ${k1.y}, ${k2.x} ${k2.y}, ${B.x} ${B.y} L ${b.x} ${b.y}`;
    } else {
      d += ` L ${b.x} ${b.y}`;
    }
  }
  return d;
}

function pathCrossings(g: EdgeGeom, obstacles: readonly Rect[]): number {
  if (obstacles.length === 0) return 0;
  let hits = 0;
  // Skip the very ends (t≈0/1) — those sit on the endpoint shapes by design.
  for (let i = 1; i < EDGE_SAMPLES; i++) {
    const p = cubicAt(g, i / EDGE_SAMPLES);
    for (const r of obstacles) {
      const x0 = r.x + EDGE_OBSTACLE_INSET;
      const y0 = r.y + EDGE_OBSTACLE_INSET;
      const x1 = r.x + r.w - EDGE_OBSTACLE_INSET;
      const y1 = r.y + r.h - EDGE_OBSTACLE_INSET;
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

export interface SketchEdgeGeometry {
  sourceId: string;
  targetId: string;
  /** Pure cubic path — parsed as one cubic by label/bounds/hit-test consumers. */
  d: string;
  mid: { x: number; y: number };
  /** Visible stroke path WITH crossing-hops, when this edge hops another. The
   *  renderer draws this if present; everything else still uses `d`. */
  dRender?: string;
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

  // Obstacle set for around-routing: every node/box rect, tagged by id. An edge
  // excludes its two endpoints AND the box each endpoint lives in (a line
  // legitimately enters its own group), but NOT sibling children — those are
  // exactly the shapes an edge must not cut through to reach a stacked sibling.
  const boxIdByLabel = new Map<string, string>();
  for (const b of layout.boxes) boxIdByLabel.set(b.label, b.id);
  const boxOf = (id: string): string | undefined => {
    const n = layout.nodes.find((m) => m.id === id);
    return n?.boxLabel ? boxIdByLabel.get(n.boxLabel) : undefined;
  };
  const obstacles: Array<{ id: string; rect: Rect }> = [];
  for (const [id, rect] of rectById) obstacles.push({ id, rect });

  // Deviation cost of a side pair: 0 when both normals point straight at the
  // other endpoint, rising as they turn away — the tie-breaker that keeps a
  // reroute as close to the natural (facing) attachment as clearance allows.
  const normalOf = (s: Side): Pt =>
    s === 'L'
      ? { x: -1, y: 0 }
      : s === 'R'
        ? { x: 1, y: 0 }
        : s === 'T'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  const facingCost = (from: Rect, to: Rect, side: Side): number => {
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    const len = Math.hypot(dx, dy) || 1;
    const n = normalOf(side);
    return 1 - (n.x * dx + n.y * dy) / len; // 0 (facing) … 2 (opposed)
  };
  // Extra surcharge for a BACK-FACING port: its outward normal points into the
  // wrong hemisphere (away from the other endpoint), so the line must leave in
  // the wrong direction and loop back. The curve cost alone under-penalises this
  // — a wide loop off a back-facing port stays a smooth, low-inflection C — so
  // exiting a card's TOP toward a target BELOW it scored as well as exiting the
  // bottom. Only the back-facing half (facingCost > 1) is charged, steeply, so a
  // forward-facing route always wins even when its bend is larger.
  const W_BACK = 2.6;
  const backFacingCost = (from: Rect, to: Rect, side: Side): number =>
    W_BACK * Math.max(0, facingCost(from, to, side) - 1);

  // Per-edge routing context: endpoint rects, ports, and the node/box rects this
  // edge must not cut through (its endpoints and their own boxes excluded).
  interface Ctx {
    source: Rect;
    target: Rect;
    sPorts: Ports | undefined;
    tPorts: Ports | undefined;
    obstacleRects: Rect[];
    /** edge indices sharing an endpoint — their meeting point isn`t a crossing */
    adjacent: Set<number>;
  }
  const ctx: Array<Ctx | null> = layout.edges.map((edge) => {
    const source = rectById.get(edge.sourceId);
    const target = rectById.get(edge.targetId);
    if (!source || !target) return null;
    const exclude = new Set(
      [
        edge.sourceId,
        edge.targetId,
        boxOf(edge.sourceId),
        boxOf(edge.targetId),
      ].filter((x): x is string => x !== undefined)
    );
    return {
      source,
      target,
      sPorts: portsById.get(edge.sourceId),
      tPorts: portsById.get(edge.targetId),
      obstacleRects: obstacles
        .filter((o) => !exclude.has(o.id))
        .map((o) => o.rect),
      adjacent: new Set<number>(),
    };
  });
  for (let a = 0; a < layout.edges.length; a++) {
    for (let b = a + 1; b < layout.edges.length; b++) {
      const ea = layout.edges[a]!;
      const eb = layout.edges[b]!;
      if (
        ea.sourceId === eb.sourceId ||
        ea.sourceId === eb.targetId ||
        ea.targetId === eb.sourceId ||
        ea.targetId === eb.targetId
      ) {
        ctx[a]?.adjacent.add(b);
        ctx[b]?.adjacent.add(a);
      }
    }
  }

  // A node crossing (edge cuts through a shape) is far worse than an edge–edge
  // crossing, which in turn costs more than a slightly-off attachment angle.
  const W_NODE = 100;
  const W_EDGE = 8;
  // A bare node has ONE port per side (its midpoint), so a line LEAVING a node
  // and another line ARRIVING at it on the same side stack onto the same point —
  // the two read as one overlapping stub heading opposite ways. Penalize an
  // origination on a side already used for termination (and vice versa) so the
  // relaxation spreads them onto different sides. Group boxes snap to per-child
  // ports (distinct points even on one side), so this only applies to bare
  // nodes. Same-direction sharing (two leaves / a fan-in) is left alone — a
  // legitimate fan. RECIPROCAL edges (a second edge between the SAME two nodes,
  // e.g. A→B alongside B→A) are also exempt: they belong parallel on the facing
  // sides, and forcing one to the far side would wrap it around the node. The
  // weight sits BELOW the facing-cost swing (0…2) so a clash only bumps an edge
  // to an equally- or barely-worse-facing side — never onto an opposed side,
  // which would route the line the long way around under other shapes.
  const W_PORT = 1.5;
  // Same-role stacking (two edges BOTH arriving — or both leaving — at one bare
  // node on the same side) collapses onto that side's single midpoint port, so
  // two unrelated lines converge to one dot (the reported divvy+console → CNN
  // stack). Weighted BELOW the facing swing (0…2) so it only nudges the edge
  // whose next-best side is nearly as good — a tight fan-in of same-direction
  // sources (whose alternative sides face away, high facing cost) stays put,
  // while a wide fan (sources in different directions) spreads across sides.
  const W_PORT_SAME = 0.6;
  const isBox = (id: string): boolean => portsById.has(id);
  // Count OTHER edges that attach to a bare endpoint of edge `self` on the same
  // side in the OPPOSITE role (self leaves here → count arrivals, and vice
  // versa), excluding reciprocal edges that share BOTH endpoints with self.
  const portClashCount = (self: number, s: Side, t: Side): number => {
    const e = layout.edges[self]!;
    let n = 0;
    for (let j = 0; j < layout.edges.length; j++) {
      if (j === self) continue;
      const ej = layout.edges[j]!;
      const cj = chosen[j]!;
      // self ORIGINATES at e.sourceId on side s → an edge ARRIVING there clashes.
      if (
        !isBox(e.sourceId) &&
        ej.targetId === e.sourceId &&
        ej.sourceId !== e.targetId && // not reciprocal
        cj.t === s
      )
        n++;
      // self TERMINATES at e.targetId on side t → an edge LEAVING there clashes.
      if (
        !isBox(e.targetId) &&
        ej.sourceId === e.targetId &&
        ej.targetId !== e.sourceId && // not reciprocal
        cj.s === t
      )
        n++;
    }
    return n;
  };
  // Count OTHER edges that TERMINATE at the same bare endpoint of `self` on the
  // same side — the co-termination stack, where two arrowheads collapse onto
  // one side-midpoint port (the divvy+console → CNN stack). Only TERMINATIONS
  // count: two heads on one point read worse than a fan of tails leaving a hub
  // (which stays a clean radial spread — see the up-left-spoke test). `s` is
  // unused (originations are exempt) but kept for signature symmetry with
  // portClashCount. Reciprocal pairs are exempt.
  const portStackCount = (self: number, _s: Side, t: Side): number => {
    const e = layout.edges[self]!;
    if (isBox(e.targetId)) return 0;
    let n = 0;
    for (let j = 0; j < layout.edges.length; j++) {
      if (j === self) continue;
      const ej = layout.edges[j]!;
      if (
        ej.targetId === e.targetId &&
        ej.sourceId !== e.sourceId && // not reciprocal
        chosen[j]!.t === t
      )
        n++;
    }
    return n;
  };
  // Shape cost of the chosen route, measured from the SAMPLED curve (not the
  // port tangents — those miss an S built from two same-direction tangents with
  // offset endpoints, e.g. exit-right / enter-left across a diagonal drop, which
  // still bulges into an S). Walk the polyline: sum the absolute turning
  // (total bend) and count sign changes of the turn (each is an inflection — a
  // straight line has none, a single C-arc none, an S one). Weighted as a
  // tiebreaker below crossings but above facing, so a route that curves ONCE
  // beats one that S-curves even when the S's ports face a touch better — the
  // "prefer 1 curve over 2" rule.
  const W_TURN = 0.55; // per radian of total turning
  const W_SCURVE = 1.8; // per inflection (turn-sign flip)
  const CURVE_STRAIGHT = 0.35; // below this total cost, treat as effectively straight
  const curveCostPoly = (pts: Pt[]): number => {
    let totalTurn = 0;
    let inflections = 0;
    let prevSign = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const ax = pts[i]!.x - pts[i - 1]!.x;
      const ay = pts[i]!.y - pts[i - 1]!.y;
      const bx = pts[i + 1]!.x - pts[i]!.x;
      const by = pts[i + 1]!.y - pts[i]!.y;
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      if (ax === 0 && ay === 0) continue;
      if (bx === 0 && by === 0) continue;
      totalTurn += Math.abs(Math.atan2(cross, dot));
      const sign = cross > 1e-6 ? 1 : cross < -1e-6 ? -1 : 0;
      if (sign !== 0) {
        if (prevSign !== 0 && sign !== prevSign) inflections++;
        prevSign = sign;
      }
    }
    return totalTurn * W_TURN + inflections * W_SCURVE;
  };
  const scoreOf = (
    c: Ctx,
    g: EdgeGeom,
    poly: Pt[],
    self: number,
    polys: Array<Pt[] | null>,
    s: Side,
    t: Side
  ): number => {
    let edgeCross = 0;
    for (let j = 0; j < polys.length; j++) {
      if (j === self || c.adjacent.has(j)) continue;
      const pj = polys[j];
      if (pj) edgeCross += polyCrossings(poly, pj);
    }
    return (
      pathCrossings(g, c.obstacleRects) * W_NODE +
      edgeCross * W_EDGE +
      portClashCount(self, s, t) * W_PORT +
      portStackCount(self, s, t) * W_PORT_SAME +
      curveCostPoly(poly) +
      facingCost(c.source, c.target, s) +
      facingCost(c.target, c.source, t) +
      backFacingCost(c.source, c.target, s) +
      backFacingCost(c.target, c.source, t)
    );
  };

  // Initial geometry from the congestion-aware side assignment.
  const chosen: Array<{ s: Side; t: Side }> = layout.edges.map(
    (_, i) => sides[i] ?? { s: 'R' as Side, t: 'L' as Side }
  );
  const geoms: Array<EdgeGeom | null> = ctx.map((c, i) =>
    c
      ? edgePath(
          c.source,
          c.target,
          chosen[i]!.s,
          chosen[i]!.t,
          c.sPorts,
          c.tPorts
        )
      : null
  );
  const polys: Array<Pt[] | null> = geoms.map((g) => (g ? polyline(g) : null));

  // Relax: repeatedly let each edge re-pick the side pair that minimises its
  // combined node + edge crossings against everyone else`s CURRENT routing. An
  // edge already clear of both keeps its assignment. A couple of passes settles
  // the mutual dependence (edge A`s best side depends on where B ended up).
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < ctx.length; i++) {
      const c = ctx[i];
      const g = geoms[i];
      const p = polys[i];
      if (!c || !g || !p) continue;
      const cur = chosen[i]!;
      const curScore = scoreOf(c, g, p, i, polys, cur.s, cur.t);
      // Nothing to fix — no node cut, no edge crossing, no port clash, no
      // stack, no notable curve. Each of these small (< W_EDGE) costs is tested
      // explicitly, else the crossing-only threshold would skip an edge that
      // only needs to move off a shared port or out of an S-curve.
      if (
        curScore < W_EDGE &&
        portClashCount(i, cur.s, cur.t) === 0 &&
        portStackCount(i, cur.s, cur.t) === 0 &&
        curveCostPoly(p) < CURVE_STRAIGHT &&
        backFacingCost(c.source, c.target, cur.s) === 0 &&
        backFacingCost(c.target, c.source, cur.t) === 0
      )
        continue;
      let bestScore = curScore;
      let bestG = g;
      let bestP = p;
      let bestSide = cur;
      for (const s of SIDES) {
        for (const t of SIDES) {
          const cg = edgePath(c.source, c.target, s, t, c.sPorts, c.tPorts);
          const cp = polyline(cg);
          const sc = scoreOf(c, cg, cp, i, polys, s, t);
          if (sc < bestScore) {
            bestScore = sc;
            bestG = cg;
            bestP = cp;
            bestSide = { s, t };
          }
        }
      }
      if (bestSide !== cur) {
        chosen[i] = bestSide;
        geoms[i] = bestG;
        polys[i] = bestP;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Crossing-hops: where two (non-adjacent) edges still cross, the HIGHER-index
  // edge hops over the lower one so the two read as distinct. `polys` holds the
  // final routing after relaxation.
  const hopsFor: Array<Pt[]> = layout.edges.map(() => []);
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (ctx[i]?.adjacent.has(j)) continue;
      const a = polys[i];
      const b = polys[j];
      if (!a || !b) continue;
      const pt = polyIntersection(a, b);
      if (pt) hopsFor[j]!.push(pt); // j (drawn later, on top) does the hop
    }
  }

  return layout.edges.map((edge, i) => {
    const g = geoms[i];
    if (!g) return null;
    const dRender = hoppedPath(g, hopsFor[i]!);
    return {
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      d: g.d,
      mid: g.mid,
      ...(dRender && { dRender }),
    };
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
