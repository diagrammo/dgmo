// ============================================================
// Hand-built radar renderer — SPIKE (Tier 2).
// One filled polygon per series over N value-axes; polygon grid rings + spokes.
// Multi-series (§15.1): a `series` block draws one polygon + markers per series,
// colored by series index from the palette, with the shared series legend
// injected by the dispatcher (charts-d3/index.ts). Single-series is unchanged.
// ============================================================

import type * as d3Selection from 'd3-selection';
import type { ParsedChart } from '../chart';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill } from '../palettes/color-utils';
import {
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../utils/text-measure';
import { labelBox, placeLabels, type LabelSpot } from '../utils/place-labels';
import type { LabelRect } from '../label-layout';
import { type Svg, fmtNum, tagDatum } from './shared';

const RINGS = 5;

// Axis names (#1764): drawn at the axis tip, capped to the room between the
// tip and the canvas edge — wrapped at word breaks into at most
// LABEL_MAX_LINES, the last line ellipsized. When even that does not fit, the
// radius shrinks (down to RADIUS_FLOOR of its first value) until it does.
const LABEL_FONT = 14;
const SCALE_FONT = 10;
const LABEL_LINE_H = 17;
const LABEL_MAX_LINES = 3;
const LABEL_GAP = 18;
const LABEL_MARGIN = 8;
const RADIUS_STEP = 4;
const RADIUS_FLOOR = 0.5;

// Vertex values (#1828): every series' values are placed together, clear of
// each other, the axis names, the ring scale and every vertex dot. A value
// tries past its dot along the spoke, then inside it, then beside, above and
// below; one with no clear spot is dropped — smallest first — and keeps its
// value on the vertex's hover.
const VALUE_FONT = 12;
const VALUE_GAP = 14;
const VALUE_SIDE_GAP = 8;
const VERTEX_R = 4;

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

  // The ring scale's numbers, laid out first so the vertex values clear them.
  // Along the ray midway between spokes 0 and 1 (the ring edge's midpoint),
  // so the numbers never sit under a vertex value label.
  const ringLabels = Array.from({ length: RINGS }, (_, k) => {
    const r = (radius * (k + 1)) / RINGS;
    const mid = angle(0) + Math.PI / n;
    const rm = r * Math.cos(Math.PI / n);
    return {
      x: cx + Math.cos(mid) * rm + 3,
      y: cy + Math.sin(mid) * rm - 2,
      text: fmtNum(Number(((maxValue * (k + 1)) / RINGS).toPrecision(2))),
    };
  });
  // In a small view the rings sit closer than a number is tall: keep the
  // outermost number and each one inward that clears the last kept.
  const scaleLabels: typeof ringLabels = [];
  let lastBox: LabelRect | null = null;
  for (const l of [...ringLabels].reverse()) {
    const box = labelBox(
      l.text,
      { x: l.x, y: l.y, anchor: 'start' },
      SCALE_FONT
    );
    if (
      lastBox &&
      box.x < lastBox.x + lastBox.w &&
      lastBox.x < box.x + box.w &&
      box.y < lastBox.y + lastBox.h &&
      lastBox.y < box.y + box.h
    )
      continue;
    scaleLabels.unshift(l);
    lastBox = box;
  }
  const reserved: LabelRect[] = [
    ...labels.flatMap((label) =>
      label.lines.map((line, j) =>
        labelBox(
          line,
          { x: label.x, y: label.y + j * LABEL_LINE_H, anchor: label.anchor },
          LABEL_FONT
        )
      )
    ),
    ...scaleLabels.map((l) =>
      labelBox(l.text, { x: l.x, y: l.y, anchor: 'start' }, SCALE_FONT)
    ),
  ];
  const values: {
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>;
    vtx: SVGCircleElement;
    text: string;
    v: number;
    x: number;
    y: number;
    spots: LabelSpot[];
    color: string;
  }[] = [];

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
        .attr('r', VERTEX_R)
        .attr('fill', color);
      tagDatum(vtx, {
        line: d.lineNumber,
        key: multi ? `${name} ${d.label}` : d.label,
        name: multi ? `${name} — ${d.label}` : d.label,
        value: fmtNum(v),
        color,
      });
      if (!chart.noValue) {
        const r = (v / maxValue) * radius;
        const c = Math.cos(angle(i));
        const sn = Math.sin(angle(i));
        // Past the dot along the spoke, reading outward from its vertex.
        const [ox, oy] = pt(i, r + VALUE_GAP);
        // Inside the dot, reading inward: the anchor and baseline mirror.
        const [ix, iy] = pt(i, Math.max(0, r - VALUE_GAP));
        const vy = y + VALUE_FONT * 0.3;
        values.push({
          g,
          vtx: vtx.node()!,
          text: fmtNum(v),
          v,
          x,
          y,
          color: multi ? color : textColor,
          spots: [
            {
              x: ox,
              y: oy + (sn < -0.3 ? 0 : sn > 0.3 ? 11 : 4),
              anchor: Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end',
            },
            {
              x: ix,
              y: iy + (sn < -0.3 ? 11 : sn > 0.3 ? 0 : 4),
              anchor: Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'end' : 'start',
            },
            { x: x + VALUE_SIDE_GAP, y: vy, anchor: 'start' },
            { x: x - VALUE_SIDE_GAP, y: vy, anchor: 'end' },
            { x, y: y - VALUE_SIDE_GAP - 2, anchor: 'middle' },
            {
              x,
              y: y + VALUE_SIDE_GAP + VALUE_FONT * 0.8,
              anchor: 'middle',
            },
          ],
        });
      }
    });
  }

  const placed = placeLabels(
    values.map((l) => ({
      text: l.text,
      priority: Math.abs(l.v),
      spots: l.spots,
    })),
    {
      fontSize: VALUE_FONT,
      reserved,
      markers: values.map((l) => ({ cx: l.x, cy: l.y, r: VERTEX_R + 1 })),
      bounds: { left: 0, top: topInset, right: width, bottom: height },
    }
  );
  values.forEach((l, k) => {
    const spot = placed[k]!.spot;
    if (!spot) return;
    // Right after its own dot, so the drawing order is the one a vertex
    // value has always had.
    l.g
      .insert('text', () => l.vtx.nextSibling as Element | null)
      .attr('x', spot.x)
      .attr('y', spot.y)
      .attr('text-anchor', spot.anchor)
      .attr('fill', l.color)
      .attr('font-size', VALUE_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(l.text);
  });

  // scale labels: ring values along one ray, drawn over the series
  for (const l of scaleLabels) {
    svg
      .append('text')
      .attr('class', 'dgmo-radar-scale')
      .attr('x', l.x)
      .attr('y', l.y)
      .attr('text-anchor', 'start')
      .attr('fill', textColor)
      .attr('fill-opacity', 0.6)
      .attr('font-size', SCALE_FONT)
      .attr('font-family', FONT_FAMILY)
      .attr('stroke', palette.bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .text(l.text);
  }
}
