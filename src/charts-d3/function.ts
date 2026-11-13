// ============================================================
// Hand-built function-plot renderer — SPIKE (Tier 3).
// Evaluates each expression over the x-range and draws one line per function.
// ============================================================

import { scaleLinear } from 'd3-scale';
import { buildValueAxis } from './value-axis';
import { line as d3line, area as d3area } from 'd3-shape';
import type { ParsedFunctionChart } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { shapeFill } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { evaluateExpression } from '../utils/expr-eval';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  tagDatum,
} from './shared';

const SAMPLES = 200;

export function renderFunction(
  svg: Svg,
  chart: ParsedFunctionChart,
  width: number,
  height: number,
  colors: string[],
  textColor: string,
  mutedColor: string,
  topInset: number,
  palette: PaletteColors,
  isDark: boolean
): void {
  const fns = chart.functions ?? [];
  if (fns.length === 0) return;
  const xr = chart.xRange ?? { min: -10, max: 10 };
  const step = (xr.max - xr.min) / SAMPLES;
  const xs: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push(xr.min + i * step);

  const curves = fns.map((fn, i) => ({
    color: fn.color ?? colors[i % colors.length]!,
    name: fn.name,
    line: fn.lineNumber,
    pts: xs.map(
      (x) => [x, evaluateExpression(fn.expression, x)] as [number, number]
    ),
  }));

  let yLo = Infinity;
  let yHi = -Infinity;
  for (const c of curves)
    for (const [, y] of c.pts)
      if (isFinite(y)) {
        yLo = Math.min(yLo, y);
        yHi = Math.max(yHi, y);
      }
  if (!isFinite(yLo)) {
    yLo = -1;
    yHi = 1;
  }
  if (yLo === yHi) yHi = yLo + 1;

  // `y-scale log`, `y-min`, `y-max` (#1830). A log axis plots only the
  // samples above 0; its floor comes from the smallest of those.
  const ySpec = chart.axes?.y;
  let posLo = Infinity;
  for (const c of curves)
    for (const [, v] of c.pts)
      if (isFinite(v) && v > 0) posLo = Math.min(posLo, v);
  const yAxis = (range: [number, number]) =>
    buildValueAxis(yLo, yHi, ySpec, range, {
      nice: true,
      dataLo: ySpec?.scale === 'log' ? posLo : yLo,
      dataHi: yHi,
    });

  const m: Margins = {
    top: topInset + 8,
    right: 32,
    bottom: 64,
    left: computeLeftMargin(chart.ylabel, yAxis([0, 1]).ticks(8).map(fmtNum)),
  };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const x = scaleLinear()
    .domain([xr.min, xr.max])
    .range([m.left, m.left + plotW]);
  const y = yAxis([m.top + plotH, m.top]);
  const [yD0, yD1] = y.domain();
  const fixedY = ySpec?.min !== undefined || ySpec?.max !== undefined;

  // gridlines + ticks
  for (const t of y.ticks(8)) {
    const yy = y(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === 0 ? 0.6 : 0.2);
    svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('x', m.left - 10)
      .attr('y', yy + 4)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(t));
  }
  for (const t of x.ticks(10)) {
    const xx = x(t);
    svg
      .append('line')
      .attr('x1', xx)
      .attr('x2', xx)
      .attr('y1', m.top)
      .attr('y2', m.top + plotH)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === 0 ? 0.6 : 0.2);
    svg
      .append('text')
      .attr('class', 'dgmo-tick')
      .attr('x', xx)
      .attr('y', m.top + plotH + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', TICK_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(fmtNum(t));
  }

  // Off-axis samples break the curve rather than run flat along an edge.
  const inRange = (p: [number, number]) =>
    isFinite(p[1]) &&
    (!y.isLog || p[1] > 0) &&
    (fixedY || y.isLog
      ? p[1] >= yD0 - 1e-9 && p[1] <= yD1 + 1e-9
      : p[1] >= yLo - 1 && p[1] <= yHi + 1);

  // `fill` shades the band between each curve and the y=0 baseline (or the
  // bottom of the scale when 0 is out of range) — parity with line + `fill`
  // (§1.9): 25% palette tint by default, opaque under `fill-solid`. The area
  // is drawn before the curves so the strokes sit on top; `fill-outline` is
  // ignored because hollowing the band would erase the plot.
  if (chart.fill === true) {
    const solid = chart.fillMode === 'solid';
    const areaGen = d3area<[number, number]>()
      .defined(inRange)
      .x((p) => x(p[0]))
      .y0(y(y.baseline))
      .y1((p) => y(p[1]));
    for (const c of curves) {
      svg
        .append('path')
        .attr('class', 'dgmo-series-area')
        .attr('d', areaGen(c.pts) ?? '')
        .attr('fill', solid ? c.color : shapeFill(palette, c.color, isDark))
        .attr('stroke', 'none')
        .attr('data-series-name', c.name);
    }
  }

  const gen = d3line<[number, number]>()
    .defined(inRange)
    .x((p) => x(p[0]))
    .y((p) => y(p[1]));
  for (const c of curves) {
    const path = svg
      .append('path')
      .attr('d', gen(c.pts) ?? '')
      .attr('fill', 'none')
      .attr('stroke', c.color)
      .attr('stroke-width', 1.75)
      .attr('stroke-linejoin', 'round')
      // Legend hover-dim (interactions.ts) keys off data-series-name — the
      // curve name matches its legend entry, so hovering an entry dims the
      // other curves.
      .attr('data-series-name', c.name);
    tagDatum(path, { line: c.line, key: c.name, name: c.name, color: c.color });
  }

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}
