// ============================================================
// Waffle renderer — `pie` + bare `waffle` (#1983).
// The pie's rows drawn as a 10×10 grid: each cell is one percent of the
// total, filled row by row from the top left in row order. A key column to
// the right names each row ("Name — value (N%)"), where N is its cell count.
// ============================================================

import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { getSegmentColors, shapeFill } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
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
const LABEL_FONT = 14;
const MIN_LABEL_FONT = 9;
const MARGIN = 6;
const KEY_GAP = 24;

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
  const data = chart.data.filter((d) => d.value > 0);
  if (data.length === 0) return;
  const cells = waffleCells(data.map((d) => d.value));

  const labels = data.map((d, i) => {
    const nm = chart.noName ? '' : d.label;
    const tail = [
      chart.noValue ? '' : fmt(d.value),
      chart.noPercent ? '' : `(${cells[i]}%)`,
    ]
      .filter(Boolean)
      .join(' ');
    return [nm, tail].filter(Boolean).join(' — ');
  });
  const maxLabelLen = labels.reduce((m, s) => Math.max(m, s.length), 0);

  const top = topInset + 8;
  const availH = Math.max(0, height - top - 8);
  const availW = Math.max(0, width - 2 * MARGIN);

  // The key column's width is linear in its font: swatch + pad + text.
  const keyWidth = (f: number) => f * 1.5 + maxLabelLen * f * 0.55;
  let font = LABEL_FONT;
  let side = Math.min(availH, availW - KEY_GAP - keyWidth(font));
  if (maxLabelLen > 0 && side < 160) {
    // Shrink the key before the grid gives up its room.
    const fitted = Math.max(
      MIN_LABEL_FONT,
      Math.min(
        LABEL_FONT,
        (availW - KEY_GAP - 160) / (1.5 + maxLabelLen * 0.55)
      )
    );
    font = fitted;
    side = Math.min(availH, availW - KEY_GAP - keyWidth(font));
  }
  const showLabels = maxLabelLen > 0 && side >= 60;
  if (!showLabels) side = Math.min(availH, availW);
  side = Math.max(WAFFLE_GRID * 2, side);

  // Rows that do not fit the grid's height at the normal gap get a smaller
  // font, so the key shrinks rather than overruns.
  const rowFit = side / Math.max(1, data.length);
  const labelFont = Math.max(6, Math.min(font, rowFit / 1.45));
  const rowH = labelFont * 1.45;

  const figureW = showLabels ? side + KEY_GAP + keyWidth(labelFont) : side;
  const x0 = Math.max(MARGIN, (width - figureW) / 2);
  const g = svg.append('g').attr('transform', `translate(${x0},${top})`);

  const emphasis = resolveEmphasis(
    chart.emphasis,
    data.map((d) => d.label)
  );
  const { dimmed } = emphasis;
  const story = storyPaint(emphasis, palette, isDark);
  const segColors = getSegmentColors(palette, data.length);

  const paint = data.map((d, i) => {
    const own = d.color ?? segColors[i % segColors.length]!;
    const recede = dimmed.has(d.label);
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
    line: data[i]!.lineNumber,
    key: data[i]!.label,
    name: data[i]!.label,
    value: `${fmt(data[i]!.value)} (${cells[i]}%)`,
    color: paint[i]!.own,
  });

  const pitch = side / WAFFLE_GRID;
  const gap = Math.max(1, pitch * 0.12);
  const size = pitch - gap;
  let cell = 0;
  data.forEach((_, i) => {
    const p = paint[i]!;
    for (let k = 0; k < cells[i]!; k++, cell++) {
      const col = cell % WAFFLE_GRID;
      const row = Math.floor(cell / WAFFLE_GRID);
      const rect = g
        .append('rect')
        .attr('x', col * pitch + gap / 2)
        .attr('y', row * pitch + gap / 2)
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

  if (!showLabels) return;
  const keyX = side + KEY_GAP;
  const keyTop = (side - rowH * data.length) / 2;
  data.forEach((_, i) => {
    const label = labels[i]!;
    if (!label) return;
    const p = paint[i]!;
    const cy = keyTop + rowH * (i + 0.5);
    const sw = labelFont * 0.9;
    const swatch = g
      .append('rect')
      .attr('x', keyX)
      .attr('y', cy - sw / 2)
      .attr('width', sw)
      .attr('height', sw)
      .attr('rx', sw * 0.12)
      .attr('fill', p.fill)
      .attr('stroke', p.stroke)
      .attr('stroke-width', 1.5);
    if (p.dim) swatch.attr('opacity', EMPHASIS_DIM_OPACITY);
    tagDatum(swatch, tagFor(i));
    tagDatum(
      g
        .append('text')
        .attr('x', keyX + labelFont * 1.5)
        .attr('y', cy + labelFont * 0.35)
        .attr('text-anchor', 'start')
        .attr('fill', p.stroke)
        .attr('font-size', labelFont)
        .attr('font-family', FONT_FAMILY)
        .attr('opacity', p.dim ? EMPHASIS_DIM_TEXT_OPACITY : null)
        .text(label),
      tagFor(i)
    );
  });
}
