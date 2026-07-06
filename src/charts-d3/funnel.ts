// ============================================================
// Hand-built funnel renderer — SPIKE (Tier 2).
// Descending-sorted trapezoid bands with vertical gaps, width ∝ value
// (minSize 14%). Combined "Name · value" label inside each band when it
// fits, otherwise beside it — no leader lines. Muted conversion % sits
// in the gap between stages.
// ============================================================

import type { ParsedFunnel } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import { type Svg, fmtNum, tagDatum } from './shared';

const LABEL_FONT_SIZE = 13;
const AVG_CHAR_W = LABEL_FONT_SIZE * 0.57;

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

  const plotW = width * 0.6;
  const cx = width / 2;
  const top = topInset + 8;
  const bottom = height - 30;
  const H = bottom - top;
  const showPct = n > 1;
  const gap = showPct ? 18 : 6;
  const bandH = (H - gap * (n - 1)) / n;
  const maxValue = sorted[0]!.value || 1;
  const minW = plotW * 0.14;
  const scaleW = (v: number) => Math.max(minW, (v / maxValue) * plotW);

  sorted.forEach((d, i) => {
    const stroke = d.color ?? colors[chart.data.indexOf(d) % colors.length]!;
    const fill = solid ? stroke : shapeFill(palette, stroke, isDark);
    const topW = scaleW(d.value);
    const botW = i < n - 1 ? scaleW(sorted[i + 1]!.value) : topW * 0.7;
    const y0 = top + i * (bandH + gap);
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
    const parts: string[] = [];
    if (!chart.noName) parts.push(d.label);
    if (!chart.noValue) parts.push(fmtNum(d.value));
    if (parts.length > 0) {
      const label = parts.join(' · ');
      const wMid = (topW + botW) / 2;
      const fitsInside = label.length * AVG_CHAR_W <= wMid - 20;
      const text = svg
        .append('text')
        .attr('y', yMid + 4)
        .attr('fill', textColor)
        .attr('font-size', LABEL_FONT_SIZE)
        .attr('font-family', FONT_FAMILY)
        .text(label);
      if (fitsInside) {
        text.attr('x', cx).attr('text-anchor', 'middle');
      } else {
        text
          .attr('x', cx - Math.max(topW, botW) / 2 - 10)
          .attr('text-anchor', 'end');
      }
    }

    if (showPct && i > 0) {
      const pct = (d.value / sorted[i - 1]!.value) * 100;
      const pctLabel = pct < 1 ? '<1%' : `${Math.round(pct)}%`;
      svg
        .append('text')
        .attr('x', cx)
        .attr('y', y0 - gap / 2 + 3.5)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('fill-opacity', 0.55)
        .attr('font-size', 10.5)
        .attr('font-family', FONT_FAMILY)
        .text(pctLabel);
    }
  });
}
