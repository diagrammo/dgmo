// ============================================================
// Hand-built funnel renderer — SPIKE (Tier 2).
// Descending-sorted contiguous trapezoid bands, width ∝ value (minSize
// 14%). Names sit flush left of each band in the band's color; the value
// is centered inside the band (falling back beside the band when too
// narrow); the conversion % sits flush right — no leader lines.
// Layout is responsive: side text scales with pane width and the funnel
// shrinks/shifts so labels never clip at any dimension.
// `no-name` / `no-value` / `no-percent` suppress each part.
// ============================================================

import type { ParsedFunnel } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { contrastText, shapeFill } from '../palettes/color-utils';
import { type Svg, fmtNum, tagDatum } from './shared';

const PAD = 12;
const MARGIN = 8;

export function renderFunnel(
  svg: Svg,
  chart: ParsedFunnel,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  topInset: number
): void {
  const sorted = [...chart.data].sort((a, b) => b.value - a.value);
  const n = sorted.length;
  if (n === 0) return;
  const solid = chart.solidFill === true;

  const top = topInset + 8;
  const bottom = height - 30;
  const H = bottom - top;
  const bandH = H / n;
  const maxValue = sorted[0]!.value || 1;

  // Side text scales with pane width (21px from ~1100px, floor 11).
  const sideFont = Math.max(11, Math.min(21, width / 52));
  const est = (s: string, f: number) => s.length * f * 0.6;

  const pctLabelFor = (i: number) => {
    const pct = (sorted[i]!.value / sorted[i - 1]!.value) * 100;
    return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
  };
  const rightTextFor = (i: number, valueInside: boolean) => {
    const parts: string[] = [];
    if (!chart.noValue && !valueInside) parts.push(fmtNum(sorted[i]!.value));
    if (!chart.noPercent && i > 0) parts.push(pctLabelFor(i));
    return parts.join(' · ');
  };

  const nameW = chart.noName
    ? 0
    : Math.max(...sorted.map((d) => est(d.label, sideFont))) + PAD;

  const bandWidthsAt = (plotW: number, i: number) => {
    const minW = plotW * 0.14;
    const scale = (v: number) => Math.max(minW, (v / maxValue) * plotW);
    const topW = scale(sorted[i]!.value);
    const botW = i < n - 1 ? scale(sorted[i + 1]!.value) : topW * 0.7;
    return { topW, botW };
  };
  const valueSizeAt = (plotW: number, i: number) => {
    const { topW, botW } = bandWidthsAt(plotW, i);
    const wMid = (topW + botW) / 2;
    const label = fmtNum(sorted[i]!.value);
    const fitByWidth = (wMid - 16) / (label.length * 0.6);
    // Fill the band with the value: ~55% of band height, shrink to fit.
    return Math.min(bandH * 0.55, fitByWidth);
  };
  const valueInsideAt = (plotW: number, i: number) =>
    !chart.noValue && valueSizeAt(plotW, i) >= 13;

  const layout = (rightW: number) => {
    const spanL = MARGIN + nameW;
    const spanR = width - MARGIN - rightW;
    const plotW = Math.max(width * 0.25, Math.min(width * 0.6, spanR - spanL));
    const lo = spanL + plotW / 2;
    const hi = spanR - plotW / 2;
    const cx =
      lo > hi ? (spanL + spanR) / 2 : Math.min(Math.max(width / 2, lo), hi);
    return { plotW, cx };
  };

  // Two passes: first size gutters assuming every value fits inside its
  // band, then re-reserve for the values that fall back to the right rail.
  const maxRightEst = (plotW: number | null) =>
    Math.max(
      0,
      ...sorted.map((_, i) =>
        est(
          rightTextFor(i, plotW === null ? true : valueInsideAt(plotW, i)),
          sideFont
        )
      )
    );
  let rightW = maxRightEst(null) + PAD;
  let { plotW, cx } = layout(rightW);
  rightW = maxRightEst(plotW) + PAD;
  ({ plotW, cx } = layout(rightW));

  sorted.forEach((d, i) => {
    const stroke = d.color ?? colors[chart.data.indexOf(d) % colors.length]!;
    const fill = solid ? stroke : shapeFill(palette, stroke, isDark);
    const { topW, botW } = bandWidthsAt(plotW, i);
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
        .attr('x', cx - halfEdge - PAD)
        .attr('y', yMid + sideFont * 0.35)
        .attr('text-anchor', 'end')
        .attr('fill', stroke)
        .attr('font-size', sideFont)
        .attr('font-weight', 600)
        .attr('font-family', FONT_FAMILY)
        .text(d.label);
    }

    const showPct = !chart.noPercent && i > 0;
    const valueInside = valueInsideAt(plotW, i);
    if (valueInside) {
      const valueSize = valueSizeAt(plotW, i);
      const valueFill = solid
        ? contrastText(fill, palette.textOnFillLight, palette.textOnFillDark)
        : stroke;
      svg
        .append('text')
        .attr('x', cx)
        .attr('y', yMid + valueSize * 0.35)
        .attr('text-anchor', 'middle')
        .attr('fill', valueFill)
        .attr('font-size', valueSize)
        .attr('font-weight', 700)
        .attr('font-family', FONT_FAMILY)
        .text(fmtNum(d.value));
    }
    const showValueRight = !chart.noValue && !valueInside;
    if (showValueRight || showPct) {
      const text = svg
        .append('text')
        .attr('x', cx + halfEdge + PAD)
        .attr('y', yMid + sideFont * 0.35)
        .attr('text-anchor', 'start')
        .attr('font-size', sideFont)
        .attr('font-weight', 600)
        .attr('font-family', FONT_FAMILY);
      if (showValueRight) {
        text.append('tspan').attr('fill', stroke).text(fmtNum(d.value));
      }
      if (showPct) {
        text
          .append('tspan')
          .attr('fill', stroke)
          .text(showValueRight ? ` · ${pctLabelFor(i)}` : pctLabelFor(i));
      }
    }
  });
}
