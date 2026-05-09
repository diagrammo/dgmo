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
} from '../utils/title-constants';
import type { LayoutResult, ResolvedActivity, ResolvedPert } from './types';
import { parsePert } from './parser';
import { analyzePert } from './analyzer';
import { layoutPert } from './layout';
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
  /** Override container dimensions during export. */
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

  const exportWidth =
    options.exportDims?.width ?? layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    options.exportDims?.height ??
    layout.height + DIAGRAM_PADDING * 2 + titleHeight;
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

  const collapsedSet = new Set(options.collapsedGroupIds ?? []);

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
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleHeight;

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
      const muStr = formatDuration(resolvedGroup?.rolledMu ?? null, unit, '?');
      const slackStr = formatDuration(resolvedGroup?.slack ?? null, unit, '?');
      const esStr = formatDuration(resolvedGroup?.es ?? null, unit, '?');
      const efStr = formatDuration(resolvedGroup?.ef ?? null, unit, '?');
      const lsStr = formatDuration(resolvedGroup?.ls ?? null, unit, '?');
      const lfStr = formatDuration(resolvedGroup?.lf ?? null, unit, '?');

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
  const fmt = (v: number | null, isTbd: boolean): string =>
    formatDuration(v, unit, isTbd ? '?' : null);

  const mcOn = resolved.monteCarloResult !== null;

  for (const node of layout.nodes) {
    const r = byId.get(node.id);
    if (!r) continue;
    if (r.activity.groupId && collapsedSet.has(r.activity.groupId)) continue;
    const isCritical = r.isCriticalPath;
    const isTbd = tbdSet.has(node.id);
    const dashArray = isTbd ? '4,3' : 'none';

    const band: Band = mcOn
      ? criticalityBand(r.criticality)
      : isCritical
        ? 'red'
        : null;

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
      .attr('data-criticality-band', band ?? '');

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

    drawTextbookCard(g, {
      width: node.width,
      height: node.height,
      x: -node.width / 2,
      y: -node.height / 2,
      name: r.activity.name,
      es: fmt(r.es, isTbd),
      dur: fmt(r.mu, isTbd),
      ef: fmt(r.ef, isTbd),
      ls: fmt(r.ls, isTbd),
      slack: fmt(r.slack, isTbd),
      lf: fmt(r.lf, isTbd),
      fill,
      stroke: baseColor,
      labelColor,
      dashArray,
    });
  }
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

  // Cell text — vertically centered within each row.
  const drawCell = (
    cx: number,
    cy: number,
    text: string,
    weight: 'normal' | 'bold' = 'normal',
    size: number = NODE_CELL_FONT_SIZE
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

  // Top row: ES | dur | EF
  const topMid = y + NODE_TOP_ROW_HEIGHT / 2;
  drawCell(x + colW / 2, topMid, a.es);
  drawCell(x + colW * 1.5, topMid, a.dur);
  drawCell(x + colW * 2.5, topMid, a.ef);

  // Middle row: name (spans full width)
  const midRowTop = y + NODE_TOP_ROW_HEIGHT;
  const midRowH = h - NODE_TOP_ROW_HEIGHT - NODE_BOTTOM_ROW_HEIGHT;
  drawCell(x + w / 2, midRowTop + midRowH / 2, a.name, 'bold', NODE_FONT_SIZE);

  // Bottom row: LS | slack | LF
  const botMid = y + h - NODE_BOTTOM_ROW_HEIGHT / 2;
  drawCell(x + colW / 2, botMid, a.ls);
  drawCell(x + colW * 1.5, botMid, a.slack);
  drawCell(x + colW * 2.5, botMid, a.lf);
}

// ============================================================
// Helpers
// ============================================================

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

// re-export to silence unused-type lint when consumers only want the helper
export type { ResolvedActivity, Duration };
