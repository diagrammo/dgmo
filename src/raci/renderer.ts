// ============================================================
// RACI / RASCI / DACI — D3 SVG Renderer
// ============================================================
//
// Treatment: color-blocked letters (cell fill = palette tint per
// marker; letter on top with palette-aware contrast text). One of
// the three Task-7 prototype options; chosen for v1 because:
//
//   - At gallery thumbnail scale, the marker palette reads as the
//     dominant signal (matches conventional RACI visual language).
//   - Multi-marker cells (`A R`) stay legible — letters don't pile up.
//   - Empty cells are visually distinct (subtle hairline border) per
//     AC 13's "ready to author" requirement.
//
// Locked in `docs/architecture/adr-NNN-raci-renderer-visual.md`
// (Phase 6 deliverable). Switching to dot-markers or plain letters
// in a future iteration only changes the cell-paint code path.
//
// SVG attribute conventions (per `sequence/renderer.ts:2310-2317`):
//   - Each phase `<g>` carries `data-section`, `data-section-toggle`,
//     `data-line-number`. Children carry `data-line-number` only.
//   - Task rows carry `data-line-number` for editor highlighting.
//   - Cells carry `data-line-number` to the role-assignment line so
//     click → editor cursor jumps to the source.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { contrastText, mix } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type {
  ParsedRaci,
  RaciMarker,
  RaciPhase,
  RaciTask,
  RaciVariant,
} from './types';
import { allTasks } from './parser';
import { VARIANTS } from './variants';

/** Sort markers into canonical alphabet order for display. */
function sortByAlphabet(
  markers: ReadonlyArray<RaciMarker>,
  alphabet: ReadonlyArray<RaciMarker>
): RaciMarker[] {
  const order = new Map<RaciMarker, number>(
    alphabet.map((m, i) => [m, i] as const)
  );
  return [...markers].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99)
  );
}

// ── Marker semantic labels (variant-aware) ───────────────────
//
// The legend chip shows both the letter and its full meaning.
// Variant differences are deliberate: in DACI the `A` is "Approver"
// (not "Accountable") and `C` is "Contributor" (not "Consulted") —
// teaching the meaning is part of the legend's job.
export const MARKER_LABELS: Readonly<
  Record<RaciVariant, Readonly<Partial<Record<RaciMarker, string>>>>
> = {
  raci: { R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed' },
  rasci: {
    R: 'Responsible',
    A: 'Accountable',
    S: 'Support',
    C: 'Consulted',
    I: 'Informed',
  },
  daci: { D: 'Driver', A: 'Approver', C: 'Contributor', I: 'Informed' },
};

// ── Layout constants ─────────────────────────────────────────

const TITLE_AREA_HEIGHT = 50;
/** Left/right page margin. */
const H_MARGIN = 24;
/** Top breathing room below title. */
const V_MARGIN = 16;
/** Marker palette / legend strip below the title. */
const LEGEND_HEIGHT = 40;
/** Gap between adjacent legend chips. */
const LEGEND_CHIP_GAP = 8;
/** Vertical gap between legend strip and role-header row. */
const LEGEND_BOTTOM_GAP = 14;
/** Label font in legend chips. */
const LEGEND_LABEL_FONT = 12;
/** Letter font in legend chips. */
const LEGEND_LETTER_FONT = 14;
/** Header row that holds the role names. */
const HEADER_HEIGHT = 44;
/** Each task row. */
const ROW_HEIGHT = 36;
/** Phase divider band height (full-width above the phase's tasks). */
const PHASE_HEIGHT = 32;
/** Width allocated to the task-label column on the left. */
const TASK_LABEL_MIN = 200;
const TASK_LABEL_MAX = 360;
/** Min/max role column width — clamped if too few or too many roles. */
const ROLE_COL_MIN = 56;
const ROLE_COL_MAX = 110;
/** Inter-cell padding. */
const CELL_PAD = 4;
/** Marker letter font size. */
const MARKER_FONT = 14;
const MARKER_FONT_WEIGHT = 600;
/** Task-label font size. */
const LABEL_FONT = 13;
/** Role-header font size. */
const ROLE_HEADER_FONT = 12;
/** Phase-bar font size. */
const PHASE_FONT = 13;

// Cell-fill tint percentage of the marker color over surface bg.
const TINT_PCT = 28;

/**
 * Map each marker letter to a semantic color drawn from the palette's
 * named accents. The mapping is deliberately conventional:
 *  - R Responsible → blue (does the work)
 *  - A Accountable → red (owns it)
 *  - S Support     → teal
 *  - C Consulted   → yellow
 *  - I Informed    → gray
 *  - D Driver      → purple
 *
 * Palette swap → markers swap; semantics stay constant.
 */
function markerColor(marker: RaciMarker, palette: PaletteColors): string {
  switch (marker) {
    case 'R':
      return palette.colors.blue;
    case 'A':
      return palette.colors.red;
    case 'S':
      return palette.colors.teal;
    case 'C':
      return palette.colors.yellow;
    case 'I':
      return palette.colors.gray;
    case 'D':
      return palette.colors.purple;
  }
}

// ── Public render entry points ───────────────────────────────

/** Drag-source identity passed to `onMarkerDragStart`. */
export type RaciDragSource =
  | { kind: 'legend'; marker: RaciMarker }
  | {
      kind: 'cell';
      marker: RaciMarker;
      taskId: string;
      roleId: string;
    };

export interface RaciInteractionHandlers {
  onClickLine?: (lineNumber: number) => void;
  /** Fires on `pointerdown` of a legend chip OR an in-cell marker slice. */
  onMarkerDragStart?: (source: RaciDragSource, event: PointerEvent) => void;
}

/**
 * Render a RACI / RASCI / DACI matrix into the given DOM container.
 * Layout is computed once and laid out as SVG; no animation.
 */
export function renderRaci(
  container: HTMLDivElement,
  parsed: ParsedRaci,
  palette: PaletteColors,
  isDark: boolean,
  handlers?: RaciInteractionHandlers | ((lineNumber: number) => void),
  exportDims?: D3ExportDimensions
): void {
  // Backwards-compat: previous signature accepted `onClickLine` directly.
  const opts: RaciInteractionHandlers =
    typeof handlers === 'function'
      ? { onClickLine: handlers }
      : (handlers ?? {});
  const onClickLine = opts.onClickLine;
  const onMarkerDragStart = opts.onMarkerDragStart;
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const tasksAll = [...allTasks(parsed)];
  if (tasksAll.length === 0 && parsed.phases.length === 0) return;

  const solid = parsed.options['solid-fill'] === 'on';
  const surfaceBg = isDark ? palette.surface : palette.bg;

  // ── Column widths ──────────────────────────────────────────

  const roleCount = Math.max(1, parsed.roles.length);
  const innerWidth = Math.max(0, width - 2 * H_MARGIN);

  // Greedy split: prefer ROLE_COL_MIN..ROLE_COL_MAX, give the rest to
  // the task-label column (clamped to a reasonable range).
  let roleColW = Math.max(
    ROLE_COL_MIN,
    Math.min(
      ROLE_COL_MAX,
      Math.floor((innerWidth - TASK_LABEL_MIN) / roleCount)
    )
  );
  let labelW = innerWidth - roleColW * roleCount;
  if (labelW > TASK_LABEL_MAX) {
    labelW = TASK_LABEL_MAX;
    roleColW = Math.max(
      ROLE_COL_MIN,
      Math.floor((innerWidth - labelW) / roleCount)
    );
  }
  if (labelW < TASK_LABEL_MIN) labelW = TASK_LABEL_MIN;

  // ── Vertical layout ────────────────────────────────────────

  const phasedRows: Array<
    { kind: 'phase'; phase: RaciPhase } | { kind: 'task'; task: RaciTask }
  > = [];
  for (const t of parsed.tasksWithoutPhase)
    phasedRows.push({ kind: 'task', task: t });
  for (const p of parsed.phases) {
    phasedRows.push({ kind: 'phase', phase: p });
    for (const t of p.tasks) phasedRows.push({ kind: 'task', task: t });
  }

  // Vertical stack: title → legend → role headers → body.
  const legendY = TITLE_AREA_HEIGHT + V_MARGIN;
  const headerY = legendY + LEGEND_HEIGHT + LEGEND_BOTTOM_GAP;
  const bodyTop = headerY + HEADER_HEIGHT;
  let cursorY = bodyTop;
  const rowYs: number[] = [];
  for (const row of phasedRows) {
    rowYs.push(cursorY);
    cursorY += row.kind === 'phase' ? PHASE_HEIGHT : ROW_HEIGHT;
  }
  const totalHeight = cursorY + V_MARGIN;

  // ── SVG root ───────────────────────────────────────────────

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', Math.max(height, totalHeight))
    .attr('viewBox', `0 0 ${width} ${Math.max(height, totalHeight)}`)
    .attr('font-family', FONT_FAMILY)
    .style('background', 'transparent');

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

  // ── Legend / palette row ───────────────────────────────────

  renderLegend(
    svg,
    parsed.variant,
    H_MARGIN,
    legendY,
    innerWidth,
    palette,
    surfaceBg,
    solid,
    onMarkerDragStart
  );

  // ── Header row: role columns ───────────────────────────────

  const roleX = (i: number): number => H_MARGIN + labelW + i * roleColW;

  const headerG = svg
    .append('g')
    .attr('class', 'raci-header')
    .attr('aria-hidden', 'false');

  // Subtle background under header
  headerG
    .append('rect')
    .attr('x', H_MARGIN)
    .attr('y', headerY)
    .attr('width', innerWidth)
    .attr('height', HEADER_HEIGHT)
    .attr('fill', mix(palette.border, surfaceBg, 35))
    .attr('rx', 4);

  // Role headers
  parsed.roleDisplayNames.forEach((roleName, i) => {
    const cx = roleX(i) + roleColW / 2;
    headerG
      .append('text')
      .attr('x', cx)
      .attr('y', headerY + HEADER_HEIGHT / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', ROLE_HEADER_FONT)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(
        truncateForWidth(roleName, roleColW - 2 * CELL_PAD, ROLE_HEADER_FONT)
      );
  });

  // ── Body: phases + task rows ───────────────────────────────

  for (let i = 0; i < phasedRows.length; i++) {
    const row = phasedRows[i];
    const y = rowYs[i];
    if (row.kind === 'phase') {
      renderPhaseBar(svg, row.phase, H_MARGIN, y, innerWidth, palette);
    } else {
      renderTaskRow(
        svg,
        row.task,
        parsed,
        H_MARGIN,
        y,
        labelW,
        roleX,
        roleColW,
        palette,
        surfaceBg,
        solid,
        onClickLine,
        onMarkerDragStart
      );
    }
  }

  // ── Empty-state hint when all cells are blank ──────────────
  const anyMarker = tasksAll.some((t) =>
    t.roleAssignments.some((a) => a.markers.length > 0)
  );
  if (!anyMarker) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', totalHeight - V_MARGIN - 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', palette.textMuted)
      .text(
        'Drag a marker from the legend onto any cell. Drag a marker out to remove.'
      );
  }
}

// ── Legend / palette ────────────────────────────────────────

function renderLegend(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  variant: RaciVariant,
  x: number,
  y: number,
  width: number,
  palette: PaletteColors,
  surfaceBg: string,
  solid: boolean,
  _onMarkerDragStart?: (source: RaciDragSource, e: PointerEvent) => void
): void {
  const labels = MARKER_LABELS[variant];
  const markers: RaciMarker[] = (Object.keys(labels) as RaciMarker[]).filter(
    (m) => labels[m] !== undefined
  );
  if (markers.length === 0) return;

  const totalGap = LEGEND_CHIP_GAP * (markers.length - 1);
  const chipW = Math.max(80, Math.floor((width - totalGap) / markers.length));

  const legendG = svg
    .append('g')
    .attr('class', 'raci-legend')
    .attr('aria-label', `${variant.toUpperCase()} marker legend`);

  markers.forEach((marker, i) => {
    const cx = x + i * (chipW + LEGEND_CHIP_GAP);
    const rawColor = markerColor(marker, palette);
    const fill = solid ? rawColor : mix(rawColor, surfaceBg, 28);
    const stroke = mix(rawColor, surfaceBg, 70);
    const labelText = labels[marker]!;

    const chipG = legendG
      .append('g')
      .attr('class', 'raci-legend-chip')
      .attr('data-marker', marker)
      .style('cursor', 'grab');

    chipG
      .append('rect')
      .attr('x', cx)
      .attr('y', y)
      .attr('width', chipW)
      .attr('height', LEGEND_HEIGHT)
      .attr('rx', 6)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 1);

    // Letter slab on the left
    const slabW = 28;
    chipG
      .append('rect')
      .attr('x', cx + 6)
      .attr('y', y + 6)
      .attr('width', slabW)
      .attr('height', LEGEND_HEIGHT - 12)
      .attr('rx', 4)
      .attr('fill', solid ? mix(rawColor, surfaceBg, 70) : rawColor)
      .attr('opacity', solid ? 1 : 0.85);

    chipG
      .append('text')
      .attr('x', cx + 6 + slabW / 2)
      .attr('y', y + LEGEND_HEIGHT / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_LETTER_FONT)
      .attr('font-weight', 700)
      .attr(
        'fill',
        contrastText(
          solid ? mix(rawColor, surfaceBg, 70) : rawColor,
          palette.textOnFillLight,
          palette.textOnFillDark
        )
      )
      .text(marker);

    // Full label to the right of the slab
    chipG
      .append('text')
      .attr('x', cx + 6 + slabW + 10)
      .attr('y', y + LEGEND_HEIGHT / 2)
      .attr('dominant-baseline', 'central')
      .attr('font-size', LEGEND_LABEL_FONT)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(truncateForWidth(labelText, chipW - slabW - 24, LEGEND_LABEL_FONT));
  });
}

// Drop-in export wrapper used by `d3.ts` renderForExport dispatch.
export function renderRaciForExport(
  container: HTMLDivElement,
  parsed: ParsedRaci,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderRaci(container, parsed, palette, isDark, {}, exportDims);
}

// ── Phase bar ────────────────────────────────────────────────

function renderPhaseBar(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  phase: RaciPhase,
  x: number,
  y: number,
  width: number,
  palette: PaletteColors
): void {
  const phaseG = svg
    .append('g')
    .attr('class', 'raci-phase')
    .attr('data-section', `phase-${phase.id}`)
    .attr('data-section-toggle', '')
    .attr('data-line-number', String(phase.lineNumber));

  phaseG
    .append('rect')
    .attr('x', x)
    .attr('y', y + 4)
    .attr('width', width)
    .attr('height', PHASE_HEIGHT - 8)
    .attr('fill', mix(palette.colors.gray, palette.bg, 35))
    .attr('rx', 4);

  phaseG
    .append('text')
    .attr('x', x + 12)
    .attr('y', y + (PHASE_HEIGHT - 4) / 2 + 2)
    .attr('dominant-baseline', 'central')
    .attr('font-size', PHASE_FONT)
    .attr('font-weight', 600)
    .attr('fill', palette.text)
    .text(phase.displayName);
}

// ── Task row ─────────────────────────────────────────────────

/** Gap (in px) between adjacent marker slices in a multi-marker cell. */
const SLICE_GAP = 4;

function renderTaskRow(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  task: RaciTask,
  parsed: ParsedRaci,
  x: number,
  y: number,
  labelW: number,
  roleX: (i: number) => number,
  roleColW: number,
  palette: PaletteColors,
  surfaceBg: string,
  solid: boolean,
  onClickLine?: (lineNumber: number) => void,
  _onMarkerDragStart?: (source: RaciDragSource, e: PointerEvent) => void
): void {
  const rowG = svg
    .append('g')
    .attr('class', 'raci-task-row')
    .attr('data-line-number', String(task.lineNumber));

  // Task label (left column)
  rowG
    .append('text')
    .attr('x', x + 8)
    .attr('y', y + ROW_HEIGHT / 2)
    .attr('dominant-baseline', 'central')
    .attr('font-size', LABEL_FONT)
    .attr('fill', palette.text)
    .text(truncateForWidth(task.displayName, labelW - 16, LABEL_FONT));

  // Build a quick lookup: roleId → markers[]
  const cellByRole = new Map<string, RaciMarker[]>();
  for (const a of task.roleAssignments) {
    cellByRole.set(a.id, a.markers);
  }

  const alphabet = VARIANTS[parsed.variant].alphabet;

  // For each role column, paint a cell
  parsed.roles.forEach((roleId, idx) => {
    const cx = roleX(idx);
    const cy = y + CELL_PAD;
    const cw = roleColW - 2; // tiny gutter between columns
    const ch = ROW_HEIGHT - 2 * CELL_PAD;
    const markersSource = cellByRole.get(roleId) ?? [];
    // Display markers in canonical alphabet order — RACI cells always
    // read R A C I left-to-right regardless of source order. Source
    // ordering still drives the round-trip (mutations preserve it).
    const markers = sortByAlphabet(markersSource, alphabet);

    const cellG = rowG
      .append('g')
      .attr('class', 'raci-cell')
      .attr('data-task-id', task.id)
      .attr('data-role-id', roleId);

    // Hairline empty cell so the grid is visible even when no markers.
    if (markers.length === 0) {
      cellG
        .append('rect')
        .attr('x', cx + 1)
        .attr('y', cy)
        .attr('width', cw - 2)
        .attr('height', ch)
        .attr('rx', 3)
        .attr('fill', 'none')
        .attr('stroke', mix(palette.border, surfaceBg, 50))
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2 3');
      return;
    }

    // Build a horizontally-segmented fill: each marker gets its own
    // tinted slice in canonical order with a small gap between slices.
    // Each slice is its own draggable handle (`<g>` with data-marker).
    const innerW = cw - 2;
    const totalGap = SLICE_GAP * (markers.length - 1);
    const sliceW = (innerW - totalGap) / markers.length;
    markers.forEach((m, i) => {
      const rawColor = markerColor(m, palette);
      const fill = solid ? rawColor : mix(rawColor, surfaceBg, TINT_PCT);
      const stroke = solid ? mix(rawColor, surfaceBg, 80) : rawColor;
      const sliceX = cx + 1 + i * (sliceW + SLICE_GAP);

      const sliceG = cellG
        .append('g')
        .attr('class', 'raci-marker-slice')
        .attr('data-marker', m)
        .style('cursor', 'grab');

      sliceG
        .append('rect')
        .attr('x', sliceX)
        .attr('y', cy)
        .attr('width', sliceW)
        .attr('height', ch)
        .attr('rx', 3)
        .attr('fill', fill)
        .attr('stroke', mix(stroke, surfaceBg, 60))
        .attr('stroke-width', 0.75);
      sliceG
        .append('text')
        .attr('x', sliceX + sliceW / 2)
        .attr('y', cy + ch / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', MARKER_FONT)
        .attr('font-weight', MARKER_FONT_WEIGHT)
        .attr(
          'fill',
          solid
            ? contrastText(
                fill,
                palette.textOnFillLight,
                palette.textOnFillDark
              )
            : palette.text
        )
        .text(m);
    });

    if (onClickLine) {
      const assignment = task.roleAssignments.find((a) => a.id === roleId);
      if (assignment) {
        cellG.on('click', () => onClickLine(assignment.lineNumber));
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────

function truncateForWidth(s: string, maxPx: number, fontSize: number): string {
  // Conservative: 0.6 em per char for sans-serif at this weight.
  const charPx = fontSize * 0.6;
  const cap = Math.max(3, Math.floor(maxPx / charPx));
  if (s.length <= cap) return s;
  return s.substring(0, cap - 1) + '…';
}
