// ============================================================
// Swimlane Diagram — D3 SVG Renderer
// ============================================================
//
// Draws lane band backgrounds + headers, phase dividers + headers, nodes
// (shape per SwimShape), edges (in-arrow labels, dashed back-edges), terminals
// (typed color + glyph), gateways (diamond; `+` for parallel), subprocess
// (double border). Fill cascade: active tag value → event/symbol type → lane
// shade. resvg has no `color-mix()` — all blends go through `mix()`.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { appendArrowheadMarkers } from '../utils/arrow-markers';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { mix, contrastText, themeBaseBg } from '../palettes/color-utils';
import { resolveColor, CATEGORICAL_COLOR_ORDER } from '../colors';
import { resolveTagColor, tagAttrKey } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import type {
  ParsedSwimlane,
  SwimlaneLayoutResult,
  SwimLayoutNode,
} from './types';

const NODE_FONT_SIZE = 12;
const LANE_LABEL_FONT = 12;
const PHASE_LABEL_FONT = 12;
const EDGE_LABEL_FONT = 11;
const NODE_RX = 8;
const NODE_STROKE = 1.5;
const EDGE_STROKE = 1.6;
const EDGE_CORNER_R = 11; // fillet radius for orthogonal edge corners
const ARROW_W = 9;
const ARROW_H = 6.4;
const LANE_RADIUS = 10;
const LANE_INSET = 2; // visual gutter between adjacent lane cards

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

type D3Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;
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

  const titleOffset = parsed.title ? 40 : 0;
  const width = opts.exportDims?.width ?? layout.width;
  const height = (opts.exportDims?.height ?? layout.height) + 0;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('font-family', FONT_FAMILY) as unknown as D3Svg;

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
    width: ARROW_W,
    height: ARROW_H,
    baseFill: palette.textMuted,
    colors: [ev.error, ev.success],
  });

  const root = svg
    .append('g')
    .attr('transform', `translate(0, ${titleOffset})`) as unknown as D3G;

  // ── Title ───────────────────────────────────────────────────
  if (parsed.title) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
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
  const solid = parsed.options['solid-fill'] === 'on';

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

  // ── Lane band backgrounds + headers (rounded cards) ─────────
  const laneG = root.append('g').attr('class', 'dgmo-swimlane-lanes');
  for (const band of layout.lanes) {
    const hex = laneColorById.get(band.id) ?? palette.border;
    // Inset on the cross axis (vertical in LR, horizontal in TB) so adjacent
    // rounded lane cards read as separate rows/columns instead of one block.
    const bx = isLR ? band.x : band.x + LANE_INSET;
    const by = isLR ? band.y + LANE_INSET : band.y;
    const bw = isLR ? band.width : band.width - LANE_INSET * 2;
    const bh = isLR ? band.height - LANE_INSET * 2 : band.height;
    laneG
      .append('path')
      .attr(
        'd',
        roundedRectPath(bx, by, bw, bh, {
          tl: LANE_RADIUS,
          tr: LANE_RADIUS,
          br: LANE_RADIUS,
          bl: LANE_RADIUS,
        })
      )
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
          isLR
            ? { tl: LANE_RADIUS, bl: LANE_RADIUS }
            : { tl: LANE_RADIUS, tr: LANE_RADIUS }
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
      .attr('font-weight', '700')
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
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.06em')
      .attr('fill', palette.textMuted)
      .attr('data-line-number', String(band.lineNumber))
      .text(band.label);
  });

  // ── Node fill cascade ───────────────────────────────────────
  const activeTag = opts.activeTagGroup ?? null;
  const nodeFill = (n: SwimLayoutNode): { fill: string; stroke: string } => {
    // 1. active tag value.
    if (activeTag) {
      const key = tagAttrKey(activeTag);
      if (n.tags[key]) {
        const c = resolveTagColor(n.tags, [...parsed.tagGroups], activeTag);
        if (c && c !== '#999999')
          return { fill: solid ? c : mix(c, baseBg, 22), stroke: c };
      }
    }
    // 2. event / symbol type.
    if (n.shape === 'terminal') {
      if (n.event === 'error')
        return {
          fill: solid ? ev.error : mix(ev.error, baseBg, 22),
          stroke: ev.error,
        };
      if (n.event === 'success')
        return {
          fill: solid ? ev.success : mix(ev.success, baseBg, 22),
          stroke: ev.success,
        };
      if (n.event === 'terminate')
        return { fill: mix(palette.text, baseBg, 30), stroke: palette.text };
      return { fill: palette.bg, stroke: palette.textMuted };
    }
    if (n.shape === 'exclusive' || n.shape === 'parallel') {
      // Gateways stay neutral.
      return {
        fill: mix(palette.surface, baseBg, 80),
        stroke: palette.textMuted,
      };
    }
    // 3. lane shade.
    const hex = laneColorById.get(n.lane) ?? palette.border;
    return {
      fill: solid ? hex : mix(hex, baseBg, 20),
      stroke: mix(hex, palette.text, 40),
    };
  };

  // ── Edges ───────────────────────────────────────────────────
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const edgeG = root.append('g').attr('class', 'dgmo-swimlane-edges');
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
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', EDGE_STROKE)
      .attr('stroke-dasharray', e.back ? '5 4' : null)
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
        return m;
      };
      // Sample the whole text run, not just the anchor: a label extends ~half
      // its width past a centered anchor (or its full width past a start/end
      // anchor), and an edge crossing that tail strikes the text even when the
      // anchor itself looks clear.
      const estW = e.label.length * EDGE_LABEL_FONT * 0.6;
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
        const up = clearance(mid.x, mid.y - LABEL_GAP, 0);
        const down = clearance(mid.x, mid.y + LABEL_GAP, 0);
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
      edgeG
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
        .attr('paint-order', 'stroke')
        .text(e.label);
    }
  }

  // ── Nodes ───────────────────────────────────────────────────
  const nodesG = root.append('g').attr('class', 'dgmo-swimlane-nodes');
  for (const n of layout.nodes) {
    const { fill, stroke } = nodeFill(n);
    const g = nodesG.append('g').attr('data-line-number', String(n.lineNumber));
    const cx = n.x;
    const cy = n.y;
    if (n.shape === 'exclusive' || n.shape === 'parallel') {
      const r = n.width / 2;
      g.append('polygon')
        .attr(
          'points',
          `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
        )
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', NODE_STROKE);
      if (n.shape === 'parallel') {
        // `+` glyph.
        const g2 = palette.textMuted;
        g.append('line')
          .attr('x1', cx)
          .attr('y1', cy - r / 2.4)
          .attr('x2', cx)
          .attr('y2', cy + r / 2.4)
          .attr('stroke', g2)
          .attr('stroke-width', 2.4);
        g.append('line')
          .attr('x1', cx - r / 2.4)
          .attr('y1', cy)
          .attr('x2', cx + r / 2.4)
          .attr('y2', cy)
          .attr('stroke', g2)
          .attr('stroke-width', 2.4);
        // Label below the diamond.
        g.append('text')
          .attr('x', cx)
          .attr('y', cy + r + 12)
          .attr('text-anchor', 'middle')
          .attr('font-size', NODE_FONT_SIZE - 1)
          .attr('fill', palette.textMuted)
          .attr('stroke', haloAt(cy + r + 12))
          .attr('stroke-width', 3.5)
          .attr('stroke-linejoin', 'round')
          .attr('paint-order', 'stroke')
          .text(n.label);
      } else {
        // Halo with the lane background so the diamond outline fades behind a
        // label that overflows the narrow gateway.
        drawCenteredLabel(
          g,
          n.label,
          cx,
          cy,
          palette.text,
          NODE_FONT_SIZE - 1,
          true,
          haloAt(cy)
        );
      }
    } else if (n.shape === 'terminal') {
      const r = n.width / 2;
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', r)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', n.event === 'none' ? NODE_STROKE : 2.4);
      // Success = double ring; terminate = thick inner ring.
      if (n.event === 'success') {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', r - 4)
          .attr('fill', 'none')
          .attr('stroke', stroke)
          .attr('stroke-width', 1);
      }
      // Terminal label goes below the circle by default, but if an edge
      // connects on the BOTTOM of the circle (it approaches from the lane
      // below) the label would sit on that line — flip it above instead.
      let connectsBelow = false;
      for (const le of layout.edges) {
        const pt =
          le.target === n.id
            ? le.points[le.points.length - 1]
            : le.source === n.id
              ? le.points[0]
              : undefined;
        if (pt && pt.y > cy + r * 0.5) connectsBelow = true;
      }
      const labelY = connectsBelow ? cy - r - 6 : cy + r + 12;
      g.append('text')
        .attr('x', cx)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('font-size', NODE_FONT_SIZE - 1)
        .attr('fill', palette.text)
        .attr('stroke', haloAt(labelY))
        .attr('stroke-width', 3.5)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke')
        .text(n.label);
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
      drawCenteredLabel(g, n.label, cx, cy, textColor, NODE_FONT_SIZE);
    }
  }
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
