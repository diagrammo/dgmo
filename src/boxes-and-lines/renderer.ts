// ============================================================
// Boxes and Lines Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import {
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  measureLegendText,
} from '../utils/legend-constants';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { contrastText, mix } from '../palettes/color-utils';
import { resolveTagColor } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import type { ParsedBoxesAndLines, BLNode } from './types';
import type { ParticipantType } from '../sequence/parser';
import type { BLLayoutResult, BLLayoutNode, BLLayoutEdge } from './layout';

// ── Constants ──────────────────────────────────────────────
const DIAGRAM_PADDING = 20;
const NODE_FONT_SIZE = 13;
const MIN_NODE_FONT_SIZE = 9;
const DESC_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 2;
const NODE_STROKE_WIDTH = 2;
const NODE_RX = 8;
const COLLAPSE_BAR_HEIGHT = 6;
const ARROWHEAD_W = 5;
const ARROWHEAD_H = 4;
const CHAR_WIDTH_RATIO = 0.6;
const NODE_TEXT_PADDING = 12;
const SERVICE_RX = 10;
const GROUP_LABEL_FONT_SIZE = 11;
const GROUP_RX = 6;
const BADGE_SIZE = 16;

type D3G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;
type D3Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

// ── Edge path generators ───────────────────────────────────
const lineGeneratorLR = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveMonotoneX);

const lineGeneratorTB = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveMonotoneY);

// ── Text fitting ───────────────────────────────────────────

function splitCamelCase(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    const prev = word[i - 1];
    const curr = word[i];
    const next = i + 1 < word.length ? word[i + 1] : '';
    const lowerToUpper =
      prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z';
    const upperRunEnd =
      prev >= 'A' &&
      prev <= 'Z' &&
      curr >= 'A' &&
      curr <= 'Z' &&
      next >= 'a' &&
      next <= 'z';
    if (lowerToUpper || upperRunEnd) {
      parts.push(word.slice(start, i));
      start = i;
    }
  }
  parts.push(word.slice(start));
  return parts.length > 1 ? parts : [word];
}

function fitTextToNode(
  label: string,
  nodeWidth: number,
  nodeHeight: number
): { lines: string[]; fontSize: number } {
  const maxTextWidth = nodeWidth - NODE_TEXT_PADDING * 2;
  const lineHeight = 1.3;

  for (
    let fontSize = NODE_FONT_SIZE;
    fontSize >= MIN_NODE_FONT_SIZE;
    fontSize--
  ) {
    const charWidth = fontSize * CHAR_WIDTH_RATIO;
    const maxCharsPerLine = Math.floor(maxTextWidth / charWidth);
    const maxLines = Math.floor((nodeHeight - 8) / (fontSize * lineHeight));
    if (maxCharsPerLine < 2 || maxLines < 1) continue;
    if (label.length <= maxCharsPerLine) return { lines: [label], fontSize };

    const words = label.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= maxCharsPerLine) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (
      lines.length <= maxLines &&
      lines.every((l) => l.length <= maxCharsPerLine)
    ) {
      return { lines, fontSize };
    }

    // CamelCase split
    const camelWords: string[] = [];
    for (const word of words) {
      if (word.length > maxCharsPerLine)
        camelWords.push(...splitCamelCase(word));
      else camelWords.push(word);
    }
    const camelLines: string[] = [];
    let cc = '';
    for (const word of camelWords) {
      const test = cc ? `${cc} ${word}` : word;
      if (test.length <= maxCharsPerLine) {
        cc = test;
      } else {
        if (cc) camelLines.push(cc);
        cc = word;
      }
    }
    if (cc) camelLines.push(cc);
    if (
      camelLines.length <= maxLines &&
      camelLines.every((l) => l.length <= maxCharsPerLine)
    ) {
      return { lines: camelLines, fontSize };
    }

    if (fontSize > MIN_NODE_FONT_SIZE) continue;

    // Hard-break
    const hardLines: string[] = [];
    for (const line of camelLines) {
      if (line.length <= maxCharsPerLine) hardLines.push(line);
      else
        for (let i = 0; i < line.length; i += maxCharsPerLine)
          hardLines.push(line.slice(i, i + maxCharsPerLine));
    }
    if (hardLines.length <= maxLines) return { lines: hardLines, fontSize };
  }

  const charWidth = MIN_NODE_FONT_SIZE * CHAR_WIDTH_RATIO;
  const maxChars = Math.floor((nodeWidth - NODE_TEXT_PADDING * 2) / charWidth);
  const truncated =
    label.length > maxChars ? label.slice(0, maxChars - 1) + '\u2026' : label;
  return { lines: [truncated], fontSize: MIN_NODE_FONT_SIZE };
}

// ── Shape renderers ────────────────────────────────────────

function renderShapeRect(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', NODE_RX)
    .attr('ry', NODE_RX)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderShapeService(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', SERVICE_RX)
    .attr('ry', SERVICE_RX)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderShapeActor(g: D3G, w: number, h: number, s: string): void {
  const figH = h * 0.65;
  const topY = -h / 2;
  const headR = Math.min(figH * 0.22, w * 0.12);
  const headY = topY + headR + 2;
  const bodyTopY = headY + headR + 1;
  const bodyBottomY = topY + figH * 0.75;
  const legY = topY + figH;
  const armSpan = Math.min(16, w * 0.18);
  const legSpan = Math.min(12, w * 0.14);
  const sw = 2.5;

  g.append('circle')
    .attr('cx', 0)
    .attr('cy', headY)
    .attr('r', headR)
    .attr('fill', 'none')
    .attr('stroke', s)
    .attr('stroke-width', sw);
  g.append('line')
    .attr('x1', 0)
    .attr('y1', bodyTopY)
    .attr('x2', 0)
    .attr('y2', bodyBottomY)
    .attr('stroke', s)
    .attr('stroke-width', sw);
  g.append('line')
    .attr('x1', -armSpan)
    .attr('y1', bodyTopY + 4)
    .attr('x2', armSpan)
    .attr('y2', bodyTopY + 4)
    .attr('stroke', s)
    .attr('stroke-width', sw);
  g.append('line')
    .attr('x1', 0)
    .attr('y1', bodyBottomY)
    .attr('x2', -legSpan)
    .attr('y2', legY)
    .attr('stroke', s)
    .attr('stroke-width', sw);
  g.append('line')
    .attr('x1', 0)
    .attr('y1', bodyBottomY)
    .attr('x2', legSpan)
    .attr('y2', legY)
    .attr('stroke', s)
    .attr('stroke-width', sw);
}

function renderShapeDatabase(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  const ry = 7;
  const topY = -h / 2 + ry;
  const bodyH = h - ry * 2;
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY + bodyH)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', topY)
    .attr('width', w)
    .attr('height', bodyH)
    .attr('fill', f)
    .attr('stroke', 'none');
  g.append('line')
    .attr('x1', -w / 2)
    .attr('y1', topY)
    .attr('x2', -w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('line')
    .attr('x1', w / 2)
    .attr('y1', topY)
    .attr('x2', w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderShapeQueue(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  const rx = 10;
  const leftX = -w / 2 + rx;
  const bodyW = w - rx * 2;
  g.append('ellipse')
    .attr('cx', leftX + bodyW)
    .attr('cy', 0)
    .attr('rx', rx)
    .attr('ry', h / 2)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('rect')
    .attr('x', leftX)
    .attr('y', -h / 2)
    .attr('width', bodyW)
    .attr('height', h)
    .attr('fill', f)
    .attr('stroke', 'none');
  g.append('line')
    .attr('x1', leftX)
    .attr('y1', -h / 2)
    .attr('x2', leftX + bodyW)
    .attr('y2', -h / 2)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('line')
    .attr('x1', leftX)
    .attr('y1', h / 2)
    .attr('x2', leftX + bodyW)
    .attr('y2', h / 2)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('ellipse')
    .attr('cx', leftX)
    .attr('cy', 0)
    .attr('rx', rx)
    .attr('ry', h / 2)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderShapeCache(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  const ry = 7;
  const topY = -h / 2 + ry;
  const bodyH = h - ry * 2;
  const dash = '4 3';
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY + bodyH)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH)
    .attr('stroke-dasharray', dash);
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', topY)
    .attr('width', w)
    .attr('height', bodyH)
    .attr('fill', f)
    .attr('stroke', 'none');
  g.append('line')
    .attr('x1', -w / 2)
    .attr('y1', topY)
    .attr('x2', -w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH)
    .attr('stroke-dasharray', dash);
  g.append('line')
    .attr('x1', w / 2)
    .attr('y1', topY)
    .attr('x2', w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH)
    .attr('stroke-dasharray', dash);
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH)
    .attr('stroke-dasharray', dash);
}

function renderShapeNetworking(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  const inset = 16;
  const points = [
    `${-w / 2 + inset},${-h / 2}`,
    `${w / 2 - inset},${-h / 2}`,
    `${w / 2},0`,
    `${w / 2 - inset},${h / 2}`,
    `${-w / 2 + inset},${h / 2}`,
    `${-w / 2},0`,
  ].join(' ');
  g.append('polygon')
    .attr('points', points)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderShapeFrontend(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  const screenH = h - 10;
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', screenH)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('line')
    .attr('x1', 0)
    .attr('y1', -h / 2 + screenH)
    .attr('x2', 0)
    .attr('y2', h / 2 - 2)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
  g.append('line')
    .attr('x1', -14)
    .attr('y1', h / 2 - 2)
    .attr('x2', 14)
    .attr('y2', h / 2 - 2)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

/** Gateway — diamond */
function renderShapeGateway(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  const points = `0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`;
  g.append('polygon')
    .attr('points', points)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

function renderShapeExternal(
  g: D3G,
  w: number,
  h: number,
  f: string,
  s: string
): void {
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', -h / 2)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', NODE_RX)
    .attr('ry', NODE_RX)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', NODE_STROKE_WIDTH)
    .attr('stroke-dasharray', '6 3');
}

function renderNodeShape(
  g: D3G,
  shape: ParticipantType,
  w: number,
  h: number,
  fillColor: string,
  strokeColor: string
): void {
  switch (shape) {
    case 'actor':
      renderShapeActor(g, w, h, strokeColor);
      break;
    case 'database':
      renderShapeDatabase(g, w, h, fillColor, strokeColor);
      break;
    case 'queue':
      renderShapeQueue(g, w, h, fillColor, strokeColor);
      break;
    case 'cache':
      renderShapeCache(g, w, h, fillColor, strokeColor);
      break;
    case 'networking':
      renderShapeNetworking(g, w, h, fillColor, strokeColor);
      break;
    case 'frontend':
      renderShapeFrontend(g, w, h, fillColor, strokeColor);
      break;
    case 'external':
      renderShapeExternal(g, w, h, fillColor, strokeColor);
      break;
    case 'gateway':
      renderShapeGateway(g, w, h, fillColor, strokeColor);
      break;
    case 'service':
      renderShapeService(g, w, h, fillColor, strokeColor);
      break;
    default:
      renderShapeRect(g, w, h, fillColor, strokeColor);
      break;
  }
}

// ── Mini-shape badge paths ─────────────────────────────────

function renderMiniBadge(
  g: D3G,
  shape: ParticipantType,
  x: number,
  y: number,
  color: string
): void {
  const s = BADGE_SIZE;
  const badge = g.append('g').attr('transform', `translate(${x},${y})`);

  switch (shape) {
    case 'database': {
      // Mini cylinder
      const ry = 2;
      badge
        .append('ellipse')
        .attr('cx', 0)
        .attr('cy', -s / 4)
        .attr('rx', s / 3)
        .attr('ry', ry)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      badge
        .append('rect')
        .attr('x', -s / 3)
        .attr('y', -s / 4)
        .attr('width', (s * 2) / 3)
        .attr('height', s / 2)
        .attr('fill', 'none')
        .attr('stroke', 'none');
      badge
        .append('line')
        .attr('x1', -s / 3)
        .attr('y1', -s / 4)
        .attr('x2', -s / 3)
        .attr('y2', s / 4)
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      badge
        .append('line')
        .attr('x1', s / 3)
        .attr('y1', -s / 4)
        .attr('x2', s / 3)
        .attr('y2', s / 4)
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      badge
        .append('ellipse')
        .attr('cx', 0)
        .attr('cy', s / 4)
        .attr('rx', s / 3)
        .attr('ry', ry)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      break;
    }
    case 'queue': {
      // Mini horizontal pipe
      badge
        .append('rect')
        .attr('x', -s / 3)
        .attr('y', -s / 4)
        .attr('width', (s * 2) / 3)
        .attr('height', s / 2)
        .attr('rx', s / 4)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      break;
    }
    case 'networking': {
      // Mini hexagon
      const r = s / 3;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${r * Math.cos(a)},${r * Math.sin(a)}`;
      }).join(' ');
      badge
        .append('polygon')
        .attr('points', pts)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      break;
    }
    case 'frontend': {
      // Mini monitor
      badge
        .append('rect')
        .attr('x', -s / 3)
        .attr('y', -s / 3)
        .attr('width', (s * 2) / 3)
        .attr('height', s / 2)
        .attr('rx', 1)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      badge
        .append('line')
        .attr('x1', 0)
        .attr('y1', s / 6)
        .attr('x2', 0)
        .attr('y2', s / 3)
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      break;
    }
    case 'actor': {
      // Mini stick figure
      badge
        .append('circle')
        .attr('cx', 0)
        .attr('cy', -s / 4)
        .attr('r', s / 6)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      badge
        .append('line')
        .attr('x1', 0)
        .attr('y1', -s / 12)
        .attr('x2', 0)
        .attr('y2', s / 6)
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      break;
    }
    case 'cache': {
      // Mini dashed cylinder
      badge
        .append('ellipse')
        .attr('cx', 0)
        .attr('cy', 0)
        .attr('rx', s / 3)
        .attr('ry', s / 4)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2 1');
      break;
    }
    case 'external': {
      // Mini dashed rect
      badge
        .append('rect')
        .attr('x', -s / 3)
        .attr('y', -s / 4)
        .attr('width', (s * 2) / 3)
        .attr('height', s / 2)
        .attr('rx', 2)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2 1');
      break;
    }
    case 'gateway': {
      // Mini diamond
      const r = s / 3;
      badge
        .append('polygon')
        .attr('points', `0,${-r} ${r},0 0,${r} ${-r},0`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      break;
    }
    default:
      // service / default — mini rounded rect
      badge
        .append('rect')
        .attr('x', -s / 4)
        .attr('y', -s / 5)
        .attr('width', s / 2)
        .attr('height', (s * 2) / 5)
        .attr('rx', 2)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.2);
      break;
  }
}

// ── Color helpers ──────────────────────────────────────────

function nodeColors(
  node: BLNode,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  palette: PaletteColors,
  isDark: boolean
): { fill: string; stroke: string; text: string } {
  const tagColor = resolveTagColor(node.metadata, tagGroups, activeGroupName);
  if (tagColor) {
    const fill = mix(tagColor, isDark ? palette.surface : palette.bg, 30);
    const stroke = tagColor;
    const text = contrastText(fill, '#eceff4', '#2e3440');
    return { fill, stroke, text };
  }
  // Untagged fallback
  const fill = isDark ? palette.surface : palette.bg;
  const stroke = palette.textMuted;
  const text = palette.text;
  return { fill, stroke, text };
}

function edgeColor(
  edge: BLLayoutEdge,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  palette: PaletteColors
): string {
  const tagColor = resolveTagColor(edge.metadata, tagGroups, activeGroupName);
  return tagColor ?? palette.textMuted;
}

// ── Arrowhead markers ──────────────────────────────────────

function ensureArrowMarkers(
  defs: d3Selection.Selection<SVGDefsElement, unknown, null, undefined>,
  colors: Set<string>
): void {
  for (const color of colors) {
    const id = `bl-arrow-${color.replace('#', '')}`;
    if (!defs.select(`#${id}`).empty()) continue;
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${ARROWHEAD_W * 2} ${ARROWHEAD_H * 2}`)
      .attr('refX', ARROWHEAD_W * 2)
      .attr('refY', ARROWHEAD_H)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('orient', 'auto')
      .append('polygon')
      .attr(
        'points',
        `0,0 ${ARROWHEAD_W * 2},${ARROWHEAD_H} 0,${ARROWHEAD_H * 2}`
      )
      .attr('fill', color);

    // Reverse marker for bidirectional
    const revId = `bl-arrow-rev-${color.replace('#', '')}`;
    if (!defs.select(`#${revId}`).empty()) continue;
    defs
      .append('marker')
      .attr('id', revId)
      .attr('viewBox', `0 0 ${ARROWHEAD_W * 2} ${ARROWHEAD_H * 2}`)
      .attr('refX', 0)
      .attr('refY', ARROWHEAD_H)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('orient', 'auto')
      .append('polygon')
      .attr(
        'points',
        `${ARROWHEAD_W * 2},0 0,${ARROWHEAD_H} ${ARROWHEAD_W * 2},${ARROWHEAD_H * 2}`
      )
      .attr('fill', color);
  }
}

// ── Edge label overlap resolution ──────────────────────────

function resolveEdgeLabelOverlaps(
  labels: { x: number; y: number; width: number; height: number }[]
): void {
  const MAX_PASSES = 8;
  const PAD = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        const overlapX = (a.width + b.width) / 2 + PAD - dx;
        const overlapY = (a.height + b.height) / 2 + PAD - dy;
        if (overlapX > 0 && overlapY > 0) {
          const shift = overlapY / 2 + 1;
          if (a.y < b.y) {
            a.y -= shift;
            b.y += shift;
          } else {
            a.y += shift;
            b.y -= shift;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// ── Main render function ───────────────────────────────────

export interface BLRenderOptions {
  onClickItem?: (lineNumber: number) => void;
  exportDims?: { width?: number; height?: number };
  activeTagGroup?: string | null;
  hiddenTagValues?: Map<string, Set<string>>;
  renderModeOverride?: 'rectangles' | 'shapes';
}

export function renderBoxesAndLines(
  container: HTMLDivElement,
  parsed: ParsedBoxesAndLines,
  layout: BLLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  options?: BLRenderOptions
): void {
  const {
    onClickItem,
    exportDims,
    activeTagGroup,
    hiddenTagValues,
    renderModeOverride,
  } = options ?? {};
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const effectiveRenderMode = renderModeOverride ?? parsed.renderMode;

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  // Determine active tag group
  const activeGroup = activeTagGroup ?? parsed.options['active-tag'] ?? null;

  // Build hidden set
  const hidden = hiddenTagValues ?? parsed.initialHiddenTagValues;

  // Build node lookup
  const nodeMap = new Map<string, BLNode>();
  for (const node of parsed.nodes) nodeMap.set(node.label, node);

  // Build layout node lookup
  const layoutNodeMap = new Map<string, BLLayoutNode>();
  for (const ln of layout.nodes) layoutNodeMap.set(ln.label, ln);

  // Compute diagram bounds for scaling
  const titleOffset = parsed.title ? 40 : 0;
  const legendH = parsed.tagGroups.length > 0 ? LEGEND_HEIGHT + 8 : 0;
  const contentW = layout.width;
  const contentH = layout.height + titleOffset + legendH;

  const scaleX = width / (contentW + DIAGRAM_PADDING * 2);
  const scaleY = height / (contentH + DIAGRAM_PADDING * 2);
  const scale = Math.min(scaleX, scaleY, 3);

  const offsetX = (width - contentW * scale) / 2;
  const offsetY = DIAGRAM_PADDING + titleOffset + legendH;

  // Create SVG
  const svg: D3Svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY)
    .style('background', palette.bg);

  const defs = svg.append('defs');

  // Title
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

  // Main diagram group with scaling
  const diagramG = svg
    .append('g')
    .attr('transform', `translate(${offsetX},${offsetY}) scale(${scale})`);

  // Collect all edge colors for arrowhead markers
  const arrowColors = new Set<string>();
  const edgeColorMap = new Map<number, string>();
  for (let i = 0; i < layout.edges.length; i++) {
    const c = edgeColor(
      layout.edges[i],
      parsed.tagGroups,
      activeGroup,
      palette
    );
    arrowColors.add(c);
    edgeColorMap.set(i, c);
  }
  ensureArrowMarkers(defs, arrowColors);

  // ── Render groups (bottom layer) ───────────────────────
  const sortedGroups = [...layout.groups].sort((a, b) => a.depth - b.depth);
  for (const group of sortedGroups) {
    const gx = group.x - group.width / 2;
    const gy = group.y - group.height / 2;

    const groupG = diagramG
      .append('g')
      .attr(
        'class',
        group.collapsed ? 'bl-group bl-group-collapsed' : 'bl-group'
      )
      .attr('data-group-toggle', group.label)
      .style('cursor', 'pointer');

    if (group.collapsed) {
      // Collapsed: solid rounded rect matching node style + 6px collapse bar
      const fillColor = isDark ? palette.surface : palette.bg;
      const strokeColor = palette.border;

      groupG
        .append('rect')
        .attr('x', gx)
        .attr('y', gy)
        .attr('width', group.width)
        .attr('height', group.height)
        .attr('rx', NODE_RX)
        .attr('ry', NODE_RX)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', NODE_STROKE_WIDTH);

      // 6px collapse bar at bottom (clipped to rounded corners)
      const clipId = `bl-clip-${group.label.replace(/[[\]\s]/g, '')}`;
      groupG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', gx)
        .attr('y', gy)
        .attr('width', group.width)
        .attr('height', group.height)
        .attr('rx', NODE_RX);
      groupG
        .append('rect')
        .attr('x', gx)
        .attr('y', gy + group.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', group.width)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', strokeColor)
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'bl-collapse-bar');

      // Label (centered, offset up slightly to account for bar)
      groupG
        .append('text')
        .attr('x', group.x)
        .attr('y', group.y - (group.childCount ? 2 : 0))
        .attr('text-anchor', 'middle')
        .attr('font-size', NODE_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', palette.text)
        .text(group.label);

      // Child count below label
      if (group.childCount) {
        groupG
          .append('text')
          .attr('x', group.x)
          .attr('y', group.y + NODE_FONT_SIZE)
          .attr('text-anchor', 'middle')
          .attr('font-size', DESC_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(`+${group.childCount}`);
      }
    } else {
      // Expanded: background container with label
      groupG
        .append('rect')
        .attr('x', gx)
        .attr('y', gy)
        .attr('width', group.width)
        .attr('height', group.height)
        .attr('rx', GROUP_RX)
        .attr('ry', GROUP_RX)
        .attr('fill', mix(palette.surface, palette.bg, 50))
        .attr('stroke', palette.border)
        .attr('stroke-width', 1);

      groupG
        .append('text')
        .attr('class', 'bl-group-label')
        .attr('x', gx + 8)
        .attr('y', gy + 16)
        .attr('font-size', GROUP_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', palette.textMuted)
        .text(group.label);
    }
  }

  // ── Render edges ───────────────────────────────────────
  // Collect label positions for overlap resolution
  const labelPositions: {
    x: number;
    y: number;
    width: number;
    height: number;
    idx: number;
  }[] = [];

  for (let i = 0; i < layout.edges.length; i++) {
    const le = layout.edges[i];
    const color = edgeColorMap.get(i) ?? palette.textMuted;

    // Check if hidden
    if (hidden.size > 0) {
      let isHidden = false;
      for (const [groupKey, hiddenVals] of hidden) {
        const val = le.metadata[groupKey];
        if (val && hiddenVals.has(val.toLowerCase())) {
          isHidden = true;
          break;
        }
      }
      if (isHidden) continue;
    }

    // Apply parallel y-offset to points
    const points = le.points.map((p) => ({ x: p.x, y: p.y + le.yOffset }));
    if (points.length < 2) continue;

    const markerId = `bl-arrow-${color.replace('#', '')}`;
    const path = diagramG
      .append('path')
      .attr('class', 'bl-edge')
      .attr(
        'd',
        (parsed.direction === 'TB' ? lineGeneratorTB : lineGeneratorLR)(
          points
        ) ?? ''
      )
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('marker-end', `url(#${markerId})`);

    if (le.bidirectional) {
      const revId = `bl-arrow-rev-${color.replace('#', '')}`;
      path.attr('marker-start', `url(#${revId})`);
    }

    // Edge label
    if (le.label && le.labelX != null && le.labelY != null) {
      const lw = le.label.length * EDGE_LABEL_FONT_SIZE * CHAR_WIDTH_RATIO;
      labelPositions.push({
        x: le.labelX,
        y: le.labelY + le.yOffset,
        width: lw + 8,
        height: EDGE_LABEL_FONT_SIZE + 6,
        idx: i,
      });
    }
  }

  // Resolve overlaps
  resolveEdgeLabelOverlaps(labelPositions);

  // Render edge labels
  for (const lp of labelPositions) {
    const le = layout.edges[lp.idx];
    if (!le.label) continue;

    diagramG
      .append('rect')
      .attr('x', lp.x - lp.width / 2)
      .attr('y', lp.y - lp.height / 2)
      .attr('width', lp.width)
      .attr('height', lp.height)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.85);

    diagramG
      .append('text')
      .attr('x', lp.x)
      .attr('y', lp.y + EDGE_LABEL_FONT_SIZE / 3)
      .attr('text-anchor', 'middle')
      .attr('font-size', EDGE_LABEL_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .text(le.label);
  }

  // ── Render nodes ───────────────────────────────────────
  for (const ln of layout.nodes) {
    const node = nodeMap.get(ln.label);
    if (!node) continue;

    // Check if hidden
    if (hidden.size > 0) {
      let isHidden = false;
      for (const [groupKey, hiddenVals] of hidden) {
        const val = node.metadata[groupKey];
        if (val && hiddenVals.has(val.toLowerCase())) {
          isHidden = true;
          break;
        }
      }
      if (isHidden) continue;
    }

    const colors = nodeColors(
      node,
      parsed.tagGroups,
      activeGroup,
      palette,
      isDark
    );
    const effectiveShape = node.shapeOverride ?? node.shape;

    const nodeG = diagramG
      .append('g')
      .attr('class', 'bl-node')
      .attr('transform', `translate(${ln.x},${ln.y})`)
      .attr('data-line-number', node.lineNumber)
      .style('cursor', onClickItem ? 'pointer' : 'default');

    // Add tag metadata as data attributes for legend hover dimming
    for (const [key, val] of Object.entries(node.metadata)) {
      nodeG.attr(`data-tag-${key}`, val.toLowerCase());
    }

    if (onClickItem) {
      nodeG.on('click', () => onClickItem(node.lineNumber));
    }

    if (effectiveRenderMode === 'shapes') {
      // Shape mode — full shape, label only
      renderNodeShape(
        nodeG as unknown as D3G,
        effectiveShape,
        ln.width,
        ln.height,
        colors.fill,
        colors.stroke
      );

      const fitted = fitTextToNode(node.label, ln.width, ln.height);
      const totalTextH = fitted.lines.length * fitted.fontSize * 1.3;
      const startY = -totalTextH / 2 + fitted.fontSize * 0.4;

      for (let li = 0; li < fitted.lines.length; li++) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', startY + li * fitted.fontSize * 1.3)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .attr('fill', colors.text)
          .text(fitted.lines[li]);
      }
    } else {
      // Rectangle mode — rounded rect, label + description + tag badge
      renderShapeRect(
        nodeG as unknown as D3G,
        ln.width,
        ln.height,
        colors.fill,
        colors.stroke
      );

      let textY = -ln.height / 2 + NODE_TEXT_PADDING + NODE_FONT_SIZE * 0.4;

      // Label (bold)
      const fitted = fitTextToNode(node.label, ln.width, ln.height * 0.6);
      for (let li = 0; li < fitted.lines.length; li++) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', textY + li * fitted.fontSize * 1.3)
          .attr('text-anchor', 'middle')
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .attr('fill', colors.text)
          .text(fitted.lines[li]);
      }
      textY += fitted.lines.length * fitted.fontSize * 1.3 + 2;

      // Description (muted, truncated)
      if (node.description) {
        const desc =
          node.description.length > 35
            ? node.description.slice(0, 34) + '\u2026'
            : node.description;
        nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', textY)
          .attr('text-anchor', 'middle')
          .attr('font-size', DESC_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(desc);
        textY += DESC_FONT_SIZE * 1.3 + 2; // eslint-disable-line no-useless-assignment
      }

      // Mini-shape badge in top-right corner
      if (effectiveShape !== 'default' && effectiveShape !== 'service') {
        renderMiniBadge(
          nodeG as unknown as D3G,
          effectiveShape,
          ln.width / 2 - BADGE_SIZE / 2 - 4,
          -ln.height / 2 + BADGE_SIZE / 2 + 4,
          colors.stroke
        );
      }
    }
  }

  // ── Render legend ──────────────────────────────────────
  if (parsed.tagGroups.length > 0) {
    renderLegend(
      svg,
      parsed,
      palette,
      isDark,
      activeGroup,
      width,
      titleOffset,
      effectiveRenderMode
    );
  }
}

// ── Legend ──────────────────────────────────────────────────

function renderLegend(
  svg: D3Svg,
  parsed: ParsedBoxesAndLines,
  palette: PaletteColors,
  isDark: boolean,
  activeGroup: string | null,
  svgWidth: number,
  titleOffset: number,
  effectiveRenderMode: 'rectangles' | 'shapes'
): void {
  const legendY = titleOffset + 4;
  const legendG = svg.append('g').attr('transform', `translate(0,${legendY})`);

  let x = LEGEND_CAPSULE_PAD;

  // Mode toggle pills
  const modes: Array<{ label: string; mode: 'rectangles' | 'shapes' }> = [
    { label: 'Rectangles', mode: 'rectangles' },
    { label: 'Shapes', mode: 'shapes' },
  ];

  for (const m of modes) {
    const isActive = effectiveRenderMode === m.mode;
    const tw = measureLegendText(m.label, LEGEND_PILL_FONT_SIZE);
    const pillW = tw + LEGEND_PILL_PAD;

    legendG
      .append('rect')
      .attr('x', x)
      .attr('y', (LEGEND_HEIGHT - 20) / 2)
      .attr('width', pillW)
      .attr('height', 20)
      .attr('rx', 10)
      .attr('fill', isActive ? palette.primary : 'none')
      .attr('stroke', isActive ? 'none' : palette.border)
      .attr('stroke-width', 1)
      .attr('data-section-toggle', `mode-${m.mode}`);

    legendG
      .append('text')
      .attr('x', x + pillW / 2)
      .attr('y', LEGEND_HEIGHT / 2 + 1)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr(
        'fill',
        isActive
          ? contrastText(palette.primary, '#eceff4', '#2e3440')
          : palette.textMuted
      )
      .attr('pointer-events', 'none')
      .text(m.label);

    x += pillW + 4;
  }

  x += LEGEND_GROUP_GAP;

  // Tag group entries
  for (const tg of parsed.tagGroups) {
    const isActiveGroup = activeGroup?.toLowerCase() === tg.name.toLowerCase();
    if (!isActiveGroup && activeGroup) continue;

    const groupG = legendG
      .append('g')
      .attr('class', 'bl-legend-group')
      .attr('data-legend-group', tg.name.toLowerCase())
      .style('cursor', 'pointer');

    // Group name pill
    const nameW =
      measureLegendText(tg.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    groupG
      .append('rect')
      .attr('x', x)
      .attr('y', (LEGEND_HEIGHT - 20) / 2)
      .attr('width', nameW)
      .attr('height', 20)
      .attr('rx', 10)
      .attr(
        'fill',
        isActiveGroup ? mix(palette.primary, palette.bg, 80) : 'none'
      )
      .attr('stroke', palette.border)
      .attr('stroke-width', 1);

    groupG
      .append('text')
      .attr('x', x + nameW / 2)
      .attr('y', LEGEND_HEIGHT / 2 + 1)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('fill', palette.text)
      .attr('pointer-events', 'none')
      .text(tg.name);

    x += nameW + 6;

    // Entries with colored dots
    for (const entry of tg.entries) {
      const entryColor = entry.color || palette.textMuted;
      const ew = measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE);

      const entryG = groupG
        .append('g')
        .attr('data-legend-entry', entry.value)
        .style('cursor', 'pointer');

      entryG
        .append('circle')
        .attr('cx', x + LEGEND_DOT_R)
        .attr('cy', LEGEND_HEIGHT / 2)
        .attr('r', LEGEND_DOT_R)
        .attr('fill', entryColor);

      entryG
        .append('text')
        .attr('x', x + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP)
        .attr('y', LEGEND_HEIGHT / 2 + 1)
        .attr('dominant-baseline', 'central')
        .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
        .attr('fill', palette.text)
        .attr('pointer-events', 'none')
        .text(entry.value);

      x += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + ew + LEGEND_ENTRY_TRAIL;
    }

    x += LEGEND_GROUP_GAP;
  }

  // Shape key — when in shapes mode, show shape-to-type mapping
  if (effectiveRenderMode === 'shapes') {
    x += LEGEND_GROUP_GAP;
    const shapeEntries: Array<{ label: string; shape: ParticipantType }> = [
      { label: 'Service', shape: 'service' },
      { label: 'Database', shape: 'database' },
      { label: 'Queue', shape: 'queue' },
      { label: 'Cache', shape: 'cache' },
      { label: 'Gateway', shape: 'gateway' },
      { label: 'Network', shape: 'networking' },
      { label: 'Frontend', shape: 'frontend' },
      { label: 'External', shape: 'external' },
      { label: 'Actor', shape: 'actor' },
    ];

    // Only show shapes that are actually used in the diagram
    const usedShapes = new Set(
      parsed.nodes.map((n) => n.shapeOverride ?? n.shape)
    );

    for (const entry of shapeEntries) {
      if (!usedShapes.has(entry.shape)) continue;
      const ew = measureLegendText(entry.label, LEGEND_ENTRY_FONT_SIZE);

      renderMiniBadge(
        legendG as unknown as D3G,
        entry.shape,
        x + BADGE_SIZE / 2,
        LEGEND_HEIGHT / 2,
        palette.textMuted
      );

      legendG
        .append('text')
        .attr('x', x + BADGE_SIZE + 4)
        .attr('y', LEGEND_HEIGHT / 2 + 1)
        .attr('dominant-baseline', 'central')
        .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(entry.label);

      x += BADGE_SIZE + 4 + ew + LEGEND_ENTRY_TRAIL;
    }
  }
}

// ── Export helper ──────────────────────────────────────────

export function renderBoxesAndLinesForExport(
  container: HTMLDivElement,
  parsed: ParsedBoxesAndLines,
  layout: BLLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  options?: { exportDims?: { width: number; height: number } }
): void {
  renderBoxesAndLines(container, parsed, layout, palette, isDark, {
    exportDims: options?.exportDims,
  });
}
