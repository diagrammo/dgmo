// ============================================================
// PERT Renderer (Phase 1 — static SVG)
// ============================================================
//
// Phase 1 visual encoding:
//   - rectangle nodes (compact = name + μ)
//   - diamond shapes for milestones (60% width, label below)
//   - dashed border for TBD activities (and downstream-of-TBD)
//   - binary critical-path stroke (bold solid in palette accent)
//   - group bounding rects (cluster) and super-edges (hammock when collapsed)
//   - data attrs on the `<g>` wrapper of each activity ONLY (per
//     CLAUDE.md gotcha: children must NOT carry data attributes)
//
// Phase 2 will layer in: criticality gradient fill, slack bars,
// σ-as-border-thickness, CDF curve. Those gate on `monteCarloResult`.

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix } from '../palettes/color-utils';
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
const NODE_LABEL_FONT_SIZE = 12;
const NODE_SECONDARY_FONT_SIZE = 11;
const SUMMARY_FONT_SIZE = 11;
const NODE_RADIUS = 6;
const NODE_STROKE_WIDTH = 1.5;
const NODE_CRITICAL_STROKE_WIDTH = 3;
const EDGE_STROKE_WIDTH = 1.4;
const EDGE_CRITICAL_STROKE_WIDTH = 2.4;
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;

const lineGenerator = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

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

  const titleHeight = options.title ? 40 : 0;

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

  renderGroups(root, resolved, layout, palette, isDark);
  renderEdges(root, resolved, layout, palette);
  renderNodes(
    root,
    defs,
    resolved,
    layout,
    palette,
    isDark,
    options.onClickItem
  );
  renderSummary(root, resolved, layout, palette);
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

  const titleHeight = parsed.title ? 40 : 0;
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
  const variants: { id: string; fill: string }[] = [
    { id: 'pert-arrow', fill: palette.textMuted },
    { id: 'pert-arrow-critical', fill: palette.accent },
  ];
  for (const v of variants) {
    defs
      .append('marker')
      .attr('id', v.id)
      .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
      .attr('refX', ARROWHEAD_W)
      .attr('refY', ARROWHEAD_H / 2)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
      .attr('fill', v.fill);
  }
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
  isDark: boolean
): void {
  if (layout.groups.length === 0) return;
  const layer = root.append('g').attr('class', 'pert-groups');
  for (const grp of layout.groups) {
    if (grp.width <= 0 || grp.height <= 0) continue;
    const resolvedGroup = resolved.groups.find((rg) => rg.group.id === grp.id);
    const label = resolvedGroup?.group.name ?? grp.id;
    const fill = mix(palette.surface, palette.bg, isDark ? 60 : 80);
    const stroke = palette.border;

    const g = layer
      .append('g')
      .attr('class', 'pert-group')
      .attr('data-group-id', grp.id)
      .attr('data-line-number', String(resolvedGroup?.group.lineNumber ?? 0));

    g.append('rect')
      .attr('x', grp.x)
      .attr('y', grp.y)
      .attr('width', grp.width)
      .attr('height', grp.height)
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 1)
      .attr(
        'stroke-dasharray',
        grp.classification === 'cluster' ? '5,3' : 'none'
      );

    g.append('text')
      .attr('x', grp.x + 10)
      .attr('y', grp.y + 14)
      .attr('fill', palette.textMuted)
      .attr('font-size', SUMMARY_FONT_SIZE)
      .attr('font-weight', 600)
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
  palette: PaletteColors
): void {
  const layer = root.append('g').attr('class', 'pert-edges');
  const criticalSet = new Set(resolved.criticalPath);
  for (const e of layout.edges) {
    if (e.points.length < 2) continue;
    const isCritical = criticalSet.has(e.source) && criticalSet.has(e.target);
    const path = lineGenerator(e.points);
    if (!path) continue;
    const stroke = isCritical ? palette.accent : palette.textMuted;
    const markerId = isCritical ? 'pert-arrow-critical' : 'pert-arrow';
    layer
      .append('path')
      .attr('class', 'pert-edge')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr(
        'stroke-width',
        isCritical ? EDGE_CRITICAL_STROKE_WIDTH : EDGE_STROKE_WIDTH
      )
      .attr('marker-end', `url(#${markerId})`)
      .attr('data-source', e.source)
      .attr('data-target', e.target)
      .attr('data-critical', String(isCritical));
  }
}

// ============================================================
// Section: nodes
// ============================================================

function renderNodes(
  root: RootSel,
  defs: Defs,
  resolved: ResolvedPert,
  layout: LayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void
): void {
  const layer = root.append('g').attr('class', 'pert-nodes');
  const byId = new Map(resolved.activities.map((r) => [r.activity.id, r]));
  const tbdSet = new Set<string>(
    resolved.activities.filter((r) => r.es === null).map((r) => r.activity.id)
  );
  const mcOn = resolved.monteCarloResult !== null;

  for (const node of layout.nodes) {
    const r = byId.get(node.id);
    if (!r) continue;
    const isCritical = r.isCriticalPath;
    const isMilestone = r.activity.isMilestone;
    const isTbd = tbdSet.has(node.id);

    // Criticality gradient when MC is on; binary tint when MC is off.
    // Gamma curve (γ=1.8) compresses 0–30% into near-neutral and reserves
    // saturated tints for the actionable risk band (60–100%).
    let fill: string;
    if (mcOn && r.criticality !== null) {
      const tintPct = Math.pow(r.criticality, 1.8) * 100;
      fill = mix(palette.accent, palette.surface, tintPct);
    } else {
      fill = isCritical
        ? mix(palette.accent, palette.surface, 22)
        : palette.surface;
    }
    const stroke = isCritical ? palette.accent : palette.border;
    const strokeWidth = isCritical
      ? NODE_CRITICAL_STROKE_WIDTH
      : NODE_STROKE_WIDTH;
    const dashArray = isTbd ? '4,3' : 'none';

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
      .attr('data-critical-path', String(isCritical));

    if (onClickItem) {
      g.style('cursor', 'pointer').on('click', () =>
        onClickItem(r.activity.lineNumber)
      );
    }

    if (isMilestone) {
      const half = node.width / 2;
      const points = [
        `0,${-half}`,
        `${half},0`,
        `0,${half}`,
        `${-half},0`,
      ].join(' ');
      g.append('polygon')
        .attr('points', points)
        .attr('fill', isCritical ? palette.accent : palette.colors.purple)
        .attr('stroke', stroke)
        .attr('stroke-width', strokeWidth);
      // Label below the diamond (per spec § Diamond milestone sizing).
      g.append('text')
        .attr('x', 0)
        .attr('y', half + 16)
        .attr('text-anchor', 'middle')
        .attr('fill', palette.text)
        .attr('font-size', NODE_LABEL_FONT_SIZE)
        .attr('font-weight', 600)
        .text(r.activity.name);
      continue;
    }

    g.append('rect')
      .attr('x', -node.width / 2)
      .attr('y', -node.height / 2)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', NODE_RADIUS)
      .attr('ry', NODE_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', strokeWidth)
      .attr('stroke-dasharray', dashArray);

    // Diagonal-stripe overlay at criticality ≥ 90% — non-color signal
    // for deuteranopia (per spec § Accessibility). Layered <line>
    // elements clipped to the rectangle; avoids resvg <pattern> quirks.
    if (mcOn && r.criticality !== null && r.criticality >= 0.9) {
      const safeId = node.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const clipId = `pert-stripe-clip-${safeId}`;
      defs
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', -node.width / 2)
        .attr('y', -node.height / 2)
        .attr('width', node.width)
        .attr('height', node.height)
        .attr('rx', NODE_RADIUS)
        .attr('ry', NODE_RADIUS);
      const stripeG = g
        .append('g')
        .attr('class', 'pert-stripe-overlay')
        .attr('clip-path', `url(#${clipId})`);
      const halfW = node.width / 2;
      const halfH = node.height / 2;
      const span = node.width + node.height;
      for (let offset = -span; offset <= span; offset += 4) {
        stripeG
          .append('line')
          .attr('x1', -halfW + offset)
          .attr('y1', -halfH)
          .attr('x2', -halfW + offset + halfH * 2)
          .attr('y2', halfH)
          .attr('stroke', palette.text)
          .attr('stroke-width', 1)
          .attr('opacity', 0.4);
      }
    }

    const textColor = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

    // Top line: name (with optional ★ when critical).
    const nameLine = isCritical ? `★ ${r.activity.name}` : r.activity.name;
    g.append('text')
      .attr('x', 0)
      .attr('y', -4)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', NODE_FONT_SIZE)
      .attr('font-weight', 600)
      .text(nameLine);

    // Bottom line: μ formatted with diagram time-unit, or `?` when TBD.
    const muStr = formatDuration(
      r.mu,
      resolved.options.timeUnit,
      isTbd ? '?' : null
    );
    g.append('text')
      .attr('x', 0)
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .attr('fill', isCritical ? textColor : palette.textMuted)
      .attr('font-size', NODE_SECONDARY_FONT_SIZE)
      .text(muStr);
  }
}

// ============================================================
// Section: summary box (bottom-right)
// ============================================================

function renderSummary(
  root: RootSel,
  resolved: ResolvedPert,
  layout: LayoutResult,
  palette: PaletteColors
): void {
  if (resolved.activities.length === 0) return;
  const lines: string[] = [];
  const unit = resolved.options.timeUnit;
  lines.push(`Project μ: ${formatDuration(resolved.projectMu, unit, '?')}`);
  if (resolved.projectSigma !== null) {
    lines.push(
      `Project σ: ${formatDuration(resolved.projectSigma, unit, '0')}`
    );
  }
  // Phase 2: when Monte Carlo ran, surface P50/P80/P95 in canonical days
  // converted to the diagram's time-unit. The simulator stores these in
  // canonical days (days), so we convert here.
  const mc = resolved.monteCarloResult;
  if (mc) {
    const fmt = (days: number): string => {
      const v = days / unitToDays(unit);
      const r = Math.round(v * 100) / 100;
      return `${r.toFixed(2).replace(/\.?0+$/, '')}${unit}`;
    };
    lines.push(
      `P50: ${fmt(mc.p50)}    P80: ${fmt(mc.p80)}    P95: ${fmt(mc.p95)}`
    );
  }
  if (resolved.criticalPath.length > 0) {
    const names = resolved.criticalPath
      .map((id) => {
        const r = resolved.activities.find((x) => x.activity.id === id);
        return r ? r.activity.name : id;
      })
      .join(' → ');
    lines.push(`Critical path: ${names}`);
  }

  const padding = 8;
  const lineHeight = 14;
  const boxWidth = Math.min(
    400,
    Math.max(160, ...lines.map((l) => l.length * 6.5 + padding * 2))
  );
  const boxHeight = lines.length * lineHeight + padding * 2;
  const x = layout.width - boxWidth - DIAGRAM_PADDING;
  const y = layout.height - boxHeight - DIAGRAM_PADDING;

  const g = root
    .append('g')
    .attr('class', 'pert-summary')
    .attr('transform', `translate(${x}, ${y})`);

  g.append('rect')
    .attr('width', boxWidth)
    .attr('height', boxHeight)
    .attr('rx', 6)
    .attr('fill', mix(palette.surface, palette.bg, 60))
    .attr('stroke', palette.border)
    .attr('stroke-width', 1);

  for (let i = 0; i < lines.length; i++) {
    g.append('text')
      .attr('x', padding)
      .attr('y', padding + (i + 1) * lineHeight - 3)
      .attr('fill', palette.text)
      .attr('font-size', SUMMARY_FONT_SIZE)
      .text(lines[i]);
  }
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

/** Mirror of analyzer's UNIT_TO_DAYS — kept local to avoid a cycle. */
function unitToDays(unit: DurationUnit): number {
  switch (unit) {
    case 'min':
      return 1 / (60 * 24);
    case 'h':
      return 1 / 24;
    case 'd':
    case 'bd':
      return 1;
    case 'w':
      return 7;
    case 'm':
      return 30;
    case 'q':
      return 90;
    case 'y':
      return 365;
    case 's':
      return 14;
  }
}

// re-export to silence unused-type lint when consumers only want the helper
export type { ResolvedActivity, Duration };
