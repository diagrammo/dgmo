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

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
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
import type {
  LayoutResult,
  PertEdge,
  ResolvedActivity,
  ResolvedPert,
} from './types';
import { parsePert } from './parser';
import { analyzePert } from './analyzer';
import { layoutPert } from './layout';
import { addCalendarDays, unitToDays } from './internal';
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
const NODE_STROKE_WIDTH = 1.5;
const NODE_TOP_ROW_HEIGHT = 26;
const NODE_BOTTOM_ROW_HEIGHT = 26;
// Edge styling: non-critical edges follow `diagram-visual-conventions.md`
// §4 (uniform textMuted stroke + width + arrowhead). Critical-path
// edges deliberately deviate — they use `palette.colors.red` for the
// stroke and a matching red arrowhead because the critical path is the
// central concept of a PERT chart, and a binary `data-critical` attr
// alone left it visually invisible to readers.
const EDGE_STROKE_WIDTH = 1.5;
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
// Group-rect treatment per §2: neutral surface fill on textMuted stroke,
// solid border, rx=8, top-center 13pt 'bold' label inside a reserved
// 28px header band — exactly matching org's container recipe.
const CONTAINER_RADIUS = 8;
const CONTAINER_LABEL_FONT_SIZE = 13;
const CONTAINER_HEADER_HEIGHT = 28;
// Collapse-bar height — see conventions doc §3 Pattern A/B (matches
// org's `COLLAPSE_BAR_HEIGHT`). Universal "this is collapsed" signal.
const COLLAPSE_BAR_HEIGHT = 6;
// Fade applied to non-critical elements when the Critical Path toggle
// is on. Matches gantt's `FADE_OPACITY` (renderer.ts:1815) so the same
// "spotlight" effect reads consistently across diagrams.
const FADE_OPACITY = 0.15;
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

// Field-reference legend — a 3×2 mini-card that mirrors the schedule
// cells of the textbook PERT card so readers can map each cell's value
// back to its meaning. Sits in the bottom band, right-aligned with the
// chart's right edge so it doesn't push the canvas wider, and matches
// the Summary box's height so it doesn't push the canvas taller.
const FIELD_LEGEND_WIDTH = 580;
const FIELD_LEGEND_GAP_X = 16;
// Falls back to this height only when the Summary is hidden / empty;
// otherwise the legend matches captionBoxHeight exactly.
const FIELD_LEGEND_DEFAULT_HEIGHT = 130;
const FIELD_LEGEND_LABEL_FONT_SIZE = 13;
const FIELD_LEGEND_DESC_FONT_SIZE = 11;
const FIELD_LEGEND_DESC_LINE_HEIGHT = 14;
const FIELD_LEGEND_LABEL_DESC_GAP = 4;
// Greedy word-wrap budget per line — calibrated for 11pt Inter at the
// cell width minus padding.
const FIELD_LEGEND_DESC_WRAP_CHARS = 27;
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

function wrapTextByChars(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
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
  const titleHeight = effectiveTitle ? 80 : 0;

  // D10 — backward-anchor annotation. Italic framing note that names
  // the end-date and tells readers ES/EF show "earliest possible"
  // rather than the intended start. Rendered as the FINAL bullet
  // inside the caption box (no longer a standalone subtitle), so the
  // diagram body sits right under the title and the framing note
  // lives next to the dates it qualifies. Forward mode emits a
  // companion bullet naming the start-date for symmetry.
  const anchorAnnotation = anchorAnnotationText(resolved);

  const collapsedSet = new Set(options.collapsedGroupIds ?? []);
  const captionText = resolved.error !== null ? null : resolved.summaryText;
  const captionBullets: CaptionBullet[] =
    captionText !== null && captionText.length > 0
      ? bulletizeCaption(captionText)
      : [];
  if (anchorAnnotation) {
    captionBullets.push({
      text: anchorAnnotation,
      level: 0,
      italic: true,
    });
  }
  const captionBoxHeight =
    captionBullets.length > 0
      ? captionBullets.length * CAPTION_LINE_HEIGHT +
        2 * CAPTION_BOX_PADDING_Y +
        CAPTION_HEADER_BAND_HEIGHT
      : 0;
  // Field-reference legend sits inside the chart-width band, right-
  // aligned with the chart's right edge. Its height matches the
  // Summary's so the bottom band never grows beyond what the Summary
  // alone would claim. When the Summary is hidden or empty, the legend
  // falls back to a default height.
  const showFieldLegend = options.showFieldLegend ?? false;
  const showSummary = options.showSummary ?? true;
  // Tornado only renders when MC ran — analytical mode produces no
  // criticality/sigma data to rank against.
  const tornadoRows =
    (options.showTornado ?? false) ? buildTornadoRows(resolved) : [];
  const showTornado = tornadoRows.length > 0;
  const tornadoBoxHeight = showTornado ? tornadoBoxHeightFor(tornadoRows) : 0;
  // S-curve gates on MC output as well.
  const scurveData =
    (options.showScurve ?? false) ? buildScurveData(resolved) : null;
  const showScurve = scurveData !== null;
  const scurveBoxHeight = showScurve ? SCURVE_BOX_HEIGHT : 0;
  const effectiveCaptionBoxHeight = showSummary ? captionBoxHeight : 0;
  const fieldLegendHeight = showFieldLegend
    ? effectiveCaptionBoxHeight > 0
      ? effectiveCaptionBoxHeight
      : FIELD_LEGEND_DEFAULT_HEIGHT
    : 0;
  const bottomBoxHeight = Math.max(
    effectiveCaptionBoxHeight,
    fieldLegendHeight
  );
  // Tornado adds CAPTION_TOP_GAP + box. When the Summary/Legend band
  // is also present, this gap separates the two stacked rows so the
  // chrome reads as two distinct widgets.
  const tornadoBlockHeight = showTornado
    ? CAPTION_TOP_GAP + tornadoBoxHeight
    : 0;
  // S-curve stacks below tornado (or below the bottom band when tornado
  // is off). Same gap pattern: each widget owns its top gap.
  const scurveBlockHeight = showScurve ? CAPTION_TOP_GAP + scurveBoxHeight : 0;
  // The caption block reserves: a top gap (between diagram and box) +
  // the bottom band itself. When neither fires, contributes zero.
  const captionBlockHeight =
    bottomBoxHeight > 0 ? CAPTION_TOP_GAP + bottomBoxHeight : 0;

  // Natural size — fits all chrome without clipping. With the legend
  // on, the bottom row pairs the Summary (capped at CAPTION_BOX_MAX_WIDTH)
  // with the legend; the canvas grows just enough to hold both side-by-
  // side when the chart is narrower than the pair.
  const naturalChartWidth = layout.width + DIAGRAM_PADDING * 2;
  const summaryShownWithLegend =
    showFieldLegend && showSummary && captionBullets.length > 0;
  // Size the Summary box to its content rather than always claiming
  // CAPTION_BOX_MAX_WIDTH. The MAX is kept as a safety upper bound for
  // pathological one-line bullets.
  const naturalCaptionWidth = Math.min(
    captionNaturalWidth(captionBullets),
    CAPTION_BOX_MAX_WIDTH
  );
  const pairSummaryWidth = summaryShownWithLegend ? naturalCaptionWidth : 0;
  const pairGap = summaryShownWithLegend ? FIELD_LEGEND_GAP_X : 0;
  const pairContainerWidth = showFieldLegend
    ? pairSummaryWidth + pairGap + FIELD_LEGEND_WIDTH
    : 0;
  const naturalWidth = showFieldLegend
    ? Math.max(naturalChartWidth, pairContainerWidth + 2 * DIAGRAM_PADDING)
    : naturalChartWidth;
  const naturalHeight =
    layout.height +
    DIAGRAM_PADDING * 2 +
    titleHeight +
    captionBlockHeight +
    tornadoBlockHeight +
    scurveBlockHeight;
  const exportWidth = Math.max(
    options.exportDims?.width ?? naturalWidth,
    naturalWidth
  );
  const exportHeight = Math.max(
    options.exportDims?.height ?? naturalHeight,
    naturalHeight
  );
  if (exportWidth <= 0 || exportHeight <= 0) return;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', exportWidth)
    .attr('height', exportHeight)
    .attr('viewBox', `0 0 ${exportWidth} ${exportHeight}`)
    .style('font-family', FONT_FAMILY);

  const defs = svg.append('defs');
  buildArrowheads(defs, palette);

  if (effectiveTitle) {
    svg
      .append('text')
      .attr('class', 'pert-title chart-title')
      .attr('x', exportWidth / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(effectiveTitle);
  }

  const offsetX = DIAGRAM_PADDING;
  const offsetY = DIAGRAM_PADDING + titleHeight;

  const root = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY})`);

  renderGroups(root, resolved, layout, palette, isDark, collapsedSet);
  renderEdges(root, resolved, layout, palette, collapsedSet);
  renderNodes(
    root,
    defs,
    resolved,
    layout,
    palette,
    isDark,
    options.onClickItem,
    collapsedSet
  );

  // Place the bottom band. With the legend on, the Summary + Legend
  // pair is centered horizontally as a unit. With the legend off, the
  // Summary uses its existing centered-column treatment.
  const pairLeft = (exportWidth - pairContainerWidth) / 2;
  const captionWidth = showFieldLegend
    ? pairSummaryWidth
    : Math.min(naturalCaptionWidth, exportWidth - 2 * DIAGRAM_PADDING);
  const captionX = showFieldLegend
    ? pairLeft
    : (exportWidth - captionWidth) / 2;
  const legendX = summaryShownWithLegend
    ? pairLeft + pairSummaryWidth + FIELD_LEGEND_GAP_X
    : pairLeft;
  if (showSummary && captionBullets.length > 0) {
    renderCaptionBlock(svg, captionBullets, {
      x: captionX,
      y: offsetY + layout.height + CAPTION_TOP_GAP,
      width: captionWidth,
      height: captionBoxHeight,
      palette,
      isDark,
    });
  }

  if (showFieldLegend) {
    renderFieldLegendBlock(svg, {
      x: legendX,
      y: offsetY + layout.height + CAPTION_TOP_GAP,
      width: FIELD_LEGEND_WIDTH,
      height: fieldLegendHeight,
      palette,
      isDark,
    });
  }

  // The bottom-band stack is: [Summary | Legend pair] then [Tornado]
  // then [S-curve]. Each widget claims a CAPTION_TOP_GAP above itself
  // when present. Cursor `widgetY` walks down the stack as we render.
  let widgetY = offsetY + layout.height + CAPTION_TOP_GAP;
  if (bottomBoxHeight > 0) widgetY += bottomBoxHeight + CAPTION_TOP_GAP;

  if (showTornado) {
    const tornadoWidth = Math.min(
      exportWidth - 2 * DIAGRAM_PADDING,
      TORNADO_BOX_WIDTH
    );
    renderTornadoBlock(svg, tornadoRows, {
      x: (exportWidth - tornadoWidth) / 2,
      y: widgetY,
      width: tornadoWidth,
      height: tornadoBoxHeight,
      palette,
      isDark,
    });
    widgetY += tornadoBoxHeight + CAPTION_TOP_GAP;
  }

  if (showScurve) {
    const scurveWidth = Math.min(
      exportWidth - 2 * DIAGRAM_PADDING,
      SCURVE_BOX_WIDTH
    );
    renderScurveBlock(svg, scurveData, {
      x: (exportWidth - scurveWidth) / 2,
      y: widgetY,
      width: scurveWidth,
      height: scurveBoxHeight,
      palette,
      isDark,
      unit: resolved.options.timeUnit,
    });
  }
}

export function renderPertForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parsePert(content);
  if (parsed.error || parsed.activities.length === 0) return '';

  const resolved = analyzePert(parsed);
  const layout = layoutPert(resolved);
  const isDark = theme === 'dark';

  const titleHeight = parsed.title && !resolved.options.noTitle ? 80 : 0;
  // Mirror the bullet-list assembly inside renderPert so exportDims
  // matches the natural height (anchor annotation now lives inside
  // the caption box as a final italic bullet).
  const captionBullets: CaptionBullet[] =
    resolved.summaryText !== null && resolved.summaryText.length > 0
      ? bulletizeCaption(resolved.summaryText)
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
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    layout.height + DIAGRAM_PADDING * 2 + titleHeight + captionBlockHeight;

  const container = document.createElement('div');
  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    renderPert(container, resolved, layout, palette, isDark, {
      title: parsed.title,
      exportDims: { width: exportWidth, height: exportHeight },
    });
    const svgEl = container.querySelector('svg');
    if (!svgEl) return '';
    if (theme === 'transparent') svgEl.style.background = 'none';
    else svgEl.style.background = palette.bg;
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;
    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(container);
  }
}

// ============================================================
// Section: arrowhead defs
// ============================================================

type Defs = d3Selection.Selection<SVGDefsElement, unknown, null, undefined>;

function buildArrowheads(defs: Defs, palette: PaletteColors): void {
  const mk = (id: string, fill: string): void => {
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
      .attr('refX', ARROWHEAD_W)
      .attr('refY', ARROWHEAD_H / 2)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
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
  collapsedSet: ReadonlySet<string>
): void {
  if (layout.groups.length === 0) return;
  const layer = root.append('g').attr('class', 'pert-groups');
  const unit = resolved.options.timeUnit;

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
      const cardFill = shapeFill(palette, cardBaseColor, isDark);
      const cardLabelColor = contrastText(
        cardFill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
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
      });

      // Bottom collapse bar (universal "this is collapsed" signal —
      // see conventions doc §3 Pattern B). Clipped to the card's
      // rounded corners so it follows the rx.
      const safeGroupId = grp.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const clipId = `pert-group-clip-${safeGroupId}`;
      g.append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', grp.x)
        .attr('y', grp.y)
        .attr('width', grp.width)
        .attr('height', grp.height)
        .attr('rx', NODE_RADIUS)
        .attr('ry', NODE_RADIUS);
      g.append('rect')
        .attr('class', 'pert-collapse-bar')
        .attr('x', grp.x)
        .attr('y', grp.y + grp.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', grp.width)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', cardBaseColor)
        .attr('clip-path', `url(#${clipId})`);
      continue;
    }

    // Non-collapsed group — container recipe per conventions doc §2:
    // neutral surface fill, textMuted stroke at 0.35 / width 1.5,
    // rx=8, top-CENTER bold label inside the 28px reserved header band.
    g.append('rect')
      .attr('x', grp.x)
      .attr('y', grp.y)
      .attr('width', grp.width)
      .attr('height', grp.height)
      .attr('rx', CONTAINER_RADIUS)
      .attr('ry', CONTAINER_RADIUS)
      .attr('fill', containerFill)
      .attr('stroke', containerStroke)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    g.append('text')
      .attr('x', grp.x + grp.width / 2)
      .attr(
        'y',
        grp.y + CONTAINER_HEADER_HEIGHT / 2 + CONTAINER_LABEL_FONT_SIZE / 2 - 2
      )
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('fill', palette.text)
      .attr('font-size', CONTAINER_LABEL_FONT_SIZE)
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
  collapsedSet: ReadonlySet<string>
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
    layer
      .append('path')
      .attr('class', 'pert-edge')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', bandColor(band, palette, palette.textMuted))
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('marker-end', `url(#${bandArrow(band)})`)
      .attr('data-source', e.source)
      .attr('data-target', e.target)
      .attr('data-critical', String(isCritical))
      .attr('data-critical-path', String(isCritical))
      .attr('data-criticality-band', band ?? '');

    // Edge label: only drawn when the dependency type or lag deviates
    // from the FS+0 default. Mirrors Primavera/MS Project's midpoint
    // label convention.
    const parsedEdge = edgeByKey.get(`${e.source}->${e.target}`);
    const labelText = parsedEdge ? formatEdgeLabel(parsedEdge) : null;
    if (labelText) {
      const mid = e.points[Math.floor(e.points.length / 2)];
      layer
        .append('text')
        .attr('class', 'pert-edge-label')
        .attr('x', mid.x)
        .attr('y', mid.y - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', palette.textMuted)
        .attr('font-size', 10)
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
  onClickItem?: (lineNumber: number) => void,
  collapsedSet: ReadonlySet<string> = new Set()
): void {
  const layer = root.append('g').attr('class', 'pert-nodes');
  const byId = new Map(resolved.activities.map((r) => [r.activity.id, r]));
  const tbdSet = new Set<string>(
    resolved.activities.filter((r) => r.es === null).map((r) => r.activity.id)
  );
  const unit = resolved.options.timeUnit;
  const sprintMode = resolved.options.sprintMode;
  const sprintNumber = resolved.options.sprintNumber ?? 1;

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

    if (onClickItem) {
      g.style('cursor', 'pointer').on('click', () =>
        onClickItem(r.activity.lineNumber)
      );
    }

    const baseColor = bandColor(band, palette, palette.primary);
    const fill = shapeFill(palette, baseColor, isDark);
    const labelColor = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

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
        // Diamond glyph prefix marks this row as a milestone at a
        // glance — reads as a sync point even when the surrounding
        // visual context (lane / palette) doesn't make it obvious.
        name: `◆ ${r.activity.name}`,
        date: fmtSchedule(r.es, isTbd),
        slack: slackText,
        slackHidden,
        fill,
        stroke: baseColor,
        labelColor,
        highlightColor: palette.colors.blue,
        dashArray,
        pinned: pinnedSet.has(node.id) ? anchorKind : null,
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
}

type AnySel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

function drawTextbookCard(g: AnySel, a: TextbookCardArgs): void {
  const { width: w, height: h, x, y } = a;
  const colW = w / 3;
  const topY = y + NODE_TOP_ROW_HEIGHT;
  const bottomY = y + h - NODE_BOTTOM_ROW_HEIGHT;
  const colX1 = x + colW;
  const colX2 = x + colW * 2;

  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', NODE_RADIUS)
    .attr('ry', NODE_RADIUS)
    .attr('fill', a.fill)
    .attr('stroke', a.stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH)
    .attr('stroke-dasharray', a.dashArray ?? 'none');

  // Internal grid lines — low-opacity divider stroke. Defaults to the
  // border color but can be overridden so a critical-path (red) border
  // doesn't drag the cell-grid red along with it.
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

  // Per-cell highlight overlays — invisible by default, lit by the
  // React layer when the field-legend's matching cell is hovered.
  // Drawn before the text so the cell text stays at full opacity on
  // top of the tint. `pointer-events: none` keeps the rects from
  // intercepting clicks meant for the node wrapper.
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
  drawCellHighlight('es', x, y, colW, NODE_TOP_ROW_HEIGHT);
  drawCellHighlight('dur', x + colW, y, colW, NODE_TOP_ROW_HEIGHT);
  drawCellHighlight('ef', x + colW * 2, y, colW, NODE_TOP_ROW_HEIGHT);
  drawCellHighlight('ls', x, bottomY, colW, NODE_BOTTOM_ROW_HEIGHT);
  drawCellHighlight('slack', x + colW, bottomY, colW, NODE_BOTTOM_ROW_HEIGHT);
  drawCellHighlight('lf', x + colW * 2, bottomY, colW, NODE_BOTTOM_ROW_HEIGHT);

  // Cell text — vertically centered within each row. Defaults to
  // normal weight; the name cell and the dur cell pass an explicit
  // weight when needed.
  const drawCell = (
    cx: number,
    cy: number,
    text: string,
    weight: 'normal' | 'bold' = 'normal',
    size: number = NODE_CELL_FONT_SIZE,
    opacity = 1
  ): void => {
    const t = g
      .append('text')
      .attr('x', cx)
      .attr('y', cy + size / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('fill', a.labelColor)
      .attr('font-size', size)
      .attr('font-weight', weight)
      .text(text);
    if (opacity !== 1) t.attr('opacity', String(opacity));
  };

  // Top row: ES | dur | EF — the dur cell carries the duration-rank
  // emphasis: bold for top-20%, faded for bottom-20%, plain otherwise.
  // ES bolds when this card is a forward-anchored source; EF bolds when
  // it's a backward-anchored sink — those cells equal the user-supplied
  // anchor date and deserve visual weight as the "given".
  const topMid = y + NODE_TOP_ROW_HEIGHT / 2;
  const durWeight: 'normal' | 'bold' = a.emphasis === 'top' ? 'bold' : 'normal';
  const durOpacity = a.emphasis === 'bottom' ? DURATION_FADE_OPACITY : 1;
  const esWeight: 'normal' | 'bold' =
    a.pinned === 'forward' ? 'bold' : 'normal';
  const efWeight: 'normal' | 'bold' =
    a.pinned === 'backward' ? 'bold' : 'normal';
  drawCell(x + colW / 2, topMid, a.es, esWeight);
  drawCell(
    x + colW * 1.5,
    topMid,
    a.dur,
    durWeight,
    NODE_CELL_FONT_SIZE,
    durOpacity
  );
  drawCell(x + colW * 2.5, topMid, a.ef, efWeight);

  // Middle row: name (spans full width). When `pinned`, shift the
  // name slightly right and draw a small anchor icon to its left so
  // the combined glyph reads as one centered unit.
  const midRowTop = y + NODE_TOP_ROW_HEIGHT;
  const midRowH = h - NODE_TOP_ROW_HEIGHT - NODE_BOTTOM_ROW_HEIGHT;
  const midCenterY = midRowTop + midRowH / 2;
  if (a.pinned) {
    // Approximate text width — sans-serif average char width ≈ 0.55 *
    // font-size. Off by a couple pixels for variable-width text but
    // close enough for a small adornment.
    const approxTextW = a.name.length * NODE_FONT_SIZE * 0.55;
    const gap = 4;
    const combined = PIN_ICON_W + gap + approxTextW;
    const groupLeft = x + w / 2 - combined / 2;
    drawAnchorPin(g, groupLeft, midCenterY, a.labelColor);
    // Center text on (groupLeft + icon + gap) + textW/2.
    const textCx = groupLeft + PIN_ICON_W + gap + approxTextW / 2;
    drawCell(textCx, midCenterY, a.name, 'bold', NODE_FONT_SIZE);
  } else {
    drawCell(x + w / 2, midCenterY, a.name, 'bold', NODE_FONT_SIZE);
  }

  // Bottom row: LS | slack | LF — LS / LF bold under the same anchor
  // rule as the top row.
  const botMid = y + h - NODE_BOTTOM_ROW_HEIGHT / 2;
  const lsWeight: 'normal' | 'bold' = esWeight;
  const lfWeight: 'normal' | 'bold' = efWeight;
  drawCell(x + colW / 2, botMid, a.ls, lsWeight);
  drawCell(x + colW * 1.5, botMid, a.slack);
  drawCell(x + colW * 2.5, botMid, a.lf, lfWeight);
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
}

function drawMilestonePill(g: AnySel, a: MilestonePillArgs): void {
  const { width: w, height: h, x, y } = a;
  // Row heights mirror the textbook card's top/bottom rows so the date
  // and slack sit on the same horizontal rhythm as ES/LF on neighboring
  // full cards — the dividers line up across the lane.
  const topRowH = NODE_TOP_ROW_HEIGHT;
  const botRowH = NODE_BOTTOM_ROW_HEIGHT;
  const topY = y + topRowH;
  const bottomY = y + h - botRowH;

  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', NODE_RADIUS)
    .attr('ry', NODE_RADIUS)
    .attr('fill', a.fill)
    .attr('stroke', a.stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH)
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
  drawCenteredText(
    x + w / 2,
    y + topRowH / 2,
    a.date,
    'normal',
    NODE_CELL_FONT_SIZE
  );

  // Middle: name. Smaller than the regular card's name (12 vs 13) so
  // longer milestone names still fit in the narrower pill. Wrap to
  // multiple lines when the name overflows; if a single word still
  // doesn't fit, truncate it with an ellipsis. Anchor pin (when the
  // milestone is the forward source / backward sink) sits to the left
  // of the text block.
  const midRowTop = y + topRowH;
  const midRowH = h - topRowH - botRowH;
  const midCenterY = midRowTop + midRowH / 2;
  const nameSize = 12;
  const NAME_PAD_X = 6;
  const NAME_PIN_GAP = 4;
  const NAME_LINE_HEIGHT = 14;
  const charW = nameSize * 0.55;

  let textAreaLeft = x + NAME_PAD_X;
  const textAreaRight = x + w - NAME_PAD_X;
  if (a.pinned) {
    drawAnchorPin(g, x + NAME_PAD_X, midCenterY, a.labelColor);
    textAreaLeft = x + NAME_PAD_X + PIN_ICON_W + NAME_PIN_GAP;
  }
  const textCx = (textAreaLeft + textAreaRight) / 2;
  const availW = textAreaRight - textAreaLeft;
  const maxChars = Math.max(1, Math.floor(availW / charW));
  const lines = wrapTextByChars(a.name, maxChars).map((line) =>
    line.length > maxChars
      ? line.slice(0, Math.max(1, maxChars - 1)) + '…'
      : line
  );
  // Cap the rendered lines at what fits in the middle row.
  const maxLines = Math.max(1, Math.floor(midRowH / NAME_LINE_HEIGHT));
  const visibleLines = lines.slice(0, maxLines);
  if (lines.length > maxLines && visibleLines.length > 0) {
    const last = visibleLines[visibleLines.length - 1]!;
    visibleLines[visibleLines.length - 1] =
      last.length > maxChars - 1
        ? last.slice(0, Math.max(1, maxChars - 1)) + '…'
        : last + '…';
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

  // Bottom: slack — preserves the textbook card's bottom-row slack
  // position, so the eye finds slack in the same place on every node.
  // Suppressed entirely when slack is zero (critical-path milestone) —
  // the empty cell + divider would just be noise.
  if (!a.slackHidden) {
    drawCenteredText(
      x + w / 2,
      y + h - botRowH / 2,
      a.slack,
      'normal',
      NODE_CELL_FONT_SIZE
    );
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
  color: string
): void {
  // Lucide `anchor` icon authored on a 24×24 viewbox — scale to PIN_ICON_W.
  const scale = PIN_ICON_W / 24;
  const top = centerY - PIN_ICON_H / 2;
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

function formatDuration(
  value: number | null,
  unit: DurationUnit,
  nullLabel: string | null
): string {
  if (value === null) return nullLabel ?? '?';
  // Round to 2 decimals; trim trailing zeros for cleanliness.
  const rounded = Math.round(value * 100) / 100;
  const display = rounded.toFixed(2).replace(/\.?0+$/, '');
  return `${display}${unit}`;
}

/**
 * Format an ES / EF / LS / LF cell. When `projectStart` is set, the
 * numeric offset (in `unit`) becomes a calendar date; otherwise we
 * fall back to the numeric duration label so unanchored diagrams keep
 * their original output byte-for-byte.
 */
function formatScheduleValue(
  value: number | null,
  projectStart: string | null,
  unit: DurationUnit,
  nullLabel: string | null
): string {
  if (value === null) return nullLabel ?? '?';
  if (projectStart === null) return formatDuration(value, unit, nullLabel);
  return addCalendarDays(projectStart, value * unitToDays(unit));
}

/**
 * Format a sprint-indexed schedule cell as `S<n>`. The activity's value
 * is in sprint units (offset from `sprint-number`), so display = base +
 * round(value). Fractional sprint offsets are rounded to nearest int —
 * sprints are inherently discrete iteration boundaries.
 */
function formatSprintCell(
  value: number | null,
  sprintNumber: number,
  nullLabel: string | null
): string {
  if (value === null) return nullLabel ?? '?';
  const rounded = Math.round(value);
  return `S${sprintNumber + rounded}`;
}

/**
 * Format a slack cell. Anchored diagrams normalize slack to calendar
 * days regardless of `time-unit` (per spec C6); unanchored diagrams
 * keep the original behavior.
 */
function formatSlackValue(
  value: number | null,
  projectStart: string | null,
  unit: DurationUnit,
  nullLabel: string | null
): string {
  if (value === null) return nullLabel ?? '?';
  if (projectStart === null) return formatDuration(value, unit, nullLabel);
  // Convert from `unit` to calendar days so a 3-week slack reads "21d"
  // instead of "3w" when dates are showing.
  const days = value * unitToDays(unit);
  const rounded = Math.round(days * 100) / 100;
  const display = rounded.toFixed(2).replace(/\.?0+$/, '');
  return `${display}d`;
}

// ============================================================
// Section: critical-path highlight (React-callable)
// ============================================================
//
// Helpers that React (PertPreview) calls when the user toggles the
// "Highlight Critical Path" entry inside the cog dropdown. Operates
// on the diagram's container element — finds the SVG inside, fades
// non-critical nodes/edges/groups to 15%.
//
// In Monte-Carlo mode the binary critical chain is a misleading lens
// (every activity has some criticality), so the highlight rule keeps
// the high-band activities (red / orange / yellow) visible and fades
// the rest. In analytical mode it falls back to the binary path.

const HIGHLIGHT_BANDS = new Set<string>(['red', 'orange', 'yellow']);

function isCritical(el: Element, mcOn: boolean): boolean {
  if (mcOn) {
    return HIGHLIGHT_BANDS.has(el.getAttribute('data-criticality-band') ?? '');
  }
  return el.getAttribute('data-critical-path') === 'true';
}

/**
 * Fade non-critical activities, edges, and group containers in the
 * PERT diagram inside `container`. Auto-detects MC vs analytical mode
 * from the rendered attributes — no extra arguments needed.
 *
 * No-op when nothing qualifies as critical (e.g. TBD-poisoned terminals
 * with no MC) so the user doesn't get a "fade everything" surprise.
 */
export function highlightPertCriticalPath(container: Element): void {
  const svg = container.querySelector('svg');
  if (!svg) return;
  // Detect MC mode: edges in MC mode have non-empty data-criticality-band
  // bands like 'red'/'orange'/etc. Analytical mode uses only 'red' or ''.
  const mcOn = Array.from(svg.querySelectorAll('.pert-edge')).some((e) => {
    const b = e.getAttribute('data-criticality-band');
    return b !== null && b !== '' && b !== 'red';
  });

  const targets = svg.querySelectorAll(
    '.pert-node, .pert-edge, .pert-group-collapsed'
  );
  let anyCritical = false;
  for (const el of targets) {
    if (isCritical(el, mcOn)) {
      anyCritical = true;
      break;
    }
  }
  if (!anyCritical) return;

  svg.setAttribute('data-critical-path-active', 'true');
  for (const el of svg.querySelectorAll('.pert-node, .pert-edge')) {
    (el as SVGElement).setAttribute(
      'opacity',
      isCritical(el, mcOn) ? '1' : String(FADE_OPACITY)
    );
  }
  // Group containers (non-collapsed) always dim to scenery; collapsed
  // group cards behave like nodes and follow the critical/non-critical
  // rule (data-critical-path is set on the wrapper from member roll-up).
  for (const el of svg.querySelectorAll('.pert-group')) {
    const opacity = el.classList.contains('pert-group-collapsed')
      ? isCritical(el, mcOn)
        ? '1'
        : String(FADE_OPACITY)
      : String(FADE_OPACITY);
    (el as SVGElement).setAttribute('opacity', opacity);
  }
}

/**
 * Reset opacities applied by `highlightPertCriticalPath`. Safe to
 * call when no highlight is active.
 */
export function resetPertCriticalPath(container: Element): void {
  const svg = container.querySelector('svg');
  if (!svg) return;
  svg.removeAttribute('data-critical-path-active');
  for (const el of svg.querySelectorAll(
    '.pert-node, .pert-edge, .pert-group'
  )) {
    (el as SVGElement).removeAttribute('opacity');
  }
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
  if (anchor.kind === 'forward') {
    return `Start date: ${anchor.date}.`;
  }
  // Backward — TBD upstream still needs a hint that schedule cells will
  // render `?` until estimates land, otherwise readers see ?-filled
  // cards under a deadline with no explanation.
  if (resolved.projectStart) {
    return `Deadline: ${anchor.date}.`;
  }
  return `Deadline: ${anchor.date} — upstream activities still need estimates.`;
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
}

/**
 * Split the analyzer's `summaryText` into one bullet per logical
 * sentence. Per-line strings already correspond to one bullet each,
 * except the percentile line which packs three sentences into one
 * line (separated by ". "). Fragments produced by that split are
 * rendered as sub-bullets indented under the preceding top-level
 * bullet (Expected duration).
 */
function bulletizeCaption(summaryText: string): CaptionBullet[] {
  const bullets: CaptionBullet[] = [];
  for (const line of summaryText.split('\n')) {
    if (!line.includes('. ')) {
      bullets.push({ text: line, level: 0 });
      continue;
    }
    // Split on ". " — every fragment is a sub-bullet under the previous
    // top-level. Rejoin the period so each fragment ends with one.
    const parts = line.split('. ');
    parts.forEach((p, i) => {
      const text = i < parts.length - 1 ? `${p}.` : p;
      bullets.push({ text, level: 1 });
    });
  }
  return bullets;
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
 * Natural width of the Summary caption block at its current content —
 * the longest bullet (with bullet glyph + indent for sub-bullets) plus
 * the box's left/right padding. Used so the box doesn't claim more
 * horizontal space than it needs to display its bullets in one line each.
 *
 * Width is approximated with a 0.55× char-width factor against
 * CAPTION_FONT_SIZE — same approximation used elsewhere in the file
 * for label width estimates.
 */
function captionNaturalWidth(bullets: CaptionBullet[]): number {
  const charW = CAPTION_FONT_SIZE * 0.55;
  // Header text "Summary" sets a soft floor so a single short bullet
  // doesn't produce a box narrower than the centered header label.
  let max = 'Summary'.length * charW;
  for (const b of bullets) {
    const indent = b.level === 1 ? SUB_BULLET_INDENT : 0;
    const w = indent + `• ${b.text}`.length * charW;
    if (w > max) max = w;
  }
  return Math.ceil(max + 2 * CAPTION_BOX_PADDING_X);
}
// Caption box max width — wide enough for the longest current bullet
// (the backward-anchor framing note ≈ 700px at 13pt) plus padding.
// Wider PERT charts get a centered, fixed-column box rather than a
// stretched-edge-to-edge one which left a sea of empty space inside.
const CAPTION_BOX_MAX_WIDTH = 800;

// Tornado widget — Monte-Carlo sensitivity ranking. Same yellow-tint
// box treatment as the Summary so the bottom band reads as one family.
const TORNADO_BOX_WIDTH = 800;
const TORNADO_TOP_N = 10;
const TORNADO_ROW_HEIGHT = 22;
const TORNADO_NAME_COL_W = 220;
const TORNADO_VALUE_COL_W = 80;
const TORNADO_BAR_FONT_SIZE = 11;
const TORNADO_BAR_HEIGHT = 14;

// S-curve widget — empirical CDF of MC trial finish times. Same yellow
// box family. Plots cumulative P(done by t) over the t-range covered
// by the simulation.
const SCURVE_BOX_WIDTH = 800;
const SCURVE_BOX_HEIGHT = 220;
const SCURVE_PLOT_PADDING_X = 56; // y-axis labels + tick gap
const SCURVE_PLOT_PADDING_RIGHT = 16;
const SCURVE_PLOT_PADDING_BOTTOM = 36; // x-axis labels + tick gap
const SCURVE_TICK_FONT_SIZE = 10;
const SCURVE_PERCENTILE_RADIUS = 4;

function renderCaptionBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  bullets: CaptionBullet[],
  args: CaptionBlockArgs
): void {
  const { x, y, width, height, palette, isDark } = args;
  const baseColor = palette.colors.yellow;
  const fill = shapeFill(palette, baseColor, isDark);
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
    .attr('stroke', baseColor)
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

  const dividerY = y + CAPTION_BOX_PADDING_Y + CAPTION_LINE_HEIGHT;
  block
    .append('line')
    .attr('class', 'pert-caption-divider')
    .attr('x1', x + CAPTION_BOX_PADDING_X)
    .attr('x2', x + width - CAPTION_BOX_PADDING_X)
    .attr('y1', dividerY)
    .attr('y2', dividerY)
    .attr('stroke', baseColor)
    .attr('stroke-width', 1)
    .attr('opacity', 0.5);

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
function renderFieldLegendBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  args: FieldLegendArgs
): void {
  const { x, y, width, height, palette, isDark } = args;
  // Neutral gray base so the legend reads as informational chrome
  // (like the Summary box) rather than competing with the criticality-
  // tinted activity cards. shapeFill + contrastText still produce a
  // theme-correct light fill / dark text combo.
  const baseColor = palette.textMuted;
  const fill = shapeFill(palette, baseColor, isDark);
  const labelColor = contrastText(
    fill,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  const colW = width / 3;
  const gridTop = y;
  const rowH = height / 2;

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
    .attr('fill', fill)
    .attr('stroke', baseColor)
    .attr('stroke-width', NODE_STROKE_WIDTH);

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
  grid(x + colW, gridTop, x + colW, y + height);
  grid(x + colW * 2, gridTop, x + colW * 2, y + height);

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

    const descLines = wrapTextByChars(cell.desc, FIELD_LEGEND_DESC_WRAP_CHARS);
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
  /** Schedule Sensitivity Index = sigma × criticality. */
  ssi: number;
  /** Criticality band drives bar color (red/orange/yellow/green/blue). */
  band: Band;
}

/**
 * Build the top-N tornado rows from MC output. SSI = sigma × criticality
 * so an activity needs both volatility AND a real chance of landing on
 * the critical path to rank highly. Returns an empty array when MC
 * didn't run (analytical mode) or no activity has positive SSI.
 */
function buildTornadoRows(resolved: ResolvedPert): TornadoRow[] {
  if (resolved.monteCarloResult === null) return [];
  const rows: TornadoRow[] = [];
  for (const a of resolved.activities) {
    if (a.activity.isMilestone) continue;
    const sigma = a.sigma;
    const c = a.criticality;
    if (sigma === null || c === null) continue;
    const ssi = sigma * c;
    if (ssi <= 0) continue;
    rows.push({
      id: a.activity.id,
      name: a.activity.name,
      ssi,
      band: criticalityBand(c),
    });
  }
  rows.sort((a, b) => b.ssi - a.ssi);
  return rows.slice(0, TORNADO_TOP_N);
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
}

function renderTornadoBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  rows: TornadoRow[],
  args: TornadoBlockArgs
): void {
  const { x, y, width, height, palette, isDark } = args;
  const baseColor = palette.colors.yellow;
  const fill = shapeFill(palette, baseColor, isDark);
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
    .attr('stroke', baseColor)
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
    .text('Sensitivity (top schedule risks)');

  const dividerY = y + CAPTION_BOX_PADDING_Y + CAPTION_LINE_HEIGHT;
  block
    .append('line')
    .attr('class', 'pert-tornado-divider')
    .attr('x1', x + CAPTION_BOX_PADDING_X)
    .attr('x2', x + width - CAPTION_BOX_PADDING_X)
    .attr('y1', dividerY)
    .attr('y2', dividerY)
    .attr('stroke', baseColor)
    .attr('stroke-width', 1)
    .attr('opacity', 0.5);

  // Bar geometry. Activity name on the left, value on the right, bar
  // fills the middle column. Longest SSI gets the full bar width.
  const maxSsi = rows.reduce((acc, r) => Math.max(acc, r.ssi), 0) || 1;
  const nameX = x + CAPTION_BOX_PADDING_X;
  const barLeft = nameX + TORNADO_NAME_COL_W;
  const valueX = x + width - CAPTION_BOX_PADDING_X;
  const barRightLimit = valueX - TORNADO_VALUE_COL_W;
  const maxBarWidth = Math.max(barRightLimit - barLeft, 0);
  const firstRowY = y + CAPTION_BOX_PADDING_Y + CAPTION_HEADER_BAND_HEIGHT;

  rows.forEach((row, i) => {
    const rowY = firstRowY + i * TORNADO_ROW_HEIGHT;
    const labelY =
      rowY + TORNADO_ROW_HEIGHT / 2 + TORNADO_BAR_FONT_SIZE / 2 - 2;
    const barW = (row.ssi / maxSsi) * maxBarWidth;
    const barColor = bandColor(row.band, palette, palette.primary);
    const barFill = shapeFill(palette, barColor, isDark);

    // Activity name (truncate via ellipsis when overlong — quick approx
    // by char width since SVG truncation needs measurement).
    const truncated =
      row.name.length > 24 ? row.name.slice(0, 23) + '…' : row.name;
    block
      .append('text')
      .attr('class', 'pert-tornado-name')
      .attr('x', nameX)
      .attr('y', labelY)
      .attr('text-anchor', 'start')
      .attr('fill', labelColor)
      .attr('font-size', TORNADO_BAR_FONT_SIZE)
      .text(truncated);

    block
      .append('rect')
      .attr('class', 'pert-tornado-bar')
      .attr('x', barLeft)
      .attr('y', rowY + (TORNADO_ROW_HEIGHT - TORNADO_BAR_HEIGHT) / 2)
      .attr('width', barW)
      .attr('height', TORNADO_BAR_HEIGHT)
      .attr('rx', 2)
      .attr('ry', 2)
      .attr('fill', barFill)
      .attr('stroke', barColor)
      .attr('stroke-width', 1)
      .attr('data-activity-id', row.id);

    // SSI value, right-aligned.
    block
      .append('text')
      .attr('class', 'pert-tornado-value')
      .attr('x', valueX)
      .attr('y', labelY)
      .attr('text-anchor', 'end')
      .attr('fill', labelColor)
      .attr('font-size', TORNADO_BAR_FONT_SIZE)
      .text(row.ssi.toFixed(2));
  });
}

// ============================================================
// Section: S-curve (completion-probability) widget
// ============================================================

interface ScurveData {
  /** Sorted-ascending sample finish times (canonical days). */
  samples: number[];
  /** Project μ in canonical days — drawn as a vertical reference. */
  expectedDays: number;
  /** Percentile finish times (in canonical days). */
  p50Days: number;
  p80Days: number;
  p95Days: number;
}

/**
 * Build the cumulative-distribution data for the S-curve. We don't have
 * direct access to the per-trial finish times; reconstruct an
 * empirical CDF from the percentile triple. With three points we
 * interpolate piecewise-linearly so the curve still has the right
 * shape (steeper near the median, flatter in the tails).
 */
function buildScurveData(resolved: ResolvedPert): ScurveData | null {
  const mc = resolved.monteCarloResult;
  if (mc === null) return null;
  // Anchor the curve with O–p95 range. Use p50 ÷ ~0.5σ-ish as a
  // proxy for the lower tail — when MC reports identical p50/p80/p95
  // (degenerate) the function returns null upstream via no-variance.
  const p5 = Math.max(0, 2 * mc.p50 - mc.p95);
  const samples = [p5, mc.p50, mc.p80, mc.p95];
  if (samples.every((v) => v === samples[0])) return null;
  // Project mean (canonical days) — useful as a reference dot.
  const expectedDays = resolved.projectMu === null ? mc.p50 : mc.p50;
  return {
    samples,
    expectedDays,
    p50Days: mc.p50,
    p80Days: mc.p80,
    p95Days: mc.p95,
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
}

function renderScurveBlock(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  data: ScurveData,
  args: ScurveBlockArgs
): void {
  const { x, y, width, height, palette, isDark, unit } = args;
  const baseColor = palette.colors.yellow;
  const fill = shapeFill(palette, baseColor, isDark);
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
    .attr('stroke', baseColor)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  block
    .append('text')
    .attr('class', 'pert-scurve-header')
    .attr('x', x + width / 2)
    .attr('y', y + CAPTION_BOX_PADDING_Y + CAPTION_FONT_SIZE)
    .attr('text-anchor', 'middle')
    .attr('fill', labelColor)
    .attr('font-size', CAPTION_FONT_SIZE)
    .attr('font-weight', '700')
    .text('Completion probability');

  const dividerY = y + CAPTION_BOX_PADDING_Y + CAPTION_LINE_HEIGHT;
  block
    .append('line')
    .attr('class', 'pert-scurve-divider')
    .attr('x1', x + CAPTION_BOX_PADDING_X)
    .attr('x2', x + width - CAPTION_BOX_PADDING_X)
    .attr('y1', dividerY)
    .attr('y2', dividerY)
    .attr('stroke', baseColor)
    .attr('stroke-width', 1)
    .attr('opacity', 0.5);

  // Plot rect — leave room on the left for y-axis labels and below
  // for x-axis labels.
  const plotLeft = x + SCURVE_PLOT_PADDING_X;
  const plotRight = x + width - SCURVE_PLOT_PADDING_RIGHT;
  const plotTop = y + CAPTION_BOX_PADDING_Y + CAPTION_HEADER_BAND_HEIGHT;
  const plotBottom = y + height - SCURVE_PLOT_PADDING_BOTTOM;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const xMin = data.samples[0];
  const xMax = data.samples[data.samples.length - 1];
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

  // Sigmoid curve through the 4 sample points (p5 / p50 / p80 / p95).
  // Cumulative probabilities at those samples are 5 / 50 / 80 / 95 %.
  // Interpolate piecewise-linearly between them with extra anchor at 0.
  const points: { x: number; y: number }[] = [
    { x: xScale(xMin), y: yScale(0.05) },
    { x: xScale(data.p50Days), y: yScale(0.5) },
    { x: xScale(data.p80Days), y: yScale(0.8) },
    { x: xScale(data.p95Days), y: yScale(0.95) },
  ];
  const curve = d3Shape
    .line<{ x: number; y: number }>()
    .x((d) => d.x)
    .y((d) => d.y)
    .curve(d3Shape.curveMonotoneX)(points);
  if (curve) {
    block
      .append('path')
      .attr('class', 'pert-scurve-line')
      .attr('d', curve)
      .attr('fill', 'none')
      .attr('stroke', palette.colors.red)
      .attr('stroke-width', 2);
  }

  // Percentile dots + dashed verticals down to x-axis.
  const dots: { value: number; pct: number; label: string }[] = [
    { value: data.p50Days, pct: 0.5, label: 'P50' },
    { value: data.p80Days, pct: 0.8, label: 'P80' },
    { value: data.p95Days, pct: 0.95, label: 'P95' },
  ];
  for (const d of dots) {
    const cx = xScale(d.value);
    const cy = yScale(d.pct);
    block
      .append('line')
      .attr('class', 'pert-scurve-percentile-tick')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', cy)
      .attr('y2', plotBottom)
      .attr('stroke', palette.colors.red)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 3')
      .attr('opacity', 0.6);
    block
      .append('circle')
      .attr('class', 'pert-scurve-percentile-dot')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', SCURVE_PERCENTILE_RADIUS)
      .attr('fill', palette.colors.red)
      .attr('stroke', fill)
      .attr('stroke-width', 1.5)
      .attr('data-percentile', d.label);
    block
      .append('text')
      .attr('class', 'pert-scurve-percentile-label')
      .attr('x', cx)
      .attr('y', cy - SCURVE_PERCENTILE_RADIUS - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
      .attr('font-size', SCURVE_TICK_FONT_SIZE)
      .text(d.label);
  }

  // X-axis ticks: min, p50, max — labelled in the diagram unit.
  const xTicks = [
    { v: xMin, label: formatScurveTick(xMin, unit) },
    { v: data.p50Days, label: formatScurveTick(data.p50Days, unit) },
    { v: data.p95Days, label: formatScurveTick(data.p95Days, unit) },
  ];
  for (const t of xTicks) {
    const tx = xScale(t.v);
    block
      .append('text')
      .attr('class', 'pert-scurve-xtick')
      .attr('x', tx)
      .attr('y', plotBottom + SCURVE_TICK_FONT_SIZE + 6)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
      .attr('font-size', SCURVE_TICK_FONT_SIZE)
      .text(t.label);
  }
}

function formatScurveTick(days: number, unit: DurationUnit): string {
  const value = days / UNIT_TO_DAYS_LOCAL[unit];
  const display = (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return `${display}${unit}`;
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
