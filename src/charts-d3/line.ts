// ============================================================
// Hand-built line / multi-line / area renderer — SPIKE.
// Includes era bands (markArea parity) when the chart declares eras.
// ============================================================

import { scalePoint, scaleLinear } from 'd3-scale';
import { line as d3line, area as d3area } from 'd3-shape';
import type { ParsedChart } from '../chart';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  drawLegend,
  drawXAxisTitle,
  drawYAxisTitle,
} from './shared';

function seriesValue(
  pt: { value: number; extraValues?: number[] },
  s: number
): number {
  return s === 0 ? pt.value : pt.extraValues?.[s - 1] ?? 0;
}

export function renderLine(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  colors: string[],
  textColor: string,
  mutedColor: string,
  bgColor: string
): void {
  const data = chart.data;
  const isArea = chart.type === 'area';
  const seriesNames =
    chart.seriesNames && chart.seriesNames.length
      ? chart.seriesNames
      : [chart.series ?? ''];
  const seriesCount = Math.max(
    1,
    seriesNames.length,
    1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
  );

  const legendItems = seriesNames.map((name, i) => ({
    name,
    color: colors[i % colors.length]!,
  }));
  const m: Margins = { top: 64, right: 32, bottom: 64, left: 72 };
  const legendH = drawLegend(svg, legendItems, width, height - 16, textColor);
  m.bottom += legendH;

  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  // value extent across all series; include 0 baseline for area
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of data) {
    for (let s = 0; s < seriesCount; s++) {
      const v = seriesValue(d, s);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (isArea) lo = Math.min(lo, 0);
  if (lo === hi) hi = lo + 1;

  const x = scalePoint<string>()
    .domain(data.map((d) => d.label))
    .range([m.left, m.left + plotW])
    .padding(0.5);
  const y = scaleLinear()
    .domain([lo, hi])
    .nice()
    .range([m.top + plotH, m.top]);

  // era bands (markArea parity)
  if (chart.eras && chart.eras.length) {
    chart.eras.forEach((era, i) => {
      const xs = x(era.start);
      const xe = x(era.end);
      if (xs == null || xe == null) return;
      const fill = era.color ?? colors[i % colors.length]!;
      svg
        .append('rect')
        .attr('x', Math.min(xs, xe))
        .attr('y', m.top)
        .attr('width', Math.abs(xe - xs))
        .attr('height', plotH)
        .attr('fill', mix(fill, bgColor, 0.85))
        .attr('stroke', 'none');
      svg
        .append('text')
        .attr('x', (xs + xe) / 2)
        .attr('y', m.top + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .attr('opacity', 0.8)
        .text(era.label);
    });
  }

  // y gridlines + ticks
  for (const t of y.ticks(6)) {
    const yy = y(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === 0 ? 0.6 : 0.25);
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

  // x category labels
  for (const d of data) {
    svg
      .append('text')
      .attr('x', x(d.label) ?? 0)
      .attr('y', m.top + plotH + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(d.label);
  }

  // one path (+ optional area fill) per series
  for (let s = 0; s < seriesCount; s++) {
    const color = colors[s % colors.length]!;
    const pts = data.map((d) => ({ label: d.label, v: seriesValue(d, s) }));

    if (isArea) {
      const areaGen = d3area<{ label: string; v: number }>()
        .x((p) => x(p.label) ?? 0)
        .y0(y(Math.max(lo, 0)))
        .y1((p) => y(p.v));
      svg
        .append('path')
        .attr('d', areaGen(pts) ?? '')
        .attr('fill', mix(color, bgColor, 0.7))
        .attr('stroke', 'none');
    }

    const lineGen = d3line<{ label: string; v: number }>()
      .x((p) => x(p.label) ?? 0)
      .y((p) => y(p.v));
    svg
      .append('path')
      .attr('d', lineGen(pts) ?? '')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.5)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');

    for (const p of pts) {
      svg
        .append('circle')
        .attr('cx', x(p.label) ?? 0)
        .attr('cy', y(p.v))
        .attr('r', 3)
        .attr('fill', color);
    }
  }

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 18, textColor);
}
