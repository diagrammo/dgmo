// ============================================================
// Boxes and Lines Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import { renderLegendD3 } from '../utils/legend-d3';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
  LegendGroupData,
  ControlsGroupToggle,
} from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { resolveTagColor } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import { renderInlineText } from '../utils/inline-markdown';
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';
import type { ParsedBoxesAndLines, BLNode } from './types';
import type { BLLayoutResult, BLLayoutNode, BLLayoutEdge } from './layout';
import { ScaleContext } from '../utils/scaling';
import {
  CHAR_WIDTH_RATIO,
  measureText,
  truncateText,
} from '../utils/text-measure';

// ── Constants (aligned with infra pattern) ─────────────────
const DIAGRAM_PADDING = 20;
// Box labels run smaller than the 13px org/infra use — boxes-and-lines nodes are
// narrower (~97px), so a smaller label fits more text per line before wrapping.
const NODE_FONT_SIZE = 11;
const MIN_NODE_FONT_SIZE = 9;
const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const NODE_RX = 8;
const COLLAPSE_BAR_HEIGHT = 4;
const ARROWHEAD_W = 5;
const ARROWHEAD_H = 4;
const DESC_FONT_SIZE = 10; // matches infra META_FONT_SIZE
const DESC_LINE_HEIGHT = 1.4; // 14px row height at 10px font (matches infra META_LINE_HEIGHT)
const MAX_DESC_LINES = 6;
const NODE_TEXT_PADDING = 12;
const GROUP_RX = 8;
const GROUP_LABEL_FONT_SIZE = 14;
const GROUP_LABEL_ZONE = 32;
// % tint floor so the ramp minimum still reads as "low, present" (mirror map).
const RAMP_FLOOR = 15;
const VALUE_FONT_SIZE = 11;

type D3G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;
type D3Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

// ── Edge path generators ───────────────────────────────────
const lineGeneratorLR = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

const lineGeneratorTB = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

// ── Text fitting ───────────────────────────────────────────

function splitCamelCase(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    // In-bounds by loop guard (i >= 1 and i < word.length).
    const prev = word[i - 1]!;
    const curr = word[i]!;
    const next = i + 1 < word.length ? word[i + 1]! : '';
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

/**
 * Fit a label into a header zone for described nodes.
 * Strategy: split first (spaces, dashes, camelCase), wrap into lines,
 * shrink font if needed, truncate individual lines with "…" — never hard-break.
 */
function fitLabelToHeader(
  label: string,
  nodeWidth: number,
  maxLines: number
): { lines: string[]; fontSize: number } {
  const maxTextWidth = nodeWidth - NODE_TEXT_PADDING * 2;

  // Split on spaces and dashes, then camelCase split each part
  const rawParts = label.split(/(\s+|-)/);
  const words: string[] = [];
  for (const part of rawParts) {
    if (!part || /^\s+$/.test(part) || part === '-') continue;
    words.push(...splitCamelCase(part));
  }

  for (
    let fontSize = NODE_FONT_SIZE;
    fontSize >= MIN_NODE_FONT_SIZE;
    fontSize--
  ) {
    if (maxTextWidth < measureText('MM', fontSize)) continue;

    // Wrap words into lines (greedy, by measured pixel width)
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (measureText(test, fontSize) <= maxTextWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);

    const fits = (l: string): boolean =>
      measureText(l, fontSize) <= maxTextWidth;

    // All lines fit at this font? Done.
    if (lines.length <= maxLines && lines.every(fits)) {
      return { lines, fontSize };
    }

    // Lines fit in count but some are too wide? Truncate those lines.
    if (lines.length <= maxLines) {
      const result = lines.map((l) =>
        fits(l) ? l : truncateText(l, fontSize, maxTextWidth)
      );
      return { lines: result, fontSize };
    }

    // Too many lines — take first maxLines, truncate last + any oversized
    const result = lines
      .slice(0, maxLines)
      .map((l) => (fits(l) ? l : truncateText(l, fontSize, maxTextWidth)));
    // In-bounds: result has exactly maxLines entries (from .slice(0, maxLines)).
    const last = result[maxLines - 1]!;
    if (!last.endsWith('\u2026')) {
      result[maxLines - 1] = truncateText(
        last + '\u2026',
        fontSize,
        maxTextWidth
      );
    }
    return { lines: result, fontSize };
  }

  // Fallback at min font
  const truncated = truncateText(label, MIN_NODE_FONT_SIZE, maxTextWidth);
  return { lines: [truncated], fontSize: MIN_NODE_FONT_SIZE };
}

// ── Color helpers ──────────────────────────────────────────

function nodeColors(
  node: BLNode,
  tagGroups: readonly TagGroup[],
  activeGroupName: string | null,
  palette: PaletteColors,
  isDark: boolean,
  value: {
    active: boolean;
    hue: string;
    fillForValue: (v: number) => string;
  },
  solid?: boolean
): { fill: string; stroke: string; text: string } {
  // Untagged-neutral fill, reused by the value path for no-value boxes.
  const neutralFill = mix(palette.bg, palette.text, isDark ? 90 : 95);
  // Value dimension active: choropleth tint by the node's value, neutral when a
  // box has no value (mirror map: `value !== undefined ? fillForValue : neutral`).
  if (value.active) {
    const fill =
      node.value !== undefined ? value.fillForValue(node.value) : neutralFill;
    // Stroke = the ramp hue (NOT a tag color — there may be none); a present
    // stroke is required for the app's --bl-node-stroke hover-dim to work.
    const stroke = value.hue;
    const text = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    return { fill, stroke, text };
  }
  const tagColor = resolveTagColor(
    node.metadata,
    [...tagGroups],
    activeGroupName
  );
  if (tagColor) {
    const fill = shapeFill(palette, tagColor, isDark, {
      ...(solid !== undefined && { solid }),
    });
    const stroke = tagColor;
    const text = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    return { fill, stroke, text };
  }
  // Untagged fallback (subtle-neutral — out of scope per TD-2 / F2;
  // intentionally near-invisible so default nodes recede).
  const fill = mix(palette.bg, palette.text, isDark ? 90 : 95);
  const stroke = mix(palette.text, palette.bg, isDark ? 60 : 40);
  const text = palette.text;
  return { fill, stroke, text };
}

function edgeColor(
  edge: BLLayoutEdge,
  tagGroups: readonly TagGroup[],
  activeGroupName: string | null,
  palette: PaletteColors
): string {
  // Only color edges that have explicit tag metadata — otherwise neutral
  const hasTagMeta =
    Object.keys(edge.metadata).length > 0 && activeGroupName != null;
  if (hasTagMeta) {
    const tagColor = resolveTagColor(
      edge.metadata,
      [...tagGroups],
      activeGroupName
    );
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
        // In-bounds by loop guard.
        const a = labels[i]!;
        const b = labels[j]!;
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

interface BLRenderOptions {
  onClickItem?: (lineNumber: number) => void;
  exportDims?: { width?: number; height?: number };
  activeTagGroup?: string | null;
  hiddenTagValues?: Map<string, Set<string>>;
  hideDescriptions?: boolean;
  controlsExpanded?: boolean;
  onToggleDescriptions?: (active: boolean) => void;
  onToggleControlsExpand?: () => void;
  exportMode?: boolean;
  /** When 'app', the description toggle is hosted by the app overlay strip
   *  (inline gear suppressed, controls row + anchor reserved). */
  controlsHost?: 'app' | 'inline';
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
    hideDescriptions,
    controlsExpanded,
    onToggleDescriptions,
    onToggleControlsExpand,
    exportMode = false,
    controlsHost,
  } = options ?? {};
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const sctx = ScaleContext.identity();

  const sDiagramPadding = sctx.aesthetic(DIAGRAM_PADDING);
  const sMinNodeFontSize = sctx.text(MIN_NODE_FONT_SIZE);
  const sEdgeLabelFontSize = sctx.text(EDGE_LABEL_FONT_SIZE);
  const sEdgeStrokeWidth = sctx.structural(EDGE_STROKE_WIDTH);
  const sNodeStrokeWidth = sctx.structural(NODE_STROKE_WIDTH);
  const sCollapseBarHeight = sctx.structural(COLLAPSE_BAR_HEIGHT);
  const sDescFontSize = sctx.text(DESC_FONT_SIZE);
  const sGroupLabelFontSize = sctx.text(GROUP_LABEL_FONT_SIZE);
  const sGroupLabelZone = sctx.structural(GROUP_LABEL_ZONE);
  const sTitleFontSize = sctx.text(TITLE_FONT_SIZE);
  const sTitleY = sctx.structural(TITLE_Y);

  // ── Value ramp + active-dimension resolution (mirror of map's value model) ──
  // The ramp is computed in the renderer (architectural divergence from the
  // map, which precomputes in layout) — node sizes are value-independent, and
  // this file already owns all colouring + the legend build. Hoisted ONCE
  // before the node loop so `fillForValue` is not recomputed per node.
  const nodeValues = parsed.nodes
    .filter((n) => n.value !== undefined)
    .map((n) => n.value!);
  const hasRamp = nodeValues.length > 0;
  const allNonNegative = hasRamp && nodeValues.every((v) => v >= 0);
  const rampMin = allNonNegative ? 0 : Math.min(...nodeValues);
  const rampMax = Math.max(...nodeValues);
  // Default hue = palette.primary (NOT red like the map — boxes have no water to
  // stand out against, and red reads as alarm on a neutral metric). A trailing
  // color on `box-metric` overrides.
  const rampHue =
    resolveColor(parsed.boxMetricColor ?? '', palette) ?? palette.primary;
  // Lift the ramp anchor off the near-black surface on dark themes so the
  // lowest values read as a clear muted tint rather than sinking to the surface.
  const rampBase = isDark ? mix(palette.surface, palette.text, 28) : palette.bg;
  const fillForValue = (v: number): string => {
    const t = rampMax > rampMin ? (v - rampMin) / (rampMax - rampMin) : 1;
    const pct = RAMP_FLOOR + Math.max(0, Math.min(1, t)) * (100 - RAMP_FLOOR);
    return mix(rampHue, rampBase, pct);
  };
  const VALUE_NAME = hasRamp ? parsed.boxMetric?.trim() || 'Value' : null;

  // Local active-dimension resolver — mirror map's inline matchColorGroup /
  // activeIsScore. Do NOT extend the shared resolveActiveTagGroup (it has a
  // fixed 3-arg signature consumed by 7 chart types). On a name collision
  // between a tag group and the metric label, the tag group wins (AC9).
  const matchColorGroup = (v: string): string | null => {
    const lv = v.trim().toLowerCase();
    if (lv === '' || lv === 'none') return null;
    const tg = parsed.tagGroups.find((g) => g.name.toLowerCase() === lv);
    if (tg) return tg.name;
    if (lv === VALUE_NAME?.toLowerCase()) return VALUE_NAME;
    return v; // unknown name passes through → renders neutral
  };
  const override = activeTagGroup; // string | null | undefined
  let activeGroup: string | null;
  if (override !== undefined) {
    activeGroup = override === null ? null : matchColorGroup(override);
  } else if (parsed.options['active-tag'] !== undefined) {
    activeGroup = matchColorGroup(parsed.options['active-tag']);
  } else {
    // Default-active dimension: value ramp when any box has a value, else the
    // first declared tag group, else none.
    activeGroup =
      VALUE_NAME ??
      (parsed.tagGroups.length > 0 ? parsed.tagGroups[0]!.name : null);
  }
  const activeIsValue = VALUE_NAME !== null && activeGroup === VALUE_NAME;

  // Synthetic legend group for the value ramp (empty entries + gradient),
  // prepended to the tag groups handed to renderLegendD3 — exactly like the
  // map's VALUE_NAME group. The shared legend infra renders the gradient capsule
  // ONLY when it is the active group (legendState.activeGroup === its name).
  const valueGroup: LegendGroupData | null =
    VALUE_NAME !== null
      ? {
          name: VALUE_NAME,
          entries: [],
          gradient: {
            min: rampMin,
            max: rampMax,
            hue: rampHue,
            base: rampBase,
          },
        }
      : null;
  const legendGroups: readonly LegendGroupData[] = [
    ...(valueGroup ? [valueGroup] : []),
    ...parsed.tagGroups,
  ];

  // Reserve legend height only when a legend will actually render. App-hosted
  // controls move the Descriptions toggle to the app overlay, so a
  // descriptions-only chart (no tag groups) reserves nothing.
  const reserveHasDescriptions = parsed.nodes.some(
    (n) => n.description && n.description.length > 0
  );
  const willRenderLegend =
    legendGroups.length > 0 ||
    (reserveHasDescriptions && controlsHost !== 'app');
  const sLegendHeight = willRenderLegend
    ? sctx.structural(
        getMaxLegendReservedHeight(
          {
            groups: legendGroups,
            position: { placement: 'top-center', titleRelation: 'below-title' },
            mode: exportMode ? 'export' : 'preview',
          },
          width
        )
      )
    : 0;

  // Build hidden set
  const hidden = hiddenTagValues ?? parsed.initialHiddenTagValues;

  // Build node lookup
  const nodeMap = new Map<string, BLNode>();
  for (const node of parsed.nodes) nodeMap.set(node.label, node);

  // Build layout node lookup
  const layoutNodeMap = new Map<string, BLLayoutNode>();
  for (const ln of layout.nodes) layoutNodeMap.set(ln.label, ln);

  // Compute diagram bounds for scaling
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const titleOffset = showTitle ? 40 : 0;
  const hasAnyDescriptions = parsed.nodes.some(
    (n) => n.description && n.description.length > 0
  );
  const needsLegend =
    legendGroups.length > 0 || (hasAnyDescriptions && onToggleDescriptions);
  const legendH = needsLegend ? sLegendHeight + 8 : 0;

  const groupLabelsSet = new Set(layout.groups.map((g) => g.label));
  let labelZoneExtension = 0;
  for (const group of parsed.groups) {
    if (group.children.some((c) => groupLabelsSet.has(c))) {
      labelZoneExtension += sGroupLabelZone;
    }
  }

  const contentW = layout.width;
  const contentH = layout.height + titleOffset + legendH + labelZoneExtension;

  const scaleX = width / (contentW + sDiagramPadding * 2);
  const scaleY = height / (contentH + sDiagramPadding * 2);
  const scale = Math.min(scaleX, scaleY, 3);

  const offsetX = (width - contentW * scale) / 2;
  const offsetY = sDiagramPadding + titleOffset + legendH;

  const svg: D3Svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY)
    .style('background', palette.bg);

  if (sctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const defs = svg.append('defs');

  if (showTitle) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', sTitleY)
      .attr('text-anchor', 'middle')
      .attr('font-size', sTitleFontSize)
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
      // In-bounds by loop guard.
      layout.edges[i]!,
      parsed.tagGroups,
      activeGroup,
      palette
    );
    arrowColors.add(c);
    edgeColorMap.set(i, c);
  }
  ensureArrowMarkers(defs, arrowColors);

  // ── Render groups (bottom layer, largest first for nesting) ──
  const sortedGroups = [...layout.groups].sort(
    (a, b) => b.width * b.height - a.width * a.height
  );
  // Identify groups that contain sub-groups — only those need extra label space
  const groupLabels = new Set(layout.groups.map((g) => g.label));
  const hasSubGroups = new Set<string>();
  for (const group of parsed.groups) {
    for (const child of group.children) {
      if (groupLabels.has(child)) hasSubGroups.add(group.label);
    }
  }

  for (const group of sortedGroups) {
    const gx = group.x - group.width / 2;
    // Only extend top for groups that contain sub-groups (dagre under-pads these)
    const needsExtra = !group.collapsed && hasSubGroups.has(group.label);
    const gy = needsExtra
      ? group.y - group.height / 2 - sGroupLabelZone
      : group.y - group.height / 2;
    const groupHeight = needsExtra
      ? group.height + sGroupLabelZone
      : group.height;

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
        .attr('stroke-width', sNodeStrokeWidth);

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
        .attr('y', gy + group.height - sCollapseBarHeight)
        .attr('width', group.width)
        .attr('height', sCollapseBarHeight)
        .attr('fill', strokeColor)
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'bl-collapse-bar');

      const maxLabelLines = Math.max(
        2,
        Math.floor((group.height - 16) / (sMinNodeFontSize * 1.3))
      );
      const fitted = fitLabelToHeader(group.label, group.width, maxLabelLines);
      const lineH = fitted.fontSize * 1.3;
      const totalH = fitted.lines.length * lineH;
      for (let li = 0; li < fitted.lines.length; li++) {
        groupG
          .append('text')
          .attr('class', 'bl-group-label')
          .attr('x', group.x)
          .attr('y', group.y - totalH / 2 + lineH / 2 + li * lineH)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .attr('fill', palette.text)
          // In-bounds by loop guard.
          .text(fitted.lines[li]!);
      }
    } else {
      // Expanded: background container with label
      groupG
        .append('rect')
        .attr('x', gx)
        .attr('y', gy)
        .attr('width', group.width)
        .attr('height', groupHeight)
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
        .attr('font-size', sGroupLabelFontSize)
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
    // In-bounds by loop guard.
    const le = layout.edges[i]!;
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

    // Self-loop: render as a smooth circular arc below the node
    if (le.source === le.target) {
      const nodeLayout = layoutNodeMap.get(le.source);
      if (nodeLayout) {
        const edgeG = diagramG
          .append('g')
          .attr('class', 'bl-edge-group')
          .attr('data-line-number', String(le.lineNumber));
        edgeGroups.set(i, edgeG as unknown as D3G);

        const markerId = `bl-arrow-${color.replace('#', '')}`;
        const cx = nodeLayout.x;
        const cy = nodeLayout.y;
        const hw = nodeLayout.width / 2;
        const hh = nodeLayout.height / 2;
        const pad = 20; // clearance from node edge

        // Arc exits from bottom of right side, swings wide, returns to right of bottom side
        const startX = cx + hw;
        const startY = cy + hh * 0.4;
        const endX = cx + hw * 0.4;
        const endY = cy + hh;

        // Control points swing far out to create a smooth circular arc
        const cp1x = startX + hw + pad;
        const cp1y = startY;
        const cp2x = endX;
        const cp2y = endY + hh + pad;

        edgeG
          .append('path')
          .attr('class', 'bl-edge')
          .attr(
            'd',
            `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`
          )
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', sEdgeStrokeWidth)
          .attr('marker-end', `url(#${markerId})`);
      }
      continue;
    }

    // Parallel edge fan: construct explicit 5-point geometry so lines
    // bundle at ports and visibly spread apart in the middle.
    let points: { x: number; y: number }[];
    if (le.yOffset !== 0 && le.parallelCount > 1) {
      const srcLayout = layoutNodeMap.get(le.source);
      const tgtLayout = layoutNodeMap.get(le.target);
      const srcY = srcLayout?.y ?? le.points[0]?.y ?? 0;
      const tgtY = tgtLayout?.y ?? le.points[le.points.length - 1]?.y ?? 0;
      const srcX = le.points[0]?.x ?? 0;
      const tgtX = le.points[le.points.length - 1]?.x ?? 0;
      const midX = (srcX + tgtX) / 2;
      const midY = (srcY + tgtY) / 2;

      points = [
        { x: srcX, y: srcY }, // port (bundled)
        { x: srcX + (midX - srcX) * 0.3, y: srcY + le.yOffset * 0.5 }, // separate
        { x: midX, y: midY + le.yOffset }, // full spread
        { x: tgtX - (tgtX - midX) * 0.3, y: tgtY + le.yOffset * 0.5 }, // converge
        { x: tgtX, y: tgtY }, // port (bundled)
      ];
    } else {
      points = le.points.map((p) => ({ x: p.x, y: p.y }));
    }
    if (points.length < 2) continue;

    const edgeG = diagramG
      .append('g')
      .attr('class', 'bl-edge-group')
      .attr('data-line-number', String(le.lineNumber));
    edgeGroups.set(i, edgeG as unknown as D3G);

    const markerId = `bl-arrow-${color.replace('#', '')}`;
    const gen = parsed.direction === 'TB' ? lineGeneratorTB : lineGeneratorLR;
    const path = edgeG
      .append('path')
      .attr('class', 'bl-edge')
      .attr('d', gen(points) ?? '')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', sEdgeStrokeWidth)
      .attr('marker-end', `url(#${markerId})`);

    if (le.bidirectional) {
      const revId = `bl-arrow-rev-${color.replace('#', '')}`;
      path.attr('marker-start', `url(#${revId})`);
    }

    // Edge label — for parallel edges, place relative to each line:
    // negative offset (top line) → label above, zero → on line, positive → below
    if (le.label && le.labelX != null && le.labelY != null) {
      const lw = measureText(le.label, sEdgeLabelFontSize);
      const labelH = sEdgeLabelFontSize + 6;
      let ly: number;
      if (le.parallelCount > 1 && le.yOffset !== 0) {
        // Position label on the line at midpoint, shifted above/below based on offset sign
        const lineY = le.labelY + 10 + le.yOffset; // +10 to undo the -10 in layout
        const labelShift = le.yOffset < 0 ? -labelH : labelH;
        ly = lineY + labelShift * 0.5;
      } else {
        ly = le.labelY + le.yOffset;
      }
      labelPositions.push({
        x: le.labelX,
        y: ly,
        width: lw + 8,
        height: labelH,
        idx: i,
      });
    }
  }

  // Resolve overlaps
  resolveEdgeLabelOverlaps(labelPositions);

  // Render edge labels into their edge groups
  for (const lp of labelPositions) {
    // In-bounds: lp.idx was set from a valid index into layout.edges above.
    const le = layout.edges[lp.idx]!;
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
      .attr('y', lp.y + sEdgeLabelFontSize / 3)
      .attr('text-anchor', 'middle')
      .attr('font-size', sEdgeLabelFontSize)
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
      isDark,
      { active: activeIsValue, hue: rampHue, fillForValue },
      parsed.options['solid-fill'] === 'on'
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

    // Numeric value drives the gradient scrub; guard on !== undefined so a
    // legitimate `value: 0` still emits data-value="0" (0 is falsy).
    if (node.value !== undefined) {
      nodeG.attr('data-value', node.value);
    }

    if (onClickItem) {
      nodeG.on('click', (event: Event) => {
        // Don't intercept clicks on links in description text
        const target = event.target as Element | null;
        if (target?.closest('a')) return;
        onClickItem(node.lineNumber);
      });
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
      .attr('stroke-width', sNodeStrokeWidth);

    // All text centered vertically using dominant-baseline: central
    const desc = node.description;
    if (desc && desc.length > 0 && !hideDescriptions) {
      const MAX_LABEL_LINES = 3;
      const fitted = fitLabelToHeader(node.label, ln.width, MAX_LABEL_LINES);
      const labelLines = fitted.lines;
      const labelLineH = fitted.fontSize * 1.3;
      const labelTotalH = labelLines.length * labelLineH;
      const headerH = labelTotalH + 12;
      const headerCenterY = -ln.height / 2 + headerH / 2;
      for (let li = 0; li < labelLines.length; li++) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr(
            'y',
            headerCenterY - labelTotalH / 2 + labelLineH / 2 + li * labelLineH
          )
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .attr('fill', colors.text)
          // In-bounds by loop guard.
          .text(labelLines[li]!);
      }

      // Separator line (full width, matches infra style)
      const sepY = -ln.height / 2 + headerH;
      nodeG
        .append('line')
        .attr('x1', -ln.width / 2)
        .attr('y1', sepY)
        .attr('x2', ln.width / 2)
        .attr('y2', sepY)
        .attr('stroke', colors.stroke)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);

      const descStartY = sepY + 4 + sDescFontSize;
      const maxTextWidth = ln.width - NODE_TEXT_PADDING * 2;
      // Char budget for the shared (char-based) bullet-aware wrapper. Derived
      // from the shared average glyph ratio so it stays in step with the
      // pixel measurer used everywhere else here.
      const charsPerLine = Math.floor(
        maxTextWidth / (sDescFontSize * CHAR_WIDTH_RATIO)
      );
      const descLineH = sDescFontSize * DESC_LINE_HEIGHT;

      // Estimate display length — strip markdown syntax for measurement
      const displayLen = (text: string): number =>
        text
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
          .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** → bold
          .replace(/\*(.+?)\*/g, '$1') // *italic* → italic
          .replace(/`(.+?)`/g, '$1') // `code` → code
          .replace(/https?:\/\/\S+/g, (u) => u.slice(0, 20)).length; // bare URLs shortened

      // Build wrapped lines from description. Convert "- " to bullet glyph
      // and let the shared helper split bullet lines into first/cont rows
      // so continuation text aligns under the bullet body, not the glyph.
      const normalizedLines: string[] = [];
      for (const descLine of desc) {
        let normalized = descLine.startsWith('- ')
          ? '\u2022 ' + descLine.slice(2)
          : descLine;
        // Normalize bare URLs: `http example.com` → `http://example.com`
        normalized = normalized.replace(
          /\bhttps?\s+([\w][\w.-]+\.[a-z]{2,}(?:\/\S*)?)/gi,
          (_, domain) => `https://${domain}`
        );
        normalizedLines.push(normalized);
      }

      const wrappedLinesShared: WrappedDescLine[] = wrapDescriptionLines(
        normalizedLines,
        charsPerLine,
        displayLen
      );

      const truncated = wrappedLinesShared.length > MAX_DESC_LINES;
      const visibleLines = truncated
        ? wrappedLinesShared.slice(0, MAX_DESC_LINES)
        : wrappedLinesShared;

      // Bullet glyph at the description's left edge; body text indented so
      // continuation lines align under the first word past the bullet.
      const BULLET_GLYPH_X = -ln.width / 2 + 6;
      const BULLET_BODY_X = BULLET_GLYPH_X + 10;

      for (let li = 0; li < visibleLines.length; li++) {
        // In-bounds by loop guard.
        const line = visibleLines[li]!;
        let lineText = line.text;
        // Truncate last line if there are more lines beyond the cap
        if (truncated && li === visibleLines.length - 1) {
          lineText =
            measureText(lineText, sDescFontSize) >= maxTextWidth
              ? truncateText(lineText, sDescFontSize, maxTextWidth)
              : lineText + '\u2026';
        }
        const y = descStartY + li * descLineH;
        if (line.kind === 'bullet-first') {
          nodeG
            .append('text')
            .attr('x', BULLET_GLYPH_X)
            .attr('y', y)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'central')
            .attr('font-size', sDescFontSize)
            .attr('fill', palette.textMuted)
            .text('\u2022');
        }
        const isBullet =
          line.kind === 'bullet-first' || line.kind === 'bullet-cont';
        const textEl = nodeG
          .append('text')
          .attr('x', isBullet ? BULLET_BODY_X : 0)
          .attr('y', y)
          .attr('text-anchor', isBullet ? 'start' : 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', DESC_FONT_SIZE)
          .attr('fill', palette.textMuted);
        renderInlineText(textEl, lineText, palette, sDescFontSize);
      }

      // Tooltip when truncated
      if (truncated) {
        const fullText = desc.join(' ');
        const tooltipText =
          fullText.length > 200 ? fullText.slice(0, 199) + '\u2026' : fullText;
        nodeG.append('title').text(tooltipText);
      }
    } else if (parsed.showValues && node.value !== undefined) {
      // Plain node with show-values: label header + thin divider + a
      // "Metric: value" line below (org/infra card style), instead of a
      // vertically-centered label with a floating number.
      const valueLabel = parsed.boxMetric
        ? `${parsed.boxMetric}: ${node.value}`
        : String(node.value);
      // Fixed header zone (not label-height-driven) so the divider sits at a
      // UNIFORM Y across every box, regardless of label line count (infra/org
      // both anchor the separator to a constant header height).
      const headerH = ln.height / 2;
      const sepY = -ln.height / 2 + headerH;
      const fitted = fitLabelToHeader(node.label, ln.width, 2);
      const labelLineH = fitted.fontSize * 1.3;
      const labelTotalH = fitted.lines.length * labelLineH;
      const headerCenterY = -ln.height / 2 + headerH / 2;
      for (let li = 0; li < fitted.lines.length; li++) {
        nodeG
          .append('text')
          .attr('x', 0)
          .attr(
            'y',
            headerCenterY - labelTotalH / 2 + labelLineH / 2 + li * labelLineH
          )
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', fitted.fontSize)
          .attr('font-weight', '600')
          .attr('fill', colors.text)
          // In-bounds by loop guard.
          .text(fitted.lines[li]!);
      }
      // Thin divider under the title — a tint of the box's own stroke colour
      // (matches org / infra card separators), not a neutral text line.
      nodeG
        .append('line')
        .attr('x1', -ln.width / 2)
        .attr('y1', sepY)
        .attr('x2', ln.width / 2)
        .attr('y2', sepY)
        .attr('stroke', colors.stroke)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);
      // "Metric: value" centered in the space below the divider.
      nodeG
        .append('text')
        .attr('class', 'bl-node-value')
        .attr('x', 0)
        .attr('y', (sepY + ln.height / 2) / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', VALUE_FONT_SIZE)
        .attr('fill', colors.text)
        .attr('opacity', 0.85)
        .text(valueLabel);
    } else {
      const maxLabelLines = Math.max(
        2,
        Math.floor((ln.height - 16) / (sMinNodeFontSize * 1.3))
      );
      const fitted = fitLabelToHeader(node.label, ln.width, maxLabelLines);
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
          // In-bounds by loop guard.
          .text(fitted.lines[li]!);
      }
    }

    // ── show-values on a DESCRIBED node ── the body is already full, so the
    // value rides in a top-right corner badge (plain nodes are handled in the
    // header/divider branch above; a described node with descriptions hidden
    // also falls through to that plain branch).
    if (
      parsed.showValues &&
      node.value !== undefined &&
      desc &&
      desc.length > 0 &&
      !hideDescriptions
    ) {
      const valueText = String(node.value);
      const padX = 6;
      const padY = 5;
      const bw = measureText(valueText, VALUE_FONT_SIZE) + 8;
      const bh = VALUE_FONT_SIZE + 4;
      // Clamp to the left padding so a long value on a narrow node never
      // slides past the box edge / over the label (R2-6 / AC23).
      const bx = Math.max(-ln.width / 2 + 4, ln.width / 2 - bw - 4);
      const by = -ln.height / 2 + 4;
      nodeG
        .append('rect')
        .attr('x', bx)
        .attr('y', by)
        .attr('width', bw)
        .attr('height', bh)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.85);
      nodeG
        .append('text')
        .attr('class', 'bl-node-value')
        .attr('x', bx + bw - padX)
        .attr('y', by + padY)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'central')
        .attr('font-size', VALUE_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('fill', palette.textMuted)
        .text(valueText);
    }
  }

  // ── Render legend ──────────────────────────────────────
  const hasDescriptions = parsed.nodes.some(
    (n) => n.description && n.description.length > 0
  );
  // App-hosted: the Descriptions control moves to the app overlay, so a
  // descriptions-only legend (no tag groups) has nothing left to render. The
  // value ramp (a synthetic group in legendGroups) also forces a legend.
  const hasLegend =
    legendGroups.length > 0 || (hasDescriptions && controlsHost !== 'app');

  if (hasLegend) {
    // Build controls group for description toggle. App-hosted controls own the
    // toggling, so the group is built (to gate + size the row) even without the
    // inline-gear callback.
    let controlsGroup: { toggles: ControlsGroupToggle[] } | undefined;
    if (hasDescriptions && (onToggleDescriptions || controlsHost === 'app')) {
      controlsGroup = {
        toggles: [
          {
            id: 'descriptions',
            type: 'toggle',
            label: 'Descriptions',
            active: !hideDescriptions,
            onToggle: () => {},
          },
        ],
      };
    }

    const legendConfig: LegendConfig = {
      groups: legendGroups,
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: exportMode ? 'export' : 'preview',
      // Keep inactive sibling tag groups visible as collapsed pills so the user
      // can click one to flip the active colouring dimension (preview only —
      // export shows just the active group). Without this, declaring a second
      // tag group (e.g. Team) leaves it invisible whenever another group is
      // active. The app's BoxesAndLinesPreview already wires pill clicks.
      showInactivePills: true,
      ...(controlsGroup !== undefined && { controlsGroup }),
      ...(controlsHost !== undefined && { controlsHost }),
    };
    const legendState: LegendState = {
      activeGroup,
      ...(controlsExpanded !== undefined && { controlsExpanded }),
    };
    const legendCallbacks: LegendCallbacks = {
      ...(onToggleControlsExpand !== undefined && {
        onControlsExpand: onToggleControlsExpand,
      }),
      onControlsToggle: (toggleId, active) => {
        if (toggleId === 'descriptions' && onToggleDescriptions) {
          onToggleDescriptions(active);
        }
      },
    };
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0,${titleOffset + 4})`);
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      legendCallbacks,
      width
    );
    legendG.selectAll('[data-legend-group]').classed('bl-legend-group', true);
  }
}

// ── Export helper ──────────────────────────────────────────

export function renderBoxesAndLinesForExport(
  container: HTMLDivElement,
  parsed: ParsedBoxesAndLines,
  layout: BLLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  options?: {
    exportDims?: { width: number; height: number };
    activeTagGroup?: string | null;
    hiddenTagValues?: Map<string, Set<string>>;
    exportMode?: boolean;
  }
): void {
  renderBoxesAndLines(container, parsed, layout, palette, isDark, {
    ...(options?.exportDims !== undefined && {
      exportDims: options.exportDims,
    }),
    ...(options?.activeTagGroup !== undefined && {
      activeTagGroup: options.activeTagGroup,
    }),
    ...(options?.hiddenTagValues !== undefined && {
      hiddenTagValues: options.hiddenTagValues,
    }),
    ...(options?.exportMode !== undefined && {
      exportMode: options.exportMode,
    }),
  });
}
