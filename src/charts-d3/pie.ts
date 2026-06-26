// ============================================================
// Hand-built pie / doughnut renderer — SPIKE.
// ECharts-style: 25% tint fill + full-strength border, external leader-line
// labels ("Name — value (pct%)"), doughnut center total.
// ============================================================

import { pie as d3pie, arc as d3arc } from 'd3-shape';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { getSegmentColors, shapeFill } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { type Svg, fmtNum, tagDatum } from './shared';

const LABEL_FONT = 14;

export function renderPie(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  topInset: number
): void {
  const data = chart.data.filter((d) => d.value > 0);
  if (data.length === 0) return;
  const isDoughnut = chart.type === 'doughnut';
  const solid = chart.solidFill === true;
  const total = data.reduce((a, d) => a + d.value, 0);

  const cx = width / 2;
  const top = topInset + 12;
  const cy = top + (height - top) / 2;
  // Leave horizontal room for the external labels + leader lines.
  const radius = Math.min(width / 2 - 220, (height - top) / 2 - 40);

  const segColors = getSegmentColors(palette, data.length);
  const strokeFor = (i: number, override?: string) =>
    override ?? segColors[i % segColors.length]!;

  const arcs = d3pie<{ value: number }>()
    .sort(null)
    .value((d) => d.value)(data.map((d) => ({ value: d.value })));

  const arcGen = d3arc<(typeof arcs)[number]>()
    .innerRadius(isDoughnut ? radius * 0.6 : 0)
    .outerRadius(radius);

  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

  arcs.forEach((a, i) => {
    const stroke = strokeFor(i, data[i]!.color);
    const fill = solid ? stroke : shapeFill(palette, stroke, isDark);
    const pct = Math.round((data[i]!.value / total) * 100);
    const slice = g
      .append('path')
      .attr('d', arcGen(a) ?? '')
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 1.5);
    tagDatum(slice, {
      line: data[i]!.lineNumber,
      key: data[i]!.label,
      name: data[i]!.label,
      value: `${fmtNum(data[i]!.value)} (${pct}%)`,
      color: stroke,
    });

    // External leader-line label.
    const mid = (a.startAngle + a.endAngle) / 2 - Math.PI / 2;
    const rightSide = Math.cos(mid) >= 0;
    const x0 = Math.cos(mid) * radius;
    const y0 = Math.sin(mid) * radius;
    const x1 = Math.cos(mid) * (radius + 16);
    const y1 = Math.sin(mid) * (radius + 16);
    const x2 = x1 + (rightSide ? 28 : -28);
    g.append('polyline')
      .attr('points', `${x0},${y0} ${x1},${y1} ${x2},${y1}`)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', 1);
    g.append('text')
      .attr('x', x2 + (rightSide ? 4 : -4))
      .attr('y', y1 + 4)
      .attr('text-anchor', rightSide ? 'start' : 'end')
      .attr('fill', textColor)
      .attr('font-size', LABEL_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(`${data[i]!.label} — ${fmtNum(data[i]!.value)} (${pct}%)`);
  });

  if (isDoughnut) {
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 8)
      .attr('fill', textColor)
      .attr('font-size', 26)
      .attr('font-weight', 700)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(total));
  }
}
