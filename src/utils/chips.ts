import type * as d3Selection from 'd3-selection';
import type { PaletteColors } from '../palettes';
import { contrastText, mix } from '../palettes/color-utils';
import { measureText } from './text-measure';

// ============================================================
// Tag chips (#1862)
// ============================================================
//
// A card's tag-group values draw as chips — a rounded pill per value, tinted
// with the value's colour — flowing left to right and wrapping inside the
// card. The group name is the chip's <title>; the legend names the groups.
// Shared by kanban cards (#1862) and sitemap page cards (#1861).
// Every size derives from the meta font and line height, so the board's
// scale context reaches the chips with no new parameters.

export type CardMeta = { label: string; value: string; color?: string };

export const chipHeight = (lineH: number): number => lineH + 2;
export const chipGap = (lineH: number): number => Math.round(lineH * 0.3);
export const chipPadX = (fs: number): number => fs * 0.6;

export function chipWidth(m: CardMeta, fs: number): number {
  return measureText(m.value, fs) + chipPadX(fs) * 2;
}

/** Chips per row, flowed into `maxW`; a chip wider than a row gets one alone. */
export function chipRows(
  meta: readonly CardMeta[],
  fs: number,
  lineH: number,
  maxW: number
): CardMeta[][] {
  const rows: CardMeta[][] = [];
  let row: CardMeta[] = [];
  let x = 0;
  for (const m of meta) {
    const w = chipWidth(m, fs);
    if (row.length > 0 && x + chipGap(lineH) + w > maxW) {
      rows.push(row);
      row = [];
      x = 0;
    }
    x += (row.length > 0 ? chipGap(lineH) : 0) + w;
    row.push(m);
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Height of the chip block plus the detail lines below the separator. */
export function metaContentHeight(
  meta: readonly CardMeta[],
  detailCount: number,
  fs: number,
  lineH: number,
  innerW: number
): number {
  const rows = chipRows(meta, fs, lineH, innerW).length;
  // The meta block already reserves a line's worth of padding for text; a
  // chip row is taller than a text line, so give one gap of it back to keep
  // the margin under the chips equal to the one above (#1862).
  const gap = chipGap(lineH);
  const chips =
    rows > 0
      ? rows * chipHeight(lineH) +
        (rows - 2) * gap +
        (detailCount > 0 ? gap : 0)
      : 0;
  return chips + detailCount * lineH;
}

/**
 * Draw a card's chips from `top`; returns the y the detail lines start at
 * (their first baseline is that plus the font size).
 */
export function drawCardChips(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cg: d3Selection.Selection<SVGGElement, unknown, any, unknown>,
  meta: readonly CardMeta[],
  x0: number,
  top: number,
  innerW: number,
  fs: number,
  lineH: number,
  cardFill: string,
  palette: PaletteColors
): number {
  const h = chipHeight(lineH);
  const gap = chipGap(lineH);
  let y = top;
  for (const row of chipRows(meta, fs, lineH, innerW)) {
    let x = x0;
    for (const m of row) {
      const w = chipWidth(m, fs);
      const tone = m.color ?? palette.textMuted;
      const fill = mix(tone, cardFill, 22);
      const chip = cg.append('g').attr('class', 'kanban-chip');
      chip.append('title').text(`${m.label}: ${m.value}`);
      chip
        .append('rect')
        .attr('x', x)
        .attr('y', y)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', h / 2)
        .attr('fill', fill)
        .attr('stroke', tone)
        .attr('stroke-opacity', 0.55)
        .attr('stroke-width', 1);
      chip
        .append('text')
        .attr('x', x + w / 2)
        .attr('y', y + h / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', fs)
        .attr(
          'fill',
          contrastText(fill, palette.textOnFillLight, palette.textOnFillDark)
        )
        .text(m.value);
      x += w + gap;
    }
    y += h + gap;
  }
  return y;
}
