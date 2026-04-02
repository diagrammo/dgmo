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
import type { BLLayoutResult, BLLayoutNode, BLLayoutEdge } from './layout';

// ── Constants (aligned with infra pattern) ─────────────────
const DIAGRAM_PADDING = 20;
const NODE_FONT_SIZE = 13;
const MIN_NODE_FONT_SIZE = 9;
const META_FONT_SIZE = 10;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const NODE_RX = 8;
const COLLAPSE_BAR_HEIGHT = 4;
const ARROWHEAD_W = 5;
const ARROWHEAD_H = 4;
const CHAR_WIDTH_RATIO = 0.6;
const NODE_TEXT_PADDING = 12;
const GROUP_RX = 8;
const GROUP_LABEL_FONT_SIZE = 14;

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

const lineGeneratorLinear = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveLinear);

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
  // Untagged fallback (matches infra node styling)
  const fill = mix(palette.bg, palette.text, isDark ? 90 : 95);
  const stroke = mix(palette.text, palette.bg, isDark ? 60 : 40);
  const text = palette.text;
  return { fill, stroke, text };
}

function edgeColor(
  edge: BLLayoutEdge,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  palette: PaletteColors
): string {
  // Only color edges that have explicit tag metadata — otherwise neutral
  const hasTagMeta =
    Object.keys(edge.metadata).length > 0 && activeGroupName != null;
  if (hasTagMeta) {
    const tagColor = resolveTagColor(edge.metadata, tagGroups, activeGroupName);
    if (tagColor) return tagColor;
  }
  return palette.textMuted;
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
}

export function renderBoxesAndLines(
  container: HTMLDivElement,
  parsed: ParsedBoxesAndLines,
  layout: BLLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  options?: BLRenderOptions
): void {
  const { onClickItem, exportDims, activeTagGroup, hiddenTagValues } =
    options ?? {};
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

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
  for (const group of layout.groups) {
    const gx = group.x - group.width / 2;
    const gy = group.y - group.height / 2;

    const groupG = diagramG
      .append('g')
      .attr(
        'class',
        group.collapsed ? 'bl-group bl-group-collapsed' : 'bl-group'
      )
      .attr('data-line-number', String(group.lineNumber))
      .attr('data-node-id', group.label)
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

      // Label centered vertically
      groupG
        .append('text')
        .attr('class', 'bl-group-label')
        .attr('x', group.x)
        .attr('y', group.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', GROUP_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', palette.text)
        .text(group.label);
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
        .attr('fill', mix(palette.surface, palette.bg, 40))
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.35);

      groupG
        .append('text')
        .attr('class', 'bl-group-label')
        .attr('x', gx + group.width / 2)
        .attr('y', gy + 18)
        .attr('text-anchor', 'middle')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', GROUP_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', palette.text)
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

  // Store edge group elements for label pass
  const edgeGroups = new Map<number, D3G>();

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

    const edgeG = diagramG
      .append('g')
      .attr('class', 'bl-edge-group')
      .attr('data-line-number', String(le.lineNumber));
    edgeGroups.set(i, edgeG as unknown as D3G);

    const markerId = `bl-arrow-${color.replace('#', '')}`;
    const gen = le.deferred
      ? lineGeneratorLinear
      : parsed.direction === 'TB'
        ? lineGeneratorTB
        : lineGeneratorLR;
    const path = edgeG
      .append('path')
      .attr('class', 'bl-edge')
      .attr('d', gen(points) ?? '')
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

  // Render edge labels into their edge groups
  for (const lp of labelPositions) {
    const le = layout.edges[lp.idx];
    if (!le.label) continue;

    const edgeG = edgeGroups.get(lp.idx);
    const target = edgeG ?? diagramG;

    target
      .append('rect')
      .attr('x', lp.x - lp.width / 2)
      .attr('y', lp.y - lp.height / 2)
      .attr('width', lp.width)
      .attr('height', lp.height)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.85);

    target
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

    const nodeG = diagramG
      .append('g')
      .attr('class', 'bl-node')
      .attr('transform', `translate(${ln.x},${ln.y})`)
      .attr('data-line-number', node.lineNumber)
      .attr('data-node-id', node.label)
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .style('--bl-node-stroke', colors.stroke);

    // Add tag metadata as data attributes for legend hover dimming
    for (const [key, val] of Object.entries(node.metadata)) {
      nodeG.attr(`data-tag-${key.toLowerCase()}`, val.toLowerCase());
    }

    if (onClickItem) {
      nodeG.on('click', () => onClickItem(node.lineNumber));
    }

    // Rectangle card
    const x = -ln.width / 2;
    const y = -ln.height / 2;

    // Background rect
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

    // All text centered vertically using dominant-baseline: central
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

  // ── Render legend ──────────────────────────────────────
  if (parsed.tagGroups.length > 0) {
    renderLegend(svg, parsed, palette, isDark, activeGroup, width, titleOffset);
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
  titleOffset: number
): void {
  const groupBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);
  const pillBorder = mix(palette.textMuted, palette.bg, 50);

  // ── Pre-compute total legend width for centering ──
  let totalW = 0;
  for (const tg of parsed.tagGroups) {
    const isActive = activeGroup?.toLowerCase() === tg.name.toLowerCase();
    totalW +=
      measureLegendText(tg.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    if (isActive) {
      totalW += 6;
      for (const entry of tg.entries) {
        totalW +=
          LEGEND_DOT_R * 2 +
          LEGEND_ENTRY_DOT_GAP +
          measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) +
          LEGEND_ENTRY_TRAIL;
      }
    }
    totalW += LEGEND_GROUP_GAP;
  }

  const legendX = Math.max(LEGEND_CAPSULE_PAD, (svgWidth - totalW) / 2);
  const legendY = titleOffset + 4;
  const legendG = svg
    .append('g')
    .attr('transform', `translate(${legendX},${legendY})`);

  let x = 0;

  // ── Tag group pills (collapsed when inactive, expanded when active) ──
  for (const tg of parsed.tagGroups) {
    const isActiveGroup = activeGroup?.toLowerCase() === tg.name.toLowerCase();

    const groupG = legendG
      .append('g')
      .attr('class', 'bl-legend-group')
      .attr('data-legend-group', tg.name.toLowerCase())
      .style('cursor', 'pointer');

    // Group name pill
    const nameW =
      measureLegendText(tg.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    const tagPill = groupG
      .append('rect')
      .attr('x', x)
      .attr('y', 0)
      .attr('width', nameW)
      .attr('height', LEGEND_HEIGHT)
      .attr('rx', LEGEND_HEIGHT / 2)
      .attr('fill', groupBg);

    if (isActiveGroup) {
      tagPill.attr('stroke', pillBorder).attr('stroke-width', 0.75);
    }

    groupG
      .append('text')
      .attr('x', x + nameW / 2)
      .attr('y', LEGEND_HEIGHT / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('font-weight', 500)
      .attr('fill', isActiveGroup ? palette.text : palette.textMuted)
      .attr('pointer-events', 'none')
      .text(tg.name);

    x += nameW;

    // Entries — only rendered when this group is active
    if (isActiveGroup) {
      x += 6;
      for (const entry of tg.entries) {
        const entryColor = entry.color || palette.textMuted;
        const ew = measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE);

        const entryG = groupG
          .append('g')
          .attr('data-legend-entry', entry.value.toLowerCase())
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
          .attr('y', LEGEND_HEIGHT / 2)
          .attr('dominant-baseline', 'central')
          .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(entry.value);

        x += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + ew + LEGEND_ENTRY_TRAIL;
      }
    }

    x += LEGEND_GROUP_GAP;
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
