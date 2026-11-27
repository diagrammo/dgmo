// ============================================================
// Boxes and Lines Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import {
  fillModeFromOptions,
  legendSuppressed,
  legendInlineRequested,
} from '../utils/parsing';
import { layoutInlineHeader } from '../utils/inline-header';
import { renderNodeNote } from '../utils/note-box';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import {
  appendArrowheadMarkers,
  appendReverseArrowheadMarkers,
} from '../utils/arrow-markers';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  getMaxLegendReservedHeight,
  getLegendExtent,
} from '../utils/legend-layout';
import type {
  LegendCallbacks,
  LegendGroupData,
  ControlsGroupToggle,
} from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  FRAME_BODY_TOP,
  LEGEND_BODY_GAP,
} from '../utils/title-constants';
import {
  contrastText,
  mix,
  relativeLuminance,
  shapeFill,
  valueRampColor,
  themeBaseBg,
  groupFill,
  groupStroke,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { resolveHighlightPaths, storyGround } from '../utils/emphasis';
import {
  resolveTagColor,
  resolveGroupTagColor,
  keepUsedTagValues,
  tagAttrKey,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes';
import {
  renderInlineText,
  stripInlineMarkdown,
} from '../utils/inline-markdown';
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';
import type { ParsedBoxesAndLines, BLNode } from './types';
import { measureSvgContent } from '../utils/export-fit';
import type { BLLayoutResult, BLLayoutNode, BLLayoutEdge } from './layout';
import { splitLabelChunks } from './layout';
import {
  NODE_FONT_SIZE,
  MIN_NODE_FONT_SIZE,
  NODE_TEXT_PADDING,
} from './node-metrics';
import { legendInkBottom } from '../utils/legend-constants';
import { LAYOUT_MARGIN } from './types';
import { ScaleContext } from '../utils/scaling';
import { growChartFrame } from '../utils/chart-frame';
import { renderCollapseBar } from '../utils/card';
import { FULL_TEXT_ATTR, fullNodeText, isCutShort } from '../utils/full-text';
import { fitGroupTitle, GROUP_TITLE_LINE_H } from './group-title';
import {
  CHAR_WIDTH_RATIO,
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../utils/text-measure';

// ── Constants (aligned with infra pattern) ─────────────────
const DIAGRAM_PADDING = 20;
const EDGE_LABEL_FONT_SIZE = 11;
import {
  CARD_RADIUS,
  CONTAINER_RADIUS,
  EDGE_LABEL_KNOCKOUT_OPACITY,
  EDGE_LABEL_UNRESOLVED_KNOCKOUT_OPACITY,
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
  ARROWHEAD_WIDTH,
  ARROWHEAD_HEIGHT,
} from '../utils/visual-conventions'; // shared (Story 111.1)
// 🔴 SHARED. This was a local `8` against the conventions' 6 — undocumented, and
// absent from the deviation list the shared file keeps, so it was drift rather
// than a decision. `org` and `sketch` both take the shared value; this was the
// only card-shaped renderer rounder than the rest (2026-08-27).
const NODE_RX = CARD_RADIUS;
const DESC_FONT_SIZE = 10; // matches infra META_FONT_SIZE
const DESC_LINE_HEIGHT = 1.4; // 14px row height at 10px font (matches infra META_LINE_HEIGHT)
const MAX_DESC_LINES = 6;
// Shared too. It was a local `8` — the same NUMBER as `CONTAINER_RADIUS`, which
// is precisely why it could drift without anyone noticing: a re-declared
// constant that happens to agree today is not the same as citing it.
const GROUP_RX = CONTAINER_RADIUS;
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

/** Top of the curve an edge's points draw: a B-spline stays well inside the
 *  points' hull, so it is measured, not read off the points (#2117). */
function curveTop(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  direction: ParsedBoxesAndLines['direction']
): number {
  if (points.length < 2) return Infinity;
  const gen = direction === 'TB' ? lineGeneratorTB : lineGeneratorLR;
  const d = gen(points.map((p) => ({ x: p.x, y: p.y })));
  const box = d
    ? measureSvgContent(
        `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke-width="0"/></svg>`
      ).box
    : null;
  return box ? box.y0 : Math.min(...points.map((p) => p.y));
}

// ── Text fitting ───────────────────────────────────────────

/**
 * Fit a label into a header zone for described nodes.
 * Strategy: split first (spaces, dashes, camelCase), wrap into lines. A
 * chunk wider than the line shrinks the font first; at the minimum font it is
 * hard-broken at a character boundary, never cut with "…" (#2172). "…" marks
 * only a label with more lines than `maxLines`.
 */
function fitLabelToHeader(
  label: string,
  nodeWidth: number,
  maxLines: number
): { lines: string[]; fontSize: number } {
  // Every caller draws these lines at 600 or 700 — a group label at 600, a node
  // title at 700 — and with only Regular and Bold shipped, CSS font matching
  // resolves both to the Bold face. Verified by rasterising the same string at
  // all four weights: 600 and 700 come out byte-identical, as do 400 and 500.
  const BOLD = { bold: true } as const;
  const maxTextWidth = nodeWidth - NODE_TEXT_PADDING * 2;

  const words = splitLabelChunks(label);

  for (
    let fontSize = NODE_FONT_SIZE;
    fontSize >= MIN_NODE_FONT_SIZE;
    fontSize--
  ) {
    if (maxTextWidth < measureText('MM', fontSize, BOLD)) continue;

    const fits = (l: string): boolean =>
      measureText(l, fontSize, BOLD) <= maxTextWidth;

    // A chunk that cannot fit a line on its own: try a smaller font before
    // breaking a word.
    if (fontSize > MIN_NODE_FONT_SIZE && !words.every((w) => fits(w.text)))
      continue;

    // Wrap words into lines (greedy, by measured pixel width)
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const joiner = current && word.spaceBefore ? ' ' : '';
      const test = current ? `${current}${joiner}${word.text}` : word.text;
      if (fits(test)) {
        current = test;
      } else {
        if (current) lines.push(current);
        if (fits(word.text)) {
          current = word.text;
        } else {
          const pieces = wrapTextToWidth(word.text, fontSize, maxTextWidth, {
            ...BOLD,
            hardBreak: true,
          });
          lines.push(...pieces.slice(0, -1));
          current = pieces[pieces.length - 1] ?? '';
        }
      }
    }
    if (current) lines.push(current);

    if (lines.length <= maxLines) return { lines, fontSize };

    // Too many lines — take first maxLines and mark the cut on the last.
    const result = lines.slice(0, maxLines);
    // In-bounds: result has exactly maxLines entries (from .slice(0, maxLines)).
    result[maxLines - 1] = truncateText(
      result[maxLines - 1]! + '\u2026',
      fontSize,
      maxTextWidth,
      BOLD
    );
    return { lines: result, fontSize };
  }

  // Fallback at min font
  const truncated = truncateText(label, MIN_NODE_FONT_SIZE, maxTextWidth, BOLD);
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
  // An explicit `color:` wins over a tag-derived colour — it is the author
  // naming this edge's colour directly, where a tag names a category that
  // happens to have one. §1.5 documents the long form as the ONLY way to colour
  // an edge (edges have no trailing-token slot), and `color` is in the reserved
  // key registry, so the metadata cut fires and the value lands here. It was
  // then dropped on the floor: the edge parsed clean, warned about nothing, and
  // rendered in the default stroke (#631).
  const explicit = edge.metadata['color'];
  if (typeof explicit === 'string') {
    const resolved = resolveColor(explicit, palette);
    if (resolved) return resolved;
  }
  // Otherwise colour only edges that carry tag metadata — else neutral.
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
  // Only the colours not already defined — the shared helpers append
  // unconditionally, and this runs more than once per render.
  const fresh = [...colors].filter((color) =>
    defs.select(`#bl-arrow-${color.replace('#', '')}`).empty()
  );
  if (fresh.length === 0) return;
  const opts = {
    idPrefix: 'bl',
    width: ARROWHEAD_WIDTH,
    height: ARROWHEAD_HEIGHT,
    // Every marker here is per-colour; the base id is never referenced, so it
    // takes the first colour rather than introducing a palette dependency.
    baseFill: fresh[0]!,
    colors: fresh,
  };
  appendArrowheadMarkers(defs, opts);
  appendReverseArrowheadMarkers(defs, opts);
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
  /** Upper bound on the fit-to-pane scale. The app passes the scale it drew
   *  before a fold, so folding a group never makes text bigger (rubric rule
   *  8, diagrammo/diagrammo#2062). The fit still wins when it is smaller, so
   *  unfolding never overflows the pane. The scale used is on the root
   *  `<svg>` as `data-scale`. */
  maxScale?: number;
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
    maxScale,
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
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty metric name also falls back to 'Value'
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
    ...keepUsedTagValues(
      parsed.tagGroups,
      parsed.tagGroups,
      [
        ...parsed.nodes.map((n) => n.metadata),
        ...parsed.edges
          .filter((e) => Object.keys(e.metadata).length > 0)
          .map((e) => e.metadata),
      ],
      parsed.groups.map((g) => g.metadata)
    ),
  ];

  // Reserve legend height only when a legend will actually render. App-hosted
  // controls move the Descriptions toggle to the app overlay, so a
  // descriptions-only chart (no tag groups) reserves nothing.
  const reserveHasDescriptions = parsed.nodes.some(
    (n) => n.description && n.description.length > 0
  );
  const noLegend = legendSuppressed(parsed.options);
  const willRenderLegend =
    (legendGroups.length > 0 ||
      (reserveHasDescriptions && controlsHost !== 'app')) &&
    !noLegend;
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
    (legendGroups.length > 0 ||
      (hasAnyDescriptions && !!onToggleDescriptions)) &&
    !noLegend;
  const legendH = needsLegend ? sLegendHeight + 8 : 0;

  // §1.9 `legend-inline` (decision #50): try a one-line header (title left,
  // legend flushed right). Falls back to the stacked band when it can't fit.
  const inlineRequested = legendInlineRequested(parsed.options);
  const legendExtent =
    inlineRequested && needsLegend
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
          { activeGroup },
          width
        )
      : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: parsed.title ?? '',
    hasLegend: needsLegend,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth: width,
    titleBandHeight: titleOffset,
    legendReserve: legendH,
    titleBaselineY: sTitleY,
    titleFontSize: sTitleFontSize,
  });

  const groupLabelsSet = new Set(layout.groups.map((g) => g.label));
  let labelZoneExtension = 0;
  for (const group of parsed.groups) {
    if (group.children.some((c) => groupLabelsSet.has(c))) {
      labelZoneExtension += sGroupLabelZone;
    }
  }

  const contentW = layout.width;

  // Title, legend and the group-label zone are drawn at FIXED pixel sizes
  // OUTSIDE the scaled content group (see `offsetY` below — it is unscaled).
  // Only `layout.height` scales. Reserve that fixed overhead by subtracting it
  // from the available height rather than folding it into the scaled
  // denominator — otherwise, when `scale < 1`, the unscaled top overhead plus
  // the scaled content overshoots the viewport and the diagram bleeds past the
  // bottom edge. Clamp the numerator so a viewport shorter than the overhead
  // still yields a positive scale instead of flipping the content inside-out.
  // With a title the first thing drawn starts at a fixed line (#1838): the
  // shared body top, or the legend's bottom plus the shared gap. The layout's
  // own top margin scales with the content, so it is cut from the scaled part.
  const bodyTop = !showTitle
    ? null
    : needsLegend && !header.inline
      ? titleOffset + 4 + legendInkBottom(sLegendHeight) + LEGEND_BODY_GAP
      : FRAME_BODY_TOP;
  // A group box can stand above the layout's top margin; the first thing
  // drawn is what lands on bodyTop. So can a note floated above its box, an
  // edge that arcs over the boxes, and that edge's label (#2117).
  const extraTopGroups = new Set(
    parsed.groups
      .filter((g) => g.children.some((c) => groupLabelsSet.has(c)))
      .map((g) => g.label)
  );
  const layoutTop = Math.min(
    LAYOUT_MARGIN,
    ...layout.groups.map(
      (g) =>
        g.y -
        g.height / 2 -
        (!g.collapsed && extraTopGroups.has(g.label) ? sGroupLabelZone : 0)
    ),
    ...layout.nodes.map((n) => n.y - n.height / 2),
    ...layout.nodes.flatMap((n) =>
      n.note && !n.note.collapsed ? [n.y + n.note.y] : []
    ),
    ...layout.edges.map((e) => curveTop(e.points, parsed.direction)),
    ...layout.edges.flatMap((e) =>
      e.labelY !== undefined && e.labelHeight !== undefined
        ? [e.labelY - e.labelHeight / 2]
        : []
    )
  );
  const vOverhead =
    bodyTop ?? titleOffset + (header.inline ? 0 : legendH) + labelZoneExtension;
  const availH =
    bodyTop === null
      ? Math.max(1, height - vOverhead - sDiagramPadding * 2)
      : Math.max(1, height - vOverhead - labelZoneExtension - sDiagramPadding);

  const scaleX = width / (contentW + sDiagramPadding * 2);
  const scaleY =
    availH / (bodyTop === null ? layout.height : layout.height - layoutTop);
  const scale = Math.min(
    scaleX,
    scaleY,
    3,
    maxScale !== undefined && maxScale > 0 ? maxScale : Infinity
  );

  const offsetX = (width - contentW * scale) / 2;
  const offsetY =
    bodyTop === null
      ? sDiagramPadding + titleOffset + (header.inline ? 0 : legendH)
      : bodyTop - layoutTop * scale;

  const svg: D3Svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY)
    .style('background', palette.bg);

  // Live renders only: export and gallery output stay byte-identical.
  if (!exportMode) svg.attr('data-scale', scale);

  if (sctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const defs = svg.append('defs');

  if (showTitle) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', header.titleX)
      .attr('y', sTitleY)
      .attr('text-anchor', header.titleAnchor)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(parsed.title);
  }

  // Main diagram group with scaling
  const diagramG = svg
    .append('g')
    .attr('transform', `translate(${offsetX},${offsetY}) scale(${scale})`);

  // Story view (#2041): `highlight` lights a node, edge or chain; the rest
  // takes the ground. A group recedes only when no member is lit.
  const storyPaths = resolveHighlightPaths(
    parsed.emphasis,
    parsed.nodes.map((n) => n.label),
    layout.edges.map((e) => ({
      from: e.source,
      to: e.target,
      ...(e.label !== undefined && { label: e.label }),
    }))
  );
  const story = storyPaths.active ? storyGround(palette, isDark) : null;
  const nodeReceded = (label: string): boolean =>
    story !== null && !storyPaths.litNodes.has(label);
  const groupChildren = new Map<string, readonly string[]>(
    parsed.groups.map((g) => [g.label, g.children])
  );
  const groupLit = (label: string, seen = new Set<string>()): boolean => {
    if (seen.has(label)) return false;
    seen.add(label);
    return (groupChildren.get(label) ?? []).some((c) =>
      groupChildren.has(c) ? groupLit(c, seen) : storyPaths.litNodes.has(c)
    );
  };
  const groupReceded = (label: string): boolean =>
    story !== null && !groupLit(label);

  // Collect all edge colors for arrowhead markers
  const arrowColors = new Set<string>();
  const edgeColorMap = new Map<number, string>();
  for (let i = 0; i < layout.edges.length; i++) {
    const c =
      story && !storyPaths.litEdges.has(i)
        ? story.groundStroke
        : edgeColor(
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
  // `BLLayoutGroup` carries geometry only, so the authored metadata is looked
  // up by label rather than threaded through layout (#585).
  const groupMetaByLabel = new Map<string, Readonly<Record<string, string>>>();
  for (const group of parsed.groups) {
    groupMetaByLabel.set(group.label, group.metadata);
    for (const child of group.children) {
      if (groupLabels.has(child)) hasSubGroups.add(group.label);
    }
  }

  for (const group of sortedGroups) {
    // The frame's own tag value (§2 of the visual-conventions doc). Container
    // resolution, so an untagged group stays neutral instead of inheriting the
    // tag group's default value.
    const groupTagColor = resolveGroupTagColor(
      groupMetaByLabel.get(group.label),
      parsed.tagGroups,
      activeGroup
    );
    const gGround = groupReceded(group.label) ? story : null;
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
      .attr('role', 'button')
      .attr('aria-expanded', group.collapsed ? 'false' : 'true')
      .attr('aria-label', group.label)
      .style('cursor', 'pointer');

    if (group.collapsed) {
      // Collapsed: solid rounded rect matching node style + the collapse bar.
      // A tinted group keeps its color when folded, so collapsing does not
      // silently drop the one thing the author set (#585) — the same rule
      // pert's collapsed card already follows for the critical-path band.
      const fillColor = gGround
        ? gGround.groundFill
        : groupTagColor
          ? groupFill(palette, isDark, groupTagColor)
          : themeBaseBg(palette, isDark);
      const strokeColor = gGround
        ? gGround.groundStroke
        : (groupTagColor ?? palette.border);

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

      renderCollapseBar(groupG, {
        x: gx,
        y: gy,
        width: group.width,
        height: group.height,
        rx: NODE_RX,
        fill: strokeColor,
        clipId: `bl-clip-${group.label.replace(/[[\]\s]/g, '')}`,
        prefix: 'bl',
        scale: sctx,
      });

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
          .attr('font-weight', 'bold')
          .attr('fill', gGround ? gGround.groundText : palette.text)
          // In-bounds by loop guard.
          .text(fitted.lines[li]!);
      }

      // Member-count chip (top-right corner): says "there are N boxes in
      // here" — the pill is otherwise indistinguishable from a plain node.
      if (group.childCount !== undefined && group.childCount > 0) {
        const chipFont = Math.max(9, sMinNodeFontSize - 2);
        const chipH = chipFont + 7;
        const chipW = Math.max(
          chipH,
          String(group.childCount).length * chipFont * 0.62 + 10
        );
        const chipCx = gx + group.width - chipW / 2 - 6;
        const chipCy = gy + chipH / 2 + 6;
        groupG
          .append('rect')
          .attr('class', 'bl-collapse-count')
          .attr('x', chipCx - chipW / 2)
          .attr('y', chipCy - chipH / 2)
          .attr('width', chipW)
          .attr('height', chipH)
          .attr('rx', chipH / 2)
          .attr('ry', chipH / 2)
          .attr('fill', palette.textMuted)
          .attr('fill-opacity', 0.18);
        groupG
          .append('text')
          .attr('class', 'bl-collapse-count')
          .attr('x', chipCx)
          .attr('y', chipCy)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', chipFont)
          .attr('font-weight', 'bold')
          .attr('fill', palette.text)
          .text(String(group.childCount));
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
        .attr(
          'fill',
          gGround
            ? themeBaseBg(palette, isDark)
            : groupFill(palette, isDark, groupTagColor)
        )
        .attr(
          'stroke',
          gGround ? gGround.groundStroke : groupStroke(palette, groupTagColor)
        )
        .attr('stroke-width', 1)
        // A colored frame draws its stroke at full strength; the 0.35 that
        // keeps an untagged frame recessive would wash the tag color out to
        // the point where the group reads as uncolored again.
        .attr('stroke-opacity', groupTagColor && !gGround ? 1 : 0.35);

      // Wrapped to the frame, cut with "…" only past its last line (#2423);
      // the layout reserved the room for the extra lines.
      const title = fitGroupTitle(group.label, group.width);
      title.lines.forEach((line, li) => {
        groupG
          .append('text')
          .attr('class', 'bl-group-label')
          .attr('x', gx + group.width / 2)
          .attr('y', gy + GROUP_TITLE_LINE_H * (li + 1))
          .attr('text-anchor', 'middle')
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', sGroupLabelFontSize)
          .attr('font-weight', 'bold')
          .attr('fill', gGround ? gGround.groundText : palette.text)
          .text(line);
      });
      // The full name rides data-full-text, never an <svg><title> (a native
      // tooltip and a second accessible name; dgmo/CLAUDE.md → Output rules).
      if (title.truncated) groupG.attr(FULL_TEXT_ATTR, group.label);

      // An expanded group folds: its hover preview of the bar (#1741).
      renderCollapseBar(groupG, {
        expanded: true,
        x: gx,
        y: gy,
        width: group.width,
        height: groupHeight,
        rx: GROUP_RX,
        fill: gGround
          ? gGround.groundStroke
          : groupStroke(palette, groupTagColor),
        clipId: `bl-clip-${group.label.replace(/[[\]\s]/g, '')}`,
        prefix: 'bl',
        scale: sctx,
      });
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

    // The polyline IS the drawn geometry — including the parallel-edge fan,
    // which is built in layout (applyParallelEdgeOffsets) so that
    // placeEdgeLabels sees the same curve the reader does. Rebuilding it here
    // is what put labels on a line that was never drawn (#640) and, when it
    // mixed a routed x with a node-centre y, buried an arrowhead (#625).
    const points = le.points.map((p) => ({ x: p.x, y: p.y }));
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
    const litColors = nodeColors(
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
    const nGround = nodeReceded(node.label) ? story : null;
    const colors = nGround
      ? {
          fill: nGround.groundFill,
          stroke: nGround.groundStroke,
          text: nGround.groundText,
        }
      : litColors;
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
      nodeG.attr(`data-tag-${tagAttrKey(key)}`, val.toLowerCase());
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
    // Whether the label or description drawn below is cut short, and the
    // description lines drawn at all — for the node's full-text attribute.
    let textCut: boolean;
    let drawnDesc: readonly string[] = [];
    if (desc && desc.length > 0 && !hideDescriptions) {
      const MAX_LABEL_LINES = 3;
      const fitted = fitLabelToHeader(node.label, ln.width, MAX_LABEL_LINES);
      const labelLines = fitted.lines;
      textCut = isCutShort(labelLines, [node.label]);
      drawnDesc = desc;
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
        stripInlineMarkdown(text).length;

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
      const descColor = nGround
        ? nGround.groundText
        : relativeLuminance(colors.fill) > 0.5
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
        textCut = true;
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
          .attr('font-weight', 'bold')
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
      textCut = isCutShort(fitted.lines, [node.label]);
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
      textCut = isCutShort(fitted.lines, [node.label]);
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
          .attr('font-weight', 'bold')
          .attr('fill', colors.text)
          // In-bounds by loop guard.
          .text(fitted.lines[li]!);
      }
    }
    if (textCut) {
      nodeG.attr(FULL_TEXT_ATTR, fullNodeText(node.label, drawnDesc));
    }

    // ── Note (floated beside the box, or a collapsed corner badge) ──
    // The box keeps its layout position; the note floats in adjacent space.
    // Coords are node-center-local (the node `<g>` is at the box center).
    if (ln.note) {
      renderNodeNote(
        nodeG,
        { width: ln.width, height: ln.height },
        ln.note,
        palette,
        isDark
      );
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
  for (const [edgeIdx, le] of layout.edges.entries()) {
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
      // No border; see EDGE_LABEL_KNOCKOUT_OPACITY for why it is not opaque.
      // A label placement could not clear IS opaque — see
      // EDGE_LABEL_UNRESOLVED_KNOCKOUT_OPACITY (#703).
      .attr(
        'opacity',
        le.labelResolved === false
          ? EDGE_LABEL_UNRESOLVED_KNOCKOUT_OPACITY
          : EDGE_LABEL_KNOCKOUT_OPACITY
      );

    const text = labelG
      .append('text')
      .attr('x', lx)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', sEdgeLabelFontSize)
      .attr(
        'fill',
        story && !storyPaths.litEdges.has(edgeIdx)
          ? story.groundText
          : palette.textMuted
      );
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
    (legendGroups.length > 0 || (hasDescriptions && controlsHost !== 'app')) &&
    !noLegend;

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
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0,${titleOffset + 4})`
      );
    renderIntegratedLegend(legendG, {
      frame: parsed.frame,
      groups: legendGroups,
      activeGroup,
      mode: exportMode ? 'export' : 'preview',
      // Inline → left-origin so the wrapper's right-flush translate lands the
      // legend at the chart's right edge; stacked → centered below the title.
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
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
  // Chart frame (#1827): subtitle under the title, footer under the chart.
  // Before the focus icon, which the app positions in root coordinates.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });

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
