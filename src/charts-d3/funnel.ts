// ============================================================
// Hand-built funnel renderer — SPIKE (Tier 2).
// Descending-sorted trapezoids, width ∝ value, minSize 8%, names left /
// values right with leader lines (ECharts parity).
// ============================================================

import type { ParsedFunnel } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import { type Svg, fmtNum, tagDatum } from './shared';

export function renderFunnel(
  svg: Svg,
  chart: ParsedFunnel,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  topInset: number
): void {
  const sorted = [...chart.data].sort((a, b) => b.value - a.value);
  const n = sorted.length;
  if (n === 0) return;
  const solid = chart.solidFill === true;

  const plotLeft = width * 0.2;
  const plotW = width * 0.6;
  const cx = width / 2;
  const top = topInset + 8;
  const bottom = height - 30;
  const H = bottom - top;
  const bandH = H / n;
  const maxValue = sorted[0]!.value || 1;
  const minW = plotW * 0.08;
  const scaleW = (v: number) => Math.max(minW, (v / maxValue) * plotW);

  sorted.forEach((d, i) => {
    const stroke = d.color ?? colors[chart.data.indexOf(d) % colors.length]!;
    const fill = solid ? stroke : shapeFill(palette, stroke, isDark);
    const topW = scaleW(d.value);
    const botW = i < n - 1 ? scaleW(sorted[i + 1]!.value) : minW;
    const y0 = top + i * bandH;
    const y1 = y0 + bandH;
    const seg = svg
      .append('polygon')
      .attr(
        'points',
        `${cx - topW / 2},${y0} ${cx + topW / 2},${y0} ${cx + botW / 2},${y1} ${cx - botW / 2},${y1}`
      )
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    tagDatum(seg, {
      line: d.lineNumber,
      key: d.label,
      name: d.label,
      value: fmtNum(d.value),
      color: stroke,
    });

    const yMid = (y0 + y1) / 2;
    if (!chart.noName) {
      svg
        .append('line')
        .attr('x1', plotLeft - 8)
        .attr('y1', yMid)
        .attr('x2', cx - topW / 2)
        .attr('y2', yMid)
        .attr('stroke', textColor)
        .attr('stroke-opacity', 0.3);
      svg
        .append('text')
        .attr('x', plotLeft - 12)
        .attr('y', yMid + 4)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', 13)
        .attr('font-family', FONT_FAMILY)
        .text(d.label);
    }
    if (!chart.noValue) {
      svg
        .append('line')
        .attr('x1', cx + topW / 2)
        .attr('y1', yMid)
        .attr('x2', plotLeft + plotW + 8)
        .attr('y2', yMid)
        .attr('stroke', textColor)
        .attr('stroke-opacity', 0.3);
      svg
        .append('text')
        .attr('x', plotLeft + plotW + 12)
        .attr('y', yMid + 4)
        .attr('text-anchor', 'start')
        .attr('fill', textColor)
        .attr('font-size', 13)
        .attr('font-family', FONT_FAMILY)
        .text(fmtNum(d.value));
    }
  });
}
