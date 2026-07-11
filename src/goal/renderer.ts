// ============================================================
// Goal chart — D3 SVG Renderer
// ============================================================
//
// Three faces off the same `now`/`target` pair:
//   - bar         : horizontal rounded fill (default)
//   - thermometer : vertical rounded tube + bulb
//   - gauge       : semicircular dial with needle + value arc
// Over-target clamps the fill at 100%; the % label stays truthful (§3).

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import {
  mix,
  shapeFill,
  getSeriesColors,
  themeBaseBg,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { compactNumber } from '../treemap/treemap-shared';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedGoal } from './types';

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Displayed magnitudes derived from the parsed value pair. */
interface GoalMetrics {
  pctFrac: number;
  fillFrac: number;
  pctLabel: string;
  valueLabel: string;
  ariaLabel: string;
}

function computeMetrics(parsed: ParsedGoal): GoalMetrics {
  const pctFrac = parsed.hasTarget ? parsed.now / parsed.target : 0;
  const fillFrac = clamp(pctFrac, 0, 1);
  const pctLabel = `${Math.round(pctFrac * 100)}%`;
  const targetLabel = parsed.hasTarget ? compactNumber(parsed.target) : '?';
  const valueLabel = `${compactNumber(parsed.now)} / ${targetLabel}`;
  const ariaTarget = parsed.hasTarget ? parsed.target : '?';
  const ariaLabel = `${parsed.title ?? 'Goal'}: ${parsed.now} of ${ariaTarget} (${Math.round(
    pctFrac * 100
  )}%)`;
  return { pctFrac, fillFrac, pctLabel, valueLabel, ariaLabel };
}

type Svg = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

/** Resolved paint colors for a goal render. */
interface GoalPaint {
  base: string;
  fill: string;
  track: string;
  text: string;
  muted: string;
}

function resolvePaint(
  parsed: ParsedGoal,
  palette: PaletteColors,
  isDark: boolean
): GoalPaint {
  const base =
    (parsed.color && resolveColor(parsed.color, palette)) ||
    parsed.color ||
    getSeriesColors(palette)[0]!;
  return {
    base,
    fill: shapeFill(palette, base, isDark, { solid: parsed.options.solidFill }),
    track: mix(palette.border, themeBaseBg(palette, isDark), 45),
    text: palette.text,
    muted: mix(palette.text, themeBaseBg(palette, isDark), 55),
  };
}

export function renderGoal(
  container: HTMLDivElement,
  parsed: ParsedGoal,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const metrics = computeMetrics(parsed);
  const paint = resolvePaint(parsed, palette, isDark);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('role', 'img')
    .attr('aria-label', metrics.ariaLabel)
    .style('font-family', FONT_FAMILY);

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  const showTitle = !!parsed.title && !parsed.options.noTitle;
  if (showTitle) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', paint.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber)
      .text(parsed.title!);
  }

  const bodyTop = showTitle ? 60 : 20;
  const bodyH = height - bodyTop - 20;
  const bodyCy = bodyTop + bodyH / 2;

  if (parsed.mode === 'thermometer') {
    renderThermometer(svg, parsed, metrics, paint, width, bodyH, bodyCy);
  } else if (parsed.mode === 'gauge') {
    renderGauge(svg, parsed, metrics, paint, width, bodyTop, bodyH, bodyCy);
  } else {
    renderBar(svg, parsed, metrics, paint, width, bodyCy);
  }
}

export function renderGoalForExport(
  container: HTMLDivElement,
  parsed: ParsedGoal,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderGoal(container, parsed, palette, isDark, exportDims);
}

// ── Shared label helpers ─────────────────────────────────────
function pctText(
  svg: Svg,
  parsed: ParsedGoal,
  metrics: GoalMetrics,
  paint: GoalPaint,
  x: number,
  y: number,
  size: number,
  anchor = 'middle'
): void {
  if (parsed.options.noPercent) return;
  svg
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('fill', paint.text)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', size)
    .attr('font-weight', 700)
    .text(metrics.pctLabel);
}

function valueText(
  svg: Svg,
  parsed: ParsedGoal,
  metrics: GoalMetrics,
  paint: GoalPaint,
  x: number,
  y: number,
  size: number,
  anchor = 'middle'
): void {
  if (parsed.options.noValue) return;
  svg
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('fill', paint.muted)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', size)
    .attr('font-weight', 500)
    .text(metrics.valueLabel);
}

// ── Bar face ─────────────────────────────────────────────────
function renderBar(
  svg: Svg,
  parsed: ParsedGoal,
  metrics: GoalMetrics,
  paint: GoalPaint,
  width: number,
  cy: number
): void {
  const trackW = Math.min(width * 0.62, 680);
  const trackH = 46;
  const r = trackH / 2;
  const x = (width - trackW) / 2;
  const y = cy - trackH / 2;

  const g = svg.append('g').attr('class', 'goal-bar');
  g.append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', trackW)
    .attr('height', trackH)
    .attr('rx', r)
    .attr('fill', paint.track);

  const fillW = trackW * metrics.fillFrac;
  if (fillW > 0.5) {
    g.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', fillW)
      .attr('height', trackH)
      .attr('rx', r)
      .attr('fill', paint.fill)
      .attr('stroke', paint.base)
      .attr('stroke-width', 2);
  }

  pctText(svg, parsed, metrics, paint, width / 2, y - 22, 44);
  valueText(svg, parsed, metrics, paint, width / 2, y + trackH + 34, 20);
}

// ── Thermometer face ─────────────────────────────────────────
function renderThermometer(
  svg: Svg,
  parsed: ParsedGoal,
  metrics: GoalMetrics,
  paint: GoalPaint,
  width: number,
  bodyH: number,
  bodyCy: number
): void {
  const tubeW = 62;
  const bulbR = tubeW * 0.78;
  const totalH = Math.min(bodyH - 40, 420);
  const tubeH = totalH - bulbR;
  const cx = width / 2 - 70;
  const tubeTop = bodyCy - totalH / 2;
  const tubeBottom = tubeTop + tubeH;
  const bulbCy = tubeBottom + bulbR * 0.55;
  const r = tubeW / 2;

  const g = svg.append('g').attr('class', 'goal-thermometer');

  // Track: bulb + tube outline.
  g.append('circle')
    .attr('cx', cx)
    .attr('cy', bulbCy)
    .attr('r', bulbR)
    .attr('fill', paint.track);
  g.append('rect')
    .attr('x', cx - r)
    .attr('y', tubeTop)
    .attr('width', tubeW)
    .attr('height', tubeH + r)
    .attr('rx', r)
    .attr('fill', paint.track);

  // Fill: bulb reservoir always full; column rises by fillFrac.
  g.append('circle')
    .attr('cx', cx)
    .attr('cy', bulbCy)
    .attr('r', bulbR - 6)
    .attr('fill', paint.fill)
    .attr('stroke', paint.base)
    .attr('stroke-width', 2);

  const colInnerH = tubeH;
  const fillH = colInnerH * metrics.fillFrac;
  const colX = cx - r + 6;
  const colW = tubeW - 12;
  // Draw the column fill from just above the bulb upward.
  const colBottom = tubeBottom;
  g.append('rect')
    .attr('x', colX)
    .attr('y', colBottom - fillH)
    .attr('width', colW)
    .attr('height', Math.max(0, fillH) + r)
    .attr('rx', colW / 2)
    .attr('fill', paint.fill)
    .attr('stroke', paint.base)
    .attr('stroke-width', 2);

  // Labels to the right of the tube.
  const labelX = cx + bulbR + 40;
  pctText(svg, parsed, metrics, paint, labelX, bodyCy - 6, 52, 'start');
  valueText(svg, parsed, metrics, paint, labelX, bodyCy + 30, 22, 'start');
}

// ── Gauge face ───────────────────────────────────────────────
/** Semicircle arc path from fraction t0 to t1 (0 = left, 1 = right, over the top). */
function arcPath(
  cx: number,
  cy: number,
  r: number,
  t0: number,
  t1: number
): string {
  const a0 = Math.PI - t0 * Math.PI;
  const a1 = Math.PI - t1 * Math.PI;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy - r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy - r * Math.sin(a1);
  const largeArc = Math.abs(t1 - t0) > 0.5 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
}

function renderGauge(
  svg: Svg,
  parsed: ParsedGoal,
  metrics: GoalMetrics,
  paint: GoalPaint,
  width: number,
  bodyTop: number,
  bodyH: number,
  bodyCy: number
): void {
  const r = Math.min(width * 0.3, bodyH * 0.62, 300);
  const cx = width / 2;
  const cy = Math.min(bodyCy + r * 0.4, bodyTop + bodyH - 30);
  const stroke = 36;

  const g = svg.append('g').attr('class', 'goal-gauge');

  g.append('path')
    .attr('d', arcPath(cx, cy, r, 0, 1))
    .attr('fill', 'none')
    .attr('stroke', paint.track)
    .attr('stroke-width', stroke)
    .attr('stroke-linecap', 'round');

  if (metrics.fillFrac > 0.001) {
    g.append('path')
      .attr('d', arcPath(cx, cy, r, 0, metrics.fillFrac))
      .attr('fill', 'none')
      .attr('stroke', paint.fill)
      .attr('stroke-width', stroke)
      .attr('stroke-linecap', 'round');
  }

  // Needle at the fill angle.
  const a = Math.PI - metrics.fillFrac * Math.PI;
  const needleLen = r - stroke / 2 - 6;
  const nx = cx + needleLen * Math.cos(a);
  const ny = cy - needleLen * Math.sin(a);
  g.append('line')
    .attr('x1', cx)
    .attr('y1', cy)
    .attr('x2', nx)
    .attr('y2', ny)
    .attr('stroke', paint.text)
    .attr('stroke-width', 5)
    .attr('stroke-linecap', 'round');
  g.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', 11)
    .attr('fill', paint.text);

  pctText(svg, parsed, metrics, paint, cx, cy - r * 0.32, 52);
  valueText(svg, parsed, metrics, paint, cx, cy + 40, 22);
}
