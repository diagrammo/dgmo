// ============================================================
// Hand-built bar / bar-stacked renderer — SPIKE.
// Handles: bar (single + grouped), bar-stacked, horizontal orientation.
// ============================================================

import { scaleBand, scaleLinear } from 'd3-scale';
import { max as d3max } from 'd3-array';
import type { ParsedChart } from '../chart';
import { FONT_FAMILY } from '../fonts';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  drawLegend,
  drawXAxisTitle,
  drawYAxisTitle,
} from './shared';

/** Extract per-series numeric values for a data point. */
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
  textColor: string,
  mutedColor: string
): void {
  const data = chart.data;
  const seriesNames =
    chart.seriesNames && chart.seriesNames.length
      ? chart.seriesNames
      : [chart.series ?? ''];
  const seriesCount = Math.max(
    1,
    seriesNames.length,
    1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
  );
  const stacked = chart.type === 'bar-stacked';
  const horizontal = chart.orientation === 'horizontal';

  const legendItems = seriesNames.map((name, i) => ({
    name,
    color: colors[i % colors.length]!,
  }));
  const m: Margins = { top: 64, right: 32, bottom: 64, left: 72 };
  const legendH = drawLegend(
    svg,
    legendItems,
    width,
    height - 16,
    textColor
  );
  m.bottom += legendH;

  // Max value: stacked sums per category, else max single value.
  const perCat = data.map((d) => seriesValues(d, seriesCount));
  const maxVal = stacked
    ? d3max(perCat, (vals) => vals.reduce((a, b) => a + b, 0)) ?? 0
    : d3max(perCat, (vals) => d3max(vals) ?? 0) ?? 0;
  const niceMax = maxVal === 0 ? 1 : maxVal;

  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  if (horizontal) {
    renderAxesAndBars(true);
  } else {
    renderAxesAndBars(false);
  }

  function renderAxesAndBars(horiz: boolean): void {
    // category scale runs along one axis, value scale along the other
    const catRange: [number, number] = horiz
      ? [m.top, m.top + plotH]
      : [m.left, m.left + plotW];
    const cat = scaleBand<string>()
      .domain(data.map((d) => d.label))
      .range(catRange)
      .padding(0.25);
    const valRange: [number, number] = horiz
      ? [m.left, m.left + plotW]
      : [m.top + plotH, m.top];
    const val = scaleLinear().domain([0, niceMax]).nice().range(valRange);

    // value-axis gridlines + ticks
    const ticks = val.ticks(6);
    for (const t of ticks) {
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

    // bars
    const zero = val(0);
    const inner = stacked
      ? null
      : scaleBand<number>()
          .domain(seriesNames.map((_, i) => i))
          .range([0, cat.bandwidth()])
          .padding(0.08);

    data.forEach((d) => {
      const base = cat(d.label) ?? 0;
      const vals = seriesValues(d, seriesCount);
      let acc = 0;
      vals.forEach((v, s) => {
        const color = d.color && seriesCount === 1 ? d.color : colors[s % colors.length]!;
        if (stacked) {
          if (horiz) {
            const x0 = val(acc);
            const x1 = val(acc + v);
            svg
              .append('rect')
              .attr('x', Math.min(x0, x1))
              .attr('y', base)
              .attr('width', Math.abs(x1 - x0))
              .attr('height', cat.bandwidth())
              .attr('fill', color);
          } else {
            const y0 = val(acc);
            const y1 = val(acc + v);
            svg
              .append('rect')
              .attr('x', base)
              .attr('y', Math.min(y0, y1))
              .attr('width', cat.bandwidth())
              .attr('height', Math.abs(y1 - y0))
              .attr('fill', color);
          }
          acc += v;
        } else {
          const off = inner!(s) ?? 0;
          const bw = inner!.bandwidth();
          if (horiz) {
            const x1 = val(v);
            svg
              .append('rect')
              .attr('x', Math.min(zero, x1))
              .attr('y', base + off)
              .attr('width', Math.abs(x1 - zero))
              .attr('height', bw)
              .attr('fill', color);
          } else {
            const y1 = val(v);
            svg
              .append('rect')
              .attr('x', base + off)
              .attr('y', Math.min(zero, y1))
              .attr('width', bw)
              .attr('height', Math.abs(zero - y1))
              .attr('fill', color);
          }
        }
      });
    });

    // axis titles
    if (horiz) {
      drawXAxisTitle(
        svg,
        chart.xlabel,
        m.left + plotW / 2,
        m.top + plotH + 46,
        textColor
      );
      drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 18, textColor);
    } else {
      drawXAxisTitle(
        svg,
        chart.xlabel,
        m.left + plotW / 2,
        m.top + plotH + 46,
        textColor
      );
      drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 18, textColor);
    }
  }
}
