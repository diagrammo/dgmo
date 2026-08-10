// ============================================================
// Hand-built heatmap renderer — SPIKE (Tier 2).
// Matrix of cells, 4-color gradient fill (primary→cyan→yellow→orange),
// per-cell label tint matching the cell color (ECharts parity).
// ============================================================

import type { ParsedHeatmap } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import {
  shapeFill,
  mix,
  hexToHSL,
  hslToHex,
  themeBaseBg,
} from '../palettes/color-utils';
import { measureText } from '../utils/text-measure';
import type { Svg } from './shared';
import { fmtNum, tagDatum } from './shared';

export function renderHeatmap(
  svg: Svg,
  chart: ParsedHeatmap,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  bgColor: string,
  topInset: number
): void {
  const rows = chart.heatmapRows ?? [];
  if (rows.length === 0) return;
  const ncols = Math.max(
    chart.columns?.length ?? 0,
    ...rows.map((r) => r.values.length)
  );
  const nrows = rows.length;
  const cols = chart.columns ?? [];

  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const r of rows)
    for (const v of r.values) {
      minValue = Math.min(minValue, v);
      maxValue = Math.max(maxValue, v);
    }

  // §1.9 fill family: tint (default) / solid / outline. In outline mode cells
  // render hollow (theme base bg fill) and the value's ramp color moves to the
  // cell STROKE — the ramp stops are built at FULL intent ('solid') so low
  // values stay visible (the tint-stop ramp would wash the border out).
  const outline = chart.fillMode === 'outline';
  const fillMode =
    outline || chart.fillMode === 'solid' ? ('solid' as const) : undefined;
  const baseBg = themeBaseBg(palette, isDark);
  const gradientStops = [
    shapeFill(palette, palette.primary, isDark, { mode: fillMode }),
    shapeFill(palette, palette.colors.cyan, isDark, { mode: fillMode }),
    shapeFill(palette, palette.colors.yellow, isDark, { mode: fillMode }),
    shapeFill(palette, palette.colors.orange, isDark, { mode: fillMode }),
  ];
  const gradientAt = (t: number): string => {
    const tt = Math.max(0, Math.min(1, t));
    const seg = 1 / (gradientStops.length - 1);
    const idx = Math.min(gradientStops.length - 2, Math.floor(tt / seg));
    const localT = (tt - idx * seg) / seg;
    return mix(gradientStops[idx + 1]!, gradientStops[idx]!, localT * 100);
  };
  const labelTint = (cellColor: string): string => {
    const { h, s } = hexToHSL(cellColor);
    const targetS = Math.min(75, Math.max(s + 25, 50));
    const targetL = isDark ? 72 : 30;
    return hslToHex(h, targetS, targetL);
  };

  const rowLabelW =
    Math.max(0, ...rows.map((r) => measureText(r.label, 13))) + 16;
  const left = 20 + rowLabelW;
  const top = topInset + 28; // room for column labels
  const right = 24;
  const bottom = 24;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const cw = plotW / ncols;
  const ch = plotH / nrows;
  // Scale value labels to fill the cell: bounded by cell height and by the
  // widest value fitting the cell width (measured at a reference size).
  const REF = 100;
  const maxValueW = Math.max(
    1,
    // Cell values are drawn at 600; the row and column labels around them are
    // not, which is why only this measurement is bold.
    ...rows.flatMap((r) =>
      r.values.map((v) => measureText(fmtNum(v), REF, { bold: true }))
    )
  );
  const cellFont = Math.max(
    11,
    Math.min(ch * 0.55, (cw * 0.7 * REF) / maxValueW)
  );

  // column labels (rotate if wide) — clickable: pins emphasis to the column
  const rotate = cols.some((c) => measureText(c, 12) > cw * 0.85);
  cols.forEach((c, ci) => {
    const x = left + ci * cw + cw / 2;
    const t = svg
      .append('text')
      .attr('class', 'dgmo-axis-label')
      .attr('data-filter-attr', 'data-col-key')
      .attr('data-filter-value', c)
      .attr('fill', textColor)
      .attr('font-size', 12)
      .attr('font-family', FONT_FAMILY)
      .text(c);
    if (rotate) {
      t.attr('transform', `translate(${x},${top - 8}) rotate(-40)`).attr(
        'text-anchor',
        'start'
      );
    } else {
      t.attr('x', x)
        .attr('y', top - 8)
        .attr('text-anchor', 'middle');
    }
  });

  rows.forEach((row, ri) => {
    // row label — hover/click emphasizes the row
    svg
      .append('text')
      .attr('class', 'dgmo-axis-label')
      .attr('data-filter-attr', 'data-row-key')
      .attr('data-filter-value', row.label)
      .attr('x', left - 10)
      .attr('y', top + ri * ch + ch / 2 + 4)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', 13)
      .attr('font-family', FONT_FAMILY)
      .text(row.label);

    row.values.forEach((v, ci) => {
      const t =
        maxValue === minValue ? 0.5 : (v - minValue) / (maxValue - minValue);
      const ramp = gradientAt(t);
      // Outline: hollow cell, ramp on the border. Otherwise the ramp IS the fill.
      const cell = outline ? baseBg : ramp;
      const colLabel = cols[ci] ?? `Col ${ci + 1}`;
      // Per-cell emph key: hovering a cell emphasizes ONLY that cell (rect +
      // its value label). Row/column emphasis comes from the axis labels via
      // data-row-key / data-col-key.
      const cellKey = `${row.label} · ${colLabel}`;
      const r = svg
        .append('rect')
        .attr('x', left + ci * cw)
        .attr('y', top + ri * ch)
        .attr('width', cw)
        .attr('height', ch)
        .attr('fill', cell)
        .attr('stroke', outline ? ramp : bgColor)
        .attr('stroke-width', outline ? 1.5 : 2)
        .attr('data-row-key', row.label)
        .attr('data-col-key', colLabel);
      tagDatum(r, {
        line: row.lineNumber,
        key: cellKey,
        name: cellKey,
        value: fmtNum(v),
        color: ramp,
      });
      if (!chart.noValue) {
        const label = svg
          .append('text')
          .attr('x', left + ci * cw + cw / 2)
          .attr('y', top + ri * ch + ch / 2 + cellFont / 3)
          .attr('text-anchor', 'middle')
          .attr('fill', labelTint(ramp))
          .attr('font-size', cellFont)
          .attr('font-weight', 600)
          .attr('font-family', FONT_FAMILY)
          .text(fmtNum(v));
        tagDatum(label, {
          line: row.lineNumber,
          key: cellKey,
          name: cellKey,
          value: fmtNum(v),
          color: ramp,
        });
        label.attr('data-row-key', row.label).attr('data-col-key', colLabel);
      }
    });
  });
}
