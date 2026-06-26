// ============================================================
// Hand-built line / multi-line / area renderer — SPIKE.
// Series-tinted value labels, 0-baseline, era bands (markArea parity).
// ============================================================

import { scalePoint, scaleLinear } from 'd3-scale';
import { line as d3line, area as d3area } from 'd3-shape';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { mix, shapeFill } from '../palettes/color-utils';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  reserveHeader,
  drawXAxisTitle,
  drawYAxisTitle,
  drawValueLabel,
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
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  bgColor: string,
  hasTitle: boolean
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

  const top = reserveHeader(svg, chart, colors, palette, isDark, hasTitle, width);
  const m: Margins = { top: top + 8, right: 32, bottom: 64, left: 72 };

  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

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
  // 0-baseline for all-positive data (ECharts parity).
  if (lo > 0) lo = 0;
  if (lo === hi) hi = lo + 1;

  const x = scalePoint<string>()
    .domain(data.map((d) => d.label))
    .range([m.left, m.left + plotW])
    .padding(0.5);
  const y = scaleLinear().domain([lo, hi]).nice().range([m.top + plotH, m.top]);

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
        .attr('fill', mix(fill, bgColor, 12));
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

  // Transparent hit-target over the plot area — the interaction adapter reads
  // its bounds for crosshair extent and snapping (see charts-d3/interactions.ts).
  svg
    .append('rect')
    .attr('class', 'dgmo-plot-rect')
    .attr('x', m.left)
    .attr('y', m.top)
    .attr('width', plotW)
    .attr('height', plotH)
    .attr('fill', 'transparent');

  for (let s = 0; s < seriesCount; s++) {
    const color = colors[s % colors.length]!;
    const name = seriesNames[s] ?? `Series ${s + 1}`;
    const pts = data.map((d, i) => ({
      label: d.label,
      v: seriesValue(d, s),
      xIndex: i,
      lineNumber: d.lineNumber,
    }));
    // Semantic series group — joins the app's generic data-attribute
    // interactivity path (hover-dim, click-to-line) like every other diagram.
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series')
      .attr('data-series-index', s)
      .attr('data-series-name', name)
      .attr('data-color', color);
    const seriesLine = chart.seriesNameLineNumbers?.[s];
    if (seriesLine !== undefined) g.attr('data-line-number', seriesLine);

    if (isArea) {
      const areaGen = d3area<(typeof pts)[number]>()
        .x((p) => x(p.label) ?? 0)
        .y0(y(Math.max(lo, 0)))
        .y1((p) => y(p.v));
      g.append('path')
        .attr('class', 'dgmo-series-area')
        .attr('d', areaGen(pts) ?? '')
        .attr('fill', shapeFill(palette, color, isDark))
        .attr('stroke', 'none');
    }

    const lineGen = d3line<(typeof pts)[number]>()
      .x((p) => x(p.label) ?? 0)
      .y((p) => y(p.v));
    g.append('path')
      .attr('class', 'dgmo-series-line')
      .attr('d', lineGen(pts) ?? '')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.5)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');

    const labelColor = mix(color, textColor, 60);
    for (const p of pts) {
      g.append('circle')
        .attr('class', 'dgmo-pt')
        .attr('data-series-index', s)
        .attr('data-series-name', name)
        .attr('data-color', color)
        .attr('data-x-index', p.xIndex)
        .attr('data-x-label', p.label)
        .attr('data-value', p.v)
        .attr('data-line-number', p.lineNumber)
        .attr('cx', x(p.label) ?? 0)
        .attr('cy', y(p.v))
        .attr('r', 3.5)
        .attr('fill', bgColor)
        .attr('stroke', color)
        .attr('stroke-width', 2);
      drawValueLabel(svg, fmtNum(p.v), x(p.label) ?? 0, y(p.v) - 10, labelColor);
    }
  }

  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, m.top + plotH + 46, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}
