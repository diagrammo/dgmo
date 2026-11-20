// ============================================================
// Statistics overlays — drawing (#1954)
// ============================================================
//
// Lines go down behind the series, right after the gridlines. Labels go on
// top, haloed, at the right end of their line in the line's colour, and are
// nudged apart so no two print over each other. No legend entry.

import type { Svg } from '../charts-d3/shared';
import { ANNOTATION_FONT, type ValueAxisFrame } from '../annotations/draw';
import { FONT_FAMILY } from '../fonts';
import {
  rectCircleOverlap,
  type LabelRect,
  type PointCircle,
} from '../label-layout';
import { sampleLines } from '../annotations/notes';
import { measureText } from '../utils/text-measure';
import {
  EDGE_DASH,
  GRID_DASH,
  HAIRLINE_DASH,
} from '../utils/visual-conventions';
import {
  extremes,
  linearFit,
  mean,
  median,
  movingAverage,
  roundStat,
} from './compute';
import type { ChartOverlay, OverlayKind } from './types';

/** Gap between a line and its label. */
const LABEL_GAP = 4;
/** An overlay line's stroke; a target is drawn heavier. */
const OVERLAY_STROKE = 1.5;
const TARGET_STROKE = 2;
/** A moving average is drawn heavier than the raw series it smooths. */
const AVERAGE_STROKE = 3;
/** The raw series under a moving average, drawn thinner. */
export const RAW_UNDER_AVERAGE_STROKE = 1.25;
/** An `extremes` marker: a filled dot with a ground-coloured ring. */
const EXTREME_R = 5.5;

/** Dash pattern per overlay; absent = solid. */
const DASH: Partial<Record<OverlayKind, string>> = {
  mean: GRID_DASH,
  median: HAIRLINE_DASH,
  target: GRID_DASH,
  trend: EDGE_DASH,
};

/** A horizontal (value-axis) overlay line, before it is placed. */
export interface OverlayLevel {
  readonly kind: OverlayKind;
  readonly value: number;
  readonly label: string;
  readonly color: string;
  readonly lineNumber: number;
}

/** An overlay label ready to draw: its line's right end and its paint. */
export interface OverlayLabel {
  readonly text: string;
  /** The end of the line the label belongs to. */
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly lineNumber: number;
  readonly kind: OverlayKind;
}

/** True when `v` lies on the frame's value axis. */
function onAxis(frame: ValueAxisFrame, v: number): boolean {
  const [d0, d1] = frame.domain;
  return Number.isFinite(v) && v >= Math.min(d0, d1) && v <= Math.max(d0, d1);
}

/**
 * Draws each level as a line across the plot, behind the series. Returns
 * the labels to draw once the series are down. `trace`, when given, gets
 * points sampled along each line, so labels drawn later can clear it (#2106).
 */
export function drawOverlayLevels(
  svg: Svg,
  levels: readonly OverlayLevel[],
  frame: ValueAxisFrame,
  trace?: PointCircle[]
): OverlayLabel[] {
  const labels: OverlayLabel[] = [];
  for (const l of levels) {
    if (!onAxis(frame, l.value)) continue;
    const p = frame.pos(l.value);
    if (!Number.isFinite(p)) continue;
    const g = svg
      .append('g')
      .attr('class', `dgmo-overlay dgmo-overlay-${l.kind}`)
      .attr('data-line-number', l.lineNumber);
    const x1 = frame.horizontal ? p : frame.left;
    const x2 = frame.horizontal ? p : frame.left + frame.width;
    const y1 = frame.horizontal ? frame.top : p;
    const y2 = frame.horizontal ? frame.top + frame.height : p;
    const line = g
      .append('line')
      .attr('x1', x1)
      .attr('x2', x2)
      .attr('y1', y1)
      .attr('y2', y2)
      .attr('stroke', l.color)
      .attr(
        'stroke-width',
        l.kind === 'target' ? TARGET_STROKE : OVERLAY_STROKE
      );
    const dash = DASH[l.kind];
    if (dash) line.attr('stroke-dasharray', dash);
    trace?.push(
      ...sampleLines([
        [
          [x1, y1],
          [x2, y2],
        ],
      ])
    );
    labels.push({
      text: l.label,
      // A vertical line (horizontal bars) is labelled at its top.
      x: x2,
      y: frame.horizontal ? y1 : y2,
      color: l.color,
      lineNumber: l.lineNumber,
      kind: l.kind,
    });
  }
  return labels;
}

/**
 * Draws overlay labels. A label on a horizontal line sits just above its
 * right end, inside the plot; one on a vertical line sits just right of its
 * top. A label that would touch another label, or one of the `avoid` marks
 * (the series' points and lines, the other overlay lines — #2106), tries
 * the other side of its line, then steps farther off it; when every spot
 * is taken, labels are pushed apart as before. Returns their boxes, which
 * point values must clear.
 */
export function drawOverlayLabels(
  svg: Svg,
  labels: readonly OverlayLabel[],
  frame: Pick<ValueAxisFrame, 'top' | 'horizontal'> &
    Partial<Pick<ValueAxisFrame, 'height'>>,
  bg: string,
  avoid: readonly PointCircle[] = []
): LabelRect[] {
  const h = ANNOTATION_FONT + 2;
  const bottom =
    frame.height === undefined ? Infinity : frame.top + frame.height;
  const placed = labels.map((l) => {
    const w = measureText(l.text, ANNOTATION_FONT, { bold: true });
    if (frame.horizontal)
      return {
        l,
        w,
        x: l.x + LABEL_GAP,
        top: l.y,
        tops: [l.y],
        anchor: 'start' as const,
      };
    const above = l.y - LABEL_GAP - h;
    const below = l.y + LABEL_GAP;
    // Above the line, or below it when that would leave the plot; then the
    // other side, then a label height farther off each side.
    const sides = above < frame.top ? [below, above] : [above, below];
    const tops = [
      ...sides,
      above - h / 2,
      below + h / 2,
      above - h,
      below + h,
    ].filter((t) => t >= frame.top && t + h <= bottom);
    return { l, w, x: l.x, top: sides[0]!, tops, anchor: 'end' as const };
  });
  // Walk top to bottom. A label takes its first clear spot; with none, it
  // goes at least one line under the last label it overlaps sideways.
  const order = placed
    .map((_, i) => i)
    .sort((a, b) => placed[a]!.top - placed[b]!.top);
  const done: { x0: number; x1: number; top: number; bottom: number }[] = [];
  for (const i of order) {
    const p = placed[i]!;
    const x0 = p.anchor === 'end' ? p.x - p.w : p.x;
    const x1 = x0 + p.w;
    const clear = (top: number): boolean =>
      !done.some(
        (d) => x0 < d.x1 && d.x0 < x1 && top < d.bottom && d.top < top + h
      ) &&
      !avoid.some((m) => rectCircleOverlap({ x: x0, y: top, w: p.w, h }, m));
    const spot = p.tops.find(clear);
    if (spot !== undefined) p.top = spot;
    else
      for (const d of done)
        if (x0 < d.x1 && d.x0 < x1 && p.top < d.bottom) p.top = d.bottom;
    done.push({ x0, x1, top: p.top, bottom: p.top + h });
  }
  const boxes: LabelRect[] = [];
  for (const p of placed) {
    const y = p.top + ANNOTATION_FONT;
    svg
      .append('text')
      .attr('class', `dgmo-overlay-label dgmo-overlay-${p.l.kind}-label`)
      .attr('data-line-number', p.l.lineNumber)
      .attr('x', p.x)
      .attr('y', y)
      .attr('text-anchor', p.anchor)
      .attr('fill', p.l.color)
      .attr('font-size', ANNOTATION_FONT)
      .attr('font-weight', 600)
      .attr('font-family', FONT_FAMILY)
      .attr('stroke', bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .text(p.l.text);
    const x0 = p.anchor === 'end' ? p.x - p.w : p.x;
    boxes.push({ x: x0, y: p.top, w: p.w, h });
  }
  return boxes;
}

/** One drawn series, as the overlays see it. */
export interface OverlaySeries {
  /** Shown before the overlay name when the chart has several series. */
  readonly name?: string;
  readonly values: readonly number[];
  readonly color: string;
}

/**
 * The horizontal lines for `mean`, `median` and `target`: one mean and one
 * median per series, in its colour, and one target line for the chart.
 */
export function overlayLevels(
  overlays: readonly ChartOverlay[] | undefined,
  series: readonly OverlaySeries[],
  fmt: (v: number) => string,
  targetColor: string
): OverlayLevel[] {
  const out: OverlayLevel[] = [];
  for (const o of overlays ?? []) {
    if (o.kind === 'target') {
      out.push({
        kind: o.kind,
        value: o.value!,
        label: `target ${fmt(o.value!)}`,
        color: targetColor,
        lineNumber: o.lineNumber,
      });
      continue;
    }
    if (o.kind !== 'mean' && o.kind !== 'median') continue;
    for (const s of series) {
      const v = o.kind === 'mean' ? mean(s.values) : median(s.values);
      if (!Number.isFinite(v)) continue;
      out.push({
        kind: o.kind,
        value: v,
        label: `${s.name ? `${s.name} ` : ''}${o.kind} ${fmt(roundStat(v))}`,
        color: s.color,
        lineNumber: o.lineNumber,
      });
    }
  }
  return out;
}

/** The `target` overlay, when the chart has one. */
export function targetOf(
  overlays: readonly ChartOverlay[] | undefined
): ChartOverlay | undefined {
  return overlays?.find((o) => o.kind === 'target');
}

/** A computed overlay line through the plot: a trend, or a smoothed copy. */
export interface OverlayPath {
  readonly kind: OverlayKind;
  /** Vertices: `at` is the pixel on the cross axis, `v` the value. */
  readonly points: readonly { readonly at: number; readonly v: number }[];
  readonly label: string;
  readonly color: string;
  readonly lineNumber: number;
  /** Stroke width; absent = the overlay default. */
  readonly width?: number;
}

/**
 * The part of a polyline whose values lie on the axis, cut where it leaves.
 * A fitted line can run past the data at its ends; it stops at the plot edge.
 */
export function clipToDomain(
  points: readonly { at: number; v: number }[],
  domain: readonly [number, number]
): { at: number; v: number }[] {
  const lo = Math.min(domain[0], domain[1]);
  const hi = Math.max(domain[0], domain[1]);
  const out: { at: number; v: number }[] = [];
  const push = (p: { at: number; v: number }) => {
    const last = out.at(-1);
    if (last?.at !== p.at || last.v !== p.v) out.push(p);
  };
  if (points.length === 1) {
    const p = points[0]!;
    return p.v >= lo && p.v <= hi ? [{ ...p }] : [];
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    let t0 = 0;
    let t1 = 1;
    if (a.v === b.v) {
      if (a.v < lo || a.v > hi) continue;
    } else {
      const tl = (lo - a.v) / (b.v - a.v);
      const th = (hi - a.v) / (b.v - a.v);
      t0 = Math.max(0, Math.min(tl, th));
      t1 = Math.min(1, Math.max(tl, th));
      if (t0 > t1) continue;
    }
    const at = (t: number) => ({
      at: a.at + t * (b.at - a.at),
      v: a.v + t * (b.v - a.v),
    });
    push(at(t0));
    push(at(t1));
  }
  return out;
}

/**
 * Draws each path behind the series. Returns the labels for their far ends.
 * `trace`, when given, gets points sampled along each path (#2106).
 */
export function drawOverlayPaths(
  svg: Svg,
  paths: readonly OverlayPath[],
  frame: ValueAxisFrame,
  trace?: PointCircle[]
): OverlayLabel[] {
  const labels: OverlayLabel[] = [];
  for (const path of paths) {
    const pts = clipToDomain(path.points, frame.domain).map(({ at, v }) => {
      const p = frame.pos(v);
      return frame.horizontal ? ([p, at] as const) : ([at, p] as const);
    });
    if (pts.length < 2) continue;
    const g = svg
      .append('g')
      .attr('class', `dgmo-overlay dgmo-overlay-${path.kind}`)
      .attr('data-line-number', path.lineNumber);
    const line = g
      .append('path')
      .attr('d', pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x},${y}`).join(''))
      .attr('fill', 'none')
      .attr('stroke', path.color)
      .attr('stroke-width', path.width ?? OVERLAY_STROKE)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');
    const dash = DASH[path.kind];
    if (dash) line.attr('stroke-dasharray', dash);
    trace?.push(
      ...sampleLines([pts.map(([x, y]) => [x, y] as [number, number])])
    );
    if (!path.label) continue;
    const [x, y] = pts.at(-1)!;
    labels.push({
      text: path.label,
      x,
      y,
      color: path.color,
      lineNumber: path.lineNumber,
      kind: path.kind,
    });
  }
  return labels;
}

/** The unit in a trend's slope label: the x-axis label when it is one word. */
export function trendUnit(xlabel: string | undefined): string {
  const word = xlabel?.trim() ?? '';
  return /^[\p{L}]+$/u.test(word) ? word.toLowerCase() : 'step';
}

/** `+1.68` / `-0.5`: a slope with its sign, rounded like every overlay. */
function signed(v: number, fmt: (v: number) => string): string {
  const r = roundStat(v);
  return `${r > 0 ? '+' : ''}${fmt(r)}`;
}

/**
 * `trend` on a line or bar (#1954): a least-squares line per series over
 * its rows, x being the row's position. Labelled with its slope per x step.
 */
export function trendPaths(
  overlays: readonly ChartOverlay[] | undefined,
  series: readonly OverlaySeries[],
  cross: (i: number) => number,
  fmt: (v: number) => string,
  unit: string
): OverlayPath[] {
  const trend = overlays?.find((o) => o.kind === 'trend');
  if (!trend) return [];
  const out: OverlayPath[] = [];
  for (const s of series) {
    const fit = linearFit(
      s.values.map((_, i) => i),
      s.values
    );
    if (!fit) continue;
    const rows = s.values
      .map((v, i) => (Number.isFinite(v) ? i : -1))
      .filter((i) => i >= 0);
    const first = rows[0]!;
    const last = rows.at(-1)!;
    const points = [];
    for (let i = first; i <= last; i++)
      points.push({ at: cross(i), v: fit.intercept + fit.slope * i });
    out.push({
      kind: 'trend',
      points,
      label: `${s.name ? `${s.name} ` : ''}trend ${signed(fit.slope, fmt)}/${unit}`,
      color: s.color,
      lineNumber: trend.lineNumber,
    });
  }
  return out;
}

/**
 * `moving-average N` on a line (#1954): each series' trailing N-point
 * average, in the series' colour, drawn heavier than the raw line.
 */
export function movingAveragePaths(
  overlays: readonly ChartOverlay[] | undefined,
  series: readonly OverlaySeries[],
  cross: (i: number) => number,
  unit: string
): OverlayPath[] {
  const ma = overlays?.find((o) => o.kind === 'moving-average');
  if (!ma) return [];
  const n = ma.value!;
  const span = unit === 'step' ? 'pt' : unit;
  return series.flatMap((s) => {
    const avg = movingAverage(s.values, n);
    const points = avg.flatMap((v, i) =>
      Number.isFinite(v) ? [{ at: cross(i), v }] : []
    );
    if (points.length < 2) return [];
    return [
      {
        kind: 'moving-average' as const,
        points,
        label: `${s.name ? `${s.name} ` : ''}${n}-${span} avg`,
        color: s.color,
        lineNumber: ma.lineNumber,
        width: AVERAGE_STROKE,
      },
    ];
  });
}

/** One `extremes` mark: a series' highest or lowest point. */
export interface ExtremeMark {
  readonly x: number;
  readonly y: number;
  readonly high: boolean;
  readonly text: string;
  /** The dot's fill: the series' colour. */
  readonly fill: string;
  /** The label's colour. */
  readonly color: string;
  readonly lineNumber: number;
}

/** The rows each series marks: `series:row` keys, for value labels to skip. */
export function extremeRows(
  series: readonly { readonly s: number; readonly values: readonly number[] }[]
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const { s, values } of series) {
    const e = extremes(values);
    if (!e) continue;
    out.set(`${s}:${e.high}`, true);
    if (e.low !== e.high) out.set(`${s}:${e.low}`, false);
  }
  return out;
}

/**
 * Draws `extremes` (#1954): a filled dot on each mark, `peak` labelled above
 * it and `low` below, kept inside the plot. Returns the label boxes.
 */
export function drawExtremes(
  svg: Svg,
  marks: readonly ExtremeMark[],
  plot: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
  bg: string
): LabelRect[] {
  const boxes: LabelRect[] = [];
  const h = ANNOTATION_FONT + 2;
  for (const m of marks) {
    const g = svg
      .append('g')
      .attr('class', `dgmo-overlay dgmo-overlay-extremes`)
      .attr('data-line-number', m.lineNumber);
    g.append('circle')
      .attr('class', m.high ? 'dgmo-extreme-high' : 'dgmo-extreme-low')
      .attr('cx', m.x)
      .attr('cy', m.y)
      .attr('r', EXTREME_R)
      .attr('fill', m.fill)
      .attr('stroke', bg)
      .attr('stroke-width', 2);
    const w = measureText(m.text, ANNOTATION_FONT, { bold: true });
    const gap = EXTREME_R + LABEL_GAP;
    const above = m.y - gap - h;
    const below = m.y + gap;
    let top = m.high ? above : below;
    if (top < plot.top) top = below;
    if (top + h > plot.bottom) top = above;
    const anchor =
      m.x - w / 2 < plot.left
        ? 'start'
        : m.x + w / 2 > plot.right
          ? 'end'
          : 'middle';
    const x =
      anchor === 'start'
        ? m.x - EXTREME_R
        : anchor === 'end'
          ? m.x + EXTREME_R
          : m.x;
    const y = top + ANNOTATION_FONT;
    g.append('text')
      .attr('class', 'dgmo-overlay-label dgmo-overlay-extremes-label')
      .attr('x', x)
      .attr('y', y)
      .attr('text-anchor', anchor)
      .attr('fill', m.color)
      .attr('font-size', ANNOTATION_FONT)
      .attr('font-weight', 600)
      .attr('font-family', FONT_FAMILY)
      .attr('stroke', bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .text(m.text);
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    boxes.push({ x: x0, y: top, w, h });
  }
  return boxes;
}
