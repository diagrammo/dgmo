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
import type { LayoutResult, ResolvedActivity, ResolvedPert } from './types';
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
// Anchor-pin glyph dimensions (Lucide map-pin path, scaled to fit
// next to the 13pt bold name label). Width drives the layout math;
// height is a derived target for vertical centering.
const PIN_ICON_W = 12;
const PIN_ICON_H = 14;

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

  const titleHeight = options.title ? 80 : 0;

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
      ? captionBullets.length * CAPTION_LINE_HEIGHT + 2 * CAPTION_BOX_PADDING_Y
      : 0;
  // The caption block reserves: a top gap (between diagram and box) +
  // the box itself. When no caption fires, contributes zero height.
  const captionBlockHeight =
    captionBullets.length > 0 ? CAPTION_TOP_GAP + captionBoxHeight : 0;

  // Natural size — fits all chrome without clipping. We always expand
  // a supplied `exportDims` to at least this; smaller hints would
  // crop the diagram body off-screen.
  const naturalWidth = layout.width + DIAGRAM_PADDING * 2;
  const naturalHeight =
    layout.height + DIAGRAM_PADDING * 2 + titleHeight + captionBlockHeight;
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

  if (options.title) {
    svg
      .append('text')
      .attr('class', 'pert-title')
      .attr('x', exportWidth / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(options.title);
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

  if (captionBullets.length > 0) {
    renderCaptionBlock(svg, captionBullets, {
      x: DIAGRAM_PADDING,
      y: offsetY + layout.height + CAPTION_TOP_GAP,
      width: exportWidth - 2 * DIAGRAM_PADDING,
      height: captionBoxHeight,
      palette,
      isDark,
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

  const titleHeight = parsed.title ? 80 : 0;
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
      ? captionBullets.length * CAPTION_LINE_HEIGHT + 2 * CAPTION_BOX_PADDING_Y
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
  }
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

  // Match org / infra default-node treatment:
  //   fill   = 25% tint of the node's intent color on surface (via shapeFill)
  //   stroke = the node's intent color
  // For critical-path / criticality-band nodes the intent color is the band
  // hue (red / orange / yellow); otherwise it's `palette.primary`. The fill
  // therefore tracks the border so a red-bordered card reads as red-tinted,
  // an orange one as orange-tinted, etc. — same convention as org / infra.
  const projectStart = resolved.projectStart;
  // Three formatter roles, distinct semantics: schedule cells become
  // dates when anchored, slack normalizes to days when anchored, and
  // mu/dur is always a duration label regardless of mode.
  const fmtSchedule = (v: number | null, isTbd: boolean): string =>
    formatScheduleValue(v, projectStart, unit, isTbd ? '?' : null);
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

  // Anchor "pin" set — nodes whose label gets a map-pin icon prefix
  // because one of their schedule cells comes directly from the
  // user-supplied date (not a derived offset).
  //   forward  → activities with no predecessors (ES = start-date)
  //   backward → activities with no successors   (LF = end-date)
  // No anchor → empty set, no pins drawn anywhere.
  const pinnedSet = computeAnchorPinSet(resolved);

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

    // Zero-duration activities (formerly milestone primitive) get a
    // ◆ glyph prefix so authors can spot sync points at a glance. The
    // node geometry is identical to a regular activity.
    const displayName = r.activity.isMilestone
      ? `◆ ${r.activity.name}`
      : r.activity.name;

    drawTextbookCard(g, {
      width: node.width,
      height: node.height,
      x: -node.width / 2,
      y: -node.height / 2,
      name: displayName,
      es: fmtSchedule(r.es, isTbd),
      dur: fmtDur(r.mu, isTbd),
      ef: fmtSchedule(r.ef, isTbd),
      ls: fmtSchedule(r.ls, isTbd),
      slack: fmtSlack(r.slack, isTbd),
      lf: fmtSchedule(r.lf, isTbd),
      fill,
      stroke: baseColor,
      labelColor,
      dashArray,
      emphasis: isTopMu ? 'top' : isBottomMu ? 'bottom' : null,
      pinned: pinnedSet.has(node.id),
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
  dashArray?: string;
  /**
   * Duration-rank emphasis. Affects ONLY the `dur` cell: 'top' bolds
   * the duration value, 'bottom' fades it to DURATION_FADE_OPACITY.
   * Card border, fill, name, and other cells are unaffected — the
   * signal is precise to "longer / shorter task".
   */
  emphasis?: 'top' | 'bottom' | null;
  /**
   * When true, prefix the middle-row name with a small map-pin icon —
   * a hint that this activity carries one of the user-supplied anchor
   * dates directly (ES of a source node in forward mode, LF of a sink
   * node in backward mode). All other cards leave the label plain.
   */
  pinned?: boolean;
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
  const topMid = y + NODE_TOP_ROW_HEIGHT / 2;
  const durWeight: 'normal' | 'bold' = a.emphasis === 'top' ? 'bold' : 'normal';
  const durOpacity = a.emphasis === 'bottom' ? DURATION_FADE_OPACITY : 1;
  drawCell(x + colW / 2, topMid, a.es);
  drawCell(
    x + colW * 1.5,
    topMid,
    a.dur,
    durWeight,
    NODE_CELL_FONT_SIZE,
    durOpacity
  );
  drawCell(x + colW * 2.5, topMid, a.ef);

  // Middle row: name (spans full width). When `pinned`, shift the
  // name slightly right and draw a small map-pin icon to its left so
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
    // Center text on (groupLeft + pin + gap) + textW/2.
    const textCx = groupLeft + PIN_ICON_W + gap + approxTextW / 2;
    drawCell(textCx, midCenterY, a.name, 'bold', NODE_FONT_SIZE);
  } else {
    drawCell(x + w / 2, midCenterY, a.name, 'bold', NODE_FONT_SIZE);
  }

  // Bottom row: LS | slack | LF
  const botMid = y + h - NODE_BOTTOM_ROW_HEIGHT / 2;
  drawCell(x + colW / 2, botMid, a.ls);
  drawCell(x + colW * 1.5, botMid, a.slack);
  drawCell(x + colW * 2.5, botMid, a.lf);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Render a Lucide-style push-pin (thumbtack) glyph at `(left, centerY)`,
 * sized to PIN_ICON_W × PIN_ICON_H. Two paths — the cap with its
 * pinch and the down-stroke — both inherit the supplied color so the
 * pin tracks the node's tint.
 */
function drawAnchorPin(
  g: AnySel,
  left: number,
  centerY: number,
  color: string
): void {
  // Lucide `pin` icon authored on a 24×24 viewbox — scale to PIN_ICON_W.
  const scale = PIN_ICON_W / 24;
  const top = centerY - PIN_ICON_H / 2;
  const pin = g
    .append('g')
    .attr('class', 'pert-pin')
    .attr('data-pert-pin', '')
    .attr('transform', `translate(${left}, ${top}) scale(${scale})`);
  // Body of the thumbtack: head, pinched neck, stem-pad shape.
  pin
    .append('path')
    .attr(
      'd',
      'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V5a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'
    )
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round');
}

/**
 * Build the set of activity ids whose label gets a map-pin icon
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
 * Surfaces which end of the schedule the user pinned and (for
 * backward) the derived project-start date so the envelope is
 * legible at a glance. Rendered as an italic bullet at the bottom
 * of the caption box.
 */
function anchorAnnotationText(resolved: ResolvedPert): string | null {
  const anchor = resolved.options.anchor;
  if (anchor === null) return null;
  if (anchor.kind === 'forward') {
    return `Forward-anchored from start-date ${anchor.date}.`;
  }
  // Backward — surface BOTH the user-supplied end-date AND the derived
  // projectStart so the reader can see the schedule envelope at a
  // glance. Falls back to a generic phrasing when projectStart is null
  // (TBD upstream — the body cells will show `?`).
  if (resolved.projectStart) {
    return `Backward-anchored: end-date ${anchor.date} → project start ${resolved.projectStart}. Non-critical dates show earliest possible.`;
  }
  return `Backward-anchored from end-date ${anchor.date}. Project start is unknown until upstream activities are estimated.`;
}

interface CaptionBullet {
  text: string;
  /** 0 = top-level bullet; 1 = sub-bullet (indented). */
  level: number;
  /**
   * When true, render the bullet text in italic and omit the `•`
   * glyph. Used for the D10 backward-anchor framing note that sits at
   * the bottom of the caption box.
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
 * `palette.primary` stroke, 25% tint fill via `shapeFill`. Text is
 * left-aligned with a `•` bullet glyph prefixing each line; sub-bullets
 * (level 1) sit indented under the preceding top-level bullet.
 */
const SUB_BULLET_INDENT = 20;

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

  const textX = x + CAPTION_BOX_PADDING_X;
  const firstBaselineY = y + CAPTION_BOX_PADDING_Y + CAPTION_FONT_SIZE;
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
      .text(bullet.italic ? bullet.text : `• ${bullet.text}`);
    if (bullet.italic) tspan.attr('font-style', 'italic');
    if (i > 0) tspan.attr('dy', CAPTION_LINE_HEIGHT);
  });
}

// re-export to silence unused-type lint when consumers only want the helper
export type { ResolvedActivity, Duration };
