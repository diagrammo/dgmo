// ============================================================
// Hand-built scatter / bubble renderer — SPIKE (Tier 2).
// Auto-fit axes (10% pad), per-point or per-category color, bubble sizing,
// point labels. (Spike uses simple above-point labels, not the full ECharts
// greedy collision graphic.)
// ============================================================

import { scaleLinear } from 'd3-scale';
import type { ParsedScatter } from '../echarts';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  drawXAxisTitle,
  drawYAxisTitle,
} from './shared';

const FILL_OPACITY = 0.65;
const DEFAULT_SIZE = 15; // diameter

export function renderScatter(
  svg: Svg,
  chart: ParsedScatter,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const points = chart.scatterPoints ?? [];
  if (points.length === 0) return;
  const solid = chart.solidFill === true;
  const hasSize = points.some((p) => p.size !== undefined);

  const categories = [
    ...new Set(points.map((p) => p.category).filter(Boolean)),
  ] as string[];
  const catColor = (cat: string, i: number) =>
    chart.categoryColors?.[cat] ?? colors[i % colors.length]!;
  const catIndex = new Map(categories.map((c, i) => [c, i]));

  const m: Margins = { top: topInset + 8, right: 32, bottom: 64, left: 72 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;

  const x = scaleLinear()
    .domain([Math.floor(xMin - xPad), Math.ceil(xMax + xPad)])
    .range([m.left, m.left + plotW]);
  const y = scaleLinear()
    .domain([Math.floor(yMin - yPad), Math.ceil(yMax + yPad)])
    .range([m.top + plotH, m.top]);

  // gridlines + ticks
  for (const t of y.ticks(6)) {
    const yy = y(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.25);
    svg
      .append('text')
      .attr('x', m.left - 10)
      .attr('y', yy + 4)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(t));
  }
  for (const t of x.ticks(6)) {
    const xx = x(t);
    svg
      .append('line')
      .attr('x1', xx)
      .attr('x2', xx)
      .attr('y1', m.top)
      .attr('y2', m.top + plotH)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.25);
    svg
      .append('text')
      .attr('x', xx)
      .attr('y', m.top + plotH + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(t));
  }

  // points
  points.forEach((p, i) => {
    const stroke =
      p.color ??
      (p.category
        ? catColor(p.category, catIndex.get(p.category) ?? 0)
        : colors[i % colors.length]!);
    const r = (hasSize ? p.size ?? DEFAULT_SIZE : DEFAULT_SIZE) / 2;
    svg
      .append('circle')
      .attr('cx', x(p.x))
      .attr('cy', y(p.y))
      .attr('r', r)
      .attr('fill', solid ? stroke : shapeFill(palette, stroke, isDark))
      .attr('fill-opacity', FILL_OPACITY)
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    if (!chart.noName) {
      svg
        .append('text')
        .attr('x', x(p.x))
        .attr('y', y(p.y) - r - 5)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', 11)
        .attr('font-family', FONT_FAMILY)
        .text(p.name);
    }
  });

  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, m.top + plotH + 46, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}
