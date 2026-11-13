// ============================================================
// Hand-built polar-area (rose) renderer — SPIKE (Tier 2).
// Equal-angle sectors; radius proportional to value (ECharts roseType:radius).
// ============================================================

import { arc as d3arc } from 'd3-shape';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { getSegmentColors, shapeFill } from '../palettes/color-utils';
import { type Svg, chartFormatter, tagDatum } from './shared';

// Label text top above its anchor: cap height of the 13px label less its +4 baseline drop.
const LABEL_TOP_ABOVE_ANCHOR = 5.4;

export function renderPolarArea(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  topInset: number
): void {
  // The author's `format` / `unit` / `locale` (#1831).
  const fmt = chartFormatter(chart);
  const data = chart.data.filter((d) => d.value > 0);
  const n = data.length;
  if (n === 0) return;
  const fillMode = chart.fillMode;
  const total = data.reduce((a, d) => a + d.value, 0);
  const maxValue = Math.max(...data.map((d) => d.value)) || 1;

  const cx = width / 2;
  const top = topInset + 8;
  const outerR = Math.min(width / 2 - 200, (height - top) / 2 - 40);
  // Top-aligned on the body band (#1838): the highest of the wedges' corners
  // and the labels (14 past the ring, at each sector's mid-angle) sets the top.
  const rOf = (v: number) => outerR * 0.14 + (v / maxValue) * (outerR * 0.86);
  const rise = Math.max(
    ...data.map((d, i) => {
      const a = (k: number) => (k * 2 * Math.PI) / n;
      const wedge = Math.max(Math.cos(a(i)), Math.cos(a(i + 1))) * rOf(d.value);
      const label =
        Math.cos(a(i + 0.5)) * (outerR + 14) + LABEL_TOP_ABOVE_ANCHOR;
      return Math.max(wedge, label);
    })
  );
  const cy = top + rise;
  const innerR = outerR * 0.14;

  const segColors = getSegmentColors(palette, n);
  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
  const seg = (2 * Math.PI) / n;

  data.forEach((d, i) => {
    const stroke = d.color ?? segColors[i % segColors.length]!;
    const r = innerR + (d.value / maxValue) * (outerR - innerR);
    const a0 = i * seg;
    const a1 = a0 + seg;
    const arcGen = d3arc<unknown>()
      .innerRadius(innerR)
      .outerRadius(r)
      .startAngle(a0)
      .endAngle(a1);
    const pct = Math.round((d.value / total) * 100);
    const sector = g
      .append('path')
      .attr('d', arcGen({}) ?? '')
      .attr('fill', shapeFill(palette, stroke, isDark, { mode: fillMode }))
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    tagDatum(sector, {
      line: d.lineNumber,
      key: d.label,
      name: d.label,
      value: `${fmt(d.value)} (${pct}%)`,
      color: stroke,
    });

    // external label at sector mid-angle (d3 angle 0 = top, clockwise)
    const mid = a0 + seg / 2 - Math.PI / 2;
    const rightSide = Math.cos(mid) >= 0;
    const lx = Math.cos(mid) * (outerR + 14);
    const ly = Math.sin(mid) * (outerR + 14);
    const nm = chart.noName ? '' : d.label;
    const tail = [
      chart.noValue ? '' : fmt(d.value),
      chart.noPercent ? '' : `(${pct}%)`,
    ]
      .filter(Boolean)
      .join(' ');
    const label = [nm, tail].filter(Boolean).join(' — ');
    if (label) {
      g.append('text')
        .attr('x', lx + (rightSide ? 4 : -4))
        .attr('y', ly + 4)
        .attr('text-anchor', rightSide ? 'start' : 'end')
        .attr('fill', textColor)
        .attr('font-size', 13)
        .attr('font-family', FONT_FAMILY)
        .text(label);
    }
  });
}
