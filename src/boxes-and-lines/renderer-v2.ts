// ============================================================
// Boxes and Lines Diagram — D3 SVG Renderer V2
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { contrastText, mix } from '../palettes/color-utils';
import { resolveTagColor, resolveActiveTagGroup } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import type { ParsedBoxesAndLines, BLNode } from './types';
import type { BLLayoutResultV2, BLLayoutNodeV2, BLLayoutEdgeV2 } from './types';

// ── Constants ─────────────────────────────────────────────
const DIAGRAM_PADDING = 20;
const NODE_FONT_SIZE = 13;
const MIN_NODE_FONT_SIZE = 9;
const META_FONT_SIZE = 10;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 1;
const NODE_STROKE_WIDTH = 1.5;
const NODE_RX = 8;
const COLLAPSE_BAR_HEIGHT = 4;
const ARROWHEAD_W = 5;
const ARROWHEAD_H = 4;
const CHAR_WIDTH_RATIO = 0.6;
const NODE_TEXT_PADDING = 12;
const GROUP_RX = 8;
const GROUP_LABEL_FONT_SIZE = 14;
const HOP_RADIUS = 4;
const DIM_OPACITY = 0.15;

type D3G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;
type D3Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

// ── Text fitting (same as v1) ─────────────────────────────

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

// ── Color helpers ─────────────────────────────────────────

function nodeColors(
  node: BLNode,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  palette: PaletteColors,
  isDark: boolean
): { fill: string; stroke: string; text: string } {
  const tagColor = resolveTagColor(node.metadata, tagGroups, activeGroupName);
  if (tagColor) {
    // Subtle tinting — color is a whisper, not a shout
    const fill = mix(tagColor, isDark ? palette.surface : palette.bg, 30);
    const stroke = tagColor;
    const text = contrastText(fill, '#eceff4', '#2e3440');
    return { fill, stroke, text };
  }
  const fill = mix(palette.bg, palette.text, isDark ? 90 : 95);
  const stroke = mix(palette.text, palette.bg, isDark ? 60 : 40);
  const text = palette.text;
  return { fill, stroke, text };
}

function edgeColor(
  edge: BLLayoutEdgeV2,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  palette: PaletteColors
): string {
  const hasTagMeta =
    Object.keys(edge.metadata).length > 0 && activeGroupName != null;
  if (hasTagMeta) {
    const tagColor = resolveTagColor(edge.metadata, tagGroups, activeGroupName);
    if (tagColor) return tagColor;
  }
  return palette.textMuted;
}

// ── Arrowhead markers ─────────────────────────────────────

function ensureArrowMarkers(
  defs: d3Selection.Selection<SVGDefsElement, unknown, null, undefined>,
  colors: Set<string>
): void {
  for (const color of colors) {
    const id = `bl-v2-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
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

    const revId = `bl-v2-arrow-rev-${color.replace('#', '')}`;
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

// ── Edge label overlap resolution ─────────────────────────

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

// ── Hop rendering helper ──────────────────────────────────

function renderHop(
  g: D3G,
  hop: { x: number; y: number },
  color: string,
  bgColor: string
): void {
  // Small semicircular arc — clear the line with bg, then draw arc
  g.append('circle')
    .attr('cx', hop.x)
    .attr('cy', hop.y)
    .attr('r', HOP_RADIUS)
    .attr('fill', bgColor)
    .attr('stroke', 'none');

  g.append('path')
    .attr(
      'd',
      `M ${hop.x - HOP_RADIUS} ${hop.y} A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 1 ${hop.x + HOP_RADIUS} ${hop.y}`
    )
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', EDGE_STROKE_WIDTH);
}

// ── Main render function ──────────────────────────────────

export interface BLRenderOptionsV2 {
  onClickItem?: (lineNumber: number) => void;
  exportDims?: { width?: number; height?: number };
  activeTagGroup?: string | null;
  hiddenTagValues?: Map<string, Set<string>>;
}

export function renderBoxesAndLinesV2(
  container: HTMLDivElement,
  parsed: ParsedBoxesAndLines,
  layout: BLLayoutResultV2,
  palette: PaletteColors,
  isDark: boolean,
  options?: BLRenderOptionsV2
): void {
  const { onClickItem, exportDims, activeTagGroup, hiddenTagValues } =
    options ?? {};
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const activeGroup = resolveActiveTagGroup(
    parsed.tagGroups,
    parsed.options['active-tag'],
    activeTagGroup
  );

  const hidden = hiddenTagValues ?? parsed.initialHiddenTagValues;

  const nodeMap = new Map<string, BLNode>();
  for (const node of parsed.nodes) nodeMap.set(node.label, node);

  const layoutNodeMap = new Map<string, BLLayoutNodeV2>();
  for (const ln of layout.nodes) layoutNodeMap.set(ln.label, ln);

  // Build edge-to-node connectivity for hover highlighting
  const nodeEdges = new Map<string, number[]>();
  for (let i = 0; i < layout.edges.length; i++) {
    const e = layout.edges[i];
    if (!nodeEdges.has(e.source)) nodeEdges.set(e.source, []);
    if (!nodeEdges.has(e.target)) nodeEdges.set(e.target, []);
    nodeEdges.get(e.source)!.push(i);
    nodeEdges.get(e.target)!.push(i);
  }

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

  // Title — generous separation
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

  // Main diagram group
  const diagramG = svg
    .append('g')
    .attr('class', 'bl-v2-diagram')
    .attr('transform', `translate(${offsetX},${offsetY}) scale(${scale})`);

  // Collect edge colors
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

  // ── Render groups (bottom layer, largest first) ──
  const sortedGroups = [...layout.groups].sort(
    (a, b) => b.width * b.height - a.width * a.height
  );

  for (const group of sortedGroups) {
    const groupG = diagramG
      .append('g')
      .attr(
        'class',
        group.collapsed ? 'bl-v2-group bl-v2-group-collapsed' : 'bl-v2-group'
      )
      .attr('data-line-number', String(group.lineNumber))
      .attr('data-node-id', group.label)
      .attr('data-group-toggle', group.label)
      .style('cursor', 'pointer');

    if (group.collapsed) {
      const fillColor = isDark ? palette.surface : palette.bg;
      const strokeColor = palette.border;

      groupG
        .append('rect')
        .attr('x', group.x)
        .attr('y', group.y)
        .attr('width', group.width)
        .attr('height', group.height)
        .attr('rx', NODE_RX)
        .attr('ry', NODE_RX)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', NODE_STROKE_WIDTH);

      const clipId = `bl-v2-clip-${group.label.replace(/[[\]\s]/g, '')}`;
      groupG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', group.x)
        .attr('y', group.y)
        .attr('width', group.width)
        .attr('height', group.height)
        .attr('rx', NODE_RX);
      groupG
        .append('rect')
        .attr('x', group.x)
        .attr('y', group.y + group.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', group.width)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', strokeColor)
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'bl-v2-collapse-bar');

      groupG
        .append('text')
        .attr('class', 'bl-v2-group-label')
        .attr('x', group.x + group.width / 2)
        .attr('y', group.y + group.height / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', GROUP_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', palette.text)
        .text(group.label);
    } else {
      // Different shading intensity per nesting level
      const nestAlpha = Math.max(20, 40 - group.nestingLevel * 10);
      groupG
        .append('rect')
        .attr('x', group.x)
        .attr('y', group.y)
        .attr('width', group.width)
        .attr('height', group.height)
        .attr('rx', GROUP_RX)
        .attr('ry', GROUP_RX)
        .attr('fill', mix(palette.surface, palette.bg, nestAlpha))
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.35)
        .attr('stroke-dasharray', group.nestingLevel > 0 ? '4,2' : 'none');

      groupG
        .append('text')
        .attr('class', 'bl-v2-group-label')
        .attr('x', group.x + group.width / 2)
        .attr('y', group.y + 18)
        .attr('text-anchor', 'middle')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', GROUP_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', palette.text)
        .text(group.label);
    }
  }

  // ── Render edges ────────────────────────────────────────
  const labelPositions: {
    x: number;
    y: number;
    width: number;
    height: number;
    idx: number;
  }[] = [];

  const edgeGroupElements = new Map<number, D3G>();

  for (let i = 0; i < layout.edges.length; i++) {
    const le = layout.edges[i];
    const color = edgeColorMap.get(i) ?? palette.textMuted;

    // Check if hidden by tag filter
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

    const edgeG = diagramG
      .append('g')
      .attr('class', 'bl-v2-edge-group')
      .attr('data-line-number', String(le.lineNumber))
      .attr('data-edge-index', String(i));
    edgeGroupElements.set(i, edgeG as unknown as D3G);

    const markerId = `bl-v2-arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

    // Render using pre-computed smoothPath
    const path = edgeG
      .append('path')
      .attr('class', 'bl-v2-edge')
      .attr('d', le.smoothPath)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('marker-end', `url(#${markerId})`);

    if (le.bidirectional) {
      const revId = `bl-v2-arrow-rev-${color.replace('#', '')}`;
      path.attr('marker-start', `url(#${revId})`);
    }

    // Render crossing hops
    for (const hop of le.hops) {
      renderHop(edgeG as unknown as D3G, hop, color, palette.bg);
    }

    // Edge label position — geometric midpoint along path length
    if (le.label && le.routedPath.length >= 2) {
      // Compute cumulative distances to find true midpoint
      let totalLen = 0;
      const segLens: number[] = [];
      for (let si = 0; si < le.routedPath.length - 1; si++) {
        const dx = le.routedPath[si + 1].x - le.routedPath[si].x;
        const dy = le.routedPath[si + 1].y - le.routedPath[si].y;
        const sl = Math.sqrt(dx * dx + dy * dy);
        segLens.push(sl);
        totalLen += sl;
      }
      const halfLen = totalLen / 2;
      let accum = 0;
      let lx = le.routedPath[0].x;
      let ly = le.routedPath[0].y;
      for (let si = 0; si < segLens.length; si++) {
        if (accum + segLens[si] >= halfLen) {
          const t = segLens[si] > 0 ? (halfLen - accum) / segLens[si] : 0;
          lx =
            le.routedPath[si].x +
            t * (le.routedPath[si + 1].x - le.routedPath[si].x);
          ly =
            le.routedPath[si].y +
            t * (le.routedPath[si + 1].y - le.routedPath[si].y);
          break;
        }
        accum += segLens[si];
      }
      const lw = le.label.length * EDGE_LABEL_FONT_SIZE * CHAR_WIDTH_RATIO;

      // Short edge: shift label outside midpoint
      const edgeLen = Math.sqrt(
        (le.routedPath[0].x - le.routedPath[le.routedPath.length - 1].x) ** 2 +
          (le.routedPath[0].y - le.routedPath[le.routedPath.length - 1].y) ** 2
      );
      const yShift = edgeLen < 80 ? -15 : -10;

      labelPositions.push({
        x: lx,
        y: ly + yShift,
        width: lw + 8,
        height: EDGE_LABEL_FONT_SIZE + 6,
        idx: i,
      });
    }
  }

  // Resolve label overlaps
  resolveEdgeLabelOverlaps(labelPositions);

  // Render edge labels
  for (const lp of labelPositions) {
    const le = layout.edges[lp.idx];
    if (!le.label) continue;

    const edgeG = edgeGroupElements.get(lp.idx);
    const target = edgeG ?? diagramG;

    // Knockout rectangle
    target
      .append('rect')
      .attr('x', lp.x - lp.width / 2)
      .attr('y', lp.y - lp.height / 2)
      .attr('width', lp.width)
      .attr('height', lp.height)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.85);

    // Label text — smaller, lighter (second-class citizen)
    target
      .append('text')
      .attr('x', lp.x)
      .attr('y', lp.y + EDGE_LABEL_FONT_SIZE / 3)
      .attr('text-anchor', 'middle')
      .attr('font-size', EDGE_LABEL_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .text(le.label);
  }

  // ── Render nodes ────────────────────────────────────────
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

    const nodeG = diagramG
      .append('g')
      .attr('class', 'bl-v2-node')
      .attr(
        'transform',
        `translate(${ln.x + ln.width / 2},${ln.y + ln.height / 2})`
      )
      .attr('data-line-number', node.lineNumber)
      .attr('data-node-id', node.label)
      .style('cursor', onClickItem ? 'pointer' : 'default');

    // Tag metadata for legend hover dimming
    for (const [key, val] of Object.entries(node.metadata)) {
      nodeG.attr(`data-tag-${key.toLowerCase()}`, val.toLowerCase());
    }

    if (onClickItem) {
      nodeG.on('click', () => onClickItem(node.lineNumber));
    }

    // Hover highlighting
    if (!exportDims) {
      nodeG.on('mouseenter', () => {
        const connectedEdges = new Set(nodeEdges.get(ln.label) ?? []);
        // Dim all non-connected edges
        diagramG.selectAll('.bl-v2-edge-group').each(function () {
          const el = d3Selection.select(this);
          const idx = parseInt(el.attr('data-edge-index') ?? '-1', 10);
          el.attr('opacity', connectedEdges.has(idx) ? 1 : DIM_OPACITY);
        });
      });
      nodeG.on('mouseleave', () => {
        diagramG.selectAll('.bl-v2-edge-group').attr('opacity', 1);
      });
    }

    // Node rectangle — flat, no shadows
    const x = -ln.width / 2;
    const y = -ln.height / 2;

    nodeG
      .append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', ln.width)
      .attr('height', ln.height)
      .attr('rx', NODE_RX)
      .attr('ry', NODE_RX)
      .attr('fill', colors.fill)
      .attr('stroke', colors.stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Text fitting
    if (node.description) {
      const lineH = NODE_FONT_SIZE * 1.3;
      const gap = 2;
      const totalH = lineH + gap + META_FONT_SIZE;
      const labelY = -totalH / 2 + lineH / 2;
      const descY = labelY + lineH / 2 + gap + META_FONT_SIZE / 2;

      nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', NODE_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', colors.text)
        .text(node.label);

      const maxChars = Math.floor(
        (ln.width - NODE_TEXT_PADDING * 2) / (META_FONT_SIZE * CHAR_WIDTH_RATIO)
      );
      const desc =
        node.description.length > maxChars
          ? node.description.slice(0, maxChars - 1) + '\u2026'
          : node.description;
      const descEl = nodeG
        .append('text')
        .attr('x', 0)
        .attr('y', descY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', META_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(desc);
      if (desc !== node.description) {
        descEl.append('title').text(node.description);
      }
    } else {
      const fitted = fitTextToNode(node.label, ln.width - 16, ln.height);
      const lineH = fitted.fontSize * 1.3;
      const totalH = fitted.lines.length * lineH;
      for (let li = 0; li < fitted.lines.length; li++) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr('y', -totalH / 2 + lineH / 2 + li * lineH)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .attr('fill', colors.text)
          .text(fitted.lines[li]);
      }
    }
  }

  // ── Render legend ───────────────────────────────────────
  if (parsed.tagGroups.length > 0) {
    const legendConfig: LegendConfig = {
      groups: parsed.tagGroups,
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: 'fixed',
    };
    const legendState: LegendState = { activeGroup };
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0,${titleOffset + 4})`);
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      undefined,
      width
    );
    legendG
      .selectAll('[data-legend-group]')
      .classed('bl-v2-legend-group', true);
  }
}

// ── Export renderer ────────────────────────────────────────

export function renderBoxesAndLinesV2ForExport(
  container: HTMLDivElement,
  parsed: ParsedBoxesAndLines,
  layout: BLLayoutResultV2,
  palette: PaletteColors,
  isDark: boolean,
  options?: {
    exportDims?: { width: number; height: number };
    activeTagGroup?: string | null;
    hiddenTagValues?: Map<string, Set<string>>;
  }
): void {
  renderBoxesAndLinesV2(container, parsed, layout, palette, isDark, {
    exportDims: options?.exportDims,
    activeTagGroup: options?.activeTagGroup,
    hiddenTagValues: options?.hiddenTagValues,
  });
}
