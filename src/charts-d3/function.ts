// ============================================================
// Hand-built function-plot renderer — SPIKE (Tier 3).
// Evaluates each expression over the x-range and draws one line per function.
// ============================================================

import { scaleLinear } from 'd3-scale';
import { axisTickFormat, buildValueAxis, labelledTicks } from './value-axis';
import { line as d3line, area as d3area } from 'd3-shape';
import type { ParsedFunctionChart } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { shapeFill } from '../palettes/color-utils';
import { FONT_FAMILY } from '../fonts';
import { evaluateExpression } from '../utils/expr-eval';
import { tabularText } from '../utils/tabular-figures';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  chartFormatter,
  computeLeftMargin,
  drawXAxisTitle,
  drawYAxisTitle,
  tagDatum,
  cutMark,
  CUT_MARK_GAP,
  CUT_MARK_LEN,
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

  // `y-axis 0..10 log` (decision #60). A log axis plots only the
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

  const yTicks = yAxis([0, 1]).ticks(8);
  // The author's `format` / `unit` / `locale` (#1831), one compact unit for
  // the y axis (#2036).
  const fmt = chartFormatter(chart, yTicks);
  const yTickFmt = axisTickFormat(yAxis([0, 1]), chart.numberFormat, fmt);
  // A run of samples past a fixed y end gets one triangle where the curve
  // leaves the plot (#2119).
  const runs = curves.flatMap((c) =>
    cutRuns(c.pts, ySpec?.min, ySpec?.max).map((r) => ({ ...r, c }))
  );
  const m: Margins = {
    top:
      topInset +
      8 +
      (runs.some((r) => r.dir > 0) ? CUT_MARK_GAP + CUT_MARK_LEN : 0),
    right: 32,
    bottom: 64,
    left: computeLeftMargin(chart.ylabel, yTicks.map(yTickFmt), {
      tabular: true,
    }),
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
  const shownTicks = y.ticks(8);
  const shown = labelledTicks(y, shownTicks, yTickFmt, {
    fontSize: TICK_FONT,
    vertical: true,
  });
  for (const t of shownTicks) {
    const yy = y(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', t === 0 ? 0.6 : 0.2);
    if (shown.has(t))
      svg
        .append('text')
        .attr('class', 'dgmo-tick')
        .attr('x', m.left - 10)
        .attr('y', yy + 4)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(yTickFmt(t), TICK_FONT));
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
      .call(tabularText(fmtNum(t), TICK_FONT));
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
  for (const r of runs)
    cutMark(
      svg,
      x(r.x),
      r.dir > 0 ? m.top : m.top + plotH,
      r.dir,
      false,
      r.c.color,
      r.c.line,
      false
    );

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor
  );
  drawYAxisTitle(svg, chart.ylabel, m.top, plotH, 20, textColor);
}

/**
 * Each contiguous run of samples past `lo` or `hi` (#2119), as the x where
 * the curve crosses that end — where it leaves the plot, or, for a run the
 * curve starts in, where it comes back.
 */
function cutRuns(
  pts: [number, number][],
  lo: number | undefined,
  hi: number | undefined
): { x: number; dir: 1 | -1 }[] {
  const side = (v: number): 0 | 1 | -1 =>
    !isFinite(v)
      ? 0
      : hi !== undefined && v > hi
        ? 1
        : lo !== undefined && v < lo
          ? -1
          : 0;
  const cross = (a: [number, number], b: [number, number], at: number) =>
    a[0] + ((at - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
  const out: { x: number; dir: 1 | -1 }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const dir = side(pts[i]![1]);
    if (!dir || (i > 0 && side(pts[i - 1]![1]) === dir)) continue;
    const bound = (dir > 0 ? hi : lo)!;
    let j = i;
    while (j + 1 < pts.length && side(pts[j + 1]![1]) === dir) j++;
    const prev = pts[i - 1];
    const next = pts[j + 1];
    const x =
      prev && isFinite(prev[1])
        ? cross(prev, pts[i]!, bound)
        : next && isFinite(next[1])
          ? cross(pts[j]!, next, bound)
          : pts[i]![0];
    out.push({ x, dir });
  }
  return out;
}
