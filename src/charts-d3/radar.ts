// ============================================================
// Hand-built radar renderer — SPIKE (Tier 2).
// One filled polygon per series over N value-axes; polygon grid rings + spokes.
// Multi-series (§15.1): a `series` block draws one polygon + markers per series,
// colored by series index from the palette, with the shared series legend
// injected by the dispatcher (charts-d3/index.ts). Single-series is unchanged.
// ============================================================

import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import {
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../utils/text-measure';
import { type Svg, fmtNum, tagDatum } from './shared';

const RINGS = 5;

// Axis names (#1764): drawn at the axis tip, capped to the room between the
// tip and the canvas edge — wrapped at word breaks into at most
// LABEL_MAX_LINES, the last line ellipsized. When even that does not fit, the
// radius shrinks (down to RADIUS_FLOOR of its first value) until it does.
const LABEL_FONT = 14;
const LABEL_LINE_H = 17;
const LABEL_MAX_LINES = 3;
const LABEL_GAP = 18;
const LABEL_MARGIN = 8;
const RADIUS_STEP = 4;
const RADIUS_FLOOR = 0.5;

interface AxisLabel {
  lines: string[];
  x: number;
  /** Baseline of the first line. */
  y: number;
  anchor: 'start' | 'middle' | 'end';
  truncated: boolean;
  fits: boolean;
}

/** Lay out one axis name at tip (lx, ly) along direction (c, s). */
function layoutAxisLabel(
  label: string,
  lx: number,
  ly: number,
  c: number,
  s: number,
  width: number,
  height: number,
  topInset: number
): AxisLabel {
  const anchor = Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end';
  const room =
    anchor === 'start'
      ? width - LABEL_MARGIN - lx
      : anchor === 'end'
        ? lx - LABEL_MARGIN
        : 2 * Math.min(lx - LABEL_MARGIN, width - LABEL_MARGIN - lx);
  let lines = [label];
  let truncated = false;
  if (measureText(label, LABEL_FONT) > room) {
    lines = room > 0 ? wrapTextToWidth(label, LABEL_FONT, room) : [label];
    if (lines.length > LABEL_MAX_LINES) {
      const rest = lines.slice(LABEL_MAX_LINES - 1).join(' ');
      lines = [
        ...lines.slice(0, LABEL_MAX_LINES - 1),
        truncateText(rest, LABEL_FONT, room),
      ];
      truncated = true;
    }
  }
  const k = lines.length;
  // Top axes grow upward from the tip, bottom axes downward, side axes centre.
  const y =
    s < -0.3
      ? ly + 4 - (k - 1) * LABEL_LINE_H
      : s > 0.3
        ? ly + 4
        : ly + 4 - ((k - 1) * LABEL_LINE_H) / 2;
  const widest = Math.max(...lines.map((l) => measureText(l, LABEL_FONT)));
  const fits =
    lines.every((l) => l !== '') &&
    widest <= room + 0.5 &&
    y - LABEL_FONT * 0.78 >= topInset &&
    y + (k - 1) * LABEL_LINE_H + LABEL_FONT * 0.22 <= height - LABEL_MARGIN;
  return { lines, x: lx, y, anchor, truncated, fits };
}

/** Value of data point `d` for series index `s` (0 = primary, rest = extraValues). */
function seriesValue(
  d: { value: number; extraValues?: number[] },
  s: number
): number {
  return s === 0 ? d.value : (d.extraValues?.[s - 1] ?? 0);
}

export function renderRadar(
  svg: Svg,
  chart: ParsedChart,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const data = chart.data;
  const n = data.length;
  if (n < 3) return;
  const fillMode = chart.fillMode;
  const solid = fillMode === 'solid';

  const seriesNames = chart.seriesNames?.length
    ? chart.seriesNames
    : [chart.series ?? ''];
  const seriesCount = Math.max(
    1,
    seriesNames.length,
    1 + Math.max(0, ...data.map((d) => d.extraValues?.length ?? 0))
  );
  const multi = seriesCount > 1;

  // Single-series keeps the original palette.primary default (colors[0] is the
  // categorical "red", so switching would regress the single-series look);
  // multi-series colors by series index to match the injected legend.
  const seriesColor = (s: number): string =>
    multi
      ? (chart.seriesNameColors?.[s] ?? colors[s % colors.length]!)
      : (chart.color ?? chart.seriesNameColors?.[0] ?? palette.primary);

  // Max across every series value so all polygons share one scale.
  const allValues: number[] = [];
  for (const d of data)
    for (let s = 0; s < seriesCount; s++) allValues.push(seriesValue(d, s));
  const maxValue = Math.max(...allValues) * 1.15 || 1;

  const cx = width / 2;
  const top = topInset + 8;
  const cy = top + (height - top) / 2;
  const firstRadius = Math.min(width / 2 - 130, (height - top) / 2 - 50);

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number): [number, number] => [
    cx + Math.cos(angle(i)) * r,
    cy + Math.sin(angle(i)) * r,
  ];

  const layoutLabels = (r: number): AxisLabel[] =>
    data.map((d, i) => {
      const [lx, ly] = pt(i, r + LABEL_GAP);
      return layoutAxisLabel(
        d.label,
        lx,
        ly,
        Math.cos(angle(i)),
        Math.sin(angle(i)),
        width,
        height,
        topInset
      );
    });
  let radius = firstRadius;
  let labels = layoutLabels(radius);
  while (
    !labels.every((l) => l.fits) &&
    radius - RADIUS_STEP >= firstRadius * RADIUS_FLOOR
  ) {
    radius -= RADIUS_STEP;
    labels = layoutLabels(radius);
  }

  // grid rings (polygons) + spokes
  for (let l = 1; l <= RINGS; l++) {
    const r = (radius * l) / RINGS;
    const poly = data.map((_, i) => pt(i, r).join(',')).join(' ');
    svg
      .append('polygon')
      .attr('points', poly)
      .attr('fill', 'none')
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.4);
  }
  data.forEach((_, i) => {
    const [x, y] = pt(i, radius);
    svg
      .append('line')
      .attr('x1', cx)
      .attr('y1', cy)
      .attr('x2', x)
      .attr('y2', y)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.4);
    // axis name
    const label = labels[i]!;
    const t = svg
      .append('text')
      .attr('x', label.x)
      .attr('y', label.y)
      .attr('text-anchor', label.anchor)
      .attr('fill', textColor)
      .attr('font-size', LABEL_FONT)
      .attr('font-family', FONT_FAMILY);
    if (label.lines.length === 1) t.text(label.lines[0]!);
    else
      label.lines.forEach((line, j) => {
        const span = t.append('tspan').text(line);
        if (j > 0) span.attr('x', label.x).attr('dy', LABEL_LINE_H);
      });
    if (label.truncated) t.append('title').text(data[i]!.label);
  });

  // one polygon (+ point markers + value labels) per series
  for (let s = 0; s < seriesCount; s++) {
    const color = seriesColor(s);
    const name = seriesNames[s] ?? `Series ${s + 1}`;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-series')
      .attr('data-series-index', s)
      .attr('data-series-name', name)
      .attr('data-color', color);
    const seriesLine = chart.seriesNameLineNumbers?.[s];
    if (seriesLine !== undefined) g.attr('data-line-number', seriesLine);

    const poly = data
      .map((d, i) => pt(i, (seriesValue(d, s) / maxValue) * radius).join(','))
      .join(' ');
    // Multi-series polygons overlap, so they need true alpha (not the opaque
    // shapeFill tint) — otherwise the last series painted hides the rest.
    // Single-series keeps the original opaque tint.
    g.append('polygon')
      .attr('points', poly)
      .attr(
        'fill',
        fillMode === 'outline'
          ? 'none'
          : solid || multi
            ? color
            : shapeFill(palette, color, isDark)
      )
      .attr('fill-opacity', solid ? 0.6 : multi ? 0.2 : 1)
      .attr('stroke', color)
      .attr('stroke-width', 2);

    data.forEach((d, i) => {
      const v = seriesValue(d, s);
      const [x, y] = pt(i, (v / maxValue) * radius);
      const vtx = g
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 4)
        .attr('fill', color);
      tagDatum(vtx, {
        line: d.lineNumber,
        key: multi ? `${name} ${d.label}` : d.label,
        name: multi ? `${name} — ${d.label}` : d.label,
        value: fmtNum(v),
        color,
      });
      if (!chart.noValue) {
        // Place the value label just past the dot, along the spoke away from
        // center, so each number reads outward from its vertex.
        const [lx, ly] = pt(i, (v / maxValue) * radius + 14);
        const c = Math.cos(angle(i));
        const s = Math.sin(angle(i));
        g.append('text')
          .attr('x', lx)
          .attr('y', ly + (s < -0.3 ? 0 : s > 0.3 ? 11 : 4))
          .attr(
            'text-anchor',
            Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end'
          )
          .attr('fill', multi ? color : textColor)
          .attr('font-size', 12)
          .attr('font-family', FONT_FAMILY)
          .text(fmtNum(v));
      }
    });
  }
}
