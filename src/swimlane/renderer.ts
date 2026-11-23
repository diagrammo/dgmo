// ============================================================
// Swimlane Diagram — D3 SVG Renderer
// ============================================================
//
// Draws lane band backgrounds + headers, phase dividers + headers, nodes
// (shape per SwimShape), edges (in-arrow labels, dashed back-edges), terminals
// (typed color + glyph), gateways (diamond; `+` for parallel), subprocess
// (double border). Fill cascade: active tag value → event/symbol type → lane
// shade. resvg has no `color-mix()` — all blends go through `mix()`.
//
// BPMN (#1874): pools (a name band; a lane-less pool is a thin bar), message
// flow (dashed, open circle at the source, hollow head), event circles by
// position (start thin, mid-flow double ring, end thick) with trigger glyphs,
// gateway glyphs with the label outside the diamond, task markers, boundary
// events, and store / data / note attachments on a dotted line.

import { diamondPoints } from '../shapes/geometry';
import { ARTIFACT_FONT, MARGIN as LAYOUT_MARGIN } from './layout';
import * as d3Selection from 'd3-selection';
import { fillModeFromOptions } from '../utils/parsing';
import { FONT_FAMILY } from '../fonts';
import { fitWrapped, measureText } from '../utils/text-measure';
import { appendArrowheadMarkers } from '../utils/arrow-markers';
import {
  ARROWHEAD_HEIGHT,
  ARROWHEAD_WIDTH,
  EDGE_DASH,
  HAIRLINE_DASH,
} from '../utils/visual-conventions';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  FRAME_BODY_TOP,
} from '../utils/title-constants';
import { mix, contrastText, themeBaseBg } from '../palettes/color-utils';
import { resolveColor, CATEGORICAL_COLOR_ORDER } from '../colors';
import {
  resolveTagColor,
  tagAttrKey,
  UNTAGGED_TAG_COLOR,
} from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import { growChartFrame } from '../utils/chart-frame';
import type {
  ParsedSwimlane,
  SwimlaneLayoutResult,
  SwimLayoutArtifact,
  SwimLayoutNode,
} from './types';

const NODE_FONT_SIZE = 12;
const LANE_LABEL_FONT = 12;
const PHASE_LABEL_FONT = 12;
const EDGE_LABEL_FONT = 11;
/** An edge label wraps to at most this many lines before it ends in `…` (#2264). */
const EDGE_LABEL_MAX_LINES = 3;
/** The narrowest an edge label wraps to, however short its segment. */
const EDGE_LABEL_MIN_WIDTH = 60;
const EDGE_LABEL_LINE_HEIGHT = 1.2;
const NODE_RX = 8;
const NODE_STROKE = 1.5;
const EDGE_STROKE = 1.6;
const EDGE_CORNER_R = 11; // fillet radius for orthogonal edge corners
const LANE_RADIUS = 10;
const LANE_INSET = 2; // visual gutter between adjacent lane cards
const POOL_LABEL_FONT = 12;
const EVENT_START_STROKE = 1.5;
const EVENT_END_STROKE = 3.2;
const MESSAGE_DASH = '6 4';
const GLYPH_STROKE = 1.3;

/** Rect path with independent corner radii (clamped to half-extent). */
/** Orthogonal polyline with rounded (filleted) corners for softer routes. */
function roundedPolyline(
  pts: readonly { readonly x: number; readonly y: number }[],
  radius: number
): string {
  if (pts.length < 3) {
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  }
  let d = `M${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (l1 < 0.01 || l2 < 0.01) {
      d += ` L${p1.x} ${p1.y}`;
      continue;
    }
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const ax = p1.x - ((p1.x - p0.x) / l1) * r;
    const ay = p1.y - ((p1.y - p0.y) / l1) * r;
    const bx = p1.x + ((p2.x - p1.x) / l2) * r;
    const by = p1.y + ((p2.y - p1.y) / l2) * r;
    d += ` L${ax} ${ay} Q${p1.x} ${p1.y} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1]!;
  d += ` L${last.x} ${last.y}`;
  return d;
}

/** Shortest distance from a point to a line segment. */
function distToSeg(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: { tl?: number; tr?: number; br?: number; bl?: number } = {}
): string {
  const m = Math.min(w, h) / 2;
  const tl = Math.min(r.tl ?? 0, m);
  const tr = Math.min(r.tr ?? 0, m);
  const br = Math.min(r.br ?? 0, m);
  const bl = Math.min(r.bl ?? 0, m);
  return [
    `M${x + tl},${y}`,
    `H${x + w - tr}`,
    tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : '',
    `V${y + h - br}`,
    br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : '',
    `H${x + bl}`,
    bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : '',
    `V${y + tl}`,
    tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : '',
    'Z',
  ].join(' ');
}

type D3G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

export interface SwimlaneRenderOptions {
  exportDims?: { width: number; height: number };
  activeTagGroup?: string | null;
  exportMode?: boolean;
}

interface EventColors {
  error: string;
  success: string;
  terminate: string;
  neutral: string;
}

/**
 * The band a title adds above the layout (#1838): the layout's first ink sits
 * its MARGIN plus a 1.5 stroke under its origin.
 */
export const SWIMLANE_TITLE_BAND = FRAME_BODY_TOP - LAYOUT_MARGIN - 1.5;
/**
 * With phases the first ink is the phase header, drawn at the layout's origin
 * with a half-unit stroke above it, so the band is the whole body top plus
 * that stroke (#1838). Top-down, the lanes run down the flow axis from the
 * origin, so their headers sit there too, with or without phases (#2117).
 */
export const swimlaneTitleBand = (
  parsed: Pick<ParsedSwimlane, 'phases' | 'direction'>
): number =>
  parsed.phases.length > 0 || parsed.direction === 'TB'
    ? FRAME_BODY_TOP + 0.5
    : SWIMLANE_TITLE_BAND;

export function renderSwimlaneForExport(
  container: HTMLElement,
  parsed: ParsedSwimlane,
  layout: SwimlaneLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  opts: SwimlaneRenderOptions = {}
): void {
  // Clear any prior render so re-renders in a live container (app preview)
  // don't stack SVGs. Export uses a throwaway container, so this is a no-op there.
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const titleOffset = parsed.title ? swimlaneTitleBand(parsed) : 0;
  const width = opts.exportDims?.width ?? layout.width;
  const height = (opts.exportDims?.height ?? layout.height) + 0;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY);

  const defs = svg.append('defs');
  const baseBg = themeBaseBg(palette, isDark);
  const ev: EventColors = {
    error: palette.colors.red,
    success: palette.colors.green,
    terminate: palette.text,
    neutral: palette.border,
  };
  appendArrowheadMarkers(defs, {
    idPrefix: 'sw',
    width: ARROWHEAD_WIDTH,
    height: ARROWHEAD_HEIGHT,
    baseFill: palette.textMuted,
    colors: [ev.error, ev.success],
  });
  // Message flow: a hollow head at the target, an open circle at the source.
  const msgStroke = palette.textMuted;
  defs
    .append('marker')
    .attr('id', 'sw-msg-head')
    .attr('viewBox', `0 0 ${ARROWHEAD_WIDTH + 2} ${ARROWHEAD_HEIGHT + 2}`)
    .attr('refX', ARROWHEAD_WIDTH + 1)
    .attr('refY', ARROWHEAD_HEIGHT / 2 + 1)
    .attr('markerWidth', ARROWHEAD_WIDTH + 2)
    .attr('markerHeight', ARROWHEAD_HEIGHT + 2)
    .attr('markerUnits', 'userSpaceOnUse')
    .attr('orient', 'auto')
    .append('polygon')
    .attr(
      'points',
      `1,1 ${ARROWHEAD_WIDTH + 1},${ARROWHEAD_HEIGHT / 2 + 1} 1,${ARROWHEAD_HEIGHT + 1}`
    )
    .attr('fill', baseBg)
    .attr('stroke', msgStroke)
    .attr('stroke-width', 1.2);
  defs
    .append('marker')
    .attr('id', 'sw-msg-tail')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 5)
    .attr('refY', 5)
    .attr('markerWidth', 10)
    .attr('markerHeight', 10)
    .attr('markerUnits', 'userSpaceOnUse')
    .append('circle')
    .attr('cx', 5)
    .attr('cy', 5)
    .attr('r', 3.6)
    .attr('fill', baseBg)
    .attr('stroke', msgStroke)
    .attr('stroke-width', 1.2);

  const root = svg
    .append('g')
    .attr('transform', `translate(0, ${titleOffset})`);

  // ── Title ───────────────────────────────────────────────────
  if (parsed.title) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      // Editor↔diagram sync anchor (cursor on the title line highlights it).
      .attr('data-line-number', String(parsed.titleLineNumber ?? 1))
      .text(parsed.title);
  }

  // ── Lane colors (explicit or auto-categorical) ──────────────
  const laneColorById = new Map<string, string>();
  parsed.lanes.forEach((lane, i) => {
    const hex =
      lane.color ??
      resolveColor(
        CATEGORICAL_COLOR_ORDER[i % CATEGORICAL_COLOR_ORDER.length]!,
        palette
      ) ??
      palette.border;
    laneColorById.set(lane.id, hex);
  });

  const isLR = parsed.direction === 'LR';
  const fillMode = fillModeFromOptions(parsed.options);

  // Halo colour for label legibility: match the lane background the text sits
  // over (not a flat light fill) so the halo blends in and just fades out the
  // edges/outlines crossing behind the text. Falls back to the base bg.
  const laneFill = (hex: string): string => mix(hex, baseBg, 9);
  const haloAt = (cross: number): string => {
    for (const band of layout.lanes) {
      const lo = isLR ? band.y : band.x;
      const hi = lo + (isLR ? band.height : band.width);
      if (cross >= lo && cross <= hi)
        return laneFill(laneColorById.get(band.id) ?? palette.border);
    }
    return baseBg;
  };

  // ── Pools (BPMN): an outline with a name band; lane-less = thin bar ──
  if (layout.pools.length > 0) {
    const poolG = root.append('g').attr('class', 'dgmo-swimlane-pools');
    const poolStroke = mix(palette.textMuted, baseBg, 55);
    for (const pool of layout.pools) {
      const by = isLR ? pool.y + LANE_INSET : pool.y;
      const bh = isLR ? pool.height - LANE_INSET * 2 : pool.height;
      const bx = isLR ? pool.x : pool.x + LANE_INSET;
      const bw = isLR ? pool.width : pool.width - LANE_INSET * 2;
      const pg = poolG
        .append('g')
        .attr('class', 'sw-pool')
        .attr('data-pool', pool.id)
        .attr('data-line-number', String(pool.lineNumber));
      pg.append('rect')
        .attr('x', bx)
        .attr('y', by)
        .attr('width', bw)
        .attr('height', bh)
        .attr('rx', LANE_RADIUS)
        .attr(
          'fill',
          pool.collapsed ? mix(palette.textMuted, baseBg, 10) : baseBg
        )
        .attr('stroke', poolStroke)
        .attr('stroke-width', 1.2);
      if (pool.collapsed) {
        pg.append('text')
          .attr('x', bx + bw / 2)
          .attr('y', by + bh / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', POOL_LABEL_FONT)
          .attr('font-weight', 'bold')
          .attr('fill', palette.text)
          .text(pool.label);
        continue;
      }
      // Name band (left in LR, top in TB), the pool name rotated in LR.
      const hw = isLR ? pool.headerSize : bw;
      const hh = isLR ? bh : pool.headerSize;
      pg.append('path')
        .attr(
          'd',
          roundedRectPath(
            bx,
            by,
            hw,
            hh,
            isLR
              ? { tl: LANE_RADIUS, bl: LANE_RADIUS }
              : { tl: LANE_RADIUS, tr: LANE_RADIUS }
          )
        )
        .attr('fill', mix(palette.textMuted, baseBg, 14))
        .attr('stroke', poolStroke)
        .attr('stroke-width', 1.2);
      const tx = isLR ? bx + hw / 2 : bx + bw / 2;
      const ty = isLR ? by + bh / 2 : by + hh / 2;
      pg.append('text')
        .attr('x', tx)
        .attr('y', ty)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', POOL_LABEL_FONT)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .attr('transform', isLR ? `rotate(-90 ${tx} ${ty})` : null)
        .text(pool.label);
    }
  }

  // ── Lane band backgrounds + headers (rounded cards) ─────────
  const laneG = root.append('g').attr('class', 'dgmo-swimlane-lanes');
  for (const band of layout.lanes) {
    const hex = laneColorById.get(band.id) ?? palette.border;
    // Inset on the cross axis (vertical in LR, horizontal in TB) so adjacent
    // rounded lane cards read as separate rows/columns instead of one block.
    // Inside a pool, lanes stack flush into one card: the inset stays only on
    // the pool's outer edges, and only the pool's own far corners are round —
    // a rounded corner against the square pool band, or against a neighbour
    // lane, leaves a notch.
    const ip = band.inPool;
    const i0 = ip && !ip.first ? 0 : LANE_INSET;
    const i1 = ip && !ip.last ? 0 : LANE_INSET;
    const bx = isLR ? band.x : band.x + i0;
    const by = isLR ? band.y + i0 : band.y;
    const bw = isLR ? band.width : band.width - i0 - i1;
    const bh = isLR ? band.height - i0 - i1 : band.height;
    const R0 = ip && !ip.first ? 0 : LANE_RADIUS; // pool's first outer corner
    const R1 = ip && !ip.last ? 0 : LANE_RADIUS; // pool's last outer corner
    const near = ip ? 0 : LANE_RADIUS; // corners on the header side
    const corners = isLR
      ? { tl: near, bl: near, tr: R0, br: R1 }
      : { tl: near, tr: near, bl: R0, br: R1 };
    laneG
      .append('path')
      .attr('d', roundedRectPath(bx, by, bw, bh, corners))
      .attr('fill', mix(hex, baseBg, 9))
      .attr('stroke', mix(palette.border, baseBg, 60))
      .attr('stroke-width', 1)
      .attr('data-line-number', String(band.lineNumber));
    // Header gutter (left in LR / top in TB) — slightly stronger tint, with
    // only its leading-edge corners rounded to hug the card.
    const gw = isLR ? band.headerSize : bw;
    const gh = isLR ? bh : band.headerSize;
    laneG
      .append('path')
      .attr(
        'd',
        roundedRectPath(
          bx,
          by,
          gw,
          gh,
          isLR ? { tl: near, bl: near } : { tl: near, tr: near }
        )
      )
      .attr('fill', mix(hex, baseBg, 16))
      .attr('opacity', 0.6);
    laneG
      .append('text')
      .attr('x', isLR ? bx + 12 : bx + bw / 2)
      .attr('y', isLR ? by + bh / 2 : by + band.headerSize / 2)
      .attr('text-anchor', isLR ? 'start' : 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', LANE_LABEL_FONT)
      .attr('font-weight', 'bold')
      .attr('fill', mix(hex, palette.text, 55))
      .text(band.label);
  }

  // ── Phase bands (zebra striping + centered headers) ─────────
  // Phases are shown as faint alternating column washes instead of divider
  // lines: under cross-phase compaction a column can host two phases, so a hard
  // divider would land mid-column. Each band already has a clean, gap-free,
  // non-overlapping column range, so a subtle wash on every other band reads as
  // distinct vertical sections without any line stepping on the headers.
  const phaseG = root.append('g').attr('class', 'dgmo-swimlane-phases');
  layout.phases.forEach((band, idx) => {
    if (idx % 2 === 1) {
      phaseG
        .append('rect')
        .attr('x', band.x)
        .attr('y', band.y)
        .attr('width', band.width)
        .attr('height', band.height)
        .attr('rx', LANE_RADIUS)
        .attr('fill', palette.text)
        .attr('opacity', 0.05)
        .attr('pointer-events', 'none');
    }
    phaseG
      .append('text')
      .attr('x', isLR ? band.x + band.width / 2 : band.headerSize / 2)
      .attr('y', isLR ? band.headerSize / 2 : band.y + band.height / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', PHASE_LABEL_FONT)
      .attr('font-weight', 'bold')
      .attr('letter-spacing', '0.06em')
      .attr('fill', palette.textMuted)
      .attr('data-line-number', String(band.lineNumber))
      .text(band.label);
  });

  // ── Node fill cascade ───────────────────────────────────────
  const activeTag = opts.activeTagGroup ?? null;
  // §1.9 fill family: 'outline' drops the tint — shapes take the theme base
  // bg and the intent color rides entirely on the stroke.
  const outline = fillMode === 'outline';
  const nodeFill = (n: SwimLayoutNode): { fill: string; stroke: string } => {
    // 1. active tag value.
    if (activeTag) {
      const key = tagAttrKey(activeTag);
      if (n.tags[key]) {
        const c = resolveTagColor(n.tags, [...parsed.tagGroups], activeTag);
        if (c && c !== UNTAGGED_TAG_COLOR)
          return {
            fill:
              fillMode === 'solid' ? c : outline ? baseBg : mix(c, baseBg, 22),
            stroke: c,
          };
      }
    }
    // 2. event / symbol type.
    if (n.shape === 'terminal') {
      if (n.event === 'error')
        return {
          fill:
            fillMode === 'solid'
              ? ev.error
              : outline
                ? baseBg
                : mix(ev.error, baseBg, 22),
          stroke: ev.error,
        };
      if (n.event === 'success')
        return {
          fill:
            fillMode === 'solid'
              ? ev.success
              : outline
                ? baseBg
                : mix(ev.success, baseBg, 22),
          stroke: ev.success,
        };
      if (n.event === 'terminate')
        return {
          fill: outline ? baseBg : mix(palette.text, baseBg, 30),
          stroke: palette.text,
        };
      return { fill: palette.bg, stroke: palette.textMuted };
    }
    if (isGatewayShape(n.shape)) {
      // Gateways stay neutral.
      return {
        fill: mix(palette.surface, baseBg, 80),
        stroke: palette.textMuted,
      };
    }
    // 3. lane shade.
    const hex = laneColorById.get(n.lane) ?? palette.border;
    return {
      fill:
        fillMode === 'solid' ? hex : outline ? baseBg : mix(hex, baseBg, 20),
      stroke: outline ? hex : mix(hex, palette.text, 40),
    };
  };

  // ── Edges ───────────────────────────────────────────────────
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const edgeG = root.append('g').attr('class', 'dgmo-swimlane-edges');
  /** True when some line (edge or message) ends on the node's top point. */
  const touchesAt = (n: SwimLayoutNode, side: 'top' | 'bottom'): boolean => {
    const y = side === 'top' ? n.y - n.height / 2 : n.y + n.height / 2;
    const lines = [...layout.edges, ...layout.messages];
    for (const le of lines) {
      const pts =
        le.target === n.id
          ? [le.points[le.points.length - 1]]
          : le.source === n.id
            ? [le.points[0]]
            : [];
      for (const pt of pts)
        if (pt && Math.abs(pt.x - n.x) < 1 && Math.abs(pt.y - y) < 1)
          return true;
    }
    return false;
  };
  /** Where each gateway caption sits, so edge labels keep off it (#2264). */
  const gatewayCaptions = layout.nodes
    .filter((n) => isGatewayShape(n.shape) && n.label)
    .map((n) => {
      const r = n.width / 2;
      const below = touchesAt(n, 'top') && !touchesAt(n, 'bottom');
      const fs = NODE_FONT_SIZE - 1;
      const baseline = below ? n.y + r + 13 : n.y - r - 7;
      return {
        x: n.x,
        y: baseline - fs / 2,
        w: measureText(n.label, fs),
        h: fs,
      };
    });
  for (const e of layout.edges) {
    const tgt = nodeById.get(e.target);
    let stroke = palette.textMuted;
    let marker = 'sw-arrow';
    if (tgt?.shape === 'terminal' && tgt.event === 'error') {
      stroke = ev.error;
      marker = `sw-arrow-${ev.error.replace('#', '')}`;
    } else if (tgt?.shape === 'terminal' && tgt.event === 'success') {
      stroke = ev.success;
      marker = `sw-arrow-${ev.success.replace('#', '')}`;
    }
    const d = roundedPolyline(e.points, EDGE_CORNER_R);
    edgeG
      .append('path')
      // `sw-edge sw-edge-group` are the editor↔diagram sync anchors (the app
      // binary-sync adapter highlights/dims `.sw-edge-group[data-line-number]`).
      .attr('class', 'sw-edge sw-edge-group')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', EDGE_STROKE)
      .attr('stroke-dasharray', e.back ? EDGE_DASH : null)
      .attr('marker-end', `url(#${marker})`)
      .attr('data-line-number', String(e.lineNumber));
    if (e.label) {
      // Place the label at the path's ARC-LENGTH midpoint. Two branches out of
      // one gateway share their first segment (the exit port), so a
      // longest-segment or first-segment anchor stacks both labels there; the
      // arc midpoint sits past the divergence, separating sibling labels.
      const segLen: number[] = [];
      let total = 0;
      for (let k = 0; k < e.points.length - 1; k++) {
        const p0 = e.points[k]!;
        const p1 = e.points[k + 1]!;
        const len = Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y);
        segLen.push(len);
        total += len;
      }
      let remain = total / 2;
      let best = 0;
      for (let k = 0; k < segLen.length; k++) {
        if (remain <= segLen[k]! || k === segLen.length - 1) {
          best = k;
          break;
        }
        remain -= segLen[k]!;
      }
      const a = e.points[best]!;
      const b = e.points[best + 1] ?? a;
      const t = segLen[best]! > 0 ? remain / segLen[best]! : 0.5;
      const mid = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // Offset the label PERPENDICULAR to its segment, choosing the side with
      // more clearance from OTHER edges. A gateway's two branches share their
      // exit, so one branch's riser often runs right beside the other branch's
      // straight-line label — picking the clearer side moves the label off it.
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const LABEL_GAP = 7;
      const pointClearance = (px: number, py: number): number => {
        let m = Infinity;
        for (const oe of layout.edges) {
          if (oe === e) continue;
          for (let k = 0; k < oe.points.length - 1; k++) {
            const d = distToSeg(
              px,
              py,
              oe.points[k]!.x,
              oe.points[k]!.y,
              oe.points[k + 1]!.x,
              oe.points[k + 1]!.y
            );
            if (d < m) m = d;
          }
        }
        // Text over a node is as struck as text over a line.
        for (const n of layout.nodes) {
          const dx = Math.max(0, Math.abs(px - n.x) - n.width / 2);
          const dy = Math.max(0, Math.abs(py - n.y) - n.height / 2);
          const d = Math.hypot(dx, dy);
          if (d < m) m = d;
        }
        // So is text over a gateway's caption, drawn outside the diamond.
        for (const box of gatewayCaptions) {
          const dx = Math.max(0, Math.abs(px - box.x) - box.w / 2);
          const dy = Math.max(0, Math.abs(py - box.y) - box.h / 2);
          const d = Math.hypot(dx, dy);
          if (d < m) m = d;
        }
        return m;
      };
      // Sample the whole text run, not just the anchor: a label extends ~half
      // its width past a centered anchor (or its full width past a start/end
      // anchor), and an edge crossing that tail strikes the text even when the
      // anchor itself looks clear.
      // A label on a horizontal segment may be no wider than that segment
      // (less LABEL_GAP each side), or it runs over the next box (#2264).
      // Wider wraps to EDGE_LABEL_MAX_LINES; longer still ends in an ellipsis
      // and the full label goes in its <title>. Short labels are unchanged.
      let lines = [e.label];
      if (horizontal) {
        const maxW = Math.max(
          EDGE_LABEL_MIN_WIDTH,
          segLen[best]! - 2 * LABEL_GAP
        );
        if (measureText(e.label, EDGE_LABEL_FONT) > maxW)
          lines = fitWrapped(
            e.label,
            maxW,
            EDGE_LABEL_FONT,
            EDGE_LABEL_FONT,
            EDGE_LABEL_MAX_LINES,
            {}
          ).lines;
      }
      const truncated = lines.join(' ') !== e.label;
      const estW =
        lines.length > 1
          ? Math.max(...lines.map((l) => measureText(l, EDGE_LABEL_FONT)))
          : e.label.length * EDGE_LABEL_FONT * 0.6;
      const clearance = (px: number, py: number, spanDir: number): number => {
        const xs =
          spanDir === 0
            ? [px - estW / 2, px, px + estW / 2]
            : [px, px + (spanDir * estW) / 2, px + spanDir * estW];
        return Math.min(...xs.map((x) => pointClearance(x, py)));
      };
      const CROWD = 10; // px: only flip off the default side when it's crowded
      let tx: number;
      let ty: number;
      let anchor: string;
      let baseline: string;
      if (horizontal) {
        // Centered anchor: text spans ±estW/2 (spanDir 0).
        // A wrapped label is checked on every line it draws.
        const rows = (dir: number): number =>
          Math.min(
            ...lines.map((_, i) =>
              clearance(
                mid.x,
                mid.y +
                  dir *
                    (LABEL_GAP + i * EDGE_LABEL_FONT * EDGE_LABEL_LINE_HEIGHT),
                0
              )
            )
          );
        const up = rows(-1);
        const down = rows(1);
        const below = up < CROWD && down > up;
        tx = mid.x;
        ty = mid.y + (below ? LABEL_GAP : -LABEL_GAP);
        anchor = 'middle';
        baseline = below ? 'hanging' : 'auto';
      } else {
        // Start/end anchor: text spans one full width away from the riser.
        const right = clearance(mid.x + LABEL_GAP, mid.y, 1);
        const left = clearance(mid.x - LABEL_GAP, mid.y, -1);
        const toLeft = right < CROWD && left > right;
        tx = mid.x + (toLeft ? -LABEL_GAP : LABEL_GAP);
        ty = mid.y;
        anchor = toLeft ? 'end' : 'start';
        baseline = 'middle';
      }
      const text = edgeG
        .append('text')
        .attr('x', tx)
        .attr('y', ty)
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', baseline)
        .attr('font-size', EDGE_LABEL_FONT)
        .attr('fill', stroke === palette.textMuted ? palette.textMuted : stroke)
        .attr('stroke', haloAt(ty))
        .attr('stroke-width', 3.5)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke');
      if (lines.length === 1) text.text(lines[0]!);
      else {
        // Above the edge the block ends at ty; below it starts there.
        const lh = EDGE_LABEL_FONT * EDGE_LABEL_LINE_HEIGHT;
        const first = baseline === 'hanging' ? 0 : -(lines.length - 1) * lh;
        lines.forEach((l, i) =>
          text
            .append('tspan')
            .attr('x', tx)
            .attr('dy', i === 0 ? first : lh)
            .text(l)
        );
      }
      if (truncated) text.append('title').text(e.label);
    }
  }

  // ── Message flows (dashed, open circle → hollow head) ───────
  if (layout.messages.length > 0) {
    const msgG = root.append('g').attr('class', 'dgmo-swimlane-messages');
    for (const m of layout.messages) {
      msgG
        .append('path')
        .attr('class', 'sw-message sw-edge-group')
        .attr('d', roundedPolyline(m.points, EDGE_CORNER_R))
        .attr('fill', 'none')
        .attr('stroke', msgStroke)
        .attr('stroke-width', EDGE_STROKE)
        .attr('stroke-dasharray', MESSAGE_DASH)
        .attr('marker-start', 'url(#sw-msg-tail)')
        .attr('marker-end', 'url(#sw-msg-head)')
        .attr('data-line-number', String(m.lineNumber));
    }
  }

  // ── Attachments (data store / data object / annotation) ─────
  if (layout.artifacts.length > 0) {
    const artG = root.append('g').attr('class', 'dgmo-swimlane-artifacts');
    for (const a of layout.artifacts)
      drawArtifact(artG, a, palette, baseBg, haloAt(isLR ? a.y : a.x));
  }

  // ── Nodes ───────────────────────────────────────────────────
  const nodesG = root.append('g').attr('class', 'dgmo-swimlane-nodes');
  // Boundary events draw after every task so they sit on top of its border.
  const drawOrder = [
    ...layout.nodes.filter((n) => n.boundaryOf === undefined),
    ...layout.nodes.filter((n) => n.boundaryOf !== undefined),
  ];
  for (const n of drawOrder) {
    const { fill, stroke } = nodeFill(n);
    const g = nodesG
      .append('g')
      // `sw-node` + `data-node-id` are the editor↔diagram sync anchors (the app
      // binary-sync adapter queries `.sw-node[data-node-id=…]`).
      .attr('class', 'sw-node')
      .attr('data-node-id', n.id)
      .attr('data-line-number', String(n.lineNumber))
      // Lane key for baked-CSS cross-highlight (hover a node → dim other lanes).
      .attr('data-lane', n.lane);
    const cx = n.x;
    const cy = n.y;
    if (isGatewayShape(n.shape)) {
      const r = n.width / 2;
      g.append('polygon')
        .attr('points', diamondPoints(cx, cy, r, r))
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', NODE_STROKE);
      drawGatewayGlyph(g, n.shape, cx, cy, r, palette.textMuted);
      // The label sits OUTSIDE the diamond — above it, or below when a line
      // arrives at the top point.
      if (n.label) {
        const below = touchesAt(n, 'top') && !touchesAt(n, 'bottom');
        const ly = below ? cy + r + 13 : cy - r - 7;
        g.append('text')
          .attr('class', 'sw-gateway-label')
          .attr('x', cx)
          .attr('y', ly)
          .attr('text-anchor', 'middle')
          .attr('font-size', NODE_FONT_SIZE - 1)
          .attr('fill', palette.text)
          .attr('stroke', haloAt(isLR ? ly : cx))
          .attr('stroke-width', 3.5)
          .attr('stroke-linejoin', 'round')
          .attr('paint-order', 'stroke')
          .text(n.label);
      }
    } else if (n.shape === 'terminal') {
      const r = n.width / 2;
      const pos = n.eventPosition ?? 'start';
      const boundary = n.boundaryOf !== undefined;
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', r)
        // A boundary event covers the task border it sits on.
        .attr('fill', boundary ? palette.bg : fill)
        .attr('stroke', stroke)
        .attr(
          'stroke-width',
          pos === 'end' ? EVENT_END_STROKE : EVENT_START_STROKE
        );
      // Mid-flow (and every boundary event) = double ring.
      if (pos === 'mid') {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', r - 3.5)
          .attr('fill', 'none')
          .attr('stroke', stroke)
          .attr('stroke-width', 1);
      }
      drawEventGlyph(g, n.event, pos === 'end', cx, cy, r, stroke, fill);
      if (n.label) {
        let lx = cx;
        let ly: number;
        let anchor = 'middle';
        if (boundary) {
          // Under the task, left of the circle — the exception path leaves
          // straight down from the circle, so the label keeps off it.
          lx = cx - r - 3;
          ly = cy + r - 1;
          anchor = 'end';
        } else {
          // Below the circle by default; above when a line connects on the
          // circle's lower half (it would sit on that line).
          ly = cy + r + 12;
          for (const le of [...layout.edges, ...layout.messages]) {
            const pt =
              le.target === n.id
                ? le.points[le.points.length - 1]
                : le.source === n.id
                  ? le.points[0]
                  : undefined;
            if (pt && pt.y > cy + r * 0.5) ly = cy - r - 6;
          }
        }
        g.append('text')
          .attr('x', lx)
          .attr('y', ly)
          .attr('text-anchor', anchor)
          .attr('font-size', NODE_FONT_SIZE - 1)
          .attr('fill', palette.text)
          .attr('stroke', haloAt(isLR ? ly : lx))
          .attr('stroke-width', 3.5)
          .attr('stroke-linejoin', 'round')
          .attr('paint-order', 'stroke')
          .text(n.label);
      }
    } else {
      // task / subprocess rectangle.
      g.append('rect')
        .attr('x', cx - n.width / 2)
        .attr('y', cy - n.height / 2)
        .attr('width', n.width)
        .attr('height', n.height)
        .attr('rx', NODE_RX)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', NODE_STROKE);
      if (n.shape === 'subprocess') {
        g.append('rect')
          .attr('x', cx - n.width / 2 + 3)
          .attr('y', cy - n.height / 2 + 3)
          .attr('width', n.width - 6)
          .attr('height', n.height - 6)
          .attr('rx', NODE_RX - 2)
          .attr('fill', 'none')
          .attr('stroke', stroke)
          .attr('stroke-width', 1);
      }
      const textColor = contrastText(
        fill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      if (n.taskType)
        drawTaskMarker(
          g,
          n.taskType,
          cx - n.width / 2 + 7,
          cy - n.height / 2 + 6,
          textColor,
          fill
        );
      drawCenteredLabel(g, n.label, cx, cy, textColor, NODE_FONT_SIZE);
    }
  }

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, { size: 'grow' });
}

/** Draw a one/two-line centered label inside a node. */
/** Greedy word-wrap to a target line length; never splits a single word. */
function wrapWords(words: string[], target: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= target) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCenteredLabel(
  g: D3G,
  label: string,
  cx: number,
  cy: number,
  fill: string,
  fontSize: number,
  tight = false,
  halo?: string
): void {
  const words = label.split(/\s+/);
  let lines: string[];
  if (tight) {
    // Gateways are narrow diamonds — any multi-word label is broken onto
    // balanced short lines so it stays inside the shape.
    lines = words.length === 1 ? [label] : wrapWords(words, 7);
  } else if (label.length <= 14 || words.length === 1) {
    lines = [label];
  } else {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }
  const lineH = fontSize * 1.2;
  const startY = cy - ((lines.length - 1) * lineH) / 2;
  lines.forEach((ln, i) => {
    const txt = g
      .append('text')
      .attr('x', cx)
      .attr('y', startY + i * lineH)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', fontSize)
      .attr('fill', fill);
    if (halo)
      txt
        .attr('stroke', halo)
        .attr('stroke-width', 3.5)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke');
    txt.text(ln);
  });
}

const isGatewayShape = (s: SwimLayoutNode['shape']): boolean =>
  s === 'exclusive' ||
  s === 'parallel' ||
  s === 'inclusive' ||
  s === 'event-based';

/** X (exclusive), + (parallel), O (inclusive), ring + pentagon (event-based). */
function drawGatewayGlyph(
  g: D3G,
  shape: SwimLayoutNode['shape'],
  cx: number,
  cy: number,
  r: number,
  color: string
): void {
  if (shape === 'parallel') {
    const k = r / 2.4;
    g.append('path')
      .attr('d', `M${cx} ${cy - k}V${cy + k}M${cx - k} ${cy}H${cx + k}`)
      .attr('stroke', color)
      .attr('stroke-width', 2.4)
      .attr('fill', 'none');
  } else if (shape === 'exclusive') {
    const k = r / 3.2;
    g.append('path')
      .attr(
        'd',
        `M${cx - k} ${cy - k}L${cx + k} ${cy + k}M${cx + k} ${cy - k}L${cx - k} ${cy + k}`
      )
      .attr('stroke', color)
      .attr('stroke-width', 2.4)
      .attr('stroke-linecap', 'round')
      .attr('fill', 'none');
  } else if (shape === 'inclusive') {
    g.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', r / 2.5)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.2);
  } else if (shape === 'event-based') {
    for (const rr of [r / 2.2, r / 2.2 - 2.5])
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', rr)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1);
    g.append('polygon')
      .attr('points', polygonPoints(cx, cy, r / 4.4, 5))
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1);
  }
}

/** Points of a regular polygon with one vertex straight up. */
function polygonPoints(cx: number, cy: number, r: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}

/** An envelope `w`×`h` centred on (cx, cy): filled (sending) or hollow. */
function drawEnvelope(
  g: D3G,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  filled: boolean,
  ground: string
): void {
  const x = cx - w / 2;
  const y = cy - h / 2;
  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('fill', filled ? color : 'none')
    .attr('stroke', color)
    .attr('stroke-width', GLYPH_STROKE);
  g.append('path')
    .attr('d', `M${x} ${y}L${cx} ${cy + h * 0.1}L${x + w} ${y}`)
    .attr('fill', 'none')
    .attr('stroke', filled ? ground : color)
    .attr('stroke-width', GLYPH_STROKE);
}

/**
 * The trigger glyph inside an event circle. A throwing event (an end) draws
 * its glyph filled; a catching one hollow.
 */
function drawEventGlyph(
  g: D3G,
  event: SwimLayoutNode['event'],
  isEnd: boolean,
  cx: number,
  cy: number,
  r: number,
  color: string,
  ground: string
): void {
  if (event === 'message') {
    drawEnvelope(g, cx, cy, r * 1.05, r * 0.72, color, isEnd, ground);
  } else if (event === 'timer') {
    const rr = r * 0.6;
    g.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', rr)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', GLYPH_STROKE);
    g.append('path')
      .attr(
        'd',
        `M${cx} ${cy - rr * 0.75}L${cx} ${cy}L${cx + rr * 0.55} ${cy + rr * 0.2}`
      )
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', GLYPH_STROKE)
      .attr('stroke-linecap', 'round');
  } else if (event === 'signal') {
    const k = r * 0.55;
    g.append('polygon')
      .attr(
        'points',
        `${cx},${cy - k} ${cx + k * 0.95},${cy + k * 0.62} ${cx - k * 0.95},${cy + k * 0.62}`
      )
      .attr('fill', isEnd ? color : 'none')
      .attr('stroke', color)
      .attr('stroke-width', GLYPH_STROKE);
  } else if (event === 'error') {
    const k = r * 0.55;
    g.append('polygon')
      .attr(
        'points',
        [
          [cx - k * 0.7, cy + k * 0.85],
          [cx - k * 0.25, cy - k * 0.75],
          [cx + k * 0.2, cy + k * 0.1],
          [cx + k * 0.7, cy - k * 0.85],
          [cx + k * 0.3, cy + k * 0.75],
          [cx - k * 0.15, cy - k * 0.05],
        ]
          .map(([x, y]) => `${x},${y}`)
          .join(' ')
      )
      .attr('fill', isEnd ? color : 'none')
      .attr('stroke', color)
      .attr('stroke-width', GLYPH_STROKE)
      .attr('stroke-linejoin', 'round');
  } else if (event === 'terminate' && isEnd) {
    g.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', r * 0.55)
      .attr('fill', color);
  }
}

/** The BPMN task marker, 12px, with its top-left corner at (x, y). */
function drawTaskMarker(
  g: D3G,
  type: NonNullable<SwimLayoutNode['taskType']>,
  x: number,
  y: number,
  color: string,
  ground: string
): void {
  const m = g.append('g').attr('class', `sw-task-marker sw-task-${type}`);
  const line = (d: string): void => {
    m.append('path')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.1)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round');
  };
  if (type === 'user') {
    m.append('circle')
      .attr('cx', x + 6)
      .attr('cy', y + 3.2)
      .attr('r', 2.6)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.1);
    line(
      `M${x + 1} ${y + 12}Q${x + 1} ${y + 6.6} ${x + 6} ${y + 6.6}Q${x + 11} ${y + 6.6} ${x + 11} ${y + 12}Z`
    );
  } else if (type === 'service') {
    const cx = x + 6;
    const cy = y + 6;
    let teeth = '';
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * i) / 4;
      teeth += `M${cx + 3.4 * Math.cos(a)} ${cy + 3.4 * Math.sin(a)}L${cx + 5.6 * Math.cos(a)} ${cy + 5.6 * Math.sin(a)}`;
    }
    line(teeth);
    m.append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 3.4)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.1);
  } else if (type === 'manual') {
    // An open hand: a wrist and four fingers.
    line(
      `M${x} ${y + 11}V${y + 6}L${x + 3} ${y + 3}M${x + 3} ${y + 5}H${x + 11}M${x + 3} ${y + 7.5}H${x + 12}M${x + 3} ${y + 10}H${x + 11}M${x} ${y + 11}H${x + 9}`
    );
  } else if (type === 'script') {
    line(
      `M${x + 2} ${y}H${x + 11}Q${x + 9} ${y + 6} ${x + 11} ${y + 12}H${x + 2}Q${x + 4} ${y + 6} ${x + 2} ${y}ZM${x + 4.5} ${y + 3.5}H${x + 8.5}M${x + 5} ${y + 6}H${x + 9}M${x + 5.5} ${y + 8.5}H${x + 9.5}`
    );
  } else {
    drawEnvelope(m, x + 6, y + 6, 12, 8.4, color, type === 'send', ground);
  }
}

/** A data store (cylinder), data object (folded page) or annotation. */
function drawArtifact(
  parent: D3G,
  a: SwimLayoutArtifact,
  palette: PaletteColors,
  baseBg: string,
  halo: string
): void {
  const g = parent
    .append('g')
    .attr('class', `sw-artifact sw-artifact-${a.kind}`)
    .attr('data-line-number', String(a.lineNumber));
  const stroke = palette.textMuted;
  const fill = mix(palette.surface, baseBg, 60);
  g.append('path')
    .attr('class', 'sw-association')
    .attr('d', a.link.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(''))
    .attr('fill', 'none')
    .attr('stroke', stroke)
    .attr('stroke-width', 1.1)
    .attr('stroke-dasharray', HAIRLINE_DASH);
  const x0 = a.x - a.width / 2;
  const y0 = a.y - a.height / 2;
  const caption = (top: number): void => {
    a.lines.forEach((ln, i) => {
      const ty = top + (i + 1) * 13 - 2;
      g.append('text')
        .attr('x', a.x)
        .attr('y', ty)
        .attr('text-anchor', 'middle')
        .attr('font-size', ARTIFACT_FONT)
        .attr('fill', palette.text)
        .attr('stroke', halo)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke')
        .text(ln);
    });
  };
  if (a.kind === 'store') {
    const w = 40;
    const h = 32;
    const x = a.x - w / 2;
    const ry = 5;
    g.append('path')
      .attr(
        'd',
        `M${x} ${y0 + ry}A${w / 2} ${ry} 0 0 1 ${x + w} ${y0 + ry}V${y0 + h - ry}A${w / 2} ${ry} 0 0 1 ${x} ${y0 + h - ry}Z`
      )
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 1.2);
    g.append('path')
      .attr('d', `M${x} ${y0 + ry}A${w / 2} ${ry} 0 0 0 ${x + w} ${y0 + ry}`)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', 1.2);
    caption(y0 + h + 4);
  } else if (a.kind === 'data') {
    const w = 28;
    const h = 36;
    const x = a.x - w / 2;
    const f = 8;
    g.append('path')
      .attr('d', `M${x} ${y0}H${x + w - f}L${x + w} ${y0 + f}V${y0 + h}H${x}Z`)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 1.2);
    g.append('path')
      .attr('d', `M${x + w - f} ${y0}V${y0 + f}H${x + w}`)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', 1.2);
    caption(y0 + h + 4);
  } else {
    // Annotation: an open bracket with the text beside it.
    g.append('path')
      .attr('d', `M${x0 + 8} ${y0}H${x0}V${y0 + a.height}H${x0 + 8}`)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', 1.2);
    a.lines.forEach((ln, i) => {
      g.append('text')
        .attr('x', x0 + 7)
        .attr('y', y0 + 5 + (i + 1) * 13 - 3)
        .attr('font-size', ARTIFACT_FONT)
        .attr('fill', palette.textMuted)
        .text(ln);
    });
  }
}
