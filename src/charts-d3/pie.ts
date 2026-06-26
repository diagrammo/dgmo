// ============================================================
// Hand-built pie / doughnut renderer — SPIKE.
// ============================================================

import { pie as d3pie, arc as d3arc } from 'd3-shape';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { getSegmentColors } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { type Svg, LEGEND_FONT, fmtNum } from './shared';
import { measureText } from '../utils/text-measure';

export function renderPie(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  palette: PaletteColors,
  textColor: string
): void {
  const data = chart.data.filter((d) => d.value > 0);
  if (data.length === 0) return;
  const isDoughnut = chart.type === 'doughnut';
  const total = data.reduce((a, d) => a + d.value, 0);

  // Reserve right-side column for the legend.
  const legendNames = data.map((d) => d.label);
  const legendW =
    Math.max(0, ...legendNames.map((n) => measureText(n, LEGEND_FONT))) + 28;
  const plotW = width - legendW - 48;
  const cx = 24 + plotW / 2;
  const cy = height / 2 + 16;
  const radius = Math.min(plotW, height - 80) / 2 - 10;

  const segColors = getSegmentColors(palette, data.length);
  const colorFor = (i: number, override?: string): string =>
    override ?? segColors[i % segColors.length]!;

  const arcs = d3pie<{ value: number }>()
    .sort(null)
    .value((d) => d.value)(data.map((d) => ({ value: d.value })));

  const arcGen = d3arc<(typeof arcs)[number]>()
    .innerRadius(isDoughnut ? radius * 0.58 : 0)
    .outerRadius(radius);
  const labelArc = d3arc<(typeof arcs)[number]>()
    .innerRadius(radius * 0.6)
    .outerRadius(radius * 0.6);

  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

  arcs.forEach((a, i) => {
    const color = colorFor(i, data[i]!.color);
    g.append('path')
      .attr('d', arcGen(a) ?? '')
      .attr('fill', color)
      .attr('stroke', palette.bg)
      .attr('stroke-width', 2);

    const frac = (a.endAngle - a.startAngle) / (2 * Math.PI);
    if (frac > 0.05 && !chart.noPercent) {
      const [lx, ly] = labelArc.centroid(a);
      g.append('text')
        .attr('x', lx)
        .attr('y', ly + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', palette.bg)
        .attr('font-size', 12)
        .attr('font-weight', 600)
        .attr('font-family', FONT_FAMILY)
        .text(`${Math.round(frac * 100)}%`);
    }
  });

  // Center total for doughnut.
  if (isDoughnut) {
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', 6)
      .attr('fill', textColor)
      .attr('font-size', 22)
      .attr('font-weight', 700)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(total));
  }

  // Right-side legend with name + value.
  const legendX = width - legendW + 4;
  const rowH = 24;
  const startY = (height - data.length * rowH) / 2 + rowH / 2;
  data.forEach((d, i) => {
    const yy = startY + i * rowH;
    svg
      .append('circle')
      .attr('cx', legendX)
      .attr('cy', yy - 4)
      .attr('r', 6)
      .attr('fill', colorFor(i, d.color));
    const label = chart.noValue ? d.label : `${d.label}  ${fmtNum(d.value)}`;
    svg
      .append('text')
      .attr('x', legendX + 14)
      .attr('y', yy)
      .attr('fill', textColor)
      .attr('font-size', LEGEND_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(label);
  });
}
