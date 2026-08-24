// ============================================================
// PERT Renderer (Phase 1 — static SVG)
// ============================================================
//
// Visual encoding (textbook 3×3 PERT/CPM box):
//   - top row    [ ES | dur | EF ]
//   - middle row [    name spans 3    ]
//   - bottom row [ LS | slack | LF ]
//   - dashed border for TBD activities (and downstream-of-TBD)
//   - criticality encoding (border + 25% fill tint + edge stroke):
//       analytical mode (no MC):
//         on M-world critical path → `palette.colors.red`
//         else                     → `palette.primary` (default)
//       Monte-Carlo mode (per-activity criticality index `c`):
//         c ≥ 0.80 → red    (very likely on the critical path)
//         c ≥ 0.50 → orange (often)
//         c ≥ 0.25 → yellow (sometimes — could swing either way)
//         c ≥ 0.10 → green  (occasionally)
//         c ≥ 0.02 → blue   (rare but real)
//         c <  0.02 → primary (default — effectively never)
//     Border + fill share the same intent color (matching the org / infra
//     "solid border, 25% muted fill" convention). Internal cell-grid
//     lines inherit the same color at low opacity so the card reads as a
//     single tinted unit. Edges pick the band from
//     min(source.crit, target.crit) and a matching arrowhead marker.
//     Collapsed groups inherit the band from the max member criticality
//     (or any-member-critical when MC is off).
//   - group bounding rects (cluster) and super-edges (hammock when collapsed)
//   - data attrs on the `<g>` wrapper of each activity ONLY (per
//     CLAUDE.md gotcha: children must NOT carry data attributes)

import { serializeSvg } from '../utils/svg-serialize';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import { ScaleContext } from '../utils/scaling';
import {
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../utils/text-measure';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  CAPTION_FONT_SIZE,
  CAPTION_FONT_WEIGHT,
  CAPTION_LINE_HEIGHT,
  CAPTION_TOP_GAP,
  CAPTION_BOX_PADDING_X,
  CAPTION_BOX_PADDING_Y,
} from '../utils/title-constants';
import { LEGEND_HEIGHT as LEGEND_HEIGHT_CONST } from '../utils/legend-constants';
import { resolveActiveTagGroup, resolveTagColor } from '../utils/tag-groups';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getLegendExtent } from '../utils/legend-layout';
import { layoutInlineHeader, INLINE_HEADER_PAD } from '../utils/inline-header';
import type {
  CaptionRow,
  LayoutResult,
  PertEdge,
  ResolvedActivity,
  ResolvedPert,
  ScurveData,
  ScurveReferenceLine,
} from './types';
import { parsePert } from './parser';
import { analyzePert } from './analyzer';
import { layoutPert, computeNodeSizing } from './layout';
import type { NodeSizing } from './layout';
import {
  addCalendarDays,
  formatDuration,
  formatScheduleValue,
  formatSprintCell,
  formatSlackValue,
} from './internal';
import type { Duration, DurationUnit } from '../gantt/types';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const NODE_FONT_SIZE = 13;
const NODE_CELL_FONT_SIZE = 11;
// Textbook 3×3 PERT/CPM box. Card rx=6 to match org/infra. The middle
// row holds the name and is taller than the corner cells so the name
// reads as the primary label (mirroring textbook proportions).
const NODE_RADIUS = 6;
// Shared card / group / collapse constants (Story 111.1). The explanatory
// comments below stay with the renderer; the values now live in one module.
import {
  NODE_STROKE_WIDTH,
  EDGE_STROKE_WIDTH,
  CONTAINER_RADIUS,
  CONTAINER_LABEL_FONT_SIZE,
  CONTAINER_HEADER_HEIGHT,
  COLLAPSE_BAR_HEIGHT,
} from '../utils/visual-conventions';

// Analysis-block chrome (Summary / Activity Risk / Completion / Field
// labels). These sit BELOW the diagram and shouldn't compete with it
// for visual weight. Match the uncolored group-container recipe (§2:
// `mix(surface, bg, 40)`) so the panels read as the same neutral
// containers as PERT group rects. Keep the stroke desaturated so the
// diagram stays the primary visual focus.
function analysisBlockChrome(
  palette: PaletteColors,
  isDark: boolean
): { fill: string; stroke: string } {
  const surfaceBg = themeBaseBg(palette, isDark);
  return {
    fill: mix(palette.surface, palette.bg, 40),
    stroke: mix(palette.textMuted, surfaceBg, 35),
  };
}
const NODE_TOP_ROW_HEIGHT = 26;
const NODE_BOTTOM_ROW_HEIGHT = 26;
// Edge styling: non-critical edges follow `diagram-visual-conventions.md`
// §4 (uniform textMuted stroke + width + arrowhead). Critical-path
// edges deliberately deviate — they use `palette.colors.red` for the
// stroke and a matching red arrowhead because the critical path is the
// central concept of a PERT chart, and a binary `data-critical` attr
// alone left it visually invisible to readers.
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
// Group-rect treatment per §2: neutral surface fill on textMuted stroke,
// solid border, rx=8, top-center 13pt 'bold' label inside a reserved
// 28px header band — exactly matching org's container recipe.
// CONTAINER_RADIUS/LABEL_FONT_SIZE/HEADER_HEIGHT + COLLAPSE_BAR_HEIGHT now
// imported from utils/visual-conventions (Story 111.1). Group-rect treatment
// per §2; collapse-bar height matches org per §3 Pattern A/B.
// Always-on fade applied to bottom-20% (by duration) activity nodes
// so the eye is drawn to the longer, schedule-dominating work first.
// Less aggressive than FADE_OPACITY because these cards still need to
// be readable; this is a hint, not a hide.
const DURATION_FADE_OPACITY = 0.55;
// Anchor glyph dimensions (Lucide `anchor` path, scaled to fit
// next to the 13pt bold name label). Width drives the layout math;
// height is a derived target for vertical centering.
const PIN_ICON_W = 13;
const PIN_ICON_H = 13;

// Legend pill height — matches the shared `renderLegendD3` legend used
// by Cycle/Mindmap/BoxesAndLines (see `utils/legend-constants.ts`):
// 28px tall, fully-rounded rx, mix-fill against surface. Drives the
// tag-group legend block's reserved height.
const LEGEND_PILL_HEIGHT = LEGEND_HEIGHT_CONST;
// Top gap is the breathing room between the title baseline (or canvas
// top when there's no title) and the pill row. Bottom gap separates
// the pills from the diagram body. Together with LEGEND_PILL_HEIGHT
// they make up the block's reserved height.
const LEGEND_TOP_GAP = 12;
const LEGEND_BOTTOM_GAP = 12;

// Field-reference legend — a 3×2 mini-card that mirrors the schedule
// cells of the textbook PERT card so readers can map each cell's value
// back to its meaning. Renders inside the Analysis row when both are
// on (stacks below Summary in column 1), or in its own full-width row
// when Analysis is off.
// Header band height inlined here (CAPTION_HEADER_BAND_HEIGHT is
// defined later in the file).
const FIELD_LEGEND_HEADER_BAND_HEIGHT = 26;
// Top + bottom padding inside each cell.
const FIELD_LEGEND_CELL_VPAD = 14;
// Pixel height per row in the field-legend grid given how many text
// lines the longest description in that row wraps to. Used by both
// the layout (to reserve canvas height) and the renderer.
function fieldLegendRowHeight(maxDescLines: number): number {
  return (
    FIELD_LEGEND_CELL_VPAD * 2 +
    FIELD_LEGEND_LABEL_FONT_SIZE +
    FIELD_LEGEND_LABEL_DESC_GAP +
    maxDescLines * FIELD_LEGEND_DESC_LINE_HEIGHT
  );
}
// Pixel width the description text wraps within for the given column
// width (column minus 8px of horizontal padding).
function fieldLegendDescWidth(colW: number): number {
  return colW - 8;
}
// Total height the field-legend block needs at the given outer width.
// Accounts for the worst-case description wrap across all 6 cells.
function fieldLegendHeightFor(width: number): number {
  const colW = width / 3;
  const wrapW = fieldLegendDescWidth(colW);
  let maxLines = 1;
  for (const cell of FIELD_LEGEND_CELLS) {
    const n = wrapTextToWidth(
      cell.desc,
      FIELD_LEGEND_DESC_FONT_SIZE,
      wrapW
    ).length;
    if (n > maxLines) maxLines = n;
  }
  return (
    FIELD_LEGEND_HEADER_BAND_HEIGHT +
    fieldLegendRowHeight(maxLines) * 2 +
    CAPTION_BOX_PADDING_Y
  );
}
const FIELD_LEGEND_LABEL_FONT_SIZE = 13;
const FIELD_LEGEND_DESC_FONT_SIZE = 13;
const FIELD_LEGEND_DESC_LINE_HEIGHT = 17;
const FIELD_LEGEND_LABEL_DESC_GAP = 4;
// Greedy word-wrap budget per line — calibrated for 11pt Inter at the
// cell width minus padding.
// Six cells, top row then bottom row — same order as the textbook card:
//   top:    [ ES | dur | EF ]
//   bottom: [ LS | slack | LF ]
const FIELD_LEGEND_CELLS: readonly { label: string; desc: string }[] = [
  {
    label: 'Early Start',
    desc: 'earliest this activity can begin once predecessors finish',
  },
  {
    label: 'Duration',
    desc: 'expected time needed to complete the work',
  },
  {
    label: 'Early Finish',
    desc: 'earliest this activity can be fully completed',
  },
  {
    label: 'Late Start',
    desc: 'latest this activity can begin without delaying the project',
  },
  {
    label: 'Slack',
    desc: "extra time before this activity's delay pushes the deadline",
  },
  {
    label: 'Late Finish',
    desc: 'latest this activity can finish without delaying the project',
  },
];

interface ScaledNodeConstants {
  nodeRadius?: number;
  nodeStrokeWidth?: number;
  nodeTopRowHeight?: number;
  nodeBottomRowHeight?: number;
  nodeFontSize?: number;
  nodeCellFontSize?: number;
  pinIconW?: number;
  pinIconH?: number;
}

interface ScaledGroupConstants extends ScaledNodeConstants {
  containerRadius?: number;
  containerLabelFontSize?: number;
  containerHeaderHeight?: number;
  collapseBarHeight?: number;
}

interface ScaledEdgeConstants {
  edgeStrokeWidth?: number;
  edgeLabelFontSize?: number;
}

const lineGenerator = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

// ============================================================
// Criticality bands
// ============================================================

type Band = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | null;

/**
 * Map a Monte-Carlo criticality index (0–1) to a color band, or `null`
 * when the activity is essentially never on the critical path. The
 * five-band split visualizes how schedule risk is distributed across
 * candidate paths:
 *   red    ≥ 0.80 — very likely critical, plan conservatively
 *   orange ≥ 0.50 — often critical
 *   yellow ≥ 0.25 — could swing either way
 *   green  ≥ 0.10 — occasionally
 *   blue   ≥ 0.02 — rare but non-zero
 *   default       — effectively never critical
 */
function criticalityBand(c: number | null): Band {
  if (c === null) return null;
  if (c >= 0.8) return 'red';
  if (c >= 0.5) return 'orange';
  if (c >= 0.25) return 'yellow';
  if (c >= 0.1) return 'green';
  if (c >= 0.02) return 'blue';
  return null;
}

function bandColor(
  band: Band,
  palette: PaletteColors,
  fallback: string
): string {
  return band === null ? fallback : palette.colors[band];
}

function bandArrow(band: Band): string {
  return band === null ? 'pert-arrow' : `pert-arrow-${band}`;
}

// ============================================================
// Public API
// ============================================================

export interface PertRenderOptions {
  /** Optional title rendered above the diagram. */
  title?: string | null;
  /**
   * Optional one-line project subtitle rendered under the title (or in
   * the title slot when the title is suppressed via `no-title`). Carries
   * the project-level μ ± σ + anchor-derived date(s) so the duration
   * stays visible even when the Analysis row is toggled off. Pass `null`
   * to suppress (the desktop preview does this — it draws an HTML
   * subtitle below the React `<h1>` instead). Typically wired from
   * `resolved.projectSubtitle`.
   */
  subtitle?: string | null;
  /** Optional callback for click → editor sync. */
  onClickItem?: (lineNumber: number) => void;
  /**
   * Override container dimensions during export. Treated as a hint:
   * the renderer will expand height/width if needed to fit chrome
   * (title + backward-anchor annotation + diagram body + caption
   * block) so the diagram never clips. Pass `undefined` (or omit) to
   * use the auto-computed natural size.
   */
  exportDims?: { width?: number; height?: number };
  /**
   * Group ids that should render as a single collapsed surface.
   * When set, the renderer:
   *   - draws the group rect with a solid fill and the rolled-up
   *     attribute body (μ / σ / slack / ES·EF / LS·LF / criticality)
   *   - skips every activity node whose `groupId` is in this set
   *   - skips every edge whose source AND target are both inside a
   *     collapsed group (i.e. internal-only edges)
   */
  collapsedGroupIds?: readonly string[];
  /**
   * Render the 3×2 field-reference mini-card to the right of the
   * Summary box. Helps presenters explain what each schedule cell
   * (ES / dur / EF / LS / slack / LF) means while reviewing the
   * diagram. Off by default; the desktop app turns it on with the
   * "Field labels" toggle.
   */
  showFieldLegend?: boolean;
  /**
   * Render the tag-group legend inside the SVG, between the title and
   * the diagram. Defaults to true so CLI exports and share-link images
   * include it; the desktop preview flips it off and renders the legend
   * in a sibling native-pixel SVG instead, so the pill text stays at
   * intended size even when the diagram SVG gets scale-to-fit'd into the
   * panel.
   */
  showLegend?: boolean;
  /**
   * Render the project-stats Summary box below the diagram. Defaults
   * to true so CLI exports / share-link images keep showing it; the
   * desktop app's cog has a "Summary" toggle that flips this off when
   * readers want a cleaner chart.
   */
  showSummary?: boolean;
  /**
   * Render the Tornado sensitivity chart below the diagram. Reads
   * existing Monte-Carlo output (criticality + per-activity sigma)
   * and ranks activities by Schedule Sensitivity Index. Off by
   * default; the desktop app exposes it as a cog toggle.
   * When MC didn't run (analytical mode), the widget renders nothing.
   */
  showTornado?: boolean;
  /**
   * Render the S-curve (cumulative completion probability) below the
   * diagram. Reads the empirical CDF of Monte-Carlo trial finish times
   * — gives readers the full distribution shape, not just three
   * percentile dates. Off by default. Silently omits when MC didn't
   * run.
   */
  showScurve?: boolean;
  /**
   * Programmatic override for the active tag group — wins over
   * `options.activeTag` from the parsed source. Used by the desktop
   * preview when the user clicks a tag-legend pill: that interaction
   * sets the override (without mutating the parsed source) and
   * triggers a re-render with the new coloring. Pass `null` (or
   * `'none'`) to explicitly suppress tag coloring; omit to fall
   * through to the parsed `active-tag` directive.
   */
  activeTagOverride?: string | null;
  /** True when rendering for export — strips collapsed pills and cog from legend. */
  exportMode?: boolean;
  containerWidth?: number;
}

export function renderPert(
  container: HTMLDivElement,
  resolved: ResolvedPert,
  layout: LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  options: PertRenderOptions = {}
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const effectiveTitle = options.title;
  const effectiveSubtitle = options.subtitle ?? null;
  const titleHeight = effectiveTitle ? 80 : effectiveSubtitle ? 50 : 0;

  const anchorAnnotation = anchorAnnotationText(resolved);

  const collapsedSet = new Set(options.collapsedGroupIds ?? []);
  const captionRows = resolved.error !== null ? null : resolved.summaryRows;
  const captionBullets: CaptionBullet[] =
    captionRows !== null && captionRows.length > 0
      ? bulletizeCaption(captionRows)
      : [];
  if (anchorAnnotation) {
    captionBullets.push({
      text: anchorAnnotation,
      level: 0,
      italic: true,
    });
  }
  const analysisLayer = computeAnalysisLayer(resolved, captionBullets, {
    showSummary: options.showSummary ?? true,
    showTornado: options.showTornado ?? false,
    showScurve: options.showScurve ?? false,
    showFieldLegend: options.showFieldLegend ?? false,
  });
  const standaloneFieldLegendWidthForExport = layout.width;
  const analysisBlockHeightAt = (contentWidth: number): number =>
    analysisLayer.analysisHasContent
      ? CAPTION_TOP_GAP + analysisContentHeightAt(analysisLayer, contentWidth)
      : 0;
  const fieldLegendBlockHeight = analysisLayer.fieldLegendStandalone
    ? CAPTION_TOP_GAP +
      fieldLegendHeightFor(standaloneFieldLegendWidthForExport)
    : 0;
  const showLegend = options.showLegend ?? true;
  const tagLegendActive = resolveActiveTagGroup(
    resolved.tagGroups,
    resolved.options.activeTag,
    options.activeTagOverride
  );
  const showTagLegend =
    showLegend && !resolved.options.noLegend && resolved.tagGroups.length > 0;
  const legendBlockHeight = showTagLegend
    ? LEGEND_TOP_GAP + LEGEND_PILL_HEIGHT + LEGEND_BOTTOM_GAP
    : 0;

  const naturalChartWidth = layout.width + DIAGRAM_PADDING * 2;
  const minAnalysisRowW = analysisLayer.analysisHasContent
    ? analysisLayer.minContentWidth + 2 * DIAGRAM_PADDING
    : 0;
  const naturalWidth = Math.max(naturalChartWidth, minAnalysisRowW);
  // At the natural width the analysis row always fits on one line, so
  // this is the row-mode height. The scaled canvas below can be
  // narrower, and then the row stacks — measure it again there.
  const naturalHeight =
    layout.height +
    DIAGRAM_PADDING * 2 +
    titleHeight +
    legendBlockHeight +
    analysisBlockHeightAt(naturalWidth - DIAGRAM_PADDING * 2) +
    fieldLegendBlockHeight;
  const exportWidth = Math.max(
    options.exportDims?.width ?? naturalWidth,
    naturalWidth
  );
  const exportHeight = Math.max(
    options.exportDims?.height ?? naturalHeight,
    naturalHeight
  );
  if (exportWidth <= 0 || exportHeight <= 0) return;

  const ctx = options.exportDims
    ? ScaleContext.identity()
    : options.containerWidth != null
      ? ScaleContext.from(options.containerWidth, naturalWidth)
      : ScaleContext.identity();

  const sDiagramPad = ctx.aesthetic(DIAGRAM_PADDING);
  const sTitleHeight = ctx.aesthetic(titleHeight);
  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sTitleY = ctx.aesthetic(TITLE_Y);
  const sSubtitleFontSize = ctx.text(13);
  const sLegendTopGap = ctx.aesthetic(LEGEND_TOP_GAP);
  const sLegendBottomGap = ctx.aesthetic(LEGEND_BOTTOM_GAP);
  const sLegendPillHeight = ctx.structural(LEGEND_PILL_HEIGHT);
  const sLegendBlockHeight = showTagLegend
    ? sLegendTopGap + sLegendPillHeight + sLegendBottomGap
    : 0;
  const sNodeRadius = ctx.structural(NODE_RADIUS);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sNodeFontSize = ctx.text(NODE_FONT_SIZE);
  const sNodeCellFontSize = ctx.text(NODE_CELL_FONT_SIZE);
  const sNodeTopRowHeight = ctx.structural(NODE_TOP_ROW_HEIGHT);
  const sNodeBottomRowHeight = ctx.structural(NODE_BOTTOM_ROW_HEIGHT);
  const sEdgeStrokeWidth = ctx.structural(EDGE_STROKE_WIDTH);
  const sArrowheadW = ctx.structural(ARROWHEAD_W);
  const sArrowheadH = ctx.structural(ARROWHEAD_H);
  const sContainerRadius = ctx.structural(CONTAINER_RADIUS);
  const sContainerLabelFontSize = ctx.text(CONTAINER_LABEL_FONT_SIZE);
  const sContainerHeaderHeight = ctx.structural(CONTAINER_HEADER_HEIGHT);
  const sCollapseBarHeight = ctx.structural(COLLAPSE_BAR_HEIGHT);
  const sPinIconW = ctx.structural(PIN_ICON_W);
  const sPinIconH = ctx.structural(PIN_ICON_H);

  const scaledWidth = layout.width + sDiagramPad * 2;
  const scaledHeight =
    layout.height +
    sDiagramPad * 2 +
    sTitleHeight +
    sLegendBlockHeight +
    analysisBlockHeightAt(scaledWidth - sDiagramPad * 2) +
    fieldLegendBlockHeight;
  const svgW = ctx.isBelowFloor ? exportWidth : scaledWidth;
  const svgH = ctx.isBelowFloor ? exportHeight : scaledHeight;

  // §1.9 `legend-inline` (decision #50): one-line header when tag groups exist.
  const inlineRequested =
    resolved.options.legendInline === true && showTagLegend;
  const legendExtent = inlineRequested
    ? getLegendExtent(
        {
          groups: resolved.tagGroups.map((g) => ({
            name: g.name,
            entries: g.entries,
          })),
          position: {
            placement: 'top-center',
            titleRelation: 'inline-with-title',
          },
          mode: options.exportMode ? 'export' : 'preview',
        },
        { activeGroup: tagLegendActive },
        svgW
      )
    : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: effectiveTitle ?? '',
    hasLegend: showTagLegend,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth: svgW,
    titleBandHeight: sTitleHeight,
    legendReserve: sLegendBlockHeight,
    titleBaselineY: sTitleY,
    titleFontSize: sTitleFontSize,
  });

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', ctx.isBelowFloor ? '100%' : svgW)
    .attr('height', svgH)
    .attr('viewBox', `0 0 ${svgW} ${svgH}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY);

  const defs = svg.append('defs');
  buildArrowheads(defs, palette, sArrowheadW, sArrowheadH);

  if (effectiveTitle) {
    svg
      .append('text')
      .attr('class', 'pert-title chart-title')
      .attr('x', header.titleX)
      .attr('y', sTitleY)
      .attr('text-anchor', header.titleAnchor)
      .attr('fill', palette.text)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(effectiveTitle);
  }
  if (effectiveSubtitle) {
    const subtitleY = effectiveTitle ? sTitleY + ctx.aesthetic(26) : sTitleY;
    svg
      .append('text')
      .attr('class', 'pert-subtitle')
      .attr('x', svgW / 2)
      .attr('y', subtitleY)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.textMuted)
      .attr('font-size', sSubtitleFontSize)
      .attr('font-weight', 400)
      .text(effectiveSubtitle);
  }

  const offsetX = Math.max(sDiagramPad, (svgW - layout.width) / 2);
  const offsetY =
    sDiagramPad + sTitleHeight + (header.inline ? 0 : sLegendBlockHeight);

  if (showTagLegend) {
    const tagLegendY = sDiagramPad + sTitleHeight + sLegendTopGap;
    renderTagLegendRow(svg, resolved, palette, isDark, {
      x: header.inline ? svgW - INLINE_HEADER_PAD - legendExtent.width : 0,
      y: header.inline ? header.legendY : tagLegendY,
      width: header.inline ? legendExtent.width : svgW,
      activeGroup: tagLegendActive,
      inline: header.inline,
      ...(options.exportMode !== undefined && {
        exportMode: options.exportMode,
      }),
    });
  }

  const root = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY})`);

  const sizing = computeNodeSizing(resolved);
  renderGroups(root, resolved, layout, palette, isDark, collapsedSet, sizing, {
    nodeRadius: sNodeRadius,
    nodeStrokeWidth: sNodeStrokeWidth,
    containerRadius: sContainerRadius,
    containerLabelFontSize: sContainerLabelFontSize,
    containerHeaderHeight: sContainerHeaderHeight,
    collapseBarHeight: sCollapseBarHeight,
    nodeTopRowHeight: sNodeTopRowHeight,
    nodeBottomRowHeight: sNodeBottomRowHeight,
    nodeFontSize: sNodeFontSize,
    nodeCellFontSize: sNodeCellFontSize,
    pinIconW: sPinIconW,
    pinIconH: sPinIconH,
  });
  renderEdges(root, resolved, layout, palette, collapsedSet, {
    edgeStrokeWidth: sEdgeStrokeWidth,
    edgeLabelFontSize: ctx.text(10),
  });
  renderNodes(
    root,
    defs,
    resolved,
    layout,
    palette,
    isDark,
    sizing,
    options.onClickItem,
    collapsedSet,
    options.activeTagOverride,
    {
      nodeRadius: sNodeRadius,
      nodeStrokeWidth: sNodeStrokeWidth,
      nodeTopRowHeight: sNodeTopRowHeight,
      nodeBottomRowHeight: sNodeBottomRowHeight,
      nodeFontSize: sNodeFontSize,
      nodeCellFontSize: sNodeCellFontSize,
      pinIconW: sPinIconW,
      pinIconH: sPinIconH,
    }
  );

  paintAnalysisLayer(
    svg,
    resolved,
    palette,
    isDark,
    analysisLayer,
    captionBullets,
    sDiagramPad,
    offsetY + layout.height,
    svgW - 2 * sDiagramPad
  );
}

export function renderPertForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors,
  /**
   * Optional parse-time "today" override. Threads through to
   * `parsePert({ now })` so the analyzer's backward-mode past-date
   * check + the anchor annotation's "(as of YYYY-MM-DD)" suffix stay
   * deterministic. Test snapshots pin this; production code omits it.
   */
  now?: Date
): string {
  const parsed = parsePert(content, {
    ...(now !== undefined && { now }),
    palette,
  });
  if (parsed.error || parsed.activities.length === 0) return '';

  const resolved = analyzePert(parsed);
  const layout = layoutPert(resolved);
  const isDark = theme === 'dark';

  // Mirror renderPert's reservation: 80 for title (subtitle nests below it),
  // 50 for subtitle-only, 0 when neither is present. `no-title` suppresses
  // the title but the subtitle (project μ ± σ) is project-level and stays.
  const hasTitle = !!parsed.title && !resolved.options.noTitle;
  const hasSubtitle = resolved.projectSubtitle !== null;
  const titleHeight = hasTitle ? 80 : hasSubtitle ? 50 : 0;
  // Mirror the bullet-list assembly inside renderPert so exportDims
  // matches the natural height (anchor annotation now lives inside
  // the caption box as a final italic bullet).
  const captionBullets: CaptionBullet[] =
    resolved.summaryRows !== null && resolved.summaryRows.length > 0
      ? bulletizeCaption(resolved.summaryRows)
      : [];
  const anchorNote = anchorAnnotationText(resolved);
  if (anchorNote) {
    captionBullets.push({ text: anchorNote, level: 0, italic: true });
  }
  const captionBoxHeight =
    captionBullets.length > 0
      ? captionBullets.length * CAPTION_LINE_HEIGHT +
        2 * CAPTION_BOX_PADDING_Y +
        CAPTION_HEADER_BAND_HEIGHT
      : 0;
  const captionBlockHeight =
    captionBullets.length > 0 ? CAPTION_TOP_GAP + captionBoxHeight : 0;
  // Mirror renderPert's tag-legend reservation so the offscreen
  // container matches the natural canvas height.
  const legendBlockHeight =
    resolved.tagGroups.length > 0
      ? LEGEND_TOP_GAP + LEGEND_PILL_HEIGHT + LEGEND_BOTTOM_GAP
      : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    layout.height +
    DIAGRAM_PADDING * 2 +
    titleHeight +
    legendBlockHeight +
    captionBlockHeight;

  const container = document.createElement('div');
  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderPert(container, resolved, layout, palette, isDark, {
      title: hasTitle ? parsed.title : null,
      subtitle: resolved.projectSubtitle,
      exportDims: { width: exportWidth, height: exportHeight },
      exportMode: true,
    });
    const svgEl = container.querySelector('svg');
    if (!svgEl) return '';
    if (theme === 'transparent') svgEl.style.background = 'none';
    else svgEl.style.background = palette.bg;
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;
    return serializeSvg(svgEl);
  } finally {
    document.body.removeChild(container);
  }
}

// ============================================================
// Analysis layer (Summary + Tornado + S-curve + Field labels)
// ============================================================
//
// Shared by the inline renderPert path (analysis row below the diagram)
// and the standalone sibling-SVG path used by the desktop preview
// (renderPertAnalysisBlock). The desktop preview renders the layer in
// a separate native-pixel SVG so its text stays readable regardless of
// the scale applied to the main diagram SVG.

type AnalysisKind = 'summary' | 'tornado' | 'scurve';

interface AnalysisLayerOptions {
  showSummary: boolean;
  showTornado: boolean;
  showScurve: boolean;
  showFieldLegend: boolean;
}

interface AnalysisLayerState {
  // Resolved on/off states (data availability has been considered).
  summaryRendered: boolean;
  showTornado: boolean;
  showScurve: boolean;
  fieldLegendInAnalysisRow: boolean;
  fieldLegendStandalone: boolean;
  analysisHasContent: boolean;

  // Computed widget content (cached so paint matches precompute).
  tornadoRows: TornadoRow[];
  scurveData: ScurveData | null;
  analysisCharts: { kind: AnalysisKind; contentHeight: number }[];

  // Sub-block heights (width-independent).
  captionBoxHeight: number;
  fieldLegendCol1Height: number;
  tornadoBoxHeight: number;
  scurveBoxHeight: number;
  col1Width: number;
  col1Height: number;
  analysisRowHeight: number;

  // Minimum content width (excludes outer padding) below which the
  // analysis row's chart axes overlap. Caller adds outer padding.
  minContentWidth: number;
}

function computeAnalysisLayer(
  resolved: ResolvedPert,
  captionBullets: CaptionBullet[],
  opts: AnalysisLayerOptions
): AnalysisLayerState {
  const summaryRendered = opts.showSummary && captionBullets.length > 0;
  const captionBoxHeight = summaryRendered
    ? captionBullets.length * CAPTION_LINE_HEIGHT +
      2 * CAPTION_BOX_PADDING_Y +
      CAPTION_HEADER_BAND_HEIGHT
    : 0;
  // Tornado / S-curve only render when MC ran — analytical mode
  // produces no criticality/sigma data.
  let tornadoRows = opts.showTornado ? buildTornadoRows(resolved) : [];
  const showTornado = tornadoRows.length > 0;
  let tornadoBoxHeight = showTornado ? tornadoBoxHeightFor(tornadoRows) : 0;
  const scurveData = opts.showScurve ? buildScurveData(resolved) : null;
  const showScurve = scurveData !== null;
  const scurveBoxHeight = showScurve ? SCURVE_BOX_HEIGHT : 0;

  const fieldLegendInAnalysisRow =
    opts.showFieldLegend && (summaryRendered || showTornado || showScurve);
  const col1Width = summaryRendered
    ? Math.max(
        SUMMARY_MIN_W,
        Math.min(SUMMARY_MAX_W, captionNaturalWidth(captionBullets))
      )
    : fieldLegendInAnalysisRow
      ? SUMMARY_MAX_W
      : 0;
  const fieldLegendCol1Height = fieldLegendInAnalysisRow
    ? fieldLegendHeightFor(col1Width)
    : 0;
  const col1Items: number[] = [];
  if (summaryRendered) col1Items.push(captionBoxHeight);
  if (fieldLegendInAnalysisRow) col1Items.push(fieldLegendCol1Height);
  const col1Height = col1Items.length
    ? col1Items.reduce((a, b) => a + b, 0) +
      (col1Items.length - 1) * COL1_VSTACK_GAP
    : 0;

  let analysisRowHeight = Math.max(
    col1Height,
    scurveBoxHeight,
    tornadoBoxHeight
  );
  // Grow Tornado to fill leftover vertical room when col 1 / S-curve
  // are taller than the default-N row count would produce.
  if (showTornado) {
    const maxRows = tornadoMaxRowsFor(analysisRowHeight);
    if (maxRows > tornadoRows.length) {
      tornadoRows = buildTornadoRows(resolved, maxRows);
      tornadoBoxHeight = tornadoBoxHeightFor(tornadoRows);
      analysisRowHeight = Math.max(
        col1Height,
        scurveBoxHeight,
        tornadoBoxHeight
      );
    }
  }

  const analysisCharts: { kind: AnalysisKind; contentHeight: number }[] = [];
  if (showTornado)
    analysisCharts.push({ kind: 'tornado', contentHeight: tornadoBoxHeight });
  if (showScurve)
    analysisCharts.push({ kind: 'scurve', contentHeight: scurveBoxHeight });
  const analysisHasContent =
    summaryRendered || analysisCharts.length > 0 || fieldLegendInAnalysisRow;
  const fieldLegendStandalone =
    opts.showFieldLegend && !fieldLegendInAnalysisRow;

  // Minimum content width — col1 + sum of chart minimums + gaps.
  let minContentWidth = 0;
  if (analysisHasContent) {
    const col1Used = summaryRendered || fieldLegendInAnalysisRow;
    if (col1Used) minContentWidth += col1Width;
    for (const w of analysisCharts) {
      minContentWidth += w.kind === 'tornado' ? TORNADO_MIN_W : SCURVE_MIN_W;
    }
    const colCount = (col1Used ? 1 : 0) + analysisCharts.length;
    if (colCount > 1) minContentWidth += (colCount - 1) * ANALYSIS_GAP;
  }

  return {
    summaryRendered,
    showTornado,
    showScurve,
    fieldLegendInAnalysisRow,
    fieldLegendStandalone,
    analysisHasContent,
    tornadoRows,
    scurveData,
    analysisCharts,
    captionBoxHeight,
    fieldLegendCol1Height,
    tornadoBoxHeight,
    scurveBoxHeight,
    col1Width,
    col1Height,
    analysisRowHeight,
    minContentWidth,
  };
}

/**
 * Total height the analysis layer needs at the given availableWidth.
 * Mirrors paintAnalysisLayer's mode selection: row mode when width fits
 * the single-row minimum, otherwise greedy-packed multi-row stack mode.
 * Returns 0 when nothing renders.
 */
function analysisLayerHeightAt(
  state: AnalysisLayerState,
  availableWidth: number
): number {
  if (!state.analysisHasContent) {
    return state.fieldLegendStandalone
      ? CAPTION_TOP_GAP + fieldLegendHeightFor(availableWidth)
      : 0;
  }
  return CAPTION_TOP_GAP + analysisContentHeightAt(state, availableWidth);
}

/**
 * Height of the analysis content itself at `availableWidth`, excluding
 * the gap above it and the standalone field-legend case. Row mode when
 * the width fits the single-row minimum, greedy-packed stack otherwise
 * — the same choice `paintAnalysisLayer` makes, which is the whole
 * point: a caller that reserves `analysisRowHeight` unconditionally
 * under-reserves by a whole stacked row and clips the bottom block off
 * the canvas (#420, seen once the Summary card made three items).
 */
function analysisContentHeightAt(
  state: AnalysisLayerState,
  availableWidth: number
): number {
  if (!state.analysisHasContent) return 0;
  if (availableWidth >= state.minContentWidth) return state.analysisRowHeight;
  // Stack mode — type-grouped rows; sum per-row max heights.
  const rows = packRows(state, availableWidth);
  let total = 0;
  rows.forEach((row, i) => {
    let rowHeight = 0;
    for (const item of row) {
      rowHeight = Math.max(
        rowHeight,
        itemContentHeight(state, item.kind, item.paintWidth)
      );
    }
    total += rowHeight;
    if (i < rows.length - 1) total += ANALYSIS_GAP;
  });
  return total;
}

function paintAnalysisLayer(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedPert,
  palette: PaletteColors,
  isDark: boolean,
  state: AnalysisLayerState,
  captionBullets: CaptionBullet[],
  x: number,
  y: number,
  availableWidth: number
): number {
  if (!state.analysisHasContent) {
    if (!state.fieldLegendStandalone) return 0;
    const bandY = y + CAPTION_TOP_GAP;
    const h = fieldLegendHeightFor(availableWidth);
    renderFieldLegendBlock(svg, {
      x,
      y: bandY,
      width: availableWidth,
      height: h,
      palette,
      isDark,
    });
    return CAPTION_TOP_GAP + h;
  }

  // When the panel is wide enough for a single row, use the original
  // side-by-side layout. Otherwise fall back to stack mode so nothing
  // overflows horizontally — text stays at native pixel size in both.
  if (availableWidth >= state.minContentWidth) {
    return paintAnalysisRowMode(
      svg,
      resolved,
      palette,
      isDark,
      state,
      captionBullets,
      x,
      y,
      availableWidth
    );
  }
  return paintAnalysisStackMode(
    svg,
    resolved,
    palette,
    isDark,
    state,
    captionBullets,
    x,
    y,
    availableWidth
  );
}

function paintAnalysisRowMode(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedPert,
  palette: PaletteColors,
  isDark: boolean,
  state: AnalysisLayerState,
  captionBullets: CaptionBullet[],
  x: number,
  y: number,
  availableWidth: number
): number {
  const bandY = y + CAPTION_TOP_GAP;
  const col1Used = state.summaryRendered || state.fieldLegendInAnalysisRow;
  const colCount = (col1Used ? 1 : 0) + state.analysisCharts.length;
  const nGaps = Math.max(0, colCount - 1);
  const usableWidth = availableWidth - nGaps * ANALYSIS_GAP;
  const chartWidth =
    state.analysisCharts.length > 0
      ? (usableWidth - state.col1Width) / state.analysisCharts.length
      : 0;
  // Charts first (Tornado then S-curve), then col-1 stack on the
  // right so Summary's percentile numbers tie visually to the S-curve.
  let cursorX = x;
  for (const w of state.analysisCharts) {
    const args = {
      x: cursorX,
      y: bandY,
      width: chartWidth,
      height: state.analysisRowHeight,
      palette,
      isDark,
    };
    if (w.kind === 'tornado') {
      renderTornadoBlock(svg, state.tornadoRows, {
        ...args,
        fillMode: resolved.options.fillMode,
      });
    } else {
      // Promote the first caption row ("Expected duration: …") into
      // the S-curve's header band when the Summary card is suppressed,
      // so the project's headline stat still appears somewhere. When
      // Summary IS rendered alongside, the title is omitted to avoid
      // duplicating the same line in two places.
      const scurveTitle =
        !state.summaryRendered && captionBullets.length > 0
          ? // In-bounds by length check.
            captionBullets[0]!.text
          : undefined;
      renderScurveBlock(svg, state.scurveData!, {
        ...args,
        unit: resolved.options.timeUnit,
        ...(scurveTitle !== undefined && { title: scurveTitle }),
      });
    }
    cursorX += chartWidth + ANALYSIS_GAP;
  }
  if (col1Used) {
    let stackY = bandY;
    if (state.summaryRendered) {
      renderCaptionBlock(svg, captionBullets, {
        x: cursorX,
        y: stackY,
        width: state.col1Width,
        height: state.captionBoxHeight,
        palette,
        isDark,
      });
      stackY += state.captionBoxHeight + COL1_VSTACK_GAP;
    }
    if (state.fieldLegendInAnalysisRow) {
      renderFieldLegendBlock(svg, {
        x: cursorX,
        y: stackY,
        width: state.col1Width,
        height: state.fieldLegendCol1Height,
        palette,
        isDark,
      });
    }
  }
  return CAPTION_TOP_GAP + state.analysisRowHeight;
}

type StackItemKind = 'summary' | 'tornado' | 'scurve' | 'field';
interface PaintItem {
  kind: StackItemKind;
  paintWidth: number;
}

// Field labels wraps to any width; this is a "looks OK" floor so it
// doesn't get squeezed paper-thin alongside another item.
const FIELD_LEGEND_MIN_W = 220;

// Type-grouped packing. Charts (tornado, scurve) share a row so they
// stay expressive at narrow widths instead of getting squeezed next to
// Summary's content-fit box. Texts (summary, field) share their own
// row with Summary at content-fit and Field labels filling the rest —
// that puts the leftover width where wrapped descriptions actually
// benefit from it. Each row falls back to vertical stacking when its
// side-by-side minimums don't fit the available width.
function packRows(
  state: AnalysisLayerState,
  availableWidth: number
): PaintItem[][] {
  const rows: PaintItem[][] = [];

  // ── Charts row ─────────────────────────────────────────────
  const charts = state.analysisCharts;
  if (charts.length === 2) {
    // In-bounds by length === 2 check.
    const minTwo =
      (charts[0]!.kind === 'tornado' ? TORNADO_MIN_W : SCURVE_MIN_W) +
      ANALYSIS_GAP +
      (charts[1]!.kind === 'tornado' ? TORNADO_MIN_W : SCURVE_MIN_W);
    if (availableWidth >= minTwo) {
      const itemW = (availableWidth - ANALYSIS_GAP) / 2;
      rows.push([
        { kind: charts[0]!.kind, paintWidth: itemW },
        { kind: charts[1]!.kind, paintWidth: itemW },
      ]);
    } else {
      for (const c of charts) {
        rows.push([{ kind: c.kind, paintWidth: availableWidth }]);
      }
    }
  } else if (charts.length === 1) {
    // In-bounds by length === 1 check.
    rows.push([{ kind: charts[0]!.kind, paintWidth: availableWidth }]);
  }

  // ── Texts row ──────────────────────────────────────────────
  const hasSummary = state.summaryRendered;
  const hasField = state.fieldLegendInAnalysisRow;
  if (hasSummary && hasField) {
    const summaryW = state.col1Width;
    const fieldW = availableWidth - summaryW - ANALYSIS_GAP;
    if (fieldW >= FIELD_LEGEND_MIN_W) {
      rows.push([
        { kind: 'summary', paintWidth: summaryW },
        { kind: 'field', paintWidth: fieldW },
      ]);
    } else {
      rows.push([{ kind: 'summary', paintWidth: summaryW }]);
      rows.push([{ kind: 'field', paintWidth: availableWidth }]);
    }
  } else if (hasSummary) {
    rows.push([{ kind: 'summary', paintWidth: state.col1Width }]);
  } else if (hasField) {
    rows.push([{ kind: 'field', paintWidth: availableWidth }]);
  }

  return rows;
}

function itemContentHeight(
  state: AnalysisLayerState,
  kind: StackItemKind,
  paintWidth: number
): number {
  switch (kind) {
    case 'tornado':
      return state.tornadoBoxHeight;
    case 'scurve':
      return state.scurveBoxHeight;
    case 'summary':
      return state.captionBoxHeight;
    case 'field':
      return fieldLegendHeightFor(paintWidth);
  }
}

function paintAnalysisStackMode(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedPert,
  palette: PaletteColors,
  isDark: boolean,
  state: AnalysisLayerState,
  captionBullets: CaptionBullet[],
  x: number,
  y: number,
  availableWidth: number
): number {
  const rows = packRows(state, availableWidth);
  let cursorY = y + CAPTION_TOP_GAP;
  rows.forEach((row, rowIndex) => {
    const gaps = Math.max(0, row.length - 1) * ANALYSIS_GAP;
    const totalRowW = row.reduce((a, it) => a + it.paintWidth, 0) + gaps;
    // Center a sub-width row inside the available space (e.g. Summary
    // alone at content-fit width sitting in a wide panel).
    const rowOffset = Math.max(0, (availableWidth - totalRowW) / 2);
    let rowHeight = 0;
    for (const item of row) {
      rowHeight = Math.max(
        rowHeight,
        itemContentHeight(state, item.kind, item.paintWidth)
      );
    }
    let cursorX = x + rowOffset;
    for (const item of row) {
      const args = {
        x: cursorX,
        y: cursorY,
        width: item.paintWidth,
        height: rowHeight,
        palette,
        isDark,
      };
      switch (item.kind) {
        case 'tornado':
          renderTornadoBlock(svg, state.tornadoRows, {
            ...args,
            fillMode: resolved.options.fillMode,
          });
          break;
        case 'scurve': {
          // Same rule as the side-by-side path: promote the headline
          // caption row to the S-curve's header band when Summary is
          // suppressed, otherwise omit to avoid duplication.
          const scurveTitle =
            !state.summaryRendered && captionBullets.length > 0
              ? // In-bounds by length check.
                captionBullets[0]!.text
              : undefined;
          renderScurveBlock(svg, state.scurveData!, {
            ...args,
            unit: resolved.options.timeUnit,
            ...(scurveTitle !== undefined && { title: scurveTitle }),
          });
          break;
        }
        case 'summary':
          renderCaptionBlock(svg, captionBullets, args);
          break;
        case 'field':
          renderFieldLegendBlock(svg, args);
          break;
      }
      cursorX += item.paintWidth + ANALYSIS_GAP;
    }
    cursorY += rowHeight;
    if (rowIndex < rows.length - 1) cursorY += ANALYSIS_GAP;
  });
  return cursorY - y;
}

/**
 * Measure (without painting) the natural dimensions the analysis layer
 * would consume at the given width. Used by callers that need to lay
 * out the analysis SVG alongside other content — most importantly the
 * desktop preview, which fits diagram + analysis into a fixed panel
 * height by scaling proportionally when natural sizes overflow.
 */
export function measurePertAnalysisBlock(
  resolved: ResolvedPert,
  width: number,
  options: {
    showSummary?: boolean;
    showTornado?: boolean;
    showScurve?: boolean;
    showFieldLegend?: boolean;
  }
): { width: number; height: number } {
  const captionRows = resolved.error !== null ? null : resolved.summaryRows;
  const captionBullets: CaptionBullet[] =
    captionRows !== null && captionRows.length > 0
      ? bulletizeCaption(captionRows)
      : [];
  const anchorAnnotation = anchorAnnotationText(resolved);
  if (anchorAnnotation) {
    captionBullets.push({ text: anchorAnnotation, level: 0, italic: true });
  }
  const state = computeAnalysisLayer(resolved, captionBullets, {
    showSummary: options.showSummary ?? true,
    showTornado: options.showTornado ?? false,
    showScurve: options.showScurve ?? false,
    showFieldLegend: options.showFieldLegend ?? false,
  });
  if (!state.analysisHasContent && !state.fieldLegendStandalone) {
    return { width: 0, height: 0 };
  }
  const itemMinW = Math.max(
    state.summaryRendered ? SUMMARY_MIN_W : 0,
    state.showTornado ? TORNADO_MIN_W : 0,
    state.showScurve ? SCURVE_MIN_W : 0,
    0
  );
  const w = Math.max(width, itemMinW);
  return { width: w, height: analysisLayerHeightAt(state, w) };
}

/**
 * Render the PERT analysis layer (Summary + Tornado + S-curve + Field
 * labels) into its own sibling SVG at native pixel size. Used by the
 * desktop preview so the analysis text stays at intended size even when
 * the main diagram SVG is scale-to-fit'd into the panel.
 */
export function renderPertAnalysisBlock(
  container: HTMLDivElement,
  resolved: ResolvedPert,
  palette: PaletteColors,
  isDark: boolean,
  options: {
    width: number;
    showSummary?: boolean;
    showTornado?: boolean;
    showScurve?: boolean;
    showFieldLegend?: boolean;
  }
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  // Mirror renderPert's caption assembly: project-stats bullets +
  // optional anchor-annotation as the closing italic bullet.
  const captionRows = resolved.error !== null ? null : resolved.summaryRows;
  const captionBullets: CaptionBullet[] =
    captionRows !== null && captionRows.length > 0
      ? bulletizeCaption(captionRows)
      : [];
  const anchorAnnotation = anchorAnnotationText(resolved);
  if (anchorAnnotation) {
    captionBullets.push({ text: anchorAnnotation, level: 0, italic: true });
  }

  const state = computeAnalysisLayer(resolved, captionBullets, {
    showSummary: options.showSummary ?? true,
    showTornado: options.showTornado ?? false,
    showScurve: options.showScurve ?? false,
    showFieldLegend: options.showFieldLegend ?? false,
  });

  if (!state.analysisHasContent && !state.fieldLegendStandalone) return;

  // The desktop preview never wants horizontal scrolling — it'd defeat
  // the whole point of pulling Analysis out of the scale-to-fit SVG.
  // Honor options.width as the hard ceiling; paintAnalysisLayer falls
  // back to stack mode when it can't fit a single row at that width.
  // The absolute floor is the widest single item (since stacked items
  // each need their own minimum).
  const itemMinW = Math.max(
    state.summaryRendered ? SUMMARY_MIN_W : 0,
    state.showTornado ? TORNADO_MIN_W : 0,
    state.showScurve ? SCURVE_MIN_W : 0,
    // Field labels has no hard min — it wraps to whatever width it gets.
    0
  );
  const width = Math.max(options.width, itemMinW);
  const totalHeight = analysisLayerHeightAt(state, width);
  if (totalHeight <= 0 || width <= 0) return;

  // overflow visible so block strokes (1.5px wide → 0.75px past rect)
  // don't get clipped at the SVG's viewBox edges. The wrapper around
  // the SVG already supplies canvas-edge padding so the extra stroke
  // pixels sit harmlessly inside that gutter.
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', totalHeight)
    .attr('viewBox', `0 0 ${width} ${totalHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY)
    .style('overflow', 'visible');

  paintAnalysisLayer(
    svg,
    resolved,
    palette,
    isDark,
    state,
    captionBullets,
    0,
    0,
    width
  );
}

// ============================================================
// Section: arrowhead defs
// ============================================================

type Defs = d3Selection.Selection<SVGDefsElement, unknown, null, undefined>;

function buildArrowheads(
  defs: Defs,
  palette: PaletteColors,
  arrowW: number = ARROWHEAD_W,
  arrowH: number = ARROWHEAD_H
): void {
  const mk = (id: string, fill: string): void => {
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${arrowW} ${arrowH}`)
      .attr('refX', arrowW)
      .attr('refY', arrowH / 2)
      .attr('markerWidth', arrowW)
      .attr('markerHeight', arrowH)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${arrowW},${arrowH / 2} 0,${arrowH}`)
      .attr('fill', fill);
  };
  mk('pert-arrow', palette.textMuted);
  mk('pert-arrow-red', palette.colors.red);
  mk('pert-arrow-orange', palette.colors.orange);
  mk('pert-arrow-yellow', palette.colors.yellow);
  mk('pert-arrow-green', palette.colors.green);
  mk('pert-arrow-blue', palette.colors.blue);
}

// ============================================================
// Section: groups
// ============================================================

type RootSel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

function renderGroups(
  root: RootSel,
  resolved: ResolvedPert,
  layout: LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  collapsedSet: ReadonlySet<string>,
  sizing: NodeSizing,
  sc: ScaledGroupConstants = {}
): void {
  if (layout.groups.length === 0) return;
  const layer = root.append('g').attr('class', 'pert-groups');
  const unit = resolved.options.timeUnit;
  const fillMode = resolved.options.fillMode;

  // Container recipe (non-collapsed groups) — see
  // `docs/architecture/diagram-visual-conventions.md` §2.
  // PERT groups don't carry a color, so use the uncolored-group form:
  // a neutral surface-on-bg mix that reads as a soft grey container,
  // matching org's `Data Team` / `Frontend Team` look.
  const containerFill = mix(palette.surface, palette.bg, 40);
  const containerStroke = palette.textMuted;

  // Collapsed-group surface — looks like a regular activity card per §3
  // Pattern B. Same fill/stroke/radius as `renderNodes`. Border + fill
  // both switch to the band color when any member activity is on the
  // critical path (or by MC criticality band), so the rolled-up card
  // mirrors the activity-card convention.

  const mcOn = resolved.monteCarloResult !== null;
  const groupHasCritical = (groupId: string): boolean =>
    resolved.activities.some(
      (a) => a.activity.groupId === groupId && a.isCriticalPath
    );

  const groupBand = (groupId: string, mcCriticality: number | null): Band =>
    mcOn
      ? criticalityBand(mcCriticality)
      : groupHasCritical(groupId)
        ? 'red'
        : null;

  for (const grp of layout.groups) {
    if (grp.width <= 0 || grp.height <= 0) continue;
    const resolvedGroup = resolved.groups.find((rg) => rg.group.id === grp.id);
    const label = resolvedGroup?.group.name ?? grp.id;
    const isCollapsed = collapsedSet.has(grp.id);
    const memberBand = groupBand(grp.id, resolvedGroup?.criticality ?? null);
    const memberCritical = groupHasCritical(grp.id);

    const g = layer
      .append('g')
      .attr(
        'class',
        isCollapsed ? 'pert-group pert-group-collapsed' : 'pert-group'
      )
      .attr('data-group-id', grp.id)
      .attr('data-group-toggle', grp.id)
      .attr('data-collapsed', String(isCollapsed))
      .attr('data-line-number', String(resolvedGroup?.group.lineNumber ?? 0))
      .attr('data-critical-path', String(memberCritical))
      .attr('data-criticality-band', memberBand ?? '')
      .style('cursor', 'pointer');

    if (isCollapsed) {
      // Render the rolled-up envelope as a textbook card with the
      // group name in the middle band — visually identical to an
      // activity node so users can read it the same way.
      const projectStart = resolved.projectStart;
      const muStr = formatDuration(resolvedGroup?.rolledMu ?? null, unit, '?');
      const slackStr = formatSlackValue(
        resolvedGroup?.slack ?? null,
        projectStart,
        unit,
        '?'
      );
      const esStr = formatScheduleValue(
        resolvedGroup?.es ?? null,
        projectStart,
        unit,
        '?'
      );
      const efStr = formatScheduleValue(
        resolvedGroup?.ef ?? null,
        projectStart,
        unit,
        '?'
      );
      const lsStr = formatScheduleValue(
        resolvedGroup?.ls ?? null,
        projectStart,
        unit,
        '?'
      );
      const lfStr = formatScheduleValue(
        resolvedGroup?.lf ?? null,
        projectStart,
        unit,
        '?'
      );

      const cardBaseColor = bandColor(memberBand, palette, palette.primary);
      const cardFill = shapeFill(palette, cardBaseColor, isDark, {
        mode: fillMode,
      });
      const cardLabelColor = contrastText(
        cardFill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      const sNR = sc.nodeRadius ?? NODE_RADIUS;
      const sCBH = sc.collapseBarHeight ?? COLLAPSE_BAR_HEIGHT;
      drawTextbookCard(g, {
        width: grp.width,
        height: grp.height,
        x: grp.x,
        y: grp.y,
        name: label,
        es: esStr,
        dur: muStr,
        ef: efStr,
        ls: lsStr,
        slack: slackStr,
        lf: lfStr,
        fill: cardFill,
        stroke: cardBaseColor,
        labelColor: cardLabelColor,
        highlightColor: palette.colors.blue,
        outerColW: sizing.outerColW,
        midColW: sizing.midColW,
        sNodeRadius: sc.nodeRadius,
        sNodeStrokeWidth: sc.nodeStrokeWidth,
        sNodeTopRowHeight: sc.nodeTopRowHeight,
        sNodeBottomRowHeight: sc.nodeBottomRowHeight,
        sNodeFontSize: sc.nodeFontSize,
        sNodeCellFontSize: sc.nodeCellFontSize,
        sPinIconW: sc.pinIconW,
        sPinIconH: sc.pinIconH,
      });

      const safeGroupId = grp.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const clipId = `pert-group-clip-${safeGroupId}`;
      g.append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', grp.x)
        .attr('y', grp.y)
        .attr('width', grp.width)
        .attr('height', grp.height)
        .attr('rx', sNR)
        .attr('ry', sNR);
      g.append('rect')
        .attr('class', 'pert-collapse-bar')
        .attr('x', grp.x)
        .attr('y', grp.y + grp.height - sCBH)
        .attr('width', grp.width)
        .attr('height', sCBH)
        .attr('fill', cardBaseColor)
        .attr('clip-path', `url(#${clipId})`);
      continue;
    }

    const sCR = sc.containerRadius ?? CONTAINER_RADIUS;
    const sCLFS = sc.containerLabelFontSize ?? CONTAINER_LABEL_FONT_SIZE;
    const sCHH = sc.containerHeaderHeight ?? CONTAINER_HEADER_HEIGHT;
    const sNSW = sc.nodeStrokeWidth ?? NODE_STROKE_WIDTH;
    g.append('rect')
      .attr('x', grp.x)
      .attr('y', grp.y)
      .attr('width', grp.width)
      .attr('height', grp.height)
      .attr('rx', sCR)
      .attr('ry', sCR)
      .attr('fill', containerFill)
      .attr('stroke', containerStroke)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', sNSW);

    g.append('text')
      .attr('x', grp.x + grp.width / 2)
      .attr('y', grp.y + sCHH / 2 + sCLFS / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('fill', palette.text)
      .attr('font-size', sCLFS)
      .attr('font-weight', 'bold')
      .text(label);
  }
}

// ============================================================
// Section: edges
// ============================================================

function renderEdges(
  root: RootSel,
  resolved: ResolvedPert,
  layout: LayoutResult,
  palette: PaletteColors,
  collapsedSet: ReadonlySet<string>,
  sc: ScaledEdgeConstants = {}
): void {
  const layer = root.append('g').attr('class', 'pert-edges');
  const criticalSet = new Set(resolved.criticalPath);
  const mcOn = resolved.monteCarloResult !== null;

  // Index parsed edges by `source->target` so the renderer can look up
  // the dependency type + lag for each layout edge. Super-edges between
  // collapsed groups won't match (their source/target are group ids);
  // they fall back to the unlabeled default render.
  const edgeByKey = new Map<string, PertEdge>();
  for (const e of resolved.edges) {
    edgeByKey.set(`${e.source}->${e.target}`, e);
  }

  // Map activity → group for fast lookup so we can suppress edges
  // that live entirely inside a collapsed group.
  const activityGroup = new Map<string, string | undefined>();
  const critById = new Map<string, number | null>();
  for (const a of resolved.activities) {
    activityGroup.set(a.activity.id, a.activity.groupId);
    critById.set(a.activity.id, a.criticality);
  }
  // When a group is collapsed, its id appears as `e.source` / `e.target`
  // on super-edges. Roll up criticality so super-edges pick up the
  // right band: max member.criticality (MC mode) or 1.0 if any member
  // is on the binary critical path (analytical mode).
  for (const rg of resolved.groups) {
    if (!collapsedSet.has(rg.group.id)) continue;
    let anyCritical = false;
    let maxC: number | null = null;
    for (const aid of rg.group.activityIds) {
      if (criticalSet.has(aid)) anyCritical = true;
      const c = critById.get(aid);
      if (typeof c === 'number') {
        maxC = maxC === null ? c : Math.max(maxC, c);
      }
    }
    if (anyCritical) criticalSet.add(rg.group.id);
    critById.set(rg.group.id, maxC);
  }

  for (const e of layout.edges) {
    if (e.points.length < 2) continue;
    const srcGroup = activityGroup.get(e.source);
    const tgtGroup = activityGroup.get(e.target);
    if (
      srcGroup &&
      tgtGroup &&
      srcGroup === tgtGroup &&
      collapsedSet.has(srcGroup)
    ) {
      continue; // internal-only edge of a collapsed group
    }
    const isCritical = criticalSet.has(e.source) && criticalSet.has(e.target);
    let band: Band;
    if (mcOn) {
      const sc = critById.get(e.source);
      const tc = critById.get(e.target);
      const minC =
        sc === null || tc === null || sc === undefined || tc === undefined
          ? null
          : Math.min(sc, tc);
      band = criticalityBand(minC);
      // Mirror the node-side fallback: a deterministic critical edge
      // whose endpoints score 0 in MC (e.g., one is a milestone) still
      // belongs to the visual critical chain.
      if (band === null && isCritical) band = 'red';
    } else {
      band = isCritical ? 'red' : null;
    }
    const path = lineGenerator(e.points);
    if (!path) continue;
    const sESW = sc.edgeStrokeWidth ?? EDGE_STROKE_WIDTH;
    const sELFS = sc.edgeLabelFontSize ?? 10;
    layer
      .append('path')
      .attr('class', 'pert-edge')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', bandColor(band, palette, palette.textMuted))
      .attr('stroke-width', sESW)
      .attr('marker-end', `url(#${bandArrow(band)})`)
      .attr('data-source', e.source)
      .attr('data-target', e.target)
      .attr('data-critical', String(isCritical))
      .attr('data-critical-path', String(isCritical))
      .attr('data-criticality-band', band ?? '');

    const parsedEdge = edgeByKey.get(`${e.source}->${e.target}`);
    const labelText = parsedEdge ? formatEdgeLabel(parsedEdge) : null;
    if (labelText) {
      const mid = e.points[Math.floor(e.points.length / 2)]!;
      layer
        .append('text')
        .attr('class', 'pert-edge-label')
        .attr('x', mid.x)
        .attr('y', mid.y - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', palette.textMuted)
        .attr('font-size', sELFS)
        .attr('paint-order', 'stroke')
        .attr('stroke', palette.bg)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('data-edge-source', e.source)
        .attr('data-edge-target', e.target)
        .text(labelText);
    }
  }
}

/**
 * Render an edge label like `SS +2d`, `FF -1d`, or `+2d` (FS-only lag).
 * Returns `null` when the edge is the default FS+0 — those stay clean.
 */
function formatEdgeLabel(edge: PertEdge): string | null {
  if (edge.type === 'FS' && edge.lag === null) return null;
  const parts: string[] = [];
  if (edge.type !== 'FS') parts.push(edge.type);
  if (edge.lag) {
    const sign = edge.lag.amount >= 0 ? '+' : '-';
    const amount = Math.abs(edge.lag.amount);
    parts.push(`${sign}${amount}${edge.lag.unit}`);
  }
  return parts.join(' ');
}

// ============================================================
// Section: nodes
// ============================================================

function renderNodes(
  root: RootSel,
  _defs: Defs,
  resolved: ResolvedPert,
  layout: LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  sizing: NodeSizing,
  onClickItem?: (lineNumber: number) => void,
  collapsedSet: ReadonlySet<string> = new Set(),
  activeTagOverride?: string | null,
  sc: ScaledNodeConstants = {}
): void {
  const layer = root.append('g').attr('class', 'pert-nodes');
  const byId = new Map(resolved.activities.map((r) => [r.activity.id, r]));
  const tbdSet = new Set<string>(
    resolved.activities.filter((r) => r.es === null).map((r) => r.activity.id)
  );
  const unit = resolved.options.timeUnit;
  const sprintMode = resolved.options.sprintMode;
  const sprintNumber = resolved.options.sprintNumber ?? 1;
  const fillMode = resolved.options.fillMode;

  // Active tag group resolution. Programmatic override (e.g. desktop
  // legend click) wins; otherwise the source's `active-tag` directive;
  // otherwise null (collapsed-by-default per spec §1.3).
  const activeTagGroup = resolveActiveTagGroup(
    resolved.tagGroups,
    resolved.options.activeTag,
    activeTagOverride
  );

  // Match org / infra default-node treatment:
  //   fill   = 25% tint of the node's intent color on surface (via shapeFill)
  //   stroke = the node's intent color
  // For critical-path / criticality-band nodes the intent color is the band
  // hue (red / orange / yellow); otherwise it's `palette.primary`. The fill
  // therefore tracks the border so a red-bordered card reads as red-tinted,
  // an orange one as orange-tinted, etc. — same convention as org / infra.
  const projectStart = resolved.projectStart;
  // Four formatter roles. Schedule cells become sprint labels (`S5`)
  // when sprint mode is active, dates when anchored to a calendar,
  // numeric durations otherwise. Slack normalizes to days when
  // anchored. Mu/dur is always a duration label regardless of mode.
  const fmtSchedule = (v: number | null, isTbd: boolean): string => {
    if (sprintMode)
      return formatSprintCell(v, sprintNumber, isTbd ? '?' : null);
    return formatScheduleValue(v, projectStart, unit, isTbd ? '?' : null);
  };
  const fmtSlack = (v: number | null, isTbd: boolean): string =>
    formatSlackValue(v, projectStart, unit, isTbd ? '?' : null);
  const fmtDur = (v: number | null, isTbd: boolean): string =>
    formatDuration(v, unit, isTbd ? '?' : null);

  const mcOn = resolved.monteCarloResult !== null;

  // Duration-rank emphasis: top 20% of (non-milestone, estimated)
  // activities by μ get bold corner cells; bottom 20% fade to
  // DURATION_FADE_OPACITY so the eye is drawn to longer work first.
  // Skipped when the project has fewer than 5 activities — the buckets
  // become noise.
  const { topMuIds, bottomMuIds } = computeDurationEmphasis(
    resolved.activities
  );

  // Anchor set — nodes whose label gets an anchor icon prefix
  // and whose anchor-side corner cells (ES+LS for forward, EF+LF for
  // backward) render bold, because those cells carry the user-supplied
  // date directly rather than a derived offset.
  //   forward  → activities with no predecessors (ES = start-date)
  //   backward → activities with no successors   (LF = end-date)
  // No anchor → empty set, no pins drawn anywhere.
  const pinnedSet = computeAnchorPinSet(resolved);
  const anchorKind = resolved.options.anchor?.kind ?? null;

  for (const node of layout.nodes) {
    const r = byId.get(node.id);
    if (!r) continue;
    if (r.activity.groupId && collapsedSet.has(r.activity.groupId)) continue;
    const isCritical = r.isCriticalPath;
    const isTbd = tbdSet.has(node.id);
    const dashArray = isTbd ? '4,3' : 'none';
    const isTopMu = topMuIds.has(node.id);
    const isBottomMu = bottomMuIds.has(node.id);

    // In MC mode, prefer the per-activity criticality band. Fall back
    // to red when the deterministic critical path includes this
    // activity but the MC band is null — ensures milestones (which
    // tend to score 0 in the simulator) and other quirks don't make
    // the caption's "Critical path:" text disagree with the colors.
    let band: Band;
    if (mcOn) {
      band = criticalityBand(r.criticality);
      if (band === null && isCritical) band = 'red';
    } else {
      band = isCritical ? 'red' : null;
    }

    const g = layer
      .append('g')
      .attr('class', 'pert-node')
      .attr('transform', `translate(${node.x}, ${node.y})`)
      .attr('data-activity-id', node.id)
      .attr('data-line-number', String(r.activity.lineNumber))
      .attr(
        'data-group-id',
        r.activity.groupId !== undefined ? r.activity.groupId : ''
      )
      .attr('data-critical-path', String(isCritical))
      .attr('data-criticality-band', band ?? '')
      .attr('data-duration-rank', isTopMu ? 'top' : isBottomMu ? 'bottom' : '');

    // Tag metadata as `data-tag-<key>` attributes — drives the
    // app-side legend-hover dimming (CSS-only). Identical contract
    // to org / kanban / gantt.
    if (r.activity.tags) {
      for (const [tagKey, tagValue] of Object.entries(r.activity.tags)) {
        g.attr(`data-tag-${tagKey}`, String(tagValue).toLowerCase());
      }
    }

    // Anchored source/sink nodes — the React-layer top legend uses
    // this to fade everything except anchored nodes when "Anchor" is
    // hovered/clicked.
    if (pinnedSet.has(node.id) && anchorKind) {
      g.attr('data-anchor', anchorKind);
    }

    if (onClickItem) {
      g.style('cursor', 'pointer').on('click', () =>
        onClickItem(r.activity.lineNumber)
      );
    }

    const baseColor = bandColor(band, palette, palette.primary);
    const fill = shapeFill(palette, baseColor, isDark, { mode: fillMode });
    const labelColor = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

    // Tag-driven color. Activities paint the middle (name) band only
    // so the criticality border stays the dominant signal; milestones
    // paint the entire pill since they have a single shape.
    const tagColor = resolveTagColor(
      r.activity.tags ?? {},
      resolved.tagGroups,
      activeTagGroup
    );
    const hasTagColor = tagColor !== undefined && tagColor !== '#999999';
    const tagBandFill = hasTagColor
      ? shapeFill(palette, tagColor as string, isDark, { mode: fillMode })
      : undefined;
    const tagLabelColor = hasTagColor
      ? contrastText(
          tagBandFill as string,
          palette.textOnFillLight,
          palette.textOnFillDark
        )
      : undefined;

    if (r.activity.isMilestone) {
      // Critical-path milestones have slack ≈ 0; suppressing the slack
      // cell removes a noisy "0d" and a redundant divider since there's
      // no schedule envelope to communicate. Slack is computed as
      // `LS - ES`, which can land on a tiny float instead of exactly 0,
      // so detect via the formatted display ("0", "0d", "0w") — that's
      // what the user would have read in the cell anyway.
      const slackText = fmtSlack(r.slack, isTbd);
      const slackHidden = !isTbd && /^0[a-z]?$/.test(slackText);
      g.attr('data-milestone', 'true');
      if (slackHidden) g.attr('data-milestone-slack-hidden', 'true');
      drawMilestonePill(g, {
        width: node.width,
        height: node.height,
        x: -node.width / 2,
        y: -node.height / 2,
        name: `◆ ${r.activity.name}`,
        date: fmtSchedule(r.es, isTbd),
        slack: slackText,
        slackHidden,
        fill: tagBandFill ?? fill,
        stroke: baseColor,
        labelColor: tagLabelColor ?? labelColor,
        highlightColor: palette.colors.blue,
        dashArray,
        pinned: pinnedSet.has(node.id) ? anchorKind : null,
        sNodeRadius: sc.nodeRadius,
        sNodeStrokeWidth: sc.nodeStrokeWidth,
        sNodeTopRowHeight: sc.nodeTopRowHeight,
        sNodeBottomRowHeight: sc.nodeBottomRowHeight,
        sNodeCellFontSize: sc.nodeCellFontSize,
        sPinIconW: sc.pinIconW,
        sPinIconH: sc.pinIconH,
      });
      continue;
    }

    drawTextbookCard(g, {
      width: node.width,
      height: node.height,
      x: -node.width / 2,
      y: -node.height / 2,
      name: r.activity.name,
      es: fmtSchedule(r.es, isTbd),
      dur: fmtDur(r.mu, isTbd),
      ef: fmtSchedule(r.ef, isTbd),
      ls: fmtSchedule(r.ls, isTbd),
      slack: fmtSlack(r.slack, isTbd),
      lf: fmtSchedule(r.lf, isTbd),
      fill,
      stroke: baseColor,
      highlightColor: palette.colors.blue,
      labelColor,
      dashArray,
      emphasis: isTopMu ? 'top' : isBottomMu ? 'bottom' : null,
      pinned: pinnedSet.has(node.id) ? anchorKind : null,
      outerColW: sizing.outerColW,
      midColW: sizing.midColW,
      ...(tagBandFill !== undefined && { midBandFill: tagBandFill }),
      ...(tagLabelColor !== undefined && { midBandLabelColor: tagLabelColor }),
      sNodeRadius: sc.nodeRadius,
      sNodeStrokeWidth: sc.nodeStrokeWidth,
      sNodeTopRowHeight: sc.nodeTopRowHeight,
      sNodeBottomRowHeight: sc.nodeBottomRowHeight,
      sNodeFontSize: sc.nodeFontSize,
      sNodeCellFontSize: sc.nodeCellFontSize,
      sPinIconW: sc.pinIconW,
      sPinIconH: sc.pinIconH,
    });
  }
}

/**
 * Bucket activities into top-20% / bottom-20% / middle by expected
 * duration (μ). Milestones, TBDs, and zero-μ activities are excluded
 * from the buckets. Skipped (returns empty sets) when fewer than 5
 * activities qualify — the buckets become noise on small projects.
 */
function computeDurationEmphasis(activities: ResolvedActivity[]): {
  topMuIds: Set<string>;
  bottomMuIds: Set<string>;
} {
  const ranked = activities
    .filter(
      (r) => !r.activity.isMilestone && r.mu !== null && (r.mu as number) > 0
    )
    .map((r) => ({ id: r.activity.id, mu: r.mu as number }))
    .sort((a, b) => a.mu - b.mu);
  if (ranked.length < 5) {
    return { topMuIds: new Set(), bottomMuIds: new Set() };
  }
  const tierCount = Math.max(1, Math.floor(ranked.length * 0.2));
  const bottomMuIds = new Set(ranked.slice(0, tierCount).map((b) => b.id));
  const topMuIds = new Set(ranked.slice(-tierCount).map((b) => b.id));
  return { topMuIds, bottomMuIds };
}

// ============================================================
// Section: textbook 3×3 PERT/CPM card
// ============================================================
//
//   ┌──────┬──────┬──────┐
//   │  ES  │ dur  │  EF  │   ← top row
//   ├──────┴──────┴──────┤
//   │        name        │   ← middle row (spans full width)
//   ├──────┬──────┬──────┤
//   │  LS  │ slack│  LF  │   ← bottom row
//   └──────┴──────┴──────┘
//
// Used for both individual activity nodes and collapsed-group cards.

interface TextbookCardArgs {
  width: number;
  height: number;
  x: number;
  y: number;
  name: string;
  es: string;
  dur: string;
  ef: string;
  ls: string;
  slack: string;
  lf: string;
  fill: string;
  stroke: string;
  /** Stroke for internal cell-grid lines. Defaults to `stroke`. */
  gridStroke?: string;
  labelColor: string;
  /**
   * Tint applied behind a cell when the field-legend hover-cross-link
   * activates it. Each cell carries `data-field` + a transparent
   * highlight rect; the React layer flips fill-opacity to 0.25.
   */
  highlightColor: string;
  dashArray?: string;
  /**
   * Duration-rank emphasis. Affects ONLY the `dur` cell: 'top' bolds
   * the duration value, 'bottom' fades it to DURATION_FADE_OPACITY.
   * Card border, fill, name, and other cells are unaffected — the
   * signal is precise to "longer / shorter task".
   */
  emphasis?: 'top' | 'bottom' | null;
  /**
   * When set, prefix the middle-row name with a small anchor icon and
   * bold the corner cells that carry the user-supplied anchor date
   * directly. `'forward'` = source node under `start-date` (bold ES + LS);
   * `'backward'` = sink node under `end-date` (bold EF + LF). `null` /
   * undefined leaves the card plain.
   */
  pinned?: 'forward' | 'backward' | null;
  /**
   * Asymmetric column widths. Outer cells (ES/EF/LS/LF) hold the
   * widest content (date strings) and `midColW` shrinks for the
   * narrow dur/slack labels. Sum of (2*outerColW + midColW) === width.
   */
  outerColW: number;
  midColW: number;
  /**
   * Optional fill for the middle (name) band only. When set, painted
   * on top of the base card fill so corner cells keep `fill` and only
   * the name region picks up the tag color. The card border (stroke)
   * is unaffected — it continues to communicate criticality.
   */
  midBandFill?: string;
  /**
   * Label color used for the name when `midBandFill` is set. Computed
   * via `contrastText()` against the tag-tinted band so the name stays
   * readable regardless of palette/theme.
   */
  midBandLabelColor?: string;
  sNodeRadius?: number | undefined;
  sNodeStrokeWidth?: number | undefined;
  sNodeTopRowHeight?: number | undefined;
  sNodeBottomRowHeight?: number | undefined;
  sNodeFontSize?: number | undefined;
  sNodeCellFontSize?: number | undefined;
  sPinIconW?: number | undefined;
  sPinIconH?: number | undefined;
}

type AnySel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

function drawTextbookCard(g: AnySel, a: TextbookCardArgs): void {
  const { width: w, height: h, x, y } = a;
  const sNR = a.sNodeRadius ?? NODE_RADIUS;
  const sNSW = a.sNodeStrokeWidth ?? NODE_STROKE_WIDTH;
  const sTRH = a.sNodeTopRowHeight ?? NODE_TOP_ROW_HEIGHT;
  const sBRH = a.sNodeBottomRowHeight ?? NODE_BOTTOM_ROW_HEIGHT;
  const sNFS = a.sNodeFontSize ?? NODE_FONT_SIZE;
  const sNCFS = a.sNodeCellFontSize ?? NODE_CELL_FONT_SIZE;
  const sPIW = a.sPinIconW ?? PIN_ICON_W;
  const sPIH = a.sPinIconH ?? PIN_ICON_H;
  const outerColW = a.outerColW;
  const midColW = a.midColW;
  const topY = y + sTRH;
  const bottomY = y + h - sBRH;
  const colX1 = x + outerColW;
  const colX2 = x + outerColW + midColW;

  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', sNR)
    .attr('ry', sNR)
    .attr('fill', a.fill)
    .attr('stroke', a.stroke)
    .attr('stroke-width', sNSW)
    .attr('stroke-dasharray', a.dashArray ?? 'none');

  if (a.midBandFill) {
    g.append('rect')
      .attr('x', x)
      .attr('y', topY)
      .attr('width', w)
      .attr('height', bottomY - topY)
      .attr('fill', a.midBandFill)
      .attr('pointer-events', 'none');
  }

  const gridColor = a.gridStroke ?? a.stroke;
  const grid = (x1: number, y1: number, x2: number, y2: number): void => {
    g.append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', gridColor)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);
  };
  grid(x, topY, x + w, topY);
  grid(x, bottomY, x + w, bottomY);
  grid(colX1, y, colX1, topY);
  grid(colX2, y, colX2, topY);
  grid(colX1, bottomY, colX1, y + h);
  grid(colX2, bottomY, colX2, y + h);

  const drawCellHighlight = (
    field: string,
    cx: number,
    cy: number,
    cw: number,
    ch: number
  ): void => {
    g.append('rect')
      .attr('class', 'pert-cell-highlight')
      .attr('data-field', field)
      .attr('x', cx)
      .attr('y', cy)
      .attr('width', cw)
      .attr('height', ch)
      .attr('fill', a.highlightColor)
      .attr('fill-opacity', 0)
      .attr('pointer-events', 'none');
  };
  drawCellHighlight('es', x, y, outerColW, sTRH);
  drawCellHighlight('dur', x + outerColW, y, midColW, sTRH);
  drawCellHighlight('ef', x + outerColW + midColW, y, outerColW, sTRH);
  drawCellHighlight('ls', x, bottomY, outerColW, sBRH);
  drawCellHighlight('slack', x + outerColW, bottomY, midColW, sBRH);
  drawCellHighlight('lf', x + outerColW + midColW, bottomY, outerColW, sBRH);

  const drawCell = (
    cx: number,
    cy: number,
    text: string,
    weight: 'normal' | 'bold' = 'normal',
    size: number = sNCFS,
    opacity = 1,
    colorOverride?: string
  ): void => {
    const t = g
      .append('text')
      .attr('x', cx)
      .attr('y', cy + size / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('fill', colorOverride ?? a.labelColor)
      .attr('font-size', size)
      .attr('font-weight', weight)
      .text(text);
    if (opacity !== 1) t.attr('opacity', String(opacity));
  };

  const topMid = y + sTRH / 2;
  const durWeight: 'normal' | 'bold' = a.emphasis === 'top' ? 'bold' : 'normal';
  const durOpacity = a.emphasis === 'bottom' ? DURATION_FADE_OPACITY : 1;
  const esWeight: 'normal' | 'bold' =
    a.pinned === 'forward' ? 'bold' : 'normal';
  const efWeight: 'normal' | 'bold' =
    a.pinned === 'backward' ? 'bold' : 'normal';
  drawCell(x + outerColW / 2, topMid, a.es, esWeight);
  drawCell(
    x + outerColW + midColW / 2,
    topMid,
    a.dur,
    durWeight,
    sNCFS,
    durOpacity
  );
  drawCell(x + outerColW + midColW + outerColW / 2, topMid, a.ef, efWeight);

  const midRowTop = y + sTRH;
  const midRowH = h - sTRH - sBRH;
  const midCenterY = midRowTop + midRowH / 2;
  const NAME_PAD_X = 6;
  const NAME_PIN_GAP = 4;
  const pinReserve = a.pinned ? sPIW + NAME_PIN_GAP : 0;
  const availTextW = Math.max(0, w - 2 * NAME_PAD_X - pinReserve);
  // Both drawCell branches below render the name at 'bold'.
  const displayName = truncateText(a.name, sNFS, availTextW, { bold: true });
  const nameColor = a.midBandLabelColor ?? a.labelColor;
  if (a.pinned) {
    drawAnchorPin(g, x + NAME_PAD_X, midCenterY, nameColor, sPIW, sPIH);
    const textAreaLeft = x + NAME_PAD_X + sPIW + NAME_PIN_GAP;
    const textAreaRight = x + w - NAME_PAD_X;
    const textCx = (textAreaLeft + textAreaRight) / 2;
    drawCell(
      textCx,
      midCenterY,
      displayName,
      'bold',
      sNFS,
      1,
      a.midBandLabelColor
    );
  } else {
    drawCell(
      x + w / 2,
      midCenterY,
      displayName,
      'bold',
      sNFS,
      1,
      a.midBandLabelColor
    );
  }

  const botMid = y + h - sBRH / 2;
  const lsWeight: 'normal' | 'bold' = esWeight;
  const lfWeight: 'normal' | 'bold' = efWeight;
  drawCell(x + outerColW / 2, botMid, a.ls, lsWeight);
  drawCell(x + outerColW + midColW / 2, botMid, a.slack);
  drawCell(x + outerColW + midColW + outerColW / 2, botMid, a.lf, lfWeight);
}

interface MilestonePillArgs {
  width: number;
  height: number;
  x: number;
  y: number;
  name: string;
  date: string;
  slack: string;
  /**
   * When true, suppress the slack cell entirely — both the text and the
   * bottom row divider. Used for zero-slack (critical-path) milestones
   * where "0d" / "0w" would just add noise.
   */
  slackHidden?: boolean;
  fill: string;
  stroke: string;
  labelColor: string;
  /** See `TextbookCardArgs.highlightColor`. */
  highlightColor: string;
  dashArray?: string;
  pinned?: 'forward' | 'backward' | null;
  sNodeRadius?: number | undefined;
  sNodeStrokeWidth?: number | undefined;
  sNodeTopRowHeight?: number | undefined;
  sNodeBottomRowHeight?: number | undefined;
  sNodeCellFontSize?: number | undefined;
  sPinIconW?: number | undefined;
  sPinIconH?: number | undefined;
}

function drawMilestonePill(g: AnySel, a: MilestonePillArgs): void {
  const { width: w, height: h, x, y } = a;
  const sNR = a.sNodeRadius ?? NODE_RADIUS;
  const sNSW = a.sNodeStrokeWidth ?? NODE_STROKE_WIDTH;
  const topRowH = a.sNodeTopRowHeight ?? NODE_TOP_ROW_HEIGHT;
  const botRowH = a.sNodeBottomRowHeight ?? NODE_BOTTOM_ROW_HEIGHT;
  const sNCFS = a.sNodeCellFontSize ?? NODE_CELL_FONT_SIZE;
  const sPIW = a.sPinIconW ?? PIN_ICON_W;
  const sPIH = a.sPinIconH ?? PIN_ICON_H;
  const topY = y + topRowH;
  const bottomY = y + h - botRowH;

  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', sNR)
    .attr('ry', sNR)
    .attr('fill', a.fill)
    .attr('stroke', a.stroke)
    .attr('stroke-width', sNSW)
    .attr('stroke-dasharray', a.dashArray ?? 'none');

  // Two horizontal dividers — same low-opacity grid stroke as the
  // textbook card's row separators, so the pill reads as a sibling
  // shape, just narrower.
  const grid = (x1: number, y1: number, x2: number, y2: number): void => {
    g.append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', a.stroke)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);
  };
  grid(x, topY, x + w, topY);
  if (!a.slackHidden) grid(x, bottomY, x + w, bottomY);

  // Per-cell highlight overlays. The pill collapses ES/EF into a single
  // top-row date cell and (when not zero) carries a slack cell at the
  // bottom; hovering "Early Start" / "Early Finish" / "Slack" in the
  // field-legend lights the corresponding row here.
  const addCellHighlight = (
    field: string,
    cx: number,
    cy: number,
    cw: number,
    ch: number
  ): void => {
    g.append('rect')
      .attr('class', 'pert-cell-highlight')
      .attr('data-field', field)
      .attr('x', cx)
      .attr('y', cy)
      .attr('width', cw)
      .attr('height', ch)
      .attr('fill', a.highlightColor)
      .attr('fill-opacity', 0)
      .attr('pointer-events', 'none');
  };
  addCellHighlight('es', x, y, w, topRowH);
  addCellHighlight('ef', x, y, w, topRowH);
  if (!a.slackHidden) {
    addCellHighlight('slack', x, bottomY, w, botRowH);
  }

  const drawCenteredText = (
    cx: number,
    cy: number,
    text: string,
    weight: 'normal' | 'bold',
    size: number
  ): void => {
    g.append('text')
      .attr('x', cx)
      .attr('y', cy + size / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('fill', a.labelColor)
      .attr('font-size', size)
      .attr('font-weight', weight)
      .text(text);
  };

  // Top: milestone date (single value — ES = EF for any zero-duration
  // activity, so two cells would just repeat).
  drawCenteredText(x + w / 2, y + topRowH / 2, a.date, 'normal', sNCFS);

  const midRowTop = y + topRowH;
  const midRowH = h - topRowH - botRowH;
  const midCenterY = midRowTop + midRowH / 2;
  const nameSize = 12;
  const NAME_PAD_X = 6;
  const NAME_PIN_GAP = 4;
  const NAME_LINE_HEIGHT = 14;

  let textAreaLeft = x + NAME_PAD_X;
  const textAreaRight = x + w - NAME_PAD_X;
  if (a.pinned) {
    drawAnchorPin(g, x + NAME_PAD_X, midCenterY, a.labelColor, sPIW, sPIH);
    textAreaLeft = x + NAME_PAD_X + sPIW + NAME_PIN_GAP;
  }
  const textCx = (textAreaLeft + textAreaRight) / 2;
  const availW = textAreaRight - textAreaLeft;
  // Hard-break over-long words so a single long token still fits the
  // narrow milestone pill rather than overflowing.
  // The pill name is drawn at 'bold' by drawCenteredText below.
  const lines = wrapTextToWidth(a.name, nameSize, availW, {
    hardBreak: true,
    bold: true,
  });
  const maxLines = Math.max(1, Math.floor(midRowH / NAME_LINE_HEIGHT));
  const visibleLines = lines.slice(0, maxLines);
  if (lines.length > maxLines && visibleLines.length > 0) {
    // More lines than fit — force a trailing ellipsis on the last
    // visible line to signal the truncation, fitting it to the text area.
    const last = visibleLines[visibleLines.length - 1]!;
    const withEllipsis = `${last}…`;
    visibleLines[visibleLines.length - 1] =
      measureText(withEllipsis, nameSize, { bold: true }) <= availW
        ? withEllipsis
        : truncateText(last, nameSize, availW, { bold: true });
  }
  const startCy =
    midCenterY - ((visibleLines.length - 1) * NAME_LINE_HEIGHT) / 2;
  visibleLines.forEach((line, i) => {
    drawCenteredText(
      textCx,
      startCy + i * NAME_LINE_HEIGHT,
      line,
      'bold',
      nameSize
    );
  });

  if (!a.slackHidden) {
    drawCenteredText(x + w / 2, y + h - botRowH / 2, a.slack, 'normal', sNCFS);
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Render a Lucide-style anchor glyph at `(left, centerY)`, sized to
 * PIN_ICON_W × PIN_ICON_H. Ring + shaft/arms inherit the supplied
 * color so the anchor tracks the node's tint.
 */
function drawAnchorPin(
  g: AnySel,
  left: number,
  centerY: number,
  color: string,
  pinW: number = PIN_ICON_W,
  pinH: number = PIN_ICON_H
): void {
  const scale = pinW / 24;
  const top = centerY - pinH / 2;
  const pin = g
    .append('g')
    .attr('class', 'pert-pin')
    .attr('data-pert-pin', '')
    .attr('transform', `translate(${left}, ${top}) scale(${scale})`);
  // Vertical shaft + curved arms (path) and ring at the top (circle).
  pin
    .append('path')
    .attr('d', 'M12 22V8 M5 12H2a10 10 0 0 0 20 0h-3')
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round');
  pin
    .append('circle')
    .attr('cx', 12)
    .attr('cy', 5)
    .attr('r', 3)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2);
}

/**
 * Build the set of activity ids whose label gets an anchor icon
 * because their card carries a user-supplied anchor date directly:
 *   forward  → activities with no predecessors (ES = start-date)
 *   backward → activities with no successors   (LF = end-date)
 *   unanchored → empty set
 */
function computeAnchorPinSet(resolved: ResolvedPert): Set<string> {
  const anchor = resolved.options.anchor;
  if (anchor === null) return new Set();
  // Build incoming/outgoing degree from edges so we don't need an
  // analyzer-side flag.
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const a of resolved.activities) {
    inDeg.set(a.activity.id, 0);
    outDeg.set(a.activity.id, 0);
  }
  for (const e of resolved.edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const pinned = new Set<string>();
  for (const a of resolved.activities) {
    if (anchor.kind === 'forward' && (inDeg.get(a.activity.id) ?? 0) === 0) {
      pinned.add(a.activity.id);
    } else if (
      anchor.kind === 'backward' &&
      (outDeg.get(a.activity.id) ?? 0) === 0
    ) {
      pinned.add(a.activity.id);
    }
  }
  return pinned;
}

/**
 * Build the anchor framing bullet, or `null` when no anchor is set.
 * Surfaces the user-pinned date in plain language; the start/finish
 * percentile bullets above already speak to the other end, so this
 * line stays narrowly focused on the fixed boundary.
 */
function anchorAnnotationText(resolved: ResolvedPert): string | null {
  const anchor = resolved.options.anchor;
  if (anchor === null) return null;
  const today = resolved.options.today;
  if (anchor.kind === 'forward') {
    return `Forward from start-date ${anchor.date}`;
  }
  // Backward mode — surface the parse-time "today" so shared-link
  // recipients see how fresh the past-date annotations are.
  const asOf = today ? ` (as of ${today})` : '';
  // TBD upstream still needs a hint that schedule cells will render
  // `?` until estimates land, otherwise readers see ?-filled cards
  // under a deadline with no explanation.
  if (resolved.projectStart) {
    return `Backward-anchored from end-date ${anchor.date}${asOf}`;
  }
  return `Backward-anchored from end-date ${anchor.date}${asOf} — upstream activities still need estimates`;
}

interface CaptionBullet {
  text: string;
  /** 0 = top-level bullet; 1 = sub-bullet (indented). */
  level: number;
  /**
   * When true, render the bullet text in italic. Bullets always carry
   * a `•` glyph regardless; italic is a stylistic accent for the D10
   * anchor framing note at the bottom of the caption box.
   */
  italic?: boolean;
  /**
   * Backward-mode flag carried over from the analyzer's `CaptionRow`.
   * True when the row reports a latest-safe-start date that already
   * precedes `options.today`; the underlying text already carries the
   * `(latest-safe start has passed)` suffix.
   */
  isPast?: boolean;
}

/**
 * Pass-through adapter from the analyzer's structured `CaptionRow[]`
 * to the renderer's `CaptionBullet[]` shape. The analyzer now emits
 * one row per logical bullet (with `level`/`italic`/`isPast`), so the
 * renderer no longer has to recover bullet structure by splitting on
 * `\n` / `. ` and assertions on `isPast` flow through directly to
 * downstream styling.
 */
function bulletizeCaption(rows: CaptionRow[]): CaptionBullet[] {
  return rows.map((row) => {
    const out: CaptionBullet = { text: row.text, level: row.level };
    if (row.italic) out.italic = true;
    if (row.isPast) out.isPast = true;
    return out;
  });
}

interface CaptionBlockArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  palette: PaletteColors;
  isDark: boolean;
}

/**
 * Render the project-stats caption as a node-styled rectangle below
 * the diagram body. Mirrors the textbook-card recipe: rounded corners,
 * `palette.primary` stroke, 25% tint fill via `shapeFill`. A centered
 * "Summary" header sits above a hairline divider; bullets follow,
 * left-aligned with a `•` glyph and sub-bullets (level 1) indented
 * under the preceding top-level bullet.
 */
const SUB_BULLET_INDENT = 20;
// Vertical space the header band reserves: the "Summary" line itself
// (CAPTION_LINE_HEIGHT) plus a small gap between divider and the first
// bullet. Used by renderPert / renderPertForExport when sizing the
// caption box.
const CAPTION_HEADER_BAND_HEIGHT = CAPTION_LINE_HEIGHT + 8;

/**
 * Estimate the Summary box's natural pixel width given its bullets.
 * Picks the longest bullet (with `• ` glyph + sub-bullet indent) and
 * adds box padding. Used to size the Summary to its content rather
 * than always claiming a fixed share of the Analysis row.
 *
 * 0.55 × CAPTION_FONT_SIZE approximates Inter's average glyph width
 * at 13pt for mixed-case English content. Tighter than the typical
 * 0.6 estimator — works because bullet text is mostly ASCII numerics
 * and short labels.
 */
function captionNaturalWidth(bullets: CaptionBullet[]): number {
  const charW = CAPTION_FONT_SIZE * 0.55;
  // Header text "Summary" sets a soft floor so a one-bullet caption
  // doesn't end up narrower than its centered header label.
  let max = 'Summary'.length * charW;
  for (const b of bullets) {
    const indent = b.level === 1 ? SUB_BULLET_INDENT : 0;
    const w = indent + `• ${b.text}`.length * charW;
    if (w > max) max = w;
  }
  return Math.ceil(max + 2 * CAPTION_BOX_PADDING_X);
}

// Tornado widget — Monte-Carlo sensitivity ranking. Renders inside
// the Analysis row at width determined by the row's column allocation.
const TORNADO_TOP_N = 10;
const TORNADO_ROW_HEIGHT = 26;
const TORNADO_NAME_COL_W = 160;
const TORNADO_BAR_FONT_SIZE = 13;
const TORNADO_BAR_HEIGHT = 16;

// Analysis row layout — shared between the inline (CLI / export) path
// inside renderPert and the standalone sibling-SVG path used by the
// desktop preview (renderPertAnalysisBlock).
const SUMMARY_MIN_W = 260;
const SUMMARY_MAX_W = 420;
const ANALYSIS_GAP = 16;
const COL1_VSTACK_GAP = 8;
// Each chart's minimum readable width — below these axis labels overlap
// and bars collapse. The canvas widens to honor them when needed.
const TORNADO_MIN_W = 340;
const SCURVE_MIN_W = 320;

// S-curve widget — empirical CDF of MC trial finish times.
const SCURVE_BOX_HEIGHT = 220;
const SCURVE_PLOT_PADDING_X = 64; // y-axis labels + tick gap (13pt ticks)
const SCURVE_PLOT_PADDING_RIGHT = 16;
const SCURVE_PLOT_PADDING_BOTTOM = 44; // x-axis labels + tick gap (13pt ticks)
const SCURVE_TICK_FONT_SIZE = 13;
const SCURVE_PERCENTILE_RADIUS = 4;

function renderCaptionBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  bullets: CaptionBullet[],
  args: CaptionBlockArgs
): void {
  const { x, y, width, height, palette, isDark } = args;
  const { fill, stroke: chromeStroke } = analysisBlockChrome(palette, isDark);
  const labelColor = contrastText(
    fill,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  const block = svg
    .append('g')
    .attr('class', 'pert-caption-block')
    .attr('data-pert-caption', '');

  block
    .append('rect')
    .attr('class', 'pert-caption-rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', width)
    .attr('height', height)
    .attr('rx', NODE_RADIUS)
    .attr('ry', NODE_RADIUS)
    .attr('fill', fill)
    .attr('stroke', chromeStroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  block
    .append('text')
    .attr('class', 'pert-caption-header')
    .attr('x', x + width / 2)
    .attr('y', y + CAPTION_BOX_PADDING_Y + CAPTION_FONT_SIZE)
    .attr('text-anchor', 'middle')
    .attr('fill', labelColor)
    .attr('font-size', CAPTION_FONT_SIZE)
    .attr('font-weight', '700')
    .text('Summary');

  const textX = x + CAPTION_BOX_PADDING_X;
  const firstBaselineY =
    y + CAPTION_BOX_PADDING_Y + CAPTION_HEADER_BAND_HEIGHT + CAPTION_FONT_SIZE;
  const text = block
    .append('text')
    .attr('class', 'pert-caption')
    .attr('x', textX)
    .attr('y', firstBaselineY)
    .attr('text-anchor', 'start')
    .attr('fill', labelColor)
    .attr('font-size', CAPTION_FONT_SIZE)
    .attr('font-weight', CAPTION_FONT_WEIGHT);

  bullets.forEach((bullet, i) => {
    const indent = bullet.level === 1 ? SUB_BULLET_INDENT : 0;
    const tspan = text
      .append('tspan')
      .attr('x', textX + indent)
      .text(`• ${bullet.text}`);
    if (bullet.italic) tspan.attr('font-style', 'italic');
    if (i > 0) tspan.attr('dy', CAPTION_LINE_HEIGHT);
  });
}

interface FieldLegendArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  palette: PaletteColors;
  isDark: boolean;
}

/**
 * Render the 3×2 PERT-field reference card. A neutral-tinted rounded
 * rect with a "Activity card fields" header band on top (mirroring the
 * Summary's typographic idiom) and a 3×2 grid of labeled definitions
 * below — so the cells map 1-to-1 to the schedule cells of every
 * activity card without pretending to be a node themselves.
 *
 * The cell content is vertically centered inside each row, so the
 * legend looks balanced whether it's sized to a tall Summary (lots of
 * bullets) or its compact default height.
 *
 * Cell order follows `drawTextbookCard`:
 *   top:    [ Early Start | Duration | Early Finish ]
 *   bottom: [ Late Start  | Slack    | Late Finish  ]
 */
interface TagLegendArgs {
  x: number;
  y: number;
  width: number;
  activeGroup: string | null;
  exportMode?: boolean;
  /** §1.9 legend-inline: left-origin the legend so the caller's right-flush x lands it at the edge. */
  inline?: boolean;
}

/**
 * Render the tag-group legend row using the shared `renderLegendD3`
 * capsule. Inactive groups appear as collapsible pills; the active
 * group expands to show its values + colored dots. Each rendered
 * group <g> is tagged with `data-tag-legend-group="<name>"` so app-side
 * hover wiring can scope dimming the same way org / kanban do.
 */
function renderTagLegendRow(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedPert,
  palette: PaletteColors,
  isDark: boolean,
  args: TagLegendArgs
): void {
  if (resolved.tagGroups.length === 0) return;

  const { x, y, width, activeGroup, exportMode, inline } = args;
  const groups = resolved.tagGroups.map((g) => ({
    name: g.name,
    entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
  }));

  const block = svg
    .append('g')
    .attr('class', 'pert-tag-legend')
    .attr('transform', `translate(${x}, ${y})`);

  renderIntegratedLegend(block, {
    groups,
    mode: exportMode ? 'export' : 'preview',
    palette,
    isDark,
    width,
    activeGroup,
    ...(inline && {
      position: {
        placement: 'top-center' as const,
        titleRelation: 'inline-with-title' as const,
      },
    }),
  });
}

function renderFieldLegendBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  args: FieldLegendArgs
): void {
  const { x, y, width, height, palette, isDark } = args;
  // Field labels is a teaching aid (what each schedule cell means) —
  // visually subordinate to Summary / Tornado / S-curve which carry
  // data. Use a transparent fill + faint hairline border so the block
  // reads as reference chrome, not a panel of its own.
  const baseColor = palette.textMuted;
  const labelColor = contrastText(
    shapeFill(palette, baseColor, isDark),
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  // Header band — matches the Summary / Tornado / S-curve treatment so
  // all four Analysis-row widgets share one visual family.
  const headerY = y + CAPTION_BOX_PADDING_Y + CAPTION_FONT_SIZE;
  const colW = width / 3;
  // Grid starts BELOW the header band.
  const gridTop = y + CAPTION_BOX_PADDING_Y + CAPTION_HEADER_BAND_HEIGHT;
  const gridBottom = y + height;
  const rowH = (gridBottom - gridTop) / 2;

  const block = svg
    .append('g')
    .attr('class', 'pert-field-legend')
    .attr('data-pert-field-legend', '');

  block
    .append('rect')
    .attr('class', 'pert-field-legend-rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', width)
    .attr('height', height)
    .attr('rx', NODE_RADIUS)
    .attr('ry', NODE_RADIUS)
    .attr('fill', 'none')
    .attr('stroke', baseColor)
    .attr('stroke-opacity', 0.4)
    .attr('stroke-width', 1);

  // Centered bold header + hairline divider — matches Summary etc.
  block
    .append('text')
    .attr('class', 'pert-field-legend-header')
    .attr('x', x + width / 2)
    .attr('y', headerY)
    .attr('text-anchor', 'middle')
    .attr('fill', labelColor)
    .attr('font-size', CAPTION_FONT_SIZE)
    .attr('font-weight', '700')
    .text('Field labels');

  // Internal grid lines for the 3×2 cell area (matches
  // drawTextbookCard's low-opacity divider pattern).
  const grid = (x1: number, y1: number, x2: number, y2: number): void => {
    block
      .append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', baseColor)
      .attr('stroke-opacity', 0.3)
      .attr('stroke-width', 1);
  };
  grid(x, gridTop + rowH, x + width, gridTop + rowH);
  grid(x + colW, gridTop, x + colW, gridBottom);
  grid(x + colW * 2, gridTop, x + colW * 2, gridBottom);

  // Field id per cell, indexed in the same order as FIELD_LEGEND_CELLS:
  //   top:    [ es | dur | ef ]
  //   bottom: [ ls | slack | lf ]
  // Used by the React-layer hover handler to find matching cells in
  // both this legend and every node card.
  const FIELD_BY_INDEX = ['es', 'dur', 'ef', 'ls', 'slack', 'lf'] as const;

  // Cells — bold label above a wrapped description, both centered
  // vertically inside the row. Each cell sizes its own stack so 2-line
  // and 3-line descriptions still sit centered in the same row height.
  // Each cell is wrapped in a `<g class="pert-field-legend-cell">` so
  // the React-layer hover handler can resolve the cell from any
  // descendant target via `closest()`.
  FIELD_LEGEND_CELLS.forEach((cell, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = x + col * colW + colW / 2;
    const cellTop = gridTop + row * rowH;
    const field = FIELD_BY_INDEX[i]!;

    const cellG = block
      .append('g')
      .attr('class', 'pert-field-legend-cell')
      .attr('data-field', field);

    // Hover trigger + highlight overlay in one. Transparent by default;
    // React layer flips fill-opacity to 0.25 on enter. `pointer-events:
    // all` lets it catch hover even when invisible.
    cellG
      .append('rect')
      .attr('class', 'pert-cell-highlight')
      .attr('data-field', field)
      .attr('x', x + col * colW)
      .attr('y', cellTop)
      .attr('width', colW)
      .attr('height', rowH)
      .attr('fill', palette.colors.blue)
      .attr('fill-opacity', 0)
      .attr('pointer-events', 'all');

    const descLines = wrapTextToWidth(
      cell.desc,
      FIELD_LEGEND_DESC_FONT_SIZE,
      fieldLegendDescWidth(colW)
    );
    const descBlockHeight =
      FIELD_LEGEND_DESC_FONT_SIZE +
      Math.max(descLines.length - 1, 0) * FIELD_LEGEND_DESC_LINE_HEIGHT;
    const stackHeight =
      FIELD_LEGEND_LABEL_FONT_SIZE +
      FIELD_LEGEND_LABEL_DESC_GAP +
      descBlockHeight;
    const stackTop = cellTop + Math.max((rowH - stackHeight) / 2, 0);
    const labelY = stackTop + FIELD_LEGEND_LABEL_FONT_SIZE;
    const firstDescY =
      labelY + FIELD_LEGEND_LABEL_DESC_GAP + FIELD_LEGEND_DESC_FONT_SIZE;

    cellG
      .append('text')
      .attr('class', 'pert-field-legend-label')
      .attr('x', cx)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', FIELD_LEGEND_LABEL_FONT_SIZE)
      .attr('font-weight', 600)
      .attr('fill', labelColor)
      .text(cell.label);

    const descText = cellG
      .append('text')
      .attr('class', 'pert-field-legend-desc')
      .attr('x', cx)
      .attr('y', firstDescY)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', FIELD_LEGEND_DESC_FONT_SIZE)
      .attr('fill', labelColor)
      .attr('opacity', 0.85);
    descLines.forEach((line, idx) => {
      const tspan = descText.append('tspan').attr('x', cx).text(line);
      if (idx > 0) tspan.attr('dy', FIELD_LEGEND_DESC_LINE_HEIGHT);
    });
  });
}

// ============================================================
// Section: tornado (sensitivity) widget
// ============================================================

interface TornadoRow {
  id: string;
  name: string;
  /** Days the project finishes EARLIER when this activity = O. */
  lowSwing: number;
  /** Days the project finishes LATER when this activity = P. */
  highSwing: number;
  /** Criticality band drives bar color (red/orange/yellow/green/blue). */
  band: Band;
}

/**
 * Build the top-N tornado rows from MC output. Reads the pre-computed
 * `tornadoSwings` array on the MonteCarloResult, converts swings from
 * canonical days to the display unit, and assigns criticality bands.
 * Returns an empty array when MC didn't run or no activity has
 * non-zero swing.
 */
function buildTornadoRows(
  resolved: ResolvedPert,
  maxN: number = TORNADO_TOP_N
): TornadoRow[] {
  if (resolved.monteCarloResult === null) return [];
  const swings = resolved.monteCarloResult.tornadoSwings ?? [];
  if (swings.length === 0) return [];
  const sprintDays = resolveSprintDaysFromOptions(resolved.options);
  const unit = resolved.options.timeUnit;
  const rows: TornadoRow[] = swings.map((s) => ({
    id: s.id,
    name: s.name,
    lowSwing: fromDisplayUnit(s.lowSwing, unit, sprintDays),
    highSwing: fromDisplayUnit(s.highSwing, unit, sprintDays),
    band: criticalityBand(s.criticality),
  }));
  return rows.slice(0, Math.max(1, maxN));
}

// Days → display-unit count (e.g., days → weeks). Inlined here so the
// renderer doesn't need to import the analyzer's helpers.
function fromDisplayUnit(
  days: number,
  unit: DurationUnit,
  sprintDays: number | undefined
): number {
  const unitDays =
    unit === 's' && sprintDays !== undefined ? sprintDays : DAYS_PER_UNIT[unit];
  return days / unitDays;
}

function resolveSprintDaysFromOptions(opts: {
  sprintMode: 'auto' | 'explicit' | null;
  sprintLength: Duration | null;
}): number | undefined {
  if (!opts.sprintMode || !opts.sprintLength) return undefined;
  return opts.sprintLength.amount * DAYS_PER_UNIT[opts.sprintLength.unit];
}

const DAYS_PER_UNIT: Record<DurationUnit, number> = {
  min: 1 / (60 * 24),
  h: 1 / 24,
  d: 1,
  bd: 1,
  w: 7,
  m: 30,
  q: 90,
  y: 365,
  s: 14,
};

/**
 * Maximum number of tornado rows that fit inside a box of the given
 * height. Reverses tornadoBoxHeightFor(): subtracts header band and
 * box padding, then floors by row height.
 */
function tornadoMaxRowsFor(boxHeight: number): number {
  const rowSpace =
    boxHeight - 2 * CAPTION_BOX_PADDING_Y - CAPTION_HEADER_BAND_HEIGHT;
  return Math.max(1, Math.floor(rowSpace / TORNADO_ROW_HEIGHT));
}

function tornadoBoxHeightFor(rows: TornadoRow[]): number {
  return (
    rows.length * TORNADO_ROW_HEIGHT +
    2 * CAPTION_BOX_PADDING_Y +
    CAPTION_HEADER_BAND_HEIGHT
  );
}

interface TornadoBlockArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  palette: PaletteColors;
  isDark: boolean;
  /**
   * §1.9 fill family. Only `'outline'` changes tornado bars (hollow:
   * theme-bg fill, color on the stroke). `'solid'` intentionally keeps
   * the canonical tint — full-saturation micro-bars would overpower the
   * analysis block's muted chrome.
   */
  fillMode?: 'solid' | 'outline' | undefined;
}

function renderTornadoBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  rows: TornadoRow[],
  args: TornadoBlockArgs
): void {
  const { x, y, width, height, palette, isDark, fillMode } = args;
  const { fill, stroke: chromeStroke } = analysisBlockChrome(palette, isDark);
  const labelColor = contrastText(
    fill,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  const block = svg
    .append('g')
    .attr('class', 'pert-tornado-block')
    .attr('data-pert-tornado', '');

  block
    .append('rect')
    .attr('class', 'pert-tornado-rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', width)
    .attr('height', height)
    .attr('rx', NODE_RADIUS)
    .attr('ry', NODE_RADIUS)
    .attr('fill', fill)
    .attr('stroke', chromeStroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  block
    .append('text')
    .attr('class', 'pert-tornado-header')
    .attr('x', x + width / 2)
    .attr('y', y + CAPTION_BOX_PADDING_Y + CAPTION_FONT_SIZE)
    .attr('text-anchor', 'middle')
    .attr('fill', labelColor)
    .attr('font-size', CAPTION_FONT_SIZE)
    .attr('font-weight', '700')
    .text('Activity Risk');

  // Two-sided bar geometry. Activity name on the far left, then a
  // bidirectional plot area with a vertical zero-line: each row paints
  // a `low` bar growing LEFT (project finishes earlier) and a `high`
  // bar growing RIGHT (project finishes later). Magnitudes sit at the
  // END of each bar — `−low` left of the low bar, `+high` right of the
  // high bar — so the eye binds the number to its own bar instead of
  // parsing a combined cell.
  //
  // The zero-line is positioned asymmetrically so the longest left bar
  // exactly reaches `innerLeft` and the longest right bar exactly
  // reaches `innerRight`. A single uniform pixels-per-unit scale spans
  // both sides — bars on the left and right remain magnitude-comparable
  // — but the plot allocates space proportionally to maxLow vs maxHigh
  // instead of wasting half on the shorter side. With maxLow == maxHigh
  // the line lands dead-center (legacy behavior).
  const fmt = (v: number): string => {
    const r = Math.round(v * 100) / 100;
    return r.toFixed(2).replace(/\.?0+$/, '');
  };

  const maxLow = rows.reduce((acc, r) => Math.max(acc, r.lowSwing), 0);
  const maxHigh = rows.reduce((acc, r) => Math.max(acc, r.highSwing), 0);
  const totalRange = maxLow + maxHigh || 1;
  const nameX = x + CAPTION_BOX_PADDING_X;
  const plotLeft = nameX + TORNADO_NAME_COL_W;
  const plotRight = x + width - CAPTION_BOX_PADDING_X;
  // Reserve gutter at each end for the value labels so a max-width
  // bar's end-label has room without bleeding into the box edge. The
  // gutters are sized to the actual longest label on each side rather
  // than a hardcoded width — `+8.54` only needs ~37px, not the legacy
  // 56px reserve. Less wasted gutter = wider plot area = bars that use
  // more of the box. When one side has zero extent (delay-only chart)
  // its gutter collapses to zero.
  const VALUE_GAP = 6;
  // Inter at TORNADO_BAR_FONT_SIZE — digits and `+`/`−` average ~0.55em.
  // Slight over-estimate (0.6) so labels never crash into the box edge
  // even with 1-2px font-rendering variance across platforms.
  const CHAR_W = TORNADO_BAR_FONT_SIZE * 0.6;
  const longestLeftLabelChars = rows.reduce(
    (acc, r) =>
      r.lowSwing > 0 ? Math.max(acc, `−${fmt(r.lowSwing)}`.length) : acc,
    0
  );
  const longestRightLabelChars = rows.reduce(
    (acc, r) =>
      r.highSwing > 0 ? Math.max(acc, `+${fmt(r.highSwing)}`.length) : acc,
    0
  );
  const leftGutter =
    longestLeftLabelChars > 0
      ? longestLeftLabelChars * CHAR_W + VALUE_GAP + 2
      : 0;
  const rightGutter =
    longestRightLabelChars > 0
      ? longestRightLabelChars * CHAR_W + VALUE_GAP + 2
      : 0;
  const innerLeft = plotLeft + leftGutter;
  const innerRight = plotRight - rightGutter;
  const plotWidth = Math.max(innerRight - innerLeft, 0);
  const pixelsPerUnit = plotWidth / totalRange;
  const leftWidth = maxLow * pixelsPerUnit;
  const centerX = innerLeft + leftWidth;
  const firstRowY = y + CAPTION_BOX_PADDING_Y + CAPTION_HEADER_BAND_HEIGHT;

  // Center baseline axis is drawn AFTER bars below — see end of fn —
  // so it reads as the canonical zero-line instead of getting buried
  // under the bar rects (which span centerX).

  rows.forEach((row, i) => {
    const rowY = firstRowY + i * TORNADO_ROW_HEIGHT;
    const labelY = rowY + TORNADO_ROW_HEIGHT / 2;
    const barColor = bandColor(row.band, palette, palette.primary);
    // fill-outline → hollow bar (theme-bg fill, existing colored stroke
    // carries the band color). Tint + solid both keep the canonical tint.
    const barFill =
      fillMode === 'outline'
        ? shapeFill(palette, barColor, isDark, { mode: 'outline' })
        : shapeFill(palette, barColor, isDark);
    const lowW = row.lowSwing * pixelsPerUnit;
    const highW = row.highSwing * pixelsPerUnit;

    const rowG = block
      .append('g')
      .attr('class', 'pert-tornado-row')
      .attr('data-activity-id', row.id)
      // Total swing (low + high) in display-units. Consumers (the app's
      // sensitivity-heatmap overlay) read this to map nodes to opacity
      // by leverage without needing a parallel data feed.
      .attr('data-tornado-swing', String(row.lowSwing + row.highSwing));

    // Transparent overlay rect spans the entire row, captures pointer
    // events even over whitespace between bars and value labels.
    rowG
      .append('rect')
      .attr('class', 'pert-tornado-row-hit')
      .attr('x', nameX)
      .attr('y', rowY)
      .attr('width', plotRight - nameX)
      .attr('height', TORNADO_ROW_HEIGHT)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all');

    // Activity name (truncate when overlong).
    const truncated =
      row.name.length > 22 ? row.name.slice(0, 21) + '…' : row.name;
    rowG
      .append('text')
      .attr('class', 'pert-tornado-name')
      .attr('x', nameX)
      .attr('y', labelY)
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'start')
      .attr('fill', labelColor)
      .attr('font-size', TORNADO_BAR_FONT_SIZE)
      .text(truncated);

    // Left bar + its `−low` label at the bar's outer (left) end.
    if (lowW > 0) {
      rowG
        .append('rect')
        .attr('class', 'pert-tornado-bar pert-tornado-bar-low')
        .attr('x', centerX - lowW)
        .attr('y', rowY + (TORNADO_ROW_HEIGHT - TORNADO_BAR_HEIGHT) / 2)
        .attr('width', lowW)
        .attr('height', TORNADO_BAR_HEIGHT)
        .attr('rx', 2)
        .attr('ry', 2)
        .attr('fill', barFill)
        .attr('stroke', barColor)
        .attr('stroke-width', 1);
      rowG
        .append('text')
        .attr('class', 'pert-tornado-value pert-tornado-value-low')
        .attr('x', centerX - lowW - VALUE_GAP)
        .attr('y', labelY)
        .attr('dominant-baseline', 'central')
        .attr('text-anchor', 'end')
        .attr('fill', labelColor)
        .attr('font-size', TORNADO_BAR_FONT_SIZE)
        .text(`−${fmt(row.lowSwing)}`);
    }

    // Right bar + its `+high` label at the bar's outer (right) end.
    if (highW > 0) {
      rowG
        .append('rect')
        .attr('class', 'pert-tornado-bar pert-tornado-bar-high')
        .attr('x', centerX)
        .attr('y', rowY + (TORNADO_ROW_HEIGHT - TORNADO_BAR_HEIGHT) / 2)
        .attr('width', highW)
        .attr('height', TORNADO_BAR_HEIGHT)
        .attr('rx', 2)
        .attr('ry', 2)
        .attr('fill', barFill)
        .attr('stroke', barColor)
        .attr('stroke-width', 1);
      rowG
        .append('text')
        .attr('class', 'pert-tornado-value pert-tornado-value-high')
        .attr('x', centerX + highW + VALUE_GAP)
        .attr('y', labelY)
        .attr('dominant-baseline', 'central')
        .attr('text-anchor', 'start')
        .attr('fill', labelColor)
        .attr('font-size', TORNADO_BAR_FONT_SIZE)
        .text(`+${fmt(row.highSwing)}`);
    }
  });

  // Zero axis — vertical rule at the bar pivot, drawn AFTER bars so it
  // visibly anchors the eye to the project-end-unchanged baseline.
  // labelColor reads "ink, not data" against the gray block fill.
  if (rows.length > 0) {
    const axisTop = firstRowY;
    const axisBottom = firstRowY + rows.length * TORNADO_ROW_HEIGHT;
    block
      .append('line')
      .attr('class', 'pert-tornado-axis')
      .attr('x1', centerX)
      .attr('x2', centerX)
      .attr('y1', axisTop)
      .attr('y2', axisBottom)
      .attr('stroke', labelColor)
      .attr('stroke-width', 1)
      .attr('opacity', 0.5);
  }
}

// ============================================================
// Section: S-curve (completion-probability) widget
// ============================================================

// `ScurveData` is defined in `./types` (Path B mode-discriminated shape).
// Previously declared inline here; promoted alongside the
// backward-anchor framing flip — see tech-spec §13A.12.

/**
 * Build the cumulative-distribution data for the S-curve.
 *
 * Two modes share most of the data; the renderer reads `data.mode` and
 * the `referenceLines[].isPast` flag for the only mode-discriminated
 * styling (dashed strokes for past latest-safe-starts). Forward-mode
 * fields preserve the pre-change semantics so existing snapshots stay
 * stable (AC 12).
 *
 * Forward (no anchor or `start-date`):
 *   - x-axis = duration / finish date; y rises 0 → 1.
 *   - referenceLines at P50/P80/P95 finishes; `isPast` always `false`.
 *
 * Backward (`end-date`):
 *   - x-axis = candidate-start date; y falls 1 → 0.
 *   - referenceLines at P50/P80/P95 latest-safe starts;
 *     `isPast` flips `true` when the resolved date precedes
 *     `options.today`, and the label appends `" (past)"`.
 */
function buildScurveData(resolved: ResolvedPert): ScurveData | null {
  const mc = resolved.monteCarloResult;
  if (mc === null) return null;
  // Anchor the curve with O–p95 range. Use 2·p50 − p95 as a proxy for
  // the lower tail; when MC reports a degenerate p50/p80/p95 (collapse
  // to one value) the function returns null and the no-variance
  // fallback caption row covers the case.
  const p5 = Math.max(0, 2 * mc.p50 - mc.p95);
  const durationSamples = [p5, mc.p50, mc.p80, mc.p95];
  if (durationSamples.every((v) => v === durationSamples[0])) return null;

  const anchor = resolved.options.anchor;
  const mode: 'forward' | 'backward' =
    anchor?.kind === 'backward' ? 'backward' : 'forward';
  // Mode-agnostic y-axis label. The mode-specific reading lives on
  // the x-axis (finish date vs candidate-start date) and in the
  // inline percentile labels; the y-axis is a probability scale in
  // both cases, so a plain-English label reads more cleanly than
  // mathematical notation.
  const yAxisLabel = 'Probability of completion';
  const today = resolved.options.today;

  // Deadline canonical days = `end_date − projectStart` for backward
  // mode. Backward also uses this as the right edge of the x-axis
  // (= candidate-start of "the deadline itself" = 0% probability).
  let deadlineDays: number | null = null;
  let deadlineDate: string | null = null;
  if (
    anchor !== null &&
    anchor.kind === 'backward' &&
    resolved.projectStart !== null
  ) {
    const startMs = Date.parse(resolved.projectStart);
    const endMs = Date.parse(anchor.date);
    if (!isNaN(startMs) && !isNaN(endMs)) {
      deadlineDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
      deadlineDate = anchor.date;
    }
  }

  // ── Project everything into "canonical x-axis days" ────────────
  //
  // Forward: x-axis days = duration days from projectStart. Sample
  // values, percentiles, and band edges are all already in this
  // space — pass through unchanged.
  //
  // Backward: x-axis days = candidate-start days from projectStart,
  // so a candidate-start date `s` projects to `s − projectStart`
  // canonical days, and the deadline at `end_date` sits at
  // `deadlineDays` canonical days (the right edge). For each duration
  // `d`, the candidate-start that just barely fits is
  // `deadlineDays − d`. P95 (longest duration) → leftmost (earliest
  // start); P5_proxy (shortest) → rightmost (latest candidate start).
  //
  // Two projection helpers: `projectSmooth` keeps fractional days so
  // the curve interpolates smoothly; `projectRounded` applies the
  // same `Math.ceil` rounding the analyzer uses (`roundConservative`)
  // so percentile dots and their date labels match the caption rows
  // byte-for-byte.
  const projectSmooth = (durationDays: number): number =>
    mode === 'backward' && deadlineDays !== null
      ? deadlineDays - durationDays
      : durationDays;
  const projectRounded = (durationDays: number): number =>
    mode === 'backward' && deadlineDays !== null
      ? deadlineDays - Math.ceil(durationDays)
      : durationDays;

  // Curve points, ordered ascending by `x`. Forward rises; backward
  // falls. Same MC trial set in both — only the projection flips.
  // Smooth projection (no ceil) so the cubic interpolation between
  // (P50, P80, P95) doesn't step.
  const durationProbPairs: Array<{ d: number; p: number }> = [
    // In-bounds: MC always produces samples; consumers gate on `mc.minDurationDays !== null`.
    { d: durationSamples[0]!, p: 0.05 },
    { d: mc.p50, p: 0.5 },
    { d: mc.p80, p: 0.8 },
    { d: mc.p95, p: 0.95 },
  ];
  const curvePoints = durationProbPairs
    .map(({ d, p }) => ({ x: projectSmooth(d), y: p }))
    .sort((a, b) => a.x - b.x);

  const samples = durationSamples.map(projectSmooth).sort((a, b) => a - b);

  // Band edges. In backward mode the projection inverts ordering, so
  // we explicitly assign the smaller projected value to `p16Days` and
  // the larger to `p84Days` — the renderer relies on `p16Days ≤
  // p84Days`.
  const p16Proj = projectSmooth(mc.p16);
  const p84Proj = projectSmooth(mc.p84);
  const bandLeft = Math.min(p16Proj, p84Proj);
  const bandRight = Math.max(p16Proj, p84Proj);

  // Percentile reference lines — same MC outputs, mode-dependent
  // wording and projection. `durationDays` keeps the original duration
  // so the renderer can paint the "≈ Nw of work" sub-label below each
  // dot in backward mode.
  const referenceLines: ScurveReferenceLine[] = (
    [
      { pct: 50, days: mc.p50 },
      { pct: 80, days: mc.p80 },
      { pct: 95, days: mc.p95 },
    ] as Array<{ pct: 50 | 80 | 95; days: number }>
  ).map(({ pct, days }) => {
    const yFrac = pct / 100;
    if (mode === 'backward' && anchor?.kind === 'backward') {
      const offsetDays = Math.ceil(days);
      const date = addCalendarDays(anchor.date, -offsetDays);
      const isPast = today.length > 0 && date < today;
      const label = `P${pct} latest-safe start${isPast ? ' (past)' : ''}`;
      return {
        x: projectRounded(days),
        y: yFrac,
        durationDays: days,
        label,
        isPast,
      };
    }
    return {
      x: days,
      y: yFrac,
      durationDays: days,
      label: `P${pct} finish`,
      isPast: false,
    };
  });

  // Axis bounds. Backward right edge = the deadline itself (the
  // candidate-start = deadline column, where 0% chance remains).
  const xMinDays =
    mode === 'backward' && deadlineDays !== null
      ? deadlineDays - mc.maxDurationDays
      : // In-bounds: MC always produces samples.
        Math.min(durationSamples[0]!, mc.minDurationDays);
  const xMaxDays =
    mode === 'backward' && deadlineDays !== null
      ? deadlineDays
      : Math.max(mc.p95, mc.maxDurationDays);

  return {
    mode,
    yAxisLabel,
    curvePoints,
    samples,
    p16Days: bandLeft,
    p84Days: bandRight,
    // Percentile dots/date-labels — `projectRounded` matches the
    // analyzer's `roundConservative` (Math.ceil of the duration), so
    // each dot's date label is byte-identical to the caption's
    // "P{X} latest-safe start: <date>" row.
    p50Days: projectRounded(mc.p50),
    p80Days: projectRounded(mc.p80),
    p95Days: projectRounded(mc.p95),
    xMinDays,
    xMaxDays,
    referenceLines,
    framingNote: anchorAnnotationText(resolved),
    anchorDate: resolved.projectStart,
    deadlineDays,
    deadlineDate,
  };
}

interface ScurveBlockArgs {
  x: number;
  y: number;
  width: number;
  height: number;
  palette: PaletteColors;
  isDark: boolean;
  unit: DurationUnit;
  // Header text painted in the top band of the block, matching the
  // "Summary" header treatment in renderCaptionBlock. Used to surface
  // the project's headline stat ("Expected duration: 11 days (± 2 days).")
  // so the chart carries its own context now that the Summary card is
  // gone from the desktop preview.
  title?: string;
}

function renderScurveBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  data: ScurveData,
  args: ScurveBlockArgs
): void {
  const { x, y, width, height, palette, isDark, unit, title } = args;
  const { fill, stroke: chromeStroke } = analysisBlockChrome(palette, isDark);
  const labelColor = contrastText(
    fill,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  const block = svg
    .append('g')
    .attr('class', 'pert-scurve-block')
    .attr('data-pert-scurve', '');

  block
    .append('rect')
    .attr('class', 'pert-scurve-rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', width)
    .attr('height', height)
    .attr('rx', NODE_RADIUS)
    .attr('ry', NODE_RADIUS)
    .attr('fill', fill)
    .attr('stroke', chromeStroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  // Header band — mirrors the Summary card's title treatment. Only
  // reserved when a title is provided; the inline renderPert path
  // (which still pairs S-curve with a Summary card) passes none, so
  // the plot keeps its full height there.
  const hasTitle = typeof title === 'string' && title.length > 0;
  if (hasTitle) {
    // Strip the trailing period — the caption-box renders this same
    // string as a sentence-style bullet, but as a bold header it reads
    // cleaner without terminal punctuation.
    const titleText = title!.replace(/\.$/, '');
    block
      .append('text')
      .attr('class', 'pert-scurve-header')
      .attr('x', x + width / 2)
      .attr('y', y + CAPTION_BOX_PADDING_Y + CAPTION_FONT_SIZE)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
      .attr('font-size', CAPTION_FONT_SIZE)
      .attr('font-weight', '700')
      .text(titleText);
  }

  // Anchor-framing kept only as a top reservation for the deadline
  // label when the diagram is end-date-anchored. The rotated y-axis
  // title plus the colored P50/P80/P95 dots make the chart self-
  // identifying for the axis story; the header band (when present)
  // names the chart with the project's headline stat.
  const SCURVE_DEADLINE_LABEL_HEIGHT = 16;
  const hasDeadline = data.deadlineDays !== null;

  // Plot rect — leave room on the left for y-axis labels, below for
  // x-axis labels, above for the header band (when titled) and the
  // deadline label (when end-date-anchored).
  const plotLeft = x + SCURVE_PLOT_PADDING_X;
  const plotRight = x + width - SCURVE_PLOT_PADDING_RIGHT;
  const plotTop =
    y +
    CAPTION_BOX_PADDING_Y +
    (hasTitle ? CAPTION_HEADER_BAND_HEIGHT : 0) +
    (hasDeadline ? SCURVE_DEADLINE_LABEL_HEIGHT : 0);
  // Percentile metadata (date / duration) now lives inline next to
  // each dot rather than stacked below the plot, so no extra bottom
  // padding is needed for a second line. The x-axis carries only the
  // general-scale ticks.
  const isAnchored = data.anchorDate !== null;
  const plotBottom = y + height - SCURVE_PLOT_PADDING_BOTTOM;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  // Tighten the visible x-range to the percentile cluster + a small
  // margin so P50/P80/P95 spread across most of the plot instead of
  // bunching against one edge of a wide-tail MC sample range. Always
  // keep the empirical 68% band [p16Days, p84Days] in frame so the
  // shaded "likely-finish span" reads cleanly. Backward mode keeps
  // the deadline as the right edge (it's the "0% chance" boundary);
  // forward mode pads past the rightmost dot symmetrically.
  const dotPositions = [data.p50Days, data.p80Days, data.p95Days];
  const dotMin = Math.min(...dotPositions);
  const dotMax = Math.max(...dotPositions);
  const dotSpan = Math.max(1, dotMax - dotMin);
  const xMin = Math.min(data.p16Days, dotMin - 0.2 * dotSpan);
  const xMax =
    data.mode === 'backward' && data.deadlineDays !== null
      ? data.deadlineDays
      : Math.max(data.p84Days, dotMax + 0.2 * dotSpan);
  const xRange = xMax - xMin || 1;
  const xScale = (v: number): number =>
    plotLeft + ((v - xMin) / xRange) * plotW;
  const yScale = (frac: number): number => plotBottom - frac * plotH;

  // Y-axis gridlines at 0.25/0.5/0.75/1.0 with labels.
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  for (const t of yTicks) {
    const yy = yScale(t);
    block
      .append('line')
      .attr('class', 'pert-scurve-grid')
      .attr('x1', plotLeft)
      .attr('x2', plotRight)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', 1)
      .attr('opacity', t === 0 || t === 1 ? 0.4 : 0.15);
    block
      .append('text')
      .attr('class', 'pert-scurve-ytick')
      .attr('x', plotLeft - 6)
      .attr('y', yy + SCURVE_TICK_FONT_SIZE / 3)
      .attr('text-anchor', 'end')
      .attr('fill', labelColor)
      .attr('font-size', SCURVE_TICK_FONT_SIZE)
      .text(`${Math.round(t * 100)}%`);
  }

  // Y-axis title — rotated 90° on the far left of the plot, centered
  // vertically. The 0-100% ticks are obviously percentages, but
  // "probability of what?" needs an explicit axis title.
  const yAxisLabelCx = x + 14;
  const yAxisLabelCy = plotTop + plotH / 2;
  block
    .append('text')
    .attr('class', 'pert-scurve-y-axis-title')
    .attr(
      'transform',
      `translate(${yAxisLabelCx}, ${yAxisLabelCy}) rotate(-90)`
    )
    .attr('text-anchor', 'middle')
    .attr('fill', labelColor)
    .attr('font-size', SCURVE_TICK_FONT_SIZE - 1)
    .attr('font-weight', '600')
    .attr('opacity', 0.85)
    // Plain-English "Probability of completion" — same label in
    // both modes. The mode-specific reading comes from the x-axis
    // (finish date vs candidate-start date) and the inline P50/P80/
    // P95 labels; the y-axis is a probability scale either way.
    // The card header was removed once this title took over, so
    // this is now the only place the chart names itself.
    .text(data.yAxisLabel);

  // Empirical 68% band [P16, P84] — same MC trials that produced the
  // P50/P80/P95 dots, so the math story stays consistent: every
  // visual element on the chart comes from one simulation run. The
  // band visually answers "where will the project most likely land?"
  // without assuming the finish-time distribution is normal.
  if (data.p84Days > data.p16Days) {
    const bandLeftRaw = xScale(data.p16Days);
    const bandRightRaw = xScale(data.p84Days);
    const bandLeft = Math.max(plotLeft, bandLeftRaw);
    const bandRight = Math.min(plotRight, bandRightRaw);
    if (bandRight > bandLeft) {
      block
        .append('rect')
        .attr('class', 'pert-scurve-likely-band')
        .attr('x', bandLeft)
        .attr('y', plotTop)
        .attr('width', bandRight - bandLeft)
        .attr('height', plotH)
        .attr('fill', palette.colors.blue)
        .attr('opacity', 0.12);
    }
  }

  // Deadline — vertical line at the hard end-date constraint. The
  // label sits ABOVE the 100% gridline (above plotTop) so it doesn't
  // compete with curve labels inside the plot, and the line + label
  // share a distinct purple color so they read as a hard constraint
  // distinct from the colored dashed percentile ticks.
  if (data.deadlineDays !== null && data.deadlineDate !== null) {
    const dx = xScale(data.deadlineDays);
    if (dx >= plotLeft - 1 && dx <= plotRight + 1) {
      const deadlineColor = palette.colors.purple;
      // Label first so it appears above the plot (in the reserved top
      // strip). Mirrors the inward-anchor logic used for percentiles
      // so the label doesn't clip at the plot edges.
      const edgePad = 4;
      let anchor: 'middle' | 'start' | 'end' = 'middle';
      if (dx <= plotLeft + edgePad) anchor = 'start';
      else if (dx >= plotRight - edgePad) anchor = 'end';
      block
        .append('text')
        .attr('class', 'pert-scurve-deadline-label')
        .attr('x', dx)
        .attr('y', plotTop - 4)
        .attr('text-anchor', anchor)
        .attr('fill', deadlineColor)
        .attr('font-size', SCURVE_TICK_FONT_SIZE)
        .attr('font-weight', '700')
        .text(`Deadline · ${formatScurveDate(data.deadlineDate)}`);
      block
        .append('line')
        .attr('class', 'pert-scurve-deadline-line')
        .attr('x1', dx)
        .attr('x2', dx)
        .attr('y1', plotTop)
        .attr('y2', plotBottom)
        .attr('stroke', deadlineColor)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.9);
    }
  }

  // Sigmoid curve through the 4 sample points. Forward mode rises
  // 0.05 → 0.95; backward mode falls 0.95 → 0.05. The pairs come from
  // `buildScurveData`, already projected into the right x-axis space
  // (duration days vs candidate-start days), so this site stays
  // mode-blind.
  const points: { x: number; y: number }[] = data.curvePoints.map((pt) => ({
    x: xScale(pt.x),
    y: yScale(pt.y),
  }));
  const curve = d3Shape
    .line<{ x: number; y: number }>()
    .x((d) => d.x)
    .y((d) => d.y)
    .curve(d3Shape.curveMonotoneX)(points);
  if (curve) {
    // Clip the curve to the plot rect. After the x-axis tightening,
    // the spline's boundary tangent can overshoot below y=0 % at
    // xMin (where the next sample point lies outside the visible
    // range), which leaks a dangling tail past the chart's left
    // edge. Per-S-curve clipPath id keeps multiple PERT diagrams on
    // the same page from sharing the same clip.
    const clipId = `pert-scurve-clip-${Math.random().toString(36).slice(2, 10)}`;
    block
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', plotLeft)
      .attr('y', plotTop)
      .attr('width', plotW)
      .attr('height', plotH);
    block
      .append('path')
      .attr('class', 'pert-scurve-line')
      .attr('d', curve)
      .attr('fill', 'none')
      .attr('stroke', palette.colors.red)
      .attr('stroke-width', 2)
      .attr('clip-path', `url(#${clipId})`);
  }

  // Percentile dots + dashed verticals + x-axis value labels. Each
  // percentile gets its own color so the eye can match dot → dashed
  // line → x-axis label as a single unit. Yellow/orange/red mirrors
  // the criticality bands used elsewhere in the diagram so colors
  // read consistently across widgets.
  type Band = 'yellow' | 'orange' | 'red';
  // Reference-line `isPast` flag comes from `buildScurveData`'s
  // backward-mode pass (forward mode always emits `false`). Past lines
  // render with a longer dash so they read as "deadline has slipped"
  // at a glance — matches the `(past)` label suffix on the same line.
  // `value` is the x-axis plotting position (mode-projected by
  // `buildScurveData`); `durationDays` is the original duration so
  // the secondary sub-label can still surface "≈ Nw of work" in
  // backward mode, where `value` is a candidate-start position
  // rather than a duration.
  const dots: {
    value: number;
    durationDays: number;
    pct: number;
    label: string;
    band: Band;
    isPast: boolean;
  }[] = [
    {
      value: data.p50Days,
      durationDays: data.referenceLines[0]?.durationDays ?? data.p50Days,
      pct: 0.5,
      label: 'P50',
      band: 'yellow',
      isPast: data.referenceLines[0]?.isPast ?? false,
    },
    {
      value: data.p80Days,
      durationDays: data.referenceLines[1]?.durationDays ?? data.p80Days,
      pct: 0.8,
      label: 'P80',
      band: 'orange',
      isPast: data.referenceLines[1]?.isPast ?? false,
    },
    {
      value: data.p95Days,
      durationDays: data.referenceLines[2]?.durationDays ?? data.p95Days,
      pct: 0.95,
      label: 'P95',
      band: 'red',
      isPast: data.referenceLines[2]?.isPast ?? false,
    },
  ];
  // Inline CSS for the hover swap. Putting it inside the block means
  // the behavior travels with the SVG — saved SVGs viewed in a browser
  // still get the same hover-to-expand affordance. resvg (PNG export)
  // ignores :hover entirely, so PNGs render the terse default just as
  // they did before. The selectors are class-scoped to .pert-scurve-
  // percentile, so the rules can't leak into other diagrams sharing
  // the page.
  block
    .append('style')
    .text(
      '.pert-scurve-percentile-verbose{opacity:0;pointer-events:none}' +
        '.pert-scurve-percentile:hover .pert-scurve-percentile-label{opacity:0}' +
        '.pert-scurve-percentile:hover .pert-scurve-percentile-verbose{opacity:1}'
    );

  // Capture the percentile dot x-positions so the x-axis tick pass
  // below can drop any auto-tick that would land directly under the
  // inline value label ("14.7w" auto-tick + "P80 · 14.7w" inline
  // label = duplicated number on the chart).
  const dotXs: number[] = dots.map((d) => xScale(d.value));

  for (const d of dots) {
    const cx = xScale(d.value);
    const cy = yScale(d.pct);
    const color = palette.colors[d.band];
    const valueText = isAnchored
      ? formatScurveDate(addCalendarDays(data.anchorDate!, d.value))
      : formatScurveTick(d.durationDays, unit);
    const inlineText = `${d.label} · ${valueText}`;
    // Verbose phrasing revealed on hover. Compressed wordings so the
    // overlay stays narrow enough to fit on the plot at typical widths.
    // The terse label already carries the date/duration, so the verbose
    // omits it in backward mode (where it'd duplicate "P50 · Mar 28").
    // Past dates aren't called out — the terse label already shows the
    // date and the dashed tick line's "4,2" pattern signals past.
    const pctInt = Math.round(d.pct * 100);
    const verboseText =
      data.mode === 'backward'
        ? `${pctInt}% chance of meeting deadline`
        : isAnchored
          ? `${pctInt}% chance to finish by ${valueText}`
          : `${pctInt}% chance within ${valueText}`;
    // Shared placement for terse + verbose: pick the side of the dot
    // that fits the wider element (the verbose phrasing) without
    // overflowing the plot. Sharing the anchor means the hover swap
    // is truly in-place — the terse "P95 · 15.8w" can't sit right of
    // the dot only to have the verbose flip left on hover.
    const verboseCharW = SCURVE_TICK_FONT_SIZE * 0.55;
    const verboseW = verboseText.length * verboseCharW;
    const inlineGap = SCURVE_PERCENTILE_RADIUS + 6;
    const roomRight = plotRight - cx - inlineGap;
    const roomLeft = cx - plotLeft - inlineGap;
    let labelX: number;
    let labelAnchor: 'start' | 'end';
    if (verboseW <= roomRight) {
      labelX = cx + inlineGap;
      labelAnchor = 'start';
    } else if (verboseW <= roomLeft) {
      labelX = cx - inlineGap;
      labelAnchor = 'end';
    } else if (roomRight >= roomLeft) {
      // Verbose wider than either side around the dot — clamp to the
      // plot edge with more room. Terse follows so the hover swap
      // still happens in place (the terse just sits a bit farther
      // from its dot than usual at this edge).
      labelX = plotRight;
      labelAnchor = 'end';
    } else {
      labelX = plotLeft;
      labelAnchor = 'start';
    }
    // Percentile colors (yellow/orange/red) are tuned for filled
    // shapes at 25 % tint. Free-standing on the panel bg they lose
    // contrast — yellow especially, against light themes — so we
    // shift each label color 25 % toward `palette.text` (dark in
    // light theme, light in dark theme) to push it back into the
    // readable band without abandoning its band identity.
    const labelFill = mix(color, palette.text, 25);

    // Group wraps tick + dot + hit area + both labels so `:hover` on
    // any part of the cluster triggers the swap.
    const dotGroup = block
      .append('g')
      .attr('class', 'pert-scurve-percentile')
      .attr('data-percentile', d.label);

    dotGroup
      .append('line')
      .attr('class', 'pert-scurve-percentile-tick')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', cy)
      .attr('y2', plotBottom)
      .attr('stroke', color)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', d.isPast ? '4,2' : '3 3')
      .attr('opacity', 0.7);
    dotGroup
      .append('circle')
      .attr('class', 'pert-scurve-percentile-dot')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', SCURVE_PERCENTILE_RADIUS)
      .attr('fill', color)
      .attr('stroke', fill)
      .attr('stroke-width', 1.5)
      // Mirrored on the parent group so the hover :hover selector can
      // attach to the cluster as a whole; kept here too for back-
      // compat with consumers querying `circle[data-percentile]`.
      .attr('data-percentile', d.label);
    // Generous transparent hit-area — a 4 px dot is too small a target
    // for the hover affordance to feel discoverable. The hit circle
    // sits on top so any pointer within 14 px registers a hover on
    // the parent group.
    dotGroup
      .append('circle')
      .attr('class', 'pert-scurve-percentile-hit')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 14)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all');
    // Inline label next to the dot: "P{X} · {date}" when anchored,
    // "P{X} · {duration}" otherwise. The natural y-spacing between
    // P50/P80/P95 (≈ 45 % of plot height) gives each label its own
    // row, so this layout stays legible even when dots are bunched
    // together horizontally (e.g. backward mode with a narrow
    // candidate-start span). Replaces the old "name above + x-axis
    // two-line label below" combo, which collided when dots overlapped.
    dotGroup
      .append('text')
      .attr('class', 'pert-scurve-percentile-label')
      .attr('x', labelX)
      .attr('y', cy + SCURVE_TICK_FONT_SIZE / 3)
      .attr('text-anchor', labelAnchor)
      .attr('fill', labelFill)
      .attr('font-size', SCURVE_TICK_FONT_SIZE)
      .attr('font-weight', '700')
      // Paint-order halo with the panel fill — knocks out the band
      // and dashed gridlines behind each letter so the label reads
      // against the panel bg, not the visual noise behind it.
      .attr('paint-order', 'stroke fill')
      .attr('stroke', fill)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-opacity', 0.95)
      .text(inlineText);
    // Verbose label shares the terse's anchor and x so the hover
    // swap reads as an in-place expansion. Hidden by default via the
    // inline <style> above; revealed when the surrounding group is
    // hovered. Same halo treatment so the longer phrase stays
    // readable across the colored band and the gridlines.
    dotGroup
      .append('text')
      .attr('class', 'pert-scurve-percentile-verbose')
      .attr('x', labelX)
      .attr('y', cy + SCURVE_TICK_FONT_SIZE / 3)
      .attr('text-anchor', labelAnchor)
      .attr('fill', labelFill)
      .attr('font-size', SCURVE_TICK_FONT_SIZE)
      .attr('font-weight', '700')
      .attr('paint-order', 'stroke fill')
      .attr('stroke', fill)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-opacity', 0.95)
      .text(verboseText);
  }

  // X-axis ticks: evenly spaced across the x-range. Endpoint labels
  // anchor inward so they don't clip the box. The percentile-collision
  // pass that used to suppress auto-ticks under colored labels is gone
  // now that percentile values live inline next to their dots — the
  // x-axis carries only the "general scale" markers.
  type Tick = { v: number; x: number; anchor: 'start' | 'middle' | 'end' };
  // "Mon DD" dates (~48px) sit between durations (~36px) and ISO
  // dates (~72px). 5 ticks gives a comfortable scale without crowding.
  const N_X_TICKS = isAnchored ? 5 : 6;
  const LABEL_W_EST = isAnchored ? 48 : 36; // "Sep 16" vs "25.4w"
  const TICK_MIN_GAP = 6;
  const footprint = (t: Tick): [number, number] => {
    if (t.anchor === 'start') return [t.x, t.x + LABEL_W_EST];
    if (t.anchor === 'end') return [t.x - LABEL_W_EST, t.x];
    return [t.x - LABEL_W_EST / 2, t.x + LABEL_W_EST / 2];
  };

  const all: Tick[] = [];
  for (let i = 0; i < N_X_TICKS; i++) {
    const v = xMin + (xRange * i) / (N_X_TICKS - 1);
    all.push({
      v,
      x: xScale(v),
      anchor: i === 0 ? 'start' : i === N_X_TICKS - 1 ? 'end' : 'middle',
    });
  }
  // Auto-tick suppression near percentile dots — drop any middle tick
  // whose label would visually duplicate the inline "P{X} · {value}"
  // pair (e.g. P80 at exactly 14.7w would otherwise render the same
  // "14.7w" twice). The ~28 px tolerance is roughly half a duration
  // label width, so adjacent-but-distinct values keep their tick.
  const TICK_DOT_PROXIMITY = 28;
  const collidesWithDot = (t: Tick): boolean =>
    dotXs.some((dx) => Math.abs(t.x - dx) < TICK_DOT_PROXIMITY);
  // In-bounds: N_X_TICKS > 0, so `all` has at least one entry.
  const kept: Tick[] = [all[0]!];
  const last = all[all.length - 1]!;
  const lastLeft = footprint(last)[0];
  let rightEdge = footprint(all[0]!)[1];
  for (let i = 1; i < all.length - 1; i++) {
    // In-bounds by loop guard.
    const t = all[i]!;
    if (collidesWithDot(t)) continue;
    const [l, r] = footprint(t);
    if (r + TICK_MIN_GAP > lastLeft) continue;
    if (l - TICK_MIN_GAP < rightEdge) continue;
    kept.push(t);
    rightEdge = r;
  }
  kept.push(last);

  for (const t of kept) {
    // Anchored: show calendar date (the durations live on the
    // percentile labels). Unanchored: show duration as before.
    const labelText = isAnchored
      ? formatScurveDate(addCalendarDays(data.anchorDate!, t.v))
      : formatScurveTick(t.v, unit);
    block
      .append('text')
      .attr('class', 'pert-scurve-xtick')
      .attr('x', t.x)
      .attr('y', plotBottom + SCURVE_TICK_FONT_SIZE + 6)
      .attr('text-anchor', t.anchor)
      .attr('fill', labelColor)
      .attr('font-size', SCURVE_TICK_FONT_SIZE)
      .text(labelText);
  }
}

function formatScurveTick(days: number, unit: DurationUnit): string {
  const value = days / UNIT_TO_DAYS_LOCAL[unit];
  const display = (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `${display}${unit}`;
}

// Compact date format for S-curve x-axis labels ("Sep 16" / "Oct 2").
// The year is omitted — it already shows up in the subline (e.g.
// "Deadline: 2026-09-15."), and including it on every tick forces
// collisions at typical panel widths.
const SCURVE_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
function formatScurveDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  // In-bounds by length === 3 check.
  const month = parseInt(parts[1]!, 10) - 1;
  const day = parseInt(parts[2]!, 10);
  if (month < 0 || month > 11 || isNaN(day)) return iso;
  return `${SCURVE_MONTH_NAMES[month]} ${day}`;
}

const UNIT_TO_DAYS_LOCAL: Record<DurationUnit, number> = {
  min: 1 / (60 * 24),
  h: 1 / 24,
  d: 1,
  bd: 1,
  w: 7,
  m: 30,
  q: 90,
  y: 365,
  s: 14,
};

// re-export to silence unused-type lint when consumers only want the helper
export type { ResolvedActivity, Duration };
