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
import { ScaleContext } from '../utils/scaling';
import {
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../utils/text-measure';

/**
 * Group `parsed.diagnostics` per task, so the renderer can paint a
 * violation indicator next to each task's label. Diagnostics whose
 * line falls inside a task's [lineNumber, endLineNumber] range are
 * attributed to that task. Out-of-range diagnostics are dropped (chart-
 * level concerns are surfaced by the diagnostics panel, not the canvas).
 */
interface DiagnosticEntry {
  line: number;
  message: string;
}

function groupDiagnosticsByTask(parsed: ParsedRaci): Map<
  string,
  {
    errors: DiagnosticEntry[];
    warnings: DiagnosticEntry[];
    /** First diagnostic line for click-to-navigate. */
    firstLine: number;
  }
> {
  const map = new Map<
    string,
    {
      errors: DiagnosticEntry[];
      warnings: DiagnosticEntry[];
      firstLine: number;
    }
  >();
  if (parsed.diagnostics.length === 0) return map;

  const tasks: RaciTask[] = [];
  for (const t of parsed.tasksWithoutPhase) tasks.push(t);
  for (const p of parsed.phases) for (const t of p.tasks) tasks.push(t);

  for (const d of parsed.diagnostics) {
    if (d.line <= 0) continue;
    const owner = tasks.find(
      (t) => d.line >= t.lineNumber && d.line <= t.endLineNumber
    );
    if (!owner) continue;
    let bucket = map.get(owner.id);
    if (!bucket) {
      bucket = { errors: [], warnings: [], firstLine: d.line };
      map.set(owner.id, bucket);
    } else if (d.line < bucket.firstLine) {
      bucket.firstLine = d.line;
    }
    const entry = { line: d.line, message: d.message };
    if (d.severity === 'error') bucket.errors.push(entry);
    else bucket.warnings.push(entry);
  }
  return map;
}

/**
 * Constraint-rule messages name the task they're about — either as a
 * `Task 'X' …` prefix (most rules) or an `… on task 'X' …` mid-clause
 * (conflicting-markers rule). When rendered right next to the task
 * label, that naming is redundant — strip it so the inline preview
 * reads cleanly (`Has no Responsible assigned.` instead of
 * `Task 'Stand the watch' has no Responsible assigned.`).
 *
 * The full form stays in `parsed.diagnostics` for the bottom
 * diagnostics panel, which lists messages outside their task row.
 */
function trimTaskPrefix(message: string): string {
  const prefix = message.match(/^Task '[^']*'\s+(.+)$/);
  if (prefix) {
    // Capture group [1] guaranteed by regex match.
    const rest = prefix[1]!;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return message.replace(/\s+on task '[^']*'/, '');
}

/**
 * Build an SVG path for a rectangle with only the top corners rounded —
 * matches the kanban-style "column" silhouette where the bottom runs
 * straight to the edge so the column reads as a continuing container.
 */
function topRoundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): string {
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M ${x} ${y + rr}` +
    ` A ${rr} ${rr} 0 0 1 ${x + rr} ${y}` +
    ` H ${x + w - rr}` +
    ` A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}` +
    ` V ${y + h}` +
    ` H ${x}` +
    ` Z`
  );
}

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
/**
 * Marker palette / legend chip height. Matches the in-cell marker
 * slice height (`ROW_HEIGHT - 2 * CELL_PAD = 28`) so legend chips
 * read as the same primitive as the slices inside the matrix.
 */
const LEGEND_HEIGHT = 28;
/** Gap between adjacent legend chips. */
const LEGEND_CHIP_GAP = 8;
/** Min chip width when rendering with full marker labels. */
const LEGEND_CHIP_LABEL_MIN = 96;
/** Chip width when only the marker letter is shown (compact mode). Square = same as cell height. */
const LEGEND_LETTER_CHIP_W = 28;
/** Min horizontal gap between title and right-aligned legend. */
const TITLE_LEGEND_GAP = 16;
/** Label font in legend chips. */
const LEGEND_LABEL_FONT = 12;
/** Letter font in legend chips. */
const LEGEND_LETTER_FONT = 14;
/** Header row that holds the role names. Matches kanban COLUMN_HEADER_HEIGHT. */
const HEADER_HEIGHT = 36;
/** Each task row. */
const ROW_HEIGHT = 36;
/** Phase divider band height (full-width above the phase's tasks).
 *  Sized with breathing room so the per-column collapsed-phase
 *  summary chips can match the regular cell geometry without crowding
 *  the phase title. */
const PHASE_HEIGHT = 40;
/** Width allocated to the task-label column on the left. */
const TASK_LABEL_MIN = 200;
const TASK_LABEL_MAX = 360;
/** Min/max role column width — clamped if too few or too many roles. */
const ROLE_COL_MIN = 64;
const ROLE_COL_MAX = 120;
/** Inter-cell padding. */
const CELL_PAD = 4;
/** Extra vertical space added to a task row when it has a description. */
/** Vertical space per stacked violation message line on a task row. */
const VIOLATION_LINE_HEIGHT = 14;
/**
 * Breathing room between the task label and the first line of stacked
 * content (description or violation). Without this the secondary lines
 * sit visually crammed against the task name.
 */
const STACK_TOP_GAP = 8;
/** Description font size — smaller than LABEL_FONT for visual hierarchy. */
const DESC_FONT = 11;
/** Per-role column corner radius (matches kanban COLUMN_RADIUS). */
const COLUMN_RADIUS = 8;
/**
 * Inset on each side of a role column, producing a 16-px visual gap
 * between columns — matches kanban COLUMN_GAP exactly.
 */
const COLUMN_INSET = 8;
/**
 * Extra space below the last task row, kept inside the column body so
 * the rounded bottom corners read clearly. Mirrors kanban COLUMN_PADDING.
 */
const COLUMN_BOTTOM_PAD = 14;
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
// 25 = the canonical `shapeFill` tint used by every other chart type.
const TINT_PCT = 25;
/**
 * Marker rect stroke + radius — matches the codebase's node styling
 * convention (flowchart `NODE_STROKE_WIDTH = 1.5`, kanban
 * `CARD_STROKE_WIDTH = 1.5`, c4 `NODE_STROKE_WIDTH = 1.5`,
 * kanban `CARD_RADIUS = 6`). Keeps RACI markers visually consistent
 * with nodes elsewhere in the diagram language.
 */
const NODE_STROKE_WIDTH = 1.5;
const NODE_RADIUS = 6;

/**
 * Map each marker letter to a semantic color drawn from the palette's
 * named accents. The mapping follows the most common convention seen
 * across Atlassian / Smartsheet / Excel template defaults:
 *  - R Responsible → green (active doer / "go" signal)
 *  - A Accountable → red   (owns it / "buck stops here")
 *  - C Consulted   → yellow
 *  - I Informed    → gray
 *  - S Support     → teal  (RASCI; close to R-green but cooler)
 *  - D Driver      → purple (DACI; distinct from A's red)
 *
 * Palette swap → markers swap; semantics stay constant.
 */
/**
 * Auto-accent rotation used when the user hasn't given a phase / role
 * an explicit `| color: …`. Cycles through every named accent (gray
 * excluded — reads as "disabled") so users can refer to phases and
 * columns by color name. Marker fills sit on top at full saturation
 * inside small chips, so even a "red column" + Accountable marker
 * read as separate elements.
 *
 * Order alternates warm / cool so adjacent phases / columns don't
 * blur into one another.
 */
const AUTO_ACCENTS: ReadonlyArray<keyof PaletteColors['colors']> = [
  'blue',
  'orange',
  'green',
  'purple',
  'yellow',
  'cyan',
  'red',
  'teal',
];

function autoAccent(index: number, palette: PaletteColors): string {
  // In-bounds: (index % AUTO_ACCENTS.length) is always within bounds (AUTO_ACCENTS is non-empty).
  return palette.colors[AUTO_ACCENTS[index % AUTO_ACCENTS.length]!];
}

function markerColor(marker: RaciMarker, palette: PaletteColors): string {
  switch (marker) {
    case 'R':
      return palette.colors.green;
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
  /**
   * Suppress the in-SVG legend strip. The app overlays an HTML legend
   * for native HTML5 drag — SVG `<g> draggable=true` is unreliable.
   * PNG/SVG export keeps the legend by default.
   */
  hideLegend?: boolean;
  /**
   * Phase ids whose tasks should be hidden. The phase header still
   * renders with a "collapsed" chevron so the user can re-expand.
   */
  collapsedPhases?: ReadonlySet<string>;
  /**
   * Suppress the in-SVG title. The app paints its own HTML title
   * above the HTML legend bar so the visual order is title → legend
   * → matrix. PNG/SVG export keeps the title by default.
   */
  hideTitle?: boolean;
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
  const hideLegend = opts.hideLegend ?? false;
  const collapsedPhases = opts.collapsedPhases ?? new Set<string>();
  const hideTitle =
    (opts.hideTitle ?? false) || parsed.options['no-title'] === 'on';
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const tasksAll = [...allTasks(parsed)];
  if (tasksAll.length === 0 && parsed.phases.length === 0) return;

  const solid = parsed.options['solid-fill'] === 'on';
  const surfaceBg = isDark ? palette.surface : palette.bg;

  // --- ScaleContext: differential scaling ---
  const roleCount = Math.max(1, parsed.roles.length);
  const idealWidth = roleCount * ROLE_COL_MAX + TASK_LABEL_MAX + 2 * H_MARGIN;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sTitleY = ctx.structural(TITLE_Y);
  const sHMargin = ctx.aesthetic(H_MARGIN);
  const sVMargin = ctx.aesthetic(V_MARGIN);
  const sTitleAreaHeight = ctx.structural(TITLE_AREA_HEIGHT);
  const sHeaderHeight = ctx.structural(HEADER_HEIGHT);
  const sRowHeight = ctx.structural(ROW_HEIGHT);
  const sPhaseHeight = ctx.structural(PHASE_HEIGHT);
  const sTaskLabelMin = ctx.structural(TASK_LABEL_MIN);
  const sTaskLabelMax = ctx.structural(TASK_LABEL_MAX);
  const sRoleColMin = ctx.structural(ROLE_COL_MIN);
  const sRoleColMax = ctx.structural(ROLE_COL_MAX);
  const sCellPad = ctx.structural(CELL_PAD);
  const sLabelFont = ctx.text(LABEL_FONT);
  const sRoleHeaderFont = ctx.text(ROLE_HEADER_FONT);
  const sPhaseFont = ctx.text(PHASE_FONT);
  const sMarkerFont = ctx.text(MARKER_FONT);
  const sDescFont = ctx.text(DESC_FONT);
  const sColumnRadius = ctx.structural(COLUMN_RADIUS);
  const sColumnInset = ctx.structural(COLUMN_INSET);
  const sColumnBottomPad = ctx.structural(COLUMN_BOTTOM_PAD);
  const sLegendHeight = ctx.structural(LEGEND_HEIGHT);
  const sLegendChipGap = ctx.structural(LEGEND_CHIP_GAP);
  const sLegendChipLabelMin = ctx.structural(LEGEND_CHIP_LABEL_MIN);
  const sLegendLetterChipW = ctx.structural(LEGEND_LETTER_CHIP_W);
  const sTitleLegendGap = ctx.aesthetic(TITLE_LEGEND_GAP);
  const sLegendLabelFont = ctx.text(LEGEND_LABEL_FONT);
  const sLegendLetterFont = ctx.text(LEGEND_LETTER_FONT);
  const sViolationLineHeight = ctx.structural(VIOLATION_LINE_HEIGHT);
  const sStackTopGap = ctx.structural(STACK_TOP_GAP);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sNodeRadius = ctx.structural(NODE_RADIUS);

  // ── Column widths ──────────────────────────────────────────

  const innerWidth = Math.max(0, width - 2 * sHMargin);

  // Greedy split: prefer sRoleColMin..sRoleColMax, give the rest to
  // the task-label column (clamped to a reasonable range).
  let roleColW = Math.max(
    sRoleColMin,
    Math.min(sRoleColMax, Math.floor((innerWidth - sTaskLabelMin) / roleCount))
  );
  let labelW = innerWidth - roleColW * roleCount;
  if (labelW > sTaskLabelMax) {
    labelW = sTaskLabelMax;
    roleColW = Math.max(
      sRoleColMin,
      Math.floor((innerWidth - labelW) / roleCount)
    );
  }
  if (labelW < sTaskLabelMin) labelW = sTaskLabelMin;

  // ── Vertical layout ────────────────────────────────────────

  // Pre-compute per-task diagnostic buckets so the row-height pass can
  // grow rows that need to fit multiple stacked violation messages.
  const taskDiagnostics = groupDiagnosticsByTask(parsed);

  const phasedRows: Array<
    | { kind: 'phase'; phase: RaciPhase; collapsed: boolean }
    | { kind: 'task'; task: RaciTask }
  > = [];
  for (const t of parsed.tasksWithoutPhase)
    phasedRows.push({ kind: 'task', task: t });
  for (const p of parsed.phases) {
    const collapsed = collapsedPhases.has(p.id);
    phasedRows.push({ kind: 'phase', phase: p, collapsed });
    if (!collapsed) {
      for (const t of p.tasks) phasedRows.push({ kind: 'task', task: t });
    }
  }

  // Vertical stack: [title row + inline legend] → role headers → body.
  // Title and legend share a single row at the top (kanban-style):
  //   title left-aligned, legend right-aligned, both vertically centered.
  // When both are hidden (app preview with HTML overlays), the row collapses.
  const hasTopRow = !hideTitle || !hideLegend;
  const titleArea = hasTopRow ? sTitleAreaHeight : sVMargin;
  const legendY = (sTitleAreaHeight - sLegendHeight) / 2;
  const headerY = titleArea + sVMargin;
  const bodyTop = headerY + sHeaderHeight;
  let cursorY = bodyTop;
  const rowYs: number[] = [];
  // Pre-compute wrapped task content once: both the y-cursor pass and
  // the renderer need it, and word-wrapping isn't free.
  const labelMaxW = labelW - 16;
  const taskRowContent = new Map<string, RowContent>();
  for (const row of phasedRows) {
    if (row.kind === 'task') {
      const bucket = taskDiagnostics.get(row.task.id);
      taskRowContent.set(
        row.task.id,
        prepareRowContent(
          row.task,
          bucket,
          labelMaxW,
          sLabelFont,
          sDescFont,
          sRowHeight,
          sStackTopGap,
          sViolationLineHeight
        )
      );
    }
  }
  for (const row of phasedRows) {
    rowYs.push(cursorY);
    if (row.kind === 'phase') {
      cursorY += sPhaseHeight;
    } else {
      const content = taskRowContent.get(row.task.id);
      cursorY += content?.rowHeight ?? sRowHeight;
    }
  }
  const colBottomY = cursorY + sColumnBottomPad;
  const totalHeight = colBottomY + sVMargin;

  // Export renders a fixed canvas (e.g. 1200×800); a short matrix would
  // otherwise reserve a tall band of dead space below the last row. Size the
  // export canvas to the content height. The interactive preview keeps the
  // `max(pane, content)` behaviour so a short matrix still fills the pane.
  const svgHeight = exportDims ? totalHeight : Math.max(height, totalHeight);

  // ── SVG root ───────────────────────────────────────────────

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', svgHeight)
    .attr('viewBox', `0 0 ${width} ${svgHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('font-family', FONT_FAMILY)
    .style('background', 'transparent');

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // ── Top row: title (left) + legend (right), inline like kanban ──

  // Decide legend geometry first so we know how much room is left for the title.
  const variantLabels = MARKER_LABELS[parsed.variant];
  const legendMarkers = (Object.keys(variantLabels) as RaciMarker[]).filter(
    (m) => variantLabels[m] !== undefined
  );
  const numChips = legendMarkers.length;
  const chipGapTotal = sLegendChipGap * Math.max(0, numChips - 1);

  // Size full-mode chips to actually fit the longest label without truncation.
  // chip = 4 pad + 24 slab + 8 gap + label + 8 right pad.
  const longestLabelPx = legendMarkers.reduce(
    (n, m) =>
      Math.max(n, measureText(variantLabels[m] ?? '', sLegendLabelFont)),
    0
  );
  const fullChipW = Math.max(
    sLegendChipLabelMin,
    Math.ceil(4 + 24 + 8 + longestLabelPx + 8)
  );
  const fullLegendW = numChips * fullChipW + chipGapTotal;
  const letterLegendW = numChips * sLegendLetterChipW + chipGapTotal;

  // Estimate title pixel width using the shared glyph measurer.
  const titleEstW =
    parsed.title && !hideTitle ? measureText(parsed.title, sTitleFontSize) : 0;

  // Pick legend mode: full chips if everything fits, else letter-only.
  // If even letters won't fit beside the title, the title is truncated below.
  let legendMode: 'full' | 'letters' = 'full';
  let legendTotalW = fullLegendW;
  let legendChipW = fullChipW;
  if (!hideLegend) {
    const remaining = innerWidth - titleEstW - sTitleLegendGap;
    if (remaining < fullLegendW) {
      legendMode = 'letters';
      legendTotalW = letterLegendW;
      legendChipW = sLegendLetterChipW;
    }
  } else {
    legendTotalW = 0;
  }

  const legendX = sHMargin + innerWidth - legendTotalW;
  const titleMaxW = hideLegend
    ? innerWidth
    : legendX - sHMargin - sTitleLegendGap;

  // Title — left-aligned, truncated to whatever room the legend leaves.
  if (parsed.title && !hideTitle) {
    svg
      .append('text')
      .attr('x', sHMargin)
      .attr('y', sTitleY)
      .attr('text-anchor', 'start')
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(truncateText(parsed.title, sTitleFontSize, titleMaxW));
  }

  // Legend — right-aligned in the same row.
  if (!hideLegend && numChips > 0) {
    renderLegend(
      svg,
      legendMarkers,
      parsed.variant,
      legendX,
      legendY,
      legendMode,
      legendChipW,
      palette,
      surfaceBg,
      solid,
      onMarkerDragStart,
      sLegendChipGap,
      sLegendHeight,
      sNodeRadius,
      sNodeStrokeWidth,
      sLegendLetterFont,
      sLegendLabelFont
    );
  }

  // ── Per-role columns (kanban-style: rounded body bg + header overlay) ──

  const roleX = (i: number): number => sHMargin + labelW + i * roleColW;

  // Column treatment: each role gets its own rounded rect spanning the full
  // body height, with a clearly darker header overlay on top. Drawn before
  // any body content so phase bars and marker cells render above it.
  const colTotalHeight = colBottomY - headerY;

  // No-phase row bands: when the chart has no [Section] bars carrying
  // visual rhythm, paint a full-width tinted band per task row so each
  // row reads as its own micro-section. Drawn BEFORE columns/cells so
  // column tints stack on top without muddying. A 4-px y-margin keeps
  // adjacent bands from touching.
  if (parsed.phases.length === 0) {
    const bandsG = svg.append('g').attr('class', 'raci-row-bands');
    phasedRows.forEach((row, i) => {
      if (row.kind !== 'task') return;
      const taskIdx = parsed.tasksWithoutPhase.indexOf(row.task);
      if (taskIdx < 0) return;
      // In-bounds: forEach index i is < rowYs.length (rowYs aligned with phasedRows).
      const yTop = rowYs[i]!;
      const rh = taskRowContent.get(row.task.id)?.rowHeight ?? sRowHeight;
      bandsG
        .append('rect')
        .attr('class', 'raci-row-band')
        .attr('data-task-id', row.task.id)
        .attr('x', sHMargin)
        .attr('y', yTop + 2)
        .attr('width', innerWidth)
        .attr('height', rh - 4)
        .attr('rx', 6)
        .attr('fill', mix(autoAccent(taskIdx, palette), surfaceBg, 12));
    });
  }

  // Each role gets its own <g class="raci-column" data-role-id> wrapping
  // body + header + name text. This lets the app's sync CSS dim other
  // columns when one is hovered: any descendant getting :hover bubbles
  // up so the wrapper's :hover state fires for the whole column area.
  const columnsG = svg.append('g').attr('class', 'raci-columns');
  parsed.roles.forEach((roleId, i) => {
    const cx = roleX(i) + sColumnInset;
    const cw = roleColW - 2 * sColumnInset;
    // Per-role color from `Cap blue` trailing-token (or `Cap | color: blue`)
    // syntax. When the user provides
    // one, it wins; otherwise rotate through marker-safe accents so
    // each column has a subtle visual identity instead of every column
    // reading as the same neutral gray.
    const roleColor = parsed.roleColors[i] ?? autoAccent(i, palette);
    const bodyFill = mix(roleColor, isDark ? palette.surface : palette.bg, 16);
    const headerFill = mix(
      roleColor,
      isDark ? palette.surface : palette.bg,
      30
    );
    const colG = columnsG
      .append('g')
      .attr('class', 'raci-column')
      .attr('data-role-id', roleId);
    colG
      .append('rect')
      .attr('class', 'raci-column-body')
      .attr('x', cx)
      .attr('y', headerY)
      .attr('width', cw)
      .attr('height', colTotalHeight)
      .attr('rx', sColumnRadius)
      .attr('fill', bodyFill);
    // Top-rounded path (flat bottom) — matches kanban COLUMN_HEADER. The
    // header sits flush against the body content below; rounded bottoms
    // would leave a visible seam between header and the first task row.
    colG
      .append('path')
      .attr('class', 'raci-column-header')
      .attr(
        'd',
        topRoundedRectPath(cx, headerY, cw, sHeaderHeight, sColumnRadius)
      )
      .attr('fill', headerFill);
    const cxText = roleX(i) + roleColW / 2;
    colG
      .append('text')
      .attr('class', 'raci-column-label')
      .attr('x', cxText)
      .attr('y', headerY + sHeaderHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', sRoleHeaderFont)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(
        truncateText(
          parsed.roleDisplayNames[i] ?? '',
          sRoleHeaderFont,
          roleColW - 2 * sCellPad
        )
      );
  });

  // ── Body: phases + task rows ───────────────────────────────

  const hasAnyDiagnostic = taskDiagnostics.size > 0;

  // Chart-wide collapsed-summary decision. If ANY collapsed phase would
  // need a column whose chip-slice width drops below the readable
  // threshold, suppress summary chips on EVERY collapsed bar — so the
  // user never wonders "why does Filing have data but Settlement
  // doesn't?". Either every collapsed bar shows chips or none do.
  const SUMMARY_MIN_SLICE_W = 22;
  const summaryInsetForCheck = sColumnInset + 4;
  const summaryColBodyWForCheck = roleColW - 2 * summaryInsetForCheck;
  let chartCanShowSummaries = true;
  for (const row of phasedRows) {
    if (row.kind !== 'phase' || !row.collapsed) continue;
    for (const roleId of parsed.roles) {
      const used = new Set<RaciMarker>();
      for (const t of row.phase.tasks) {
        const a = t.roleAssignments.find((r) => r.id === roleId);
        if (!a) continue;
        for (const m of a.markers) used.add(m);
      }
      if (used.size === 0) continue;
      const totalGap = SLICE_GAP * Math.max(0, used.size - 1);
      const sliceW = (summaryColBodyWForCheck - totalGap) / used.size;
      if (sliceW < SUMMARY_MIN_SLICE_W) {
        chartCanShowSummaries = false;
        break;
      }
    }
    if (!chartCanShowSummaries) break;
  }

  for (let i = 0; i < phasedRows.length; i++) {
    // In-bounds by loop guard (i < phasedRows.length); rowYs aligned with phasedRows.
    const row = phasedRows[i]!;
    const y = rowYs[i]!;
    if (row.kind === 'phase') {
      const phaseIdx = parsed.phases.indexOf(row.phase);
      renderPhaseBar(
        svg,
        row.phase,
        sHMargin,
        y,
        innerWidth,
        palette,
        row.collapsed,
        autoAccent(Math.max(0, phaseIdx), palette),
        parsed.roles,
        roleX,
        roleColW,
        parsed.variant,
        surfaceBg,
        solid,
        chartCanShowSummaries,
        sPhaseHeight,
        sPhaseFont,
        sColumnInset,
        sNodeRadius
      );
    } else {
      renderTaskRow(
        svg,
        row.task,
        parsed,
        sHMargin,
        y,
        labelW,
        roleX,
        roleColW,
        palette,
        surfaceBg,
        solid,
        taskDiagnostics,
        hasAnyDiagnostic,
        taskRowContent.get(row.task.id),
        onClickLine,
        onMarkerDragStart,
        sLabelFont,
        sDescFont,
        sCellPad,
        sRowHeight,
        sColumnInset,
        sNodeRadius,
        sNodeStrokeWidth,
        sMarkerFont,
        sLegendLabelFont,
        sStackTopGap,
        sViolationLineHeight
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
      .attr('y', totalHeight - sVMargin - 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', palette.textMuted)
      .text(
        'Drag a marker from the legend onto any cell. Drag a marker out to remove.'
      );
  }

  // ── Column hover wiring ──────────────────────────────────────
  //
  // Toggle `data-hover-col` on the SVG and tag the matching column +
  // its cells with `raci-col-active` whenever the pointer is over any
  // element with a `data-role-id` ancestor. The app's sync CSS uses
  // those hooks to dim everything else, so a single role's row of
  // cells pops on hover. Pure-CSS doesn't reach because cells are not
  // descendants of the column group.
  setupColumnHover(svg);
}

function setupColumnHover(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>
): void {
  const node = svg.node();
  if (!node) return;
  let current: string | null = null;

  const findRole = (target: EventTarget | null): string | null => {
    let el = target as Element | null;
    while (el && el !== node) {
      const r = el.getAttribute && el.getAttribute('data-role-id');
      if (r) return r;
      el = el.parentElement;
    }
    return null;
  };

  const set = (role: string | null): void => {
    if (role === current) return;
    if (current) {
      svg
        .selectAll(
          `.raci-cell[data-role-id="${current}"], .raci-column[data-role-id="${current}"]`
        )
        .classed('raci-col-active', false);
    }
    current = role;
    if (role) {
      svg.attr('data-hover-col', role);
      svg
        .selectAll(
          `.raci-cell[data-role-id="${role}"], .raci-column[data-role-id="${role}"]`
        )
        .classed('raci-col-active', true);
    } else {
      svg.attr('data-hover-col', null);
    }
  };

  svg.on('mouseover', (event: MouseEvent) => set(findRole(event.target)));
  svg.on('mouseleave', () => set(null));
}

// ── Legend / palette ────────────────────────────────────────

function renderLegend(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  markers: ReadonlyArray<RaciMarker>,
  variant: RaciVariant,
  x: number,
  y: number,
  mode: 'full' | 'letters',
  chipW: number,
  palette: PaletteColors,
  surfaceBg: string,
  solid: boolean,
  _onMarkerDragStart:
    | ((source: RaciDragSource, e: PointerEvent) => void)
    | undefined,
  sLegendChipGap: number,
  sLegendHeight: number,
  sNodeRadius: number,
  sNodeStrokeWidth: number,
  sLegendLetterFont: number,
  sLegendLabelFont: number
): void {
  if (markers.length === 0) return;
  const labels = MARKER_LABELS[variant];

  const legendG = svg
    .append('g')
    .attr('class', 'raci-legend')
    .attr('aria-label', `${variant.toUpperCase()} marker legend`);

  markers.forEach((marker, i) => {
    const cx = x + i * (chipW + sLegendChipGap);
    const rawColor = markerColor(marker, palette);
    const labelText = labels[marker]!;

    const chipG = legendG
      .append('g')
      .attr('class', 'raci-legend-chip')
      .attr('data-marker', marker)
      .style('cursor', 'grab');

    if (mode === 'letters') {
      // Compact: a single colored pill with just the marker letter.
      // The full label moves to a native tooltip so hover still teaches it.
      const fill = solid ? rawColor : mix(rawColor, surfaceBg, TINT_PCT);
      const stroke = solid ? mix(rawColor, surfaceBg, 70) : rawColor;
      chipG
        .append('rect')
        .attr('x', cx)
        .attr('y', y)
        .attr('width', chipW)
        .attr('height', sLegendHeight)
        .attr('rx', sNodeRadius)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', sNodeStrokeWidth);
      chipG
        .append('text')
        .attr('x', cx + chipW / 2)
        .attr('y', y + sLegendHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', sLegendLetterFont)
        .attr('font-weight', 700)
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
        .text(marker);
      return;
    }

    // Full mode: bordered chip with a letter slab on the left and label text.
    const fill = solid ? rawColor : mix(rawColor, surfaceBg, TINT_PCT);
    const stroke = mix(rawColor, surfaceBg, 70);

    chipG
      .append('rect')
      .attr('x', cx)
      .attr('y', y)
      .attr('width', chipW)
      .attr('height', sLegendHeight)
      .attr('rx', sNodeRadius)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', sNodeStrokeWidth);

    // Letter slab on the left — tinted (not solid) so it sits in
    // the same visual register as the diagram's marker cells.
    const slabPad = 4;
    const slabW = 24;
    const slabFill = solid
      ? mix(rawColor, surfaceBg, 70)
      : mix(rawColor, surfaceBg, 55);
    chipG
      .append('rect')
      .attr('x', cx + slabPad)
      .attr('y', y + slabPad)
      .attr('width', slabW)
      .attr('height', sLegendHeight - 2 * slabPad)
      .attr('rx', 4)
      .attr('fill', slabFill);

    chipG
      .append('text')
      .attr('x', cx + slabPad + slabW / 2)
      .attr('y', y + sLegendHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', sLegendLetterFont)
      .attr('font-weight', 700)
      .attr(
        'fill',
        solid
          ? contrastText(
              slabFill,
              palette.textOnFillLight,
              palette.textOnFillDark
            )
          : palette.text
      )
      .text(marker);

    // Full label to the right of the slab
    chipG
      .append('text')
      .attr('x', cx + slabPad + slabW + 8)
      .attr('y', y + sLegendHeight / 2)
      .attr('dominant-baseline', 'central')
      .attr('font-size', sLegendLabelFont)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(
        truncateText(
          labelText,
          sLegendLabelFont,
          chipW - slabW - slabPad * 2 - 12
        )
      );
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
  palette: PaletteColors,
  collapsed: boolean,
  autoColor: string,
  // Role columns + variant. Supplied so a collapsed phase bar can paint
  // a per-column marker-union summary in each role column's slot.
  roles: ReadonlyArray<string>,
  roleX: (i: number) => number,
  roleColW: number,
  variant: RaciVariant,
  surfaceBg: string,
  solid: boolean,
  showSummary: boolean,
  sPhaseHeight: number,
  sPhaseFont: number,
  sColumnInset: number,
  sNodeRadius: number
): void {
  const phaseG = svg
    .append('g')
    .attr('class', 'raci-phase')
    .attr('data-section', `phase-${phase.id}`)
    .attr('data-section-toggle', '')
    .attr('data-line-number', String(phase.lineNumber))
    .attr('data-phase-id', phase.id)
    .attr('data-collapsed', collapsed ? '1' : '0')
    .style('cursor', 'pointer');

  // Phase color rules: explicit `[Voyage] | color: blue` wins; absent
  // that, fall back to the marker-safe auto-accent so each phase bar
  // has its own identity.
  const phaseFill = mix(phase.color ?? autoColor, palette.bg, 30);
  phaseG
    .append('rect')
    .attr('x', x)
    .attr('y', y + 4)
    .attr('width', width)
    .attr('height', sPhaseHeight - 8)
    .attr('fill', phaseFill)
    .attr('rx', 4);

  const chevX = x + 12;
  const chevY = y + sPhaseHeight / 2;
  phaseG
    .append('text')
    .attr('x', chevX)
    .attr('y', chevY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', 9)
    .attr('fill', palette.text)
    .attr('opacity', 0.6)
    .text(collapsed ? '▶' : '▼');

  phaseG
    .append('text')
    .attr('x', x + 26)
    .attr('y', y + (sPhaseHeight - 4) / 2 + 2)
    .attr('dominant-baseline', 'central')
    .attr('font-size', sPhaseFont)
    .attr('font-weight', 600)
    .attr('fill', palette.text)
    .text(phase.displayName);

  if (collapsed) {
    // Show the hidden-task count to the right of the label so users
    // can see at a glance what's in the rolled-up phase.
    const taskCount = phase.tasks.length;
    if (taskCount > 0) {
      const labelTextWidth = measureText(phase.displayName, sPhaseFont);
      phaseG
        .append('text')
        .attr('x', x + 26 + labelTextWidth + 10)
        .attr('y', y + (sPhaseHeight - 4) / 2 + 2)
        .attr('dominant-baseline', 'central')
        .attr('font-size', sPhaseFont - 1)
        .attr('font-weight', 500)
        .attr('fill', palette.textMuted)
        .text(`${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`);
    }

    // Chart-wide gate: if any collapsed phase on this chart would have
    // a column too narrow to render readable chips, suppress on every
    // collapsed bar — coverage stays consistent.
    if (!showSummary) return;

    // Per-column marker-union summary. For each role column, walk every
    // task in this phase, union the markers used in that column, and
    // paint chips that match the regular cell geometry — same column
    // inset, same SLICE_GAP, so chips fill the column body and read
    // as a compressed cell rather than a separate primitive.
    const alphabet = VARIANTS[variant].alphabet;
    const summaryInset = sColumnInset + 4;
    const summaryColBodyW = roleColW - 2 * summaryInset;
    const SUMMARY_CHIP_H = 24;
    const SUMMARY_LETTER_FONT = 13;
    const summaryY = y + (sPhaseHeight - SUMMARY_CHIP_H) / 2;

    roles.forEach((roleId, colIdx) => {
      const used = new Set<RaciMarker>();
      for (const t of phase.tasks) {
        const a = t.roleAssignments.find((r) => r.id === roleId);
        if (!a) continue;
        for (const m of a.markers) used.add(m);
      }
      if (used.size === 0) return;
      const ordered = sortByAlphabet([...used], alphabet);
      const totalGap = SLICE_GAP * Math.max(0, ordered.length - 1);
      const sliceW = (summaryColBodyW - totalGap) / ordered.length;
      const startX = roleX(colIdx) + summaryInset;

      ordered.forEach((marker, i) => {
        const cx = startX + i * (sliceW + SLICE_GAP);
        const rawColor = markerColor(marker, palette);
        // Match the cell-marker / legend-chip fill+stroke colors and
        // corner radius. Stroke width is a touch thinner than
        // NODE_STROKE_WIDTH because at the smaller summary scale the
        // full 1.5 reads as too heavy.
        const fill = solid ? rawColor : mix(rawColor, surfaceBg, TINT_PCT);
        const stroke = solid ? mix(rawColor, surfaceBg, 70) : rawColor;
        const chipG = phaseG.append('g').attr('class', 'raci-phase-summary');
        chipG
          .append('rect')
          .attr('x', cx)
          .attr('y', summaryY)
          .attr('width', sliceW)
          .attr('height', SUMMARY_CHIP_H)
          .attr('rx', sNodeRadius)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1.25);
        chipG
          .append('text')
          .attr('x', cx + sliceW / 2)
          .attr('y', summaryY + SUMMARY_CHIP_H / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('font-size', SUMMARY_LETTER_FONT)
          .attr('font-weight', 700)
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
          .text(marker);
      });
    });
  }
}

// ── Task row ─────────────────────────────────────────────────

/** Gap (in px) between adjacent marker slices in a multi-marker cell. */
const SLICE_GAP = 4;

interface TaskDiagnosticBucket {
  errors: DiagnosticEntry[];
  warnings: DiagnosticEntry[];
  firstLine: number;
}

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
  taskDiagnostics: Map<string, TaskDiagnosticBucket> | null,
  _hasAnyDiagnostic: boolean,
  rowContent: RowContent | undefined,
  onClickLine: ((lineNumber: number) => void) | undefined,
  _onMarkerDragStart:
    | ((source: RaciDragSource, e: PointerEvent) => void)
    | undefined,
  sLabelFont: number,
  sDescFont: number,
  sCellPad: number,
  sRowHeight: number,
  sColumnInset: number,
  sNodeRadius: number,
  sNodeStrokeWidth: number,
  sMarkerFont: number,
  sLegendLabelFont: number,
  sStackTopGap: number,
  sViolationLineHeight: number
): void {
  const rowG = svg
    .append('g')
    .attr('class', 'raci-task-row')
    .attr('data-task-id', task.id)
    .attr('data-line-number', String(task.lineNumber));

  // No gutter chip — violations now stack on their own lines below the
  // task label, each colored by severity (red = error, amber = warning).
  const labelX = x + 8;
  const labelMaxW = labelW - 16;
  const content =
    rowContent ??
    prepareRowContent(
      task,
      taskDiagnostics?.get(task.id),
      labelMaxW,
      sLabelFont,
      sDescFont,
      sRowHeight,
      sStackTopGap,
      sViolationLineHeight
    );
  const { nameLines, descLines, violations, rowHeight } = content;

  // Group everything that lives in the label column under a single
  // wrapper so the sync adapter's hover-dim CSS can target the wrapper
  // and fire whether the user is over the rect, the name text, the
  // description, or a violation. Cells stay siblings of this group on
  // the rowG so they DON'T trigger the row-hover dim.
  const labelG = rowG.append('g').attr('class', 'raci-task-label-area');

  // Transparent hit-zone over the task-label column, sized to match
  // the wrapped row height so any pointer drift inside the label
  // column is captured by the wrapper :hover.
  labelG
    .append('rect')
    .attr('class', 'raci-task-label-zone')
    .attr('x', x)
    .attr('y', y)
    .attr('width', labelW)
    .attr('height', rowHeight)
    .attr('fill', 'transparent')
    .attr('pointer-events', 'all');

  // Task name — wrapped to as many lines as fit without truncating.
  const nameTopY = y + sLabelFont / 2 + 6;
  const nameEl = labelG
    .append('text')
    .attr('class', 'raci-task-label')
    .attr('x', labelX)
    .attr('y', nameTopY)
    .attr('dominant-baseline', 'central')
    .attr('font-size', sLabelFont)
    .attr('fill', palette.text);
  nameLines.forEach((line, i) => {
    const tspan = nameEl.append('tspan').attr('x', labelX).text(line);
    if (i > 0) tspan.attr('dy', NAME_LINE_HEIGHT);
  });

  let stackY =
    nameTopY +
    Math.max(0, nameLines.length - 1) * NAME_LINE_HEIGHT +
    sLabelFont / 2 +
    4 +
    sStackTopGap;

  if (descLines.length > 0) {
    const descEl = labelG
      .append('text')
      .attr('class', 'raci-task-description')
      .attr('x', labelX)
      .attr('y', stackY)
      .attr('dominant-baseline', 'central')
      .attr('font-size', sDescFont)
      .attr('fill', palette.textMuted);
    descLines.forEach((line, i) => {
      const tspan = descEl.append('tspan').attr('x', labelX).text(line);
      if (i > 0) tspan.attr('dy', DESC_LINE_HEIGHT);
    });
    stackY += descLines.length * DESC_LINE_HEIGHT;
  }

  for (const v of violations) {
    const lineColor =
      v.severity === 'error' ? palette.colors.red : palette.colors.orange;
    const lineG = labelG
      .append('g')
      .attr('class', 'raci-violation-line')
      .attr('data-severity', v.severity)
      .style('cursor', onClickLine ? 'pointer' : 'default');

    const violationFont = sLabelFont - 2;
    const textEl = lineG
      .append('text')
      .attr('x', labelX)
      .attr('y', stackY)
      .attr('dominant-baseline', 'central')
      .attr('font-size', violationFont)
      .attr('fill', lineColor);
    v.lines.forEach((line, i) => {
      // Render bold for any quoted spans within this wrapped line.
      const segs = parseQuotedSegments(line);
      segs.forEach((seg, segIdx) => {
        const tspan = textEl.append('tspan').text(seg.text);
        if (i > 0 && segIdx === 0)
          tspan.attr('x', labelX).attr('dy', sViolationLineHeight);
        if (seg.bold) tspan.attr('font-weight', 700);
      });
    });

    if (onClickLine) {
      const targetLine = v.sourceLine;
      lineG.on('click', (e: Event) => {
        e.stopPropagation();
        onClickLine(targetLine);
      });
    }
    stackY += v.lines.length * sViolationLineHeight;
  }

  // Build a quick lookup: roleId → markers[]
  const cellByRole = new Map<string, readonly RaciMarker[]>();
  for (const a of task.roleAssignments) {
    cellByRole.set(a.id, a.markers);
  }

  const alphabet = VARIANTS[parsed.variant].alphabet;

  // For each role column, paint a cell
  parsed.roles.forEach((roleId, idx) => {
    // Cells sit inside the column body. The column body uses COLUMN_INSET
    // on each side; add 4 px more so the cell doesn't kiss the column edge.
    const cellInset = sColumnInset + 4;
    const cx = roleX(idx) + cellInset;
    const cy = y + sCellPad;
    const cw = roleColW - 2 * cellInset;
    const ch = sRowHeight - 2 * sCellPad;
    const markersSource = cellByRole.get(roleId) ?? [];
    // Display markers in canonical alphabet order — RACI cells always
    // read R A C I left-to-right regardless of source order. Source
    // ordering still drives the round-trip (mutations preserve it).
    const markers = sortByAlphabet(markersSource, alphabet);

    const assignment = task.roleAssignments.find((a) => a.id === roleId);
    const cellG = rowG
      .append('g')
      .attr('class', 'raci-cell')
      .attr('data-task-id', task.id)
      .attr('data-role-id', roleId);
    // Cells with an explicit role assignment carry the assignment's line
    // number so click → cursor jumps to that exact source line. Empty
    // cells leave the attribute off; walk-up resolution falls back to
    // the parent task row.
    if (assignment) {
      cellG.attr('data-line-number', String(assignment.lineNumber));
    }

    // Full-bounds transparent hit layer covering the column-body area
    // (NOT the inter-column gap). Without this, empty cells only hit-test
    // on the marker stroke — drag-and-drop misses the cell body.
    cellG
      .append('rect')
      .attr('class', 'raci-cell-hit')
      .attr('x', roleX(idx) + sColumnInset)
      .attr('y', y)
      .attr('width', roleColW - 2 * sColumnInset)
      .attr('height', sRowHeight)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all');

    // Build a horizontally-segmented fill: each marker gets its own
    // tinted slice in canonical order with a small gap between slices.
    // Each slice is its own draggable handle (`<g>` with data-marker).
    //
    // Border styling matches the codebase's node convention
    // (flowchart NODE_STROKE_WIDTH = 1.5, kanban CARD_STROKE_WIDTH = 1.5,
    // c4 NODE_STROKE_WIDTH = 1.5; corner radius 6 = kanban CARD_RADIUS).
    const totalGap = SLICE_GAP * (markers.length - 1);
    const sliceW = markers.length > 0 ? (cw - totalGap) / markers.length : 0;
    const variantLabels = MARKER_LABELS[parsed.variant];
    markers.forEach((m, i) => {
      const rawColor = markerColor(m, palette);
      const fill = solid ? rawColor : mix(rawColor, surfaceBg, TINT_PCT);
      const stroke = rawColor;
      const sliceX = cx + i * (sliceW + SLICE_GAP);

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
        .attr('rx', sNodeRadius)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', sNodeStrokeWidth);

      // When the slice is wide enough, spell out the full marker label
      // ("Responsible") instead of the bare letter. Same primitive as the
      // legend chip, so cells and legend read as the same UI element.
      const fullLabel = variantLabels[m] ?? m;
      const labelPx = measureText(fullLabel, sLegendLabelFont);
      const showFullLabel = labelPx + 16 <= sliceW;
      const textContent = showFullLabel ? fullLabel : m;
      const textFont = showFullLabel ? sLegendLabelFont : sMarkerFont;

      sliceG
        .append('text')
        .attr('x', sliceX + sliceW / 2)
        .attr('y', cy + ch / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', textFont)
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
        .text(textContent);
    });

    // Drop-preview rect: sized + rounded to match where a dropped marker
    // would land. Appended LAST so it paints on top of any marker slices —
    // otherwise the slice rects in a filled cell fully cover the highlight
    // and the user gets no visual feedback when dragging onto a cell that
    // already has assignments. `pointer-events: none` keeps it clear of
    // hit-testing. Hidden by default; CSS paints it when the cell carries
    // [data-drop-active="1"].
    cellG
      .append('rect')
      .attr('class', 'raci-cell-drop-preview')
      .attr('x', cx)
      .attr('y', cy)
      .attr('width', cw)
      .attr('height', ch)
      .attr('rx', sNodeRadius)
      .attr('fill', 'transparent')
      .attr('stroke', 'transparent')
      .attr('pointer-events', 'none');

    if (onClickLine && assignment) {
      cellG.on('click', () => onClickLine(assignment.lineNumber));
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Wrapped text content for a task row plus the height that fits it.
 * Pre-computed once per task and reused by both the y-cursor layout
 * pass (which needs the height) and the renderer (which paints the
 * wrapped lines), so the two stay in sync without duplicating logic.
 */
interface RowContent {
  nameLines: string[];
  descLines: string[];
  violations: Array<{
    severity: 'error' | 'warning';
    sourceLine: number;
    text: string;
    lines: string[];
  }>;
  rowHeight: number;
}

const NAME_LINE_HEIGHT = 16;
const DESC_LINE_HEIGHT = 16;

function prepareRowContent(
  task: RaciTask,
  bucket: TaskDiagnosticBucket | undefined,
  labelMaxW: number,
  sLabelFont = LABEL_FONT,
  sDescFont = DESC_FONT,
  sRowHeight = ROW_HEIGHT,
  sStackTopGap = STACK_TOP_GAP,
  sViolationLineHeight = VIOLATION_LINE_HEIGHT
): RowContent {
  const nameLines = wrapTextToWidth(task.displayName, sLabelFont, labelMaxW, {
    hardBreak: true,
  });
  const description = task.description?.trim() ?? '';
  const descLines =
    description.length > 0
      ? description
          .split('\n')
          .flatMap((line) =>
            wrapTextToWidth(line, sDescFont, labelMaxW, { hardBreak: true })
          )
      : [];
  const violations: RowContent['violations'] = [];
  if (bucket) {
    const collect = (
      arr: DiagnosticEntry[],
      severity: 'error' | 'warning'
    ): void => {
      for (const e of arr) {
        const text = trimTaskPrefix(e.message);
        violations.push({
          severity,
          sourceLine: e.line,
          text,
          lines: wrapTextToWidth(text, sLabelFont - 2, labelMaxW, {
            hardBreak: true,
          }),
        });
      }
    };
    collect(bucket.errors, 'error');
    collect(bucket.warnings, 'warning');
  }

  const totalViolationLines = violations.reduce(
    (n, v) => n + v.lines.length,
    0
  );
  const hasStacked = descLines.length > 0 || violations.length > 0;
  // ROW_HEIGHT was sized for a one-line label; extra label lines push
  // every stacked block down by NAME_LINE_HEIGHT.
  const labelExtra = Math.max(0, nameLines.length - 1) * NAME_LINE_HEIGHT;
  const rowHeight =
    sRowHeight +
    labelExtra +
    (hasStacked ? sStackTopGap : 0) +
    descLines.length * DESC_LINE_HEIGHT +
    totalViolationLines * sViolationLineHeight;

  return { nameLines, descLines, violations, rowHeight };
}

/**
 * Split a diagnostic message at single-quoted spans so the renderer can
 * paint the quoted name (role / task) as a bold tspan with no quotes.
 * Plain-text contexts (tooltip, bottom panel) keep the quotes — they're
 * the only emphasis available there.
 */
type Segment = { text: string; bold: boolean };

function parseQuotedSegments(message: string): Segment[] {
  const out: Segment[] = [];
  const re = /'([^']+)'/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    if (m.index > last)
      out.push({ text: message.slice(last, m.index), bold: false });
    // Capture group [1] guaranteed by the regex pattern.
    out.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < message.length)
    out.push({ text: message.slice(last), bold: false });
  return out;
}
