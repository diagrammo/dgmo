// ============================================================
// Hand-built bar renderer.
// Handles: single-series bar, multi-series `stack` (stacked) and `group`
// (clustered side-by-side) layouts (chart.barLayout), horizontal orientation.
// Matches the house style: 25% tint fill + full-strength border, per-category
// colors for single series, value labels, 0-baseline.
// Signed values: the domain is [min(0, dataMin), max(0, dataMax)] and bars
// grow from the 0 baseline in either direction (diverging); stacks accumulate
// positive and negative runs separately.
// ============================================================

import { scaleBand, scaleLinear } from 'd3-scale';
import { max as d3max, min as d3min } from 'd3-array';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import {
  type Svg,
  type Margins,
  type InlineTitleInfo,
  TICK_FONT,
  fmtNum,
  reserveHeader,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  drawValueLabel,
  tagDatum,
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
  hasTitle: boolean,
  inlineTitle?: InlineTitleInfo
): void {
  const data = chart.data;
  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const stacked = chart.barLayout === 'stack';
  const grouped = chart.barLayout === 'group';
  // A `stack` or `group` block header makes it multi-series; plain `bar` (no
  // layout header) is single-series. `stack` sums into one bar; `group` draws
  // the series side by side via the `inner` band below.
  const seriesCount =
    stacked || grouped
      ? Math.max(
          1,
          seriesNames.length,
          1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
        )
      : 1;
  const horizontal = chart.orientation === 'horizontal';
  const multiSeries = seriesCount > 1;
  const fillMode = chart.fillMode;

  // Single series → each category gets its own palette color (ECharts parity).
  // Multi series → color by series index.
  const colorFor = (seriesIdx: number, catIdx: number, override?: string) => {
    if (override) return override;
    return multiSeries
      ? (chart.seriesNameColors?.[seriesIdx] ??
          colors[seriesIdx % colors.length]!)
      : colors[catIdx % colors.length]!;
  };
  const fillOf = (c: string) =>
    shapeFill(palette, c, isDark, { mode: fillMode });

  const top = reserveHeader(
    svg,
    chart,
    colors,
    palette,
    isDark,
    hasTitle,
    width,
    inlineTitle
  );

  const perCat = data.map((d) => seriesValues(d, seriesCount));
  // Stacked bars accumulate positive and negative values into separate runs,
  // so the extents are the per-category positive sum and negative sum.
  const maxVal = stacked
    ? (d3max(perCat, (vals) =>
        vals.filter((v) => v > 0).reduce((a, b) => a + b, 0)
      ) ?? 0)
    : (d3max(perCat, (vals) => d3max(vals) ?? 0) ?? 0);
  const minVal = stacked
    ? (d3min(perCat, (vals) =>
        vals.filter((v) => v < 0).reduce((a, b) => a + b, 0)
      ) ?? 0)
    : (d3min(perCat, (vals) => d3min(vals) ?? 0) ?? 0);
  // Domain always includes 0 (bars encode magnitude from a 0 baseline); with
  // negative data it extends below so bars grow either direction from 0.
  const hiVal = Math.max(0, maxVal);
  const loVal = Math.min(0, minVal);
  const niceMax = hiVal === 0 && loVal === 0 ? 1 : hiVal;

  // Left margin must fit the rotated y-title + the left-edge labels: category
  // names for horizontal bars, value ticks for vertical.
  const leftLabels = horizontal
    ? data.map((d) => d.label)
    : [fmtNum(niceMax), fmtNum(niceMax / 2), fmtNum(loVal), fmtNum(loVal / 2)];
  const m: Margins = {
    top: top + 8,
    right: 32,
    bottom: 64,
    left: computeLeftMargin(chart.ylabel, leftLabels),
  };

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
  const val = scaleLinear().domain([loVal, niceMax]).nice().range(valRange);

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
    let accPos = 0;
    let accNeg = 0;
    vals.forEach((v, s) => {
      const stroke = colorFor(s, ci, seriesCount === 1 ? d.color : undefined);
      const fill = fillOf(stroke);
      const sName = seriesNames[s] ?? '';
      const tag = {
        line: d.lineNumber,
        key: multiSeries ? sName : d.label,
        name: multiSeries ? `${d.label} · ${sName}` : d.label,
        value: v,
        color: stroke,
        seriesName: multiSeries ? sName : undefined,
      };
      if (stacked) {
        // Positive segments stack up/right from 0, negative segments stack
        // down/left — the diverging-stack convention.
        const acc = v < 0 ? accNeg : accPos;
        if (horiz) {
          const x0 = val(acc);
          const x1 = val(acc + v);
          rect(
            svg,
            Math.min(x0, x1),
            base,
            Math.abs(x1 - x0),
            cat.bandwidth(),
            fill,
            stroke,
            tag
          );
          if (Math.abs(x1 - x0) > 26)
            drawValueLabel(
              svg,
              fmtNum(v),
              (x0 + x1) / 2,
              base + cat.bandwidth() / 2 + 4,
              textColor
            );
        } else {
          const y0 = val(acc);
          const y1 = val(acc + v);
          rect(
            svg,
            base,
            Math.min(y0, y1),
            cat.bandwidth(),
            Math.abs(y1 - y0),
            fill,
            stroke,
            tag
          );
          if (Math.abs(y1 - y0) > 18)
            drawValueLabel(
              svg,
              fmtNum(v),
              base + cat.bandwidth() / 2,
              (y0 + y1) / 2 + 4,
              textColor
            );
        }
        if (v < 0) accNeg += v;
        else accPos += v;
      } else {
        const off = inner!(s) ?? 0;
        const bw = inner!.bandwidth();
        if (horiz) {
          const x1 = val(v);
          rect(
            svg,
            Math.min(zero, x1),
            base + off,
            Math.abs(x1 - zero),
            bw,
            fill,
            stroke,
            tag
          );
          // Negative bars grow left — the label sits off the bar's free end,
          // flipped inside the bar when it would leave the plot (the min-value
          // bar ends exactly at the plot edge and would hit the category name).
          const txt = fmtNum(v);
          const approxW = txt.length * 7 + 6;
          const inside =
            v < 0 ? x1 - approxW < m.left : x1 + approxW > m.left + plotW;
          drawValueLabel(
            svg,
            txt,
            v < 0 ? (inside ? x1 + 6 : x1 - 6) : inside ? x1 - 6 : x1 + 6,
            base + off + bw / 2 + 4,
            textColor,
            v < 0 !== inside ? 'end' : 'start'
          );
        } else {
          const y1 = val(v);
          rect(
            svg,
            base + off,
            Math.min(zero, y1),
            bw,
            Math.abs(zero - y1),
            fill,
            stroke,
            tag
          );
          // Negative bars grow down — the label sits below the bar's free end,
          // flipped inside the bar when it would leave the plot (the min-value
          // bar reaches the plot floor and would hit the category name).
          const yOut = v < 0 ? y1 + 14 : y1 - 6;
          const yInside = v < 0 ? yOut > m.top + plotH - 2 : yOut < m.top + 2;
          drawValueLabel(
            svg,
            fmtNum(v),
            base + off + bw / 2,
            yInside ? (v < 0 ? y1 - 6 : y1 + 14) : yOut,
            textColor
          );
        }
      }
    });
  });

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}

function rect(
  svg: Svg,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  tag: {
    line: number;
    key: string;
    name: string;
    value: number;
    color: string;
    seriesName?: string | undefined;
  }
): void {
  const r = svg
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', w)
    .attr('height', h)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', 1.5);
  tagDatum(r, tag);
}
