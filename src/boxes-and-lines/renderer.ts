// ============================================================
// Boxes and Lines Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { fillModeFromOptions } from '../utils/parsing';
import {
  renderNoteBox,
  renderNoteConnector,
  renderNoteBadge,
  noteConnectorPoints,
  NOTE_BADGE_RADIUS,
} from '../utils/note-box';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import type {
  LegendCallbacks,
  LegendGroupData,
  ControlsGroupToggle,
} from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import {
  contrastText,
  mix,
  relativeLuminance,
  shapeFill,
  valueRampColor,
  themeBaseBg,
} from '../palettes/color-utils';
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
import {
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
} from '../utils/visual-conventions'; // shared (Story 111.1)
const NODE_RX = 8;
// Intentional deviation (conventions §3): boxes-and-lines uses a 4px collapse
// bar (and 4px separator gap in layout.ts) — denser than the 6px default.
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
    /** Two explicit endpoint colours (`heat Risk green red`). When set, the
     *  value's position on the ramp is carried by HUE, so the box follows the
     *  STANDARD box convention (solid colour outline + 25% faded fill) rather than
     *  the map's saturated choropleth fill. A single-colour ramp encodes value by
     *  saturation/lightness and keeps the choropleth fill (no hue to spare). */
    twoColor: boolean;
    fillForValue: (v: number) => string;
  },
  fillMode?: 'solid' | 'outline'
): { fill: string; stroke: string; text: string } {
  // Untagged-neutral fill, reused by the value path for no-value boxes.
  const neutralFill = mix(palette.bg, palette.text, isDark ? 90 : 95);
  if (value.active) {
    if (node.value === undefined) {
      // No-value box: neutral fill, ramp-hue stroke (present so the app's
      // --bl-node-stroke hover-dim still works).
      const text = contrastText(
        neutralFill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      return { fill: neutralFill, stroke: value.hue, text };
    }
    // Value box: render the ramp colour like any tagged box — a 25% faded
    // (muted) fill + a solid colour outline; `solid-fill` opts into the full
    // fill. The outline differs by ramp kind: a two-colour ramp carries value by
    // HUE, so each box's outline is its own ramp colour (red→green); a
    // single-colour ramp has one hue, so the outline is the constant ramp hue and
    // value reads from the muted fill depth.
    const rampColor = value.fillForValue(node.value);
    const fill = shapeFill(palette, rampColor, isDark, { mode: fillMode });
    const stroke = value.twoColor ? rampColor : value.hue;
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
    const fill = shapeFill(palette, tagColor, isDark, { mode: fillMode });
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
  /** Explicit value-ramp domain override. When provided, the choropleth ramp
   *  uses these endpoints instead of computing min/max from `parsed.nodes`.
   *  Focus mode passes the GLOBAL (pre-filter) domain so neighbor colours stay
   *  stable when only a subset is rendered (Decision 20 / FM1). */
  rampDomain?: { min: number; max: number };
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
    rampDomain,
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
  // Anchor the low end at the lowest value (not 0) to maximise within-diagram
  // dynamic range; mirrors the map's region-heat ramp. Equal-value data
  // (rampMin === rampMax) falls back to t = 1 in fillForValue below.
  // A caller-supplied domain (focus mode) wins so colours don't shift when a
  // subset is rendered; otherwise derive from the nodes on screen.
  const rampMin = rampDomain?.min ?? (hasRamp ? Math.min(...nodeValues) : 0);
  const rampMax = rampDomain?.max ?? Math.max(...nodeValues);
  // Default hue = palette.primary (NOT red like the map — boxes have no water to
  // stand out against, and red reads as alarm on a neutral metric). A trailing
  // color on `heat` overrides.
  const rampHue =
    resolveColor(parsed.boxMetricColor ?? '', palette) ?? palette.primary;
  // Explicit LOW endpoint (`heat Risk green red`); absent ⇒ single-colour
  // (neutral low). Only recognized names peel, so resolveColor always succeeds.
  const rampLow = parsed.boxMetricLowColor
    ? (resolveColor(parsed.boxMetricLowColor, palette) ?? undefined)
    : undefined;
  // Lift the ramp anchor off the near-black surface on dark themes so the
  // lowest values read as a clear muted tint rather than sinking to the surface.
  const rampBase = isDark ? mix(palette.surface, palette.text, 28) : palette.bg;
  const rampLowFloor = mix(rampHue, rampBase, RAMP_FLOOR);
  const fillForValue = (v: number): string => {
    const t = rampMax > rampMin ? (v - rampMin) / (rampMax - rampMin) : 1;
    // Two-colour ramp: shared low→high interpolation (direct or via midpoint).
    if (rampLow !== undefined)
      return valueRampColor(rampLow, rampHue, t, { isDark });
    // Single/zero-colour: byte-identical to pre-change (same numeric pct, no
    // float round-trip).
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
            low: rampLow ?? rampLowFloor,
            high: rampHue,
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
      const fillColor = themeBaseBg(palette, isDark);
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
  // Edge labels are placed in layout (label-placement.ts) and drawn AFTER the
  // node loop (see the bl-edge-labels layer) so boxes never clip them.
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
          .attr('data-line-number', String(le.lineNumber))
          // Endpoint node labels for baked-CSS connection-highlight.
          .attr('data-from', le.source)
          .attr('data-to', le.target);

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
      .attr('data-line-number', String(le.lineNumber))
      // Endpoint node labels for baked-CSS connection-highlight.
      .attr('data-from', le.source)
      .attr('data-to', le.target);

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

    const fillMode = fillModeFromOptions(parsed.options);
    const colors = nodeColors(
      node,
      parsed.tagGroups,
      activeGroup,
      palette,
      isDark,
      {
        active: activeIsValue,
        hue: rampHue,
        twoColor: rampLow !== undefined,
        fillForValue,
      },
      fillMode
    );
    // Divider matches the org-card convention: the box stroke normally, but the
    // contrast text colour in solid mode (where stroke == fill and would vanish).
    const dividerStroke = fillMode === 'solid' ? colors.text : colors.stroke;

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
    // legitimate `heat: 0` still emits data-value="0" (0 is falsy).
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
          .attr('font-weight', 'bold')
          .attr('fill', colors.text)
          // In-bounds by loop guard.
          .text(labelLines[li]!);
      }

      // Single divider under the title (org-card convention) — everything else
      // renders below it as one body section (no second divider / footer band).
      const sepY = -ln.height / 2 + headerH;
      nodeG
        .append('line')
        .attr('x1', -ln.width / 2)
        .attr('y1', sepY)
        .attr('x2', ln.width / 2)
        .attr('y2', sepY)
        .attr('stroke', dividerStroke)
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

      // Description must stay legible on ANY fill. On the default light/tinted
      // fills keep the subtle muted grey; on a dark/saturated fill (e.g.
      // solid-fill) the fixed grey sinks in — switch to a muted tint of the
      // box's contrast-correct text colour so it reads while staying
      // subordinate to the title.
      const descColor =
        relativeLuminance(colors.fill) > 0.5
          ? palette.textMuted
          : mix(colors.text, colors.fill, 75);

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
            .attr('fill', descColor)
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
          .attr('fill', descColor);
        renderInlineText(textEl, lineText, palette, sDescFontSize);
      }

      // Tooltip when truncated
      if (truncated) {
        const fullText = desc.join(' ');
        const tooltipText =
          fullText.length > 200 ? fullText.slice(0, 199) + '\u2026' : fullText;
        nodeG.append('title').text(tooltipText);
      }

      // Value sits in the SAME body section, directly after the description \u2014
      // no second divider / footer band (org-card: title, one line, body).
      if (parsed.showValues !== false && node.value !== undefined) {
        const valueLabel = parsed.boxMetric
          ? `${parsed.boxMetric}: ${node.value}`
          : String(node.value);
        nodeG
          .append('text')
          .attr('class', 'bl-node-value')
          .attr('x', 0)
          .attr('y', descStartY + visibleLines.length * descLineH)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', VALUE_FONT_SIZE)
          .attr('font-weight', '600')
          .attr('fill', colors.text)
          .text(valueLabel);
      }
    } else if (parsed.showValues !== false && node.value !== undefined) {
      // Plain node with a value (default-on): label header + thin divider + a
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
          .attr('font-weight', 'bold')
          .attr('fill', colors.text)
          // In-bounds by loop guard.
          .text(fitted.lines[li]!);
      }
      // Single divider under the title (org-card convention; solid-aware so it
      // stays visible when stroke == fill).
      nodeG
        .append('line')
        .attr('x1', -ln.width / 2)
        .attr('y1', sepY)
        .attr('x2', ln.width / 2)
        .attr('y2', sepY)
        .attr('stroke', dividerStroke)
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

    // ── Note (floated beside the box, or a collapsed corner badge) ──
    // The box keeps its layout position; the note floats in adjacent space.
    // Coords are node-center-local (the node `<g>` is at the box center).
    if (ln.note) {
      if (ln.note.collapsed) {
        renderNoteBadge(
          nodeG,
          {
            x: ln.width / 2 - NOTE_BADGE_RADIUS - 3,
            y: -ln.height / 2 + NOTE_BADGE_RADIUS + 3,
          },
          palette,
          {
            isDark,
            ...(ln.note.color && { color: ln.note.color }),
            lineNumber: ln.note.lineNumber,
            endLineNumber: ln.note.endLineNumber,
          }
        );
      } else {
        const [cx1, cy1, cx2, cy2] = noteConnectorPoints(
          { width: ln.width, height: ln.height },
          ln.note
        );
        renderNoteConnector(nodeG, cx1, cy1, cx2, cy2, palette);
        renderNoteBox(
          nodeG,
          {
            x: ln.note.x,
            y: ln.note.y,
            width: ln.note.width,
            height: ln.note.height,
          },
          ln.note.lines,
          palette,
          {
            isDark,
            ...(ln.note.color && { color: ln.note.color }),
            lineNumber: ln.note.lineNumber,
            endLineNumber: ln.note.endLineNumber,
            interactive: true,
          }
        );
      }
    }
  }

  // ── Render edge labels ─────────────────────────────────
  // Drawn AFTER nodes (and groups) so the halo + text always paint on top and
  // are never clipped by a box. Positions/wrapping come from label-placement
  // (layout); this is a pure consumer. Labels stay in their own layer rather
  // than inside each edge group, but carry data-line-number so line-hover/click
  // still highlights the matching label.
  const labelLayer = diagramG.append('g').attr('class', 'bl-edge-labels');
  const labelLineHeight = sEdgeLabelFontSize * 1.3;
  for (const le of layout.edges) {
    if (!le.labelLines || le.labelLines.length === 0) continue;
    if (le.labelX === undefined || le.labelY === undefined) continue;
    const lx = le.labelX;
    const ly = le.labelY;

    // Honour the same tag-value hiding as the edges themselves.
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

    const lw = le.labelWidth ?? 0;
    const lh = le.labelHeight ?? sEdgeLabelFontSize + 6;
    const lines = le.labelLines;
    const labelG = labelLayer
      .append('g')
      .attr('class', 'bl-edge-label')
      .attr('data-line-number', String(le.lineNumber));

    labelG
      .append('rect')
      .attr('x', lx - lw / 2)
      .attr('y', ly - lh / 2)
      .attr('width', lw)
      .attr('height', lh)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      // No border; semi-transparent so the line stays faintly visible behind the
      // label while the (full-opacity) text on top stays crisp.
      .attr('opacity', 0.72);

    const text = labelG
      .append('text')
      .attr('x', lx)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', sEdgeLabelFontSize)
      .attr('fill', palette.textMuted);
    const firstY =
      ly - ((lines.length - 1) / 2) * labelLineHeight + sEdgeLabelFontSize / 3;
    lines.forEach((line, k) => {
      text
        .append('tspan')
        .attr('x', lx)
        .attr('y', firstY + k * labelLineHeight)
        .text(line);
    });
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
    renderIntegratedLegend(legendG, {
      groups: legendGroups,
      activeGroup,
      mode: exportMode ? 'export' : 'preview',
      // Keep inactive sibling tag groups visible as collapsed pills so the user
      // can click one to flip the active colouring dimension (preview only).
      showInactivePills: true,
      ...(controlsGroup !== undefined && { controlsGroup }),
      ...(controlsHost !== undefined && { controlsHost }),
      ...(controlsExpanded !== undefined && { controlsExpanded }),
      callbacks: legendCallbacks,
      palette,
      isDark,
      width,
    });
    legendG.selectAll('[data-legend-group]').classed('bl-legend-group', true);
  }

  // ── Focus mode: one reusable hover-reveal icon (interactive only) ──
  // A single hidden icon the app repositions over the hovered box/group and
  // stamps `data-focus-id`/`data-focus-kind` on (Decision 22 / ADR-4) — NOT one
  // per node (~4k elements on a large graph). Appended to the SVG root so the
  // app positions it in root (screen-mapped) coordinates, counter-scaled to a
  // constant size regardless of fit. Excluded from export like org's icon.
  if (!exportDims && !exportMode) {
    const iconSize = 14;
    const focusG = svg
      .append('g')
      .attr('class', 'bl-focus-icon')
      .attr('data-export-ignore', 'true')
      .style('display', 'none')
      .style('pointer-events', 'auto')
      .style('cursor', 'pointer');
    // Hit area
    focusG
      .append('rect')
      .attr('x', -3)
      .attr('y', -3)
      .attr('width', iconSize + 6)
      .attr('height', iconSize + 6)
      .attr('fill', 'transparent');
    // Scope/target icon: outer circle + inner dot (mirrors org-focus-icon)
    const cx = iconSize / 2;
    const cy = iconSize / 2;
    focusG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', iconSize / 2 - 1)
      .attr('fill', palette.bg)
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', 1.5);
    focusG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 2)
      .attr('fill', palette.textMuted);
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
