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
import * as d3Shape from 'd3-shape';
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
const ARROW_W = 9;
const ARROW_H = 6.4;

type D3Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;
type D3G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

const linePath = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveLinear);

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

  // ── Lane band backgrounds + headers ─────────────────────────
  const laneG = root.append('g').attr('class', 'dgmo-swimlane-lanes');
  for (const band of layout.lanes) {
    const hex = laneColorById.get(band.id) ?? palette.border;
    laneG
      .append('rect')
      .attr('x', band.x)
      .attr('y', band.y)
      .attr('width', band.width)
      .attr('height', band.height)
      .attr('fill', mix(hex, baseBg, 9))
      .attr('stroke', mix(palette.border, baseBg, 60))
      .attr('stroke-width', 1)
      .attr('data-line-number', String(band.lineNumber));
    // Header gutter (left in LR / top in TB) — slightly stronger tint.
    const isLR = parsed.direction === 'LR';
    const gx = band.x;
    const gy = band.y;
    laneG
      .append('rect')
      .attr('x', gx)
      .attr('y', gy)
      .attr('width', isLR ? band.headerSize : band.width)
      .attr('height', isLR ? band.height : band.headerSize)
      .attr('fill', mix(hex, baseBg, 16))
      .attr('opacity', 0.6);
    laneG
      .append('text')
      .attr('x', isLR ? gx + 12 : gx + band.width / 2)
      .attr('y', isLR ? gy + band.height / 2 : gy + band.headerSize / 2)
      .attr('text-anchor', isLR ? 'start' : 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', LANE_LABEL_FONT)
      .attr('font-weight', '700')
      .attr('fill', mix(hex, palette.text, 55))
      .text(band.label);
  }

  // ── Phase dividers + headers ────────────────────────────────
  const phaseG = root.append('g').attr('class', 'dgmo-swimlane-phases');
  const isLR = parsed.direction === 'LR';
  layout.phases.forEach((band, idx) => {
    // Divider line at the leading edge (skip for the first phase).
    if (idx > 0) {
      if (isLR) {
        phaseG
          .append('line')
          .attr('x1', band.x)
          .attr('y1', 0)
          .attr('x2', band.x)
          .attr('y2', layout.height)
          .attr('stroke', mix(palette.border, baseBg, 70))
          .attr('stroke-dasharray', '3 4');
      } else {
        phaseG
          .append('line')
          .attr('x1', 0)
          .attr('y1', band.y)
          .attr('x2', layout.width)
          .attr('y2', band.y)
          .attr('stroke', mix(palette.border, baseBg, 70))
          .attr('stroke-dasharray', '3 4');
      }
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
      .text(band.label.toUpperCase());
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
          return { fill: mix(c, baseBg, 22), stroke: c };
      }
    }
    // 2. event / symbol type.
    if (n.shape === 'terminal') {
      if (n.event === 'error')
        return { fill: mix(ev.error, baseBg, 22), stroke: ev.error };
      if (n.event === 'success')
        return { fill: mix(ev.success, baseBg, 22), stroke: ev.success };
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
    return { fill: mix(hex, baseBg, 20), stroke: mix(hex, palette.text, 40) };
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
    const d = linePath([...e.points]) ?? '';
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
      // Anchor the label on the path's LONGEST segment — the central run of an
      // orthogonal route, clear of both endpoints and of sibling branches that
      // share a source/target port (geometric-midpoint labels collide there).
      let best = 0;
      let bestLen = -1;
      for (let k = 0; k < e.points.length - 1; k++) {
        const p0 = e.points[k]!;
        const p1 = e.points[k + 1]!;
        const len = Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y);
        if (len > bestLen) {
          bestLen = len;
          best = k;
        }
      }
      const a = e.points[best]!;
      const b = e.points[best + 1] ?? a;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      edgeG
        .append('text')
        .attr('x', mid.x)
        .attr('y', mid.y - 5)
        .attr('text-anchor', 'middle')
        .attr('font-size', EDGE_LABEL_FONT)
        .attr('fill', stroke === palette.textMuted ? palette.textMuted : stroke)
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
          .text(n.label);
      } else {
        drawCenteredLabel(g, n.label, cx, cy, palette.text, NODE_FONT_SIZE - 1);
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
      g.append('text')
        .attr('x', cx)
        .attr('y', cy + r + 12)
        .attr('text-anchor', 'middle')
        .attr('font-size', NODE_FONT_SIZE - 1)
        .attr('fill', palette.text)
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
function drawCenteredLabel(
  g: D3G,
  label: string,
  cx: number,
  cy: number,
  fill: string,
  fontSize: number
): void {
  const words = label.split(/\s+/);
  // Single line if short; else split roughly in half.
  let lines: string[];
  if (label.length <= 14 || words.length === 1) {
    lines = [label];
  } else {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }
  const lineH = fontSize * 1.2;
  const startY = cy - ((lines.length - 1) * lineH) / 2;
  lines.forEach((ln, i) => {
    g.append('text')
      .attr('x', cx)
      .attr('y', startY + i * lineH)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', fontSize)
      .attr('fill', fill)
      .text(ln);
  });
}
