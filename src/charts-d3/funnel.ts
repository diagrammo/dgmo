// ============================================================
// Hand-built funnel renderer — SPIKE (Tier 2).
// Descending-sorted contiguous trapezoid bands, width ∝ value (minSize
// 14%). Names sit flush left of each band in the band's color; the value
// is centered inside the band (falling back beside the band when too
// narrow); a muted conversion % sits flush right — no leader lines.
// `no-name` / `no-value` / `no-percent` suppress each part.
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

  const plotW = width * 0.6;
  const cx = width / 2;
  const top = topInset + 8;
  const bottom = height - 30;
  const H = bottom - top;
  const bandH = H / n;
  const maxValue = sorted[0]!.value || 1;
  const minW = plotW * 0.14;
  const scaleW = (v: number) => Math.max(minW, (v / maxValue) * plotW);

  sorted.forEach((d, i) => {
    const stroke = d.color ?? colors[chart.data.indexOf(d) % colors.length]!;
    const fill = solid ? stroke : shapeFill(palette, stroke, isDark);
    const topW = scaleW(d.value);
    const botW = i < n - 1 ? scaleW(sorted[i + 1]!.value) : topW * 0.7;
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
    const halfEdge = (topW + botW) / 4; // half of the band's width at yMid
    if (!chart.noName) {
      svg
        .append('text')
        .attr('x', cx - halfEdge - 10)
        .attr('y', yMid + 4)
        .attr('text-anchor', 'end')
        .attr('fill', stroke)
        .attr('font-size', 13)
        .attr('font-family', FONT_FAMILY)
        .text(d.label);
    }

    const showPct = !chart.noPercent && i > 0;
    let valueInside = false;
    if (!chart.noValue) {
      const valueLabel = fmtNum(d.value);
      // ~0.57em average glyph width at 13px Inter
      valueInside = valueLabel.length * 13 * 0.57 <= halfEdge * 2 - 12;
      if (valueInside) {
        svg
          .append('text')
          .attr('x', cx)
          .attr('y', yMid + 4)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', 13)
          .attr('font-family', FONT_FAMILY)
          .text(valueLabel);
      }
    }
    const showValueRight = !chart.noValue && !valueInside;
    if (showValueRight || showPct) {
      const text = svg
        .append('text')
        .attr('x', cx + halfEdge + 10)
        .attr('y', yMid + 4)
        .attr('text-anchor', 'start')
        .attr('font-size', 13)
        .attr('font-family', FONT_FAMILY);
      if (showValueRight) {
        text.append('tspan').attr('fill', stroke).text(fmtNum(d.value));
      }
      if (showPct) {
        const pct = (d.value / sorted[i - 1]!.value) * 100;
        const pctLabel = pct < 1 ? '<1%' : `${Math.round(pct)}%`;
        text
          .append('tspan')
          .attr('fill', textColor)
          .attr('fill-opacity', 0.55)
          .text(showValueRight ? ` · ${pctLabel}` : pctLabel);
      }
    }
  });
}
