// ============================================================
// Hand-built function-plot renderer — SPIKE (Tier 3).
// Evaluates each expression over the x-range and draws one line per function.
// ============================================================

import { scaleLinear } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import type { ParsedFunctionChart } from '../echarts';
import { FONT_FAMILY } from '../fonts';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  drawXAxisTitle,
  drawYAxisTitle,
  tagDatum,
} from './shared';

const SAMPLES = 200;

/** Mirror of echarts.ts evaluateExpression (kept local for spike isolation). */
function evaluateExpression(expr: string, x: number): number {
  try {
    const processed = expr
      .replace(/\bpi\b/gi, String(Math.PI))
      .replace(/\be\b/g, String(Math.E))
      .replace(/\bsin\s*\(/gi, 'Math.sin(')
      .replace(/\bcos\s*\(/gi, 'Math.cos(')
      .replace(/\btan\s*\(/gi, 'Math.tan(')
      .replace(/\bln\s*\(/gi, 'Math.log(')
      .replace(/\blog\s*\(/gi, 'Math.log10(')
      .replace(/\bexp\s*\(/gi, 'Math.exp(')
      .replace(/\bsqrt\s*\(/gi, 'Math.sqrt(')
      .replace(/\babs\s*\(/gi, 'Math.abs(')
      .replace(/\bx\b/gi, `(${x})`)
      .replace(/\^/g, '**');
    const result = new Function(`return ${processed}`)() as unknown;
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

export function renderFunction(
  svg: Svg,
  chart: ParsedFunctionChart,
  width: number,
  height: number,
  colors: string[],
  textColor: string,
  mutedColor: string,
  topInset: number
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
    pts: xs.map((x) => [x, evaluateExpression(fn.expression, x)] as [number, number]),
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

  const m: Margins = { top: topInset + 8, right: 32, bottom: 64, left: 72 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const x = scaleLinear().domain([xr.min, xr.max]).range([m.left, m.left + plotW]);
  const y = scaleLinear().domain([yLo, yHi]).nice().range([m.top + plotH, m.top]);

  // gridlines + ticks
  for (const t of y.ticks(8)) {
    const yy = y(t);
    svg.append('line').attr('x1', m.left).attr('x2', m.left + plotW).attr('y1', yy).attr('y2', yy)
      .attr('stroke', mutedColor).attr('stroke-opacity', t === 0 ? 0.6 : 0.2);
    svg.append('text').attr('x', m.left - 10).attr('y', yy + 4).attr('text-anchor', 'end')
      .attr('fill', textColor).attr('font-size', TICK_FONT).attr('font-family', FONT_FAMILY).text(fmtNum(t));
  }
  for (const t of x.ticks(10)) {
    const xx = x(t);
    svg.append('line').attr('x1', xx).attr('x2', xx).attr('y1', m.top).attr('y2', m.top + plotH)
      .attr('stroke', mutedColor).attr('stroke-opacity', t === 0 ? 0.6 : 0.2);
    svg.append('text').attr('x', xx).attr('y', m.top + plotH + 18).attr('text-anchor', 'middle')
      .attr('fill', textColor).attr('font-size', TICK_FONT).attr('font-family', FONT_FAMILY).text(fmtNum(t));
  }

  const gen = d3line<[number, number]>()
    .defined((p) => isFinite(p[1]) && p[1] >= yLo - 1 && p[1] <= yHi + 1)
    .x((p) => x(p[0]))
    .y((p) => y(p[1]));
  for (const c of curves) {
    const path = svg.append('path').attr('d', gen(c.pts) ?? '').attr('fill', 'none')
      .attr('stroke', c.color).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round');
    tagDatum(path, { line: c.line, key: c.name, name: c.name, color: c.color });
  }

  drawXAxisTitle(svg, chart.xlabel, m.left + plotW / 2, m.top + plotH + 46, textColor);
  drawYAxisTitle(svg, chart.ylabel, m.top + plotH / 2, 20, textColor);
}
