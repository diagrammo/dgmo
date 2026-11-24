// ============================================================
// Waffle renderer — `pie` + bare `waffle` (#1983).
// The pie's rows drawn as a 10×10 grid: each cell is one percent of the
// total, filled row by row from the top left in row order, so every row of
// data is one unbroken band of cells.
//
// Labels (#2104): no key column. Each band gets a label right of the grid —
// value large in the band colour, name small after it — joined to its band
// by an elbow leader. Rules, from the stress test on the ecosystem-docs page
// `mockups/2026-11-17-waffle-legend`:
//   1. at most WAFFLE_MAX_LABELS labels; the smallest rows merge into one
//      grey "N more" band. An explicit `other-below` turns the cap off;
//   2. the leader starts on the band's own row. A band confined to one row
//      that does not reach the right edge gets a leader along the gap under
//      that row; at most WAFFLE_MAX_IN_ROW per row, the rest merge;
//   3. rows that round to zero cells are named on one muted line;
//   4. under WAFFLE_LABEL_MIN_WIDTH the labels move inside the grid, with
//      a callout on the right for bands too thin to hold text;
//   5. the name column starts after the widest value.
// ============================================================

import type { ChartDataPoint, ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  getSegmentColors,
  shapeFill,
} from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { measureText, truncateText } from '../utils/text-measure';
import { type Svg, chartFormatter, tagDatum } from './shared';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  resolveEmphasis,
  storyPaint,
} from '../utils/emphasis';

/** Cells per side; the grid holds WAFFLE_GRID² cells, one percent each. */
export const WAFFLE_GRID = 10;
const CELLS = WAFFLE_GRID * WAFFLE_GRID;
/** Most labels beside the grid; past it the smallest rows merge. */
export const WAFFLE_MAX_LABELS = 8;
/** Most single-row bands per grid row that get their own label. */
export const WAFFLE_MAX_IN_ROW = 2;
/** Under this canvas width the labels move inside the grid. */
export const WAFFLE_LABEL_MIN_WIDTH = 360;
const MARGIN = 6;
const VALUE_FONT_MAX = 22;
const VALUE_FONT_MIN = 11;
const NAME_FONT_MIN = 10;
/** Leader geometry, from the grid's right edge: run, elbow, landing. */
const LEAD_RUN = 23;
const LEAD_ELBOW = 39;
const LEAD_END = 45;
const LABEL_X = LEAD_END + 4;
const NAME_GAP = 6;
/** Unicode first-strong isolate: an RTL name cannot reorder its neighbours. */
const isolate = (s: string): string => `\u2068${s}\u2069`;

/**
 * Whole cells per value, summing to exactly CELLS (largest-remainder
 * rounding). Ties go to the earlier row. A value under half a cell can get 0.
 */
export function waffleCells(values: readonly number[]): number[] {
  const total = values.reduce((a, v) => a + v, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * CELLS);
  const cells = exact.map(Math.floor);
  let left = CELLS - cells.reduce((a, c) => a + c, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    cells[i]! += 1;
    left -= 1;
  }
  return cells;
}

export interface WaffleBand {
  label: string;
  value: number;
  color?: string | undefined;
  lineNumber: number;
  /** The grey band that holds every merged row. */
  merged: boolean;
  /** First cell index and cell count. */
  start: number;
  cells: number;
}

/** Where a band's leader starts, in grid rows and columns. */
export type WaffleAnchor =
  | { kind: 'edge'; row: number }
  | { kind: 'within'; row: number; col: number };

export interface WaffleBands {
  bands: WaffleBand[];
  /** Rows that round to zero cells and were not merged. */
  zero: string[];
}

/** The row a band's leader starts from (rule 2). */
export function waffleAnchor(b: WaffleBand): WaffleAnchor {
  const s = b.start;
  const e = b.start + b.cells - 1;
  const r0 = Math.floor(s / WAFFLE_GRID);
  const r1 = Math.floor(e / WAFFLE_GRID);
  const lastCol = e % WAFFLE_GRID;
  if (r0 === r1 && lastCol !== WAFFLE_GRID - 1) {
    return { kind: 'within', row: r0, col: lastCol };
  }
  // Rows that reach the right edge: all but the last, and the last when full.
  const rows: { r: number; n: number }[] = [];
  for (let r = r0; r <= r1; r++) {
    if (r === r1 && lastCol !== WAFFLE_GRID - 1) continue;
    const from = r === r0 ? s % WAFFLE_GRID : 0;
    const to = r === r1 ? lastCol : WAFFLE_GRID - 1;
    rows.push({ r, n: to - from + 1 });
  }
  const most = Math.max(...rows.map((x) => x.n));
  const tied = rows.filter((x) => x.n === most);
  return { kind: 'edge', row: tied[Math.floor((tied.length - 1) / 2)]!.r };
}

/**
 * The bands to draw, after the label cap (rule 1) and the per-row limit on
 * single-row bands (rule 2). Kept rows stay in their order; the merged band
 * comes last. `capped` false (an explicit `other-below`) turns the cap off.
 */
export function waffleBands(
  rows: readonly ChartDataPoint[],
  capped: boolean
): WaffleBands {
  const total = rows.reduce((a, d) => a + d.value, 0);
  const out = new Set<number>();
  if (capped && rows.length > WAFFLE_MAX_LABELS) {
    rows
      .map((d, i) => ({ v: d.value, i }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .slice(WAFFLE_MAX_LABELS - 1)
      .forEach(({ i }) => out.add(i));
  }
  for (;;) {
    const kept = rows.map((d, i) => ({ d, i })).filter((x) => !out.has(x.i));
    const mergedRows = rows.filter((_, i) => out.has(i));
    const entries: {
      label: string;
      value: number;
      color?: string | undefined;
      lineNumber: number;
      merged: boolean;
      src: number;
    }[] = kept.map(({ d, i }) => ({
      label: d.label,
      value: d.value,
      color: d.color,
      lineNumber: d.lineNumber,
      merged: false,
      src: i,
    }));
    if (mergedRows.length > 0) {
      const top = Math.max(...mergedRows.map((d) => d.value));
      const under = total > 0 ? Math.floor((top / total) * 100) + 1 : 1;
      const n = mergedRows.length;
      entries.push({
        label:
          n === 1
            ? `1 more, under ${under}%`
            : `${n} more, each under ${under}%`,
        value: mergedRows.reduce((a, d) => a + d.value, 0),
        lineNumber: mergedRows[0]!.lineNumber,
        merged: true,
        src: -1,
      });
    }
    const cells = waffleCells(entries.map((x) => x.value));
    let start = 0;
    const bands: (WaffleBand & { src: number })[] = entries.map((x, k) => {
      const b = { ...x, start, cells: cells[k]! };
      start += cells[k]!;
      return b;
    });
    // Rule 2: more than WAFFLE_MAX_IN_ROW single-row bands in one row — the
    // smallest extras merge, then the layout is computed again.
    const perRow = new Map<number, (WaffleBand & { src: number })[]>();
    for (const b of bands) {
      if (b.merged || b.cells === 0) continue;
      const a = waffleAnchor(b);
      if (a.kind !== 'within') continue;
      perRow.set(a.row, [...(perRow.get(a.row) ?? []), b]);
    }
    let grew = false;
    for (const list of perRow.values()) {
      if (list.length <= WAFFLE_MAX_IN_ROW) continue;
      [...list]
        .sort((a, b) => b.value - a.value || a.src - b.src)
        .slice(WAFFLE_MAX_IN_ROW)
        .forEach((b) => out.add(b.src));
      grew = true;
    }
    if (grew) continue;
    return {
      bands: bands.filter((b) => b.cells > 0).map(({ src: _src, ...b }) => b),
      zero: bands.filter((b) => b.cells === 0 && !b.merged).map((b) => b.label),
    };
  }
}

export function renderWaffle(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  topInset: number
): void {
  const fmt = chartFormatter(chart);
  const rows = chart.data.filter((d) => d.value > 0);
  if (rows.length === 0) return;
  const { bands, zero } = waffleBands(rows, chart.otherBelow === undefined);

  // The large slot: the value when the author set a `format`, else the
  // percentage. `no-name` with `no-percent` leaves the grid alone.
  const gridAlone = !!chart.noName && !!chart.noPercent;
  const slotFor = (b: WaffleBand): string => {
    if (gridAlone) return '';
    if (chart.numberFormat && !chart.noValue) return fmt(b.value);
    return chart.noPercent ? '' : `${b.cells}%`;
  };
  const nameFor = (b: WaffleBand): string =>
    gridAlone || (chart.noName && !b.merged) ? '' : b.label;
  const labelled = bands.filter((b) => slotFor(b) || nameFor(b));
  const zeroLine =
    !gridAlone && !chart.noName && zero.length > 0
      ? `Under half a cell, so no square: ${zero.join(', ')}`
      : '';

  const top = topInset + 8;
  const availH = Math.max(0, height - top - 8);
  const availW = Math.max(0, width - 2 * MARGIN);
  const narrow = width < WAFFLE_LABEL_MIN_WIDTH;

  // ── Paint ───────────────────────────────────────────────
  const emphasis = resolveEmphasis(
    chart.emphasis,
    bands.map((b) => b.label)
  );
  const { dimmed } = emphasis;
  const story = storyPaint(emphasis, palette, isDark);
  const segColors = getSegmentColors(palette, bands.length);
  let colorIdx = 0;
  const paint = bands.map((b) => {
    const own = b.merged
      ? palette.textMuted
      : (b.color ?? segColors[colorIdx++ % segColors.length]!);
    const recede = dimmed.has(b.label);
    const stroke = !story.active
      ? own
      : recede
        ? story.groundStroke
        : story.subject(own);
    const fill = !story.active
      ? shapeFill(palette, own, isDark, { mode: chart.fillMode })
      : recede
        ? story.groundFill
        : stroke;
    return { own, stroke, fill, dim: recede && !story.active };
  });
  const tagFor = (i: number) => ({
    line: bands[i]!.lineNumber,
    key: bands[i]!.label,
    name: bands[i]!.label,
    value: `${fmt(bands[i]!.value)} (${bands[i]!.cells}%)`,
    color: paint[i]!.own,
  });

  // ── Sizes ───────────────────────────────────────────────
  // In-grid mode (rule 4) keeps beside-grid callouts only for bands with no
  // full row to write on.
  const fullRow = (b: WaffleBand): number => {
    const first = Math.ceil(b.start / WAFFLE_GRID);
    return (first + 1) * WAFFLE_GRID <= b.start + b.cells ? first : -1;
  };
  const beside = narrow ? labelled.filter((b) => fullRow(b) < 0) : labelled;
  const inside = narrow ? labelled.filter((b) => fullRow(b) >= 0) : [];

  const zeroH = zeroLine ? 18 : 0;
  const gridH = Math.max(0, availH - zeroH);
  let valueFont = Math.max(
    VALUE_FONT_MIN,
    Math.min(VALUE_FONT_MAX, gridH / 16, narrow ? 13 : VALUE_FONT_MAX)
  );
  const nameFontOf = (vf: number) =>
    Math.max(NAME_FONT_MIN, Math.min(12.5, vf * 0.58));
  const colWidth = (vf: number) => {
    const nf = nameFontOf(vf);
    const vw = Math.max(
      0,
      ...beside.map((b) => measureText(slotFor(b), vf, { bold: true }))
    );
    const nw = Math.max(0, ...beside.map((b) => measureText(nameFor(b), nf)));
    return { vw, nw, w: vw + (vw && nw ? NAME_GAP : 0) + nw };
  };
  let col = colWidth(valueFont);
  const besideW = beside.length > 0 ? LABEL_X + col.w : 0;
  let side = Math.min(gridH, availW - besideW);
  // The grid never shrinks below this share of the width for long names;
  // the names cut instead.
  const floor = Math.min(
    gridH,
    (availW - (beside.length ? LABEL_X : 0)) * 0.48
  );
  side = Math.max(side, floor, WAFFLE_GRID * 2);
  // Labels must fit the grid's height at their minimum spacing.
  const spacingOf = (vf: number) => vf * 1.3;
  if (beside.length * spacingOf(valueFont) > side) {
    valueFont = Math.max(VALUE_FONT_MIN, side / (beside.length * 1.3));
    col = colWidth(valueFont);
  }
  const nameFont = nameFontOf(valueFont);
  const spacing = spacingOf(valueFont);

  const zeroFont = Math.max(NAME_FONT_MIN, Math.min(11.5, nameFont));
  const zeroW = zeroLine ? measureText(zeroLine, zeroFont) : 0;
  const labelRight = Math.min(
    availW,
    Math.max(
      side + (beside.length ? LABEL_X + col.w : 0),
      (beside.length ? side + LABEL_X : 0) + zeroW
    )
  );
  const figureW = Math.max(side, labelRight);
  const x0 = Math.max(MARGIN, (width - figureW) / 2);
  const g = svg.append('g').attr('transform', `translate(${x0},${top})`);

  // ── Cells ───────────────────────────────────────────────
  const pitch = side / WAFFLE_GRID;
  const gap = Math.max(1, pitch * 0.12);
  const size = pitch - gap;
  bands.forEach((b, i) => {
    const p = paint[i]!;
    for (let k = 0; k < b.cells; k++) {
      const cell = b.start + k;
      const rect = g
        .append('rect')
        .attr('x', (cell % WAFFLE_GRID) * pitch + gap / 2)
        .attr('y', Math.floor(cell / WAFFLE_GRID) * pitch + gap / 2)
        .attr('width', size)
        .attr('height', size)
        .attr('rx', size * 0.12)
        .attr('fill', p.fill)
        .attr('stroke', p.stroke)
        .attr('stroke-width', 1.5);
      if (p.dim) rect.attr('opacity', EMPHASIS_DIM_OPACITY);
      tagDatum(rect, tagFor(i));
    }
  });

  // ── Labels inside the grid (rule 4) ─────────────────────
  for (const b of inside) {
    const i = bands.indexOf(b);
    const p = paint[i]!;
    const cy = (fullRow(b) + 0.5) * pitch;
    const vf = Math.min(pitch * 0.62, 16);
    const nf = Math.max(8, vf * 0.62);
    const ink = contrastText(
      p.fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    const halo = () =>
      g
        .append('text')
        .attr('fill', ink)
        .attr('stroke', p.fill)
        .attr('stroke-width', Math.max(2, vf * 0.3))
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke')
        .attr('font-family', FONT_FAMILY)
        .attr('opacity', p.dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
    const slot = slotFor(b);
    const sx = pitch * 0.3;
    const sw = slot ? measureText(slot, vf, { bold: true }) : 0;
    if (slot) {
      tagDatum(
        halo()
          .attr('x', sx)
          .attr('y', cy + vf * 0.35)
          .attr('font-size', vf)
          .attr('font-weight', 800)
          .text(slot),
        tagFor(i)
      );
    }
    const name = nameFor(b);
    const nx = sx + (sw ? sw + NAME_GAP : 0);
    const cut = name ? truncateText(name, nf, side - nx - pitch * 0.3) : '';
    if (cut) {
      tagDatum(
        halo()
          .attr('x', nx)
          .attr('y', cy + nf * 0.35)
          .attr('font-size', nf)
          .attr('font-weight', 600)
          .text(isolate(cut)),
        tagFor(i)
      );
    }
  }

  // ── Labels beside the grid (rules 1, 2, 5) ──────────────
  const anchors = beside.map((b) => waffleAnchor(b));
  const want = anchors.map((a) => (a.row + 0.5) * pitch);
  const ys = spread(
    want,
    spacing,
    spacing * 0.5,
    Math.max(spacing * 0.5, side - spacing * 0.3)
  );
  const valueX = side + LABEL_X;
  const nameX = valueX + (col.vw ? col.vw + NAME_GAP : 0);
  const nameMax = Math.max(
    0,
    x0 + labelRight - x0 - nameX,
    availW - (x0 - MARGIN) - nameX
  );
  beside.forEach((b, k) => {
    const i = bands.indexOf(b);
    const p = paint[i]!;
    const a = anchors[k]!;
    const ly = ys[k]!;
    let d: string;
    let dot: [number, number];
    if (a.kind === 'edge') {
      const ay = (a.row + 0.5) * pitch;
      dot = [side, ay];
      d = `M${side} ${ay} H${side + LEAD_RUN} L${side + LEAD_ELBOW} ${ly} H${side + LEAD_END}`;
    } else {
      // Along the gap under the band's row, from its last cell.
      const ax = (a.col + 0.5) * pitch;
      const cellBottom = (a.row + 1) * pitch - gap / 2;
      const gapY = (a.row + 1) * pitch;
      dot = [ax, cellBottom];
      d = `M${ax} ${cellBottom} V${gapY} H${side + 7} L${side + LEAD_ELBOW} ${ly} H${side + LEAD_END}`;
    }
    const dimOp = p.dim ? EMPHASIS_DIM_TEXT_OPACITY : 0.85;
    // Its own group, so the label keeps the pointer: hovering it dims the
    // other bands through the datum-hover path.
    const lg = g.append('g').attr('class', 'dgmo-band-label');
    const leader = lg
      .append('path')
      .attr('d', d)
      .attr('fill', 'none')
      .attr('stroke', p.stroke)
      .attr('stroke-width', 1.3)
      .attr('opacity', dimOp);
    tagDatum(leader, tagFor(i));
    const marker = lg
      .append('circle')
      .attr('cx', dot[0])
      .attr('cy', dot[1])
      .attr('r', 2.6)
      .attr('fill', p.stroke)
      .attr('opacity', dimOp);
    tagDatum(marker, tagFor(i));
    const slot = slotFor(b);
    if (slot) {
      tagDatum(
        lg
          .append('text')
          .attr('x', valueX)
          .attr('y', ly + valueFont * 0.35)
          .attr('fill', p.stroke)
          .attr('font-size', valueFont)
          .attr('font-weight', 700)
          .attr('font-family', FONT_FAMILY)
          .attr('opacity', p.dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
          .text(slot),
        tagFor(i)
      );
    }
    const name = nameFor(b);
    const cut = name ? truncateText(name, nameFont, nameMax) : '';
    if (cut) {
      tagDatum(
        lg
          .append('text')
          .attr('x', slot ? nameX : valueX)
          .attr('y', ly + nameFont * 0.35)
          .attr('fill', b.merged ? palette.textMuted : palette.text)
          .attr('font-size', nameFont)
          .attr('font-family', FONT_FAMILY)
          .attr('opacity', p.dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
          .text(isolate(cut)),
        tagFor(i)
      );
    }
  });

  // ── Zero-cell line (rule 3) ─────────────────────────────
  if (zeroLine) {
    // Under the labels when it fits there; otherwise under the grid, where
    // the whole width is free — it sits below every label either way.
    const zf = zeroFont;
    const right = availW - (x0 - MARGIN);
    const zx = beside.length > 0 && valueX + zeroW <= right ? valueX : 0;
    const zy = Math.max(side, (ys.at(-1) ?? 0) + spacing * 0.6) + 14;
    const room = right - zx;
    g.append('text')
      .attr('x', zx)
      .attr('y', Math.min(zy, availH))
      .attr('fill', palette.textMuted)
      .attr('font-size', zf)
      .attr('font-family', FONT_FAMILY)
      .text(truncateText(zeroLine, zf, room));
  }
}

/**
 * Push label centres apart to at least `min`, inside [lo, hi], keeping
 * their order. Labels that cannot all fit keep the spacing and overrun `hi`.
 */
function spread(
  want: readonly number[],
  min: number,
  lo: number,
  hi: number
): number[] {
  const ys = [...want];
  for (let i = 0; i < ys.length; i++) {
    ys[i] = Math.max(ys[i]!, lo, i > 0 ? ys[i - 1]! + min : lo);
  }
  for (let i = ys.length - 1; i >= 0; i--) {
    const cap = i === ys.length - 1 ? hi : ys[i + 1]! - min;
    ys[i] = Math.min(ys[i]!, cap);
  }
  for (let i = 0; i < ys.length; i++) {
    ys[i] = Math.max(ys[i]!, lo, i > 0 ? ys[i - 1]! + min : lo);
  }
  return ys;
}
