// ============================================================
// Hand-built bar / bar-stacked renderer — SPIKE.
// Handles: bar (single + grouped), bar-stacked, horizontal orientation.
// Matches the ECharts house style: 25% tint fill + full-strength border,
// per-category colors for single series, value labels, 0-baseline.
// ============================================================

import { scaleBand, scaleLinear } from 'd3-scale';
import { max as d3max } from 'd3-array';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
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

function seriesValues(
  pt: { value: number; extraValues?: number[] },
  seriesCount: number
): number[] {
  const out = [pt.value];
  for (let s = 1; s < seriesCount; s++) out.push(pt.extraValues?.[s - 1] ?? 0);
  return out;
}

export function renderBar(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  hasTitle: boolean
): void {
  const data = chart.data;
  const seriesNames =
    chart.seriesNames && chart.seriesNames.length
      ? chart.seriesNames
      : [chart.series ?? ''];
  const stacked = chart.type === 'bar-stacked';
  // ECharts parity: plain `bar` renders only the first series (extra series are
  // dropped, matching the parser's E_* warning); only bar-stacked stacks them.
  const seriesCount = stacked
    ? Math.max(
        1,
        seriesNames.length,
        1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
      )
    : 1;
  const horizontal = chart.orientation === 'horizontal';
  const multiSeries = seriesCount > 1;
  const solid = chart.solidFill === true;

  // Single series → each category gets its own palette color (ECharts parity).
  // Multi series → color by series index.
  const colorFor = (seriesIdx: number, catIdx: number, override?: string) => {
    if (override) return override;
    return multiSeries
      ? colors[seriesIdx % colors.length]!
      : colors[catIdx % colors.length]!;
  };
  const fillOf = (c: string) =>
    solid ? c : shapeFill(palette, c, isDark);

  const top = reserveHeader(svg, chart, colors, palette, isDark, hasTitle, width);
  const m: Margins = { top: top + 8, right: 32, bottom: 64, left: 72 };

  const perCat = data.map((d) => seriesValues(d, seriesCount));
  const maxVal = stacked
    ? d3max(perCat, (vals) => vals.reduce((a, b) => a + b, 0)) ?? 0
    : d3max(perCat, (vals) => d3max(vals) ?? 0) ?? 0;
  const niceMax = maxVal === 0 ? 1 : maxVal;

  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const horiz = horizontal;

  const catRange: [number, number] = horiz
    ? [m.top, m.top + plotH]
    : [m.left, m.left + plotW];
  const cat = scaleBand<string>()
    .domain(data.map((d) => d.label))
    .range(catRange)
    .padding(0.3);
  const valRange: [number, number] = horiz
    ? [m.left, m.left + plotW]
    : [m.top + plotH, m.top];
  const val = scaleLinear().domain([0, niceMax]).nice().range(valRange);

  // value-axis gridlines + ticks
  for (const t of val.ticks(6)) {
    if (horiz) {
      const x = val(t);
      svg
        .append('line')
        .attr('x1', x)
        .attr('x2', x)
        .attr('y1', m.top)
        .attr('y2', m.top + plotH)
        .attr('stroke', mutedColor)
        .attr('stroke-opacity', t === 0 ? 0.6 : 0.25);
      svg
        .append('text')
        .attr('x', x)
        .attr('y', m.top + plotH + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(fmtNum(t));
    } else {
      const y = val(t);
      svg
        .append('line')
        .attr('x1', m.left)
        .attr('x2', m.left + plotW)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', mutedColor)
        .attr('stroke-opacity', t === 0 ? 0.6 : 0.25);
      svg
        .append('text')
        .attr('x', m.left - 10)
        .attr('y', y + 4)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(fmtNum(t));
    }
  }

  // category labels
  for (const d of data) {
    const c = (cat(d.label) ?? 0) + cat.bandwidth() / 2;
    if (horiz) {
      svg
        .append('text')
        .attr('x', m.left - 10)
        .attr('y', c + 4)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(d.label);
    } else {
      svg
        .append('text')
        .attr('x', c)
        .attr('y', m.top + plotH + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(d.label);
    }
  }

  const zero = val(0);
  const inner = stacked
    ? null
    : scaleBand<number>()
        .domain(seriesNames.map((_, i) => i))
        .range([0, cat.bandwidth()])
        .padding(0.12);

  data.forEach((d, ci) => {
    const base = cat(d.label) ?? 0;
    const vals = seriesValues(d, seriesCount);
    let acc = 0;
    vals.forEach((v, s) => {
      const stroke = colorFor(s, ci, seriesCount === 1 ? d.color : undefined);
      const fill = fillOf(stroke);
      if (stacked) {
        if (horiz) {
          const x0 = val(acc);
          const x1 = val(acc + v);
          rect(svg, Math.min(x0, x1), base, Math.abs(x1 - x0), cat.bandwidth(), fill, stroke);
          if (Math.abs(x1 - x0) > 26)
            drawValueLabel(svg, fmtNum(v), (x0 + x1) / 2, base + cat.bandwidth() / 2 + 4, textColor);
        } else {
          const y0 = val(acc);
          const y1 = val(acc + v);
          rect(svg, base, Math.min(y0, y1), cat.bandwidth(), Math.abs(y1 - y0), fill, stroke);
          if (Math.abs(y1 - y0) > 18)
            drawValueLabel(svg, fmtNum(v), base + cat.bandwidth() / 2, (y0 + y1) / 2 + 4, textColor);
        }
        acc += v;
      } else {
        const off = inner!(s) ?? 0;
        const bw = inner!.bandwidth();
        if (horiz) {
          const x1 = val(v);
          rect(svg, Math.min(zero, x1), base + off, Math.abs(x1 - zero), bw, fill, stroke);
          drawValueLabel(svg, fmtNum(v), x1 + 6, base + off + bw / 2 + 4, textColor, 'start');
        } else {
          const y1 = val(v);
          rect(svg, base + off, Math.min(zero, y1), bw, Math.abs(zero - y1), fill, stroke);
          drawValueLabel(svg, fmtNum(v), base + off + bw / 2, y1 - 6, textColor);
        }
      }
    });
  });

  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, m.top + plotH + 46, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}

function rect(
  svg: Svg,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string
): void {
  svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.5);
}
