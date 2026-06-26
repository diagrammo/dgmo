// ============================================================
// Hand-built radar renderer — SPIKE (Tier 2).
// One filled polygon over N value-axes; polygon grid rings + spokes.
// ============================================================

import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import { type Svg, fmtNum } from './shared';

const RINGS = 5;

export function renderRadar(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const data = chart.data;
  const n = data.length;
  if (n < 3) return;
  const solid = chart.solidFill === true;
  const radarColor =
    chart.color ?? chart.seriesNameColors?.[0] ?? palette.primary;
  const maxValue = Math.max(...data.map((d) => d.value)) * 1.15 || 1;

  const cx = width / 2;
  const top = topInset + 8;
  const cy = top + (height - top) / 2;
  const radius = Math.min(width / 2 - 130, (height - top) / 2 - 50);

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number): [number, number] => [
    cx + Math.cos(angle(i)) * r,
    cy + Math.sin(angle(i)) * r,
  ];

  // grid rings (polygons) + spokes
  for (let l = 1; l <= RINGS; l++) {
    const r = (radius * l) / RINGS;
    const poly = data
      .map((_, i) => pt(i, r).join(','))
      .join(' ');
    svg
      .append('polygon')
      .attr('points', poly)
      .attr('fill', 'none')
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.4);
  }
  data.forEach((_, i) => {
    const [x, y] = pt(i, radius);
    svg
      .append('line')
      .attr('x1', cx)
      .attr('y1', cy)
      .attr('x2', x)
      .attr('y2', y)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.4);
    // axis name
    const [lx, ly] = pt(i, radius + 18);
    const c = Math.cos(angle(i));
    svg
      .append('text')
      .attr('x', lx)
      .attr('y', ly + 4)
      .attr('text-anchor', Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end')
      .attr('fill', textColor)
      .attr('font-size', 14)
      .attr('font-family', FONT_FAMILY)
      .text(data[i]!.label);
  });

  // data polygon
  const poly = data
    .map((d, i) => pt(i, (d.value / maxValue) * radius).join(','))
    .join(' ');
  svg
    .append('polygon')
    .attr('points', poly)
    .attr('fill', solid ? radarColor : shapeFill(palette, radarColor, isDark))
    .attr('fill-opacity', solid ? 0.6 : 1)
    .attr('stroke', radarColor)
    .attr('stroke-width', 2);

  data.forEach((d, i) => {
    const [x, y] = pt(i, (d.value / maxValue) * radius);
    svg
      .append('circle')
      .attr('cx', x)
      .attr('cy', y)
      .attr('r', 4)
      .attr('fill', radarColor);
    if (!chart.noValue) {
      svg
        .append('text')
        .attr('x', x)
        .attr('y', y - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', 12)
        .attr('font-family', FONT_FAMILY)
        .text(fmtNum(d.value));
    }
  });
}
