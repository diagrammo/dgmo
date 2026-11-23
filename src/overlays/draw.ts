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
  type LabelPlacement,
  type LabelRect,
  type PointCircle,
} from '../label-layout';
import {
  LEADER_COST,
  LEADER_DISTANCES,
  boxFor,
  nearestOnBox,
  overlayPlacement,
  pickSpot,
  type Anchor,
  type Bounds,
  type Spot,
} from './place';
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
/** What a label must keep clear of an extremes dot: the dot and its ring. */
export const EXTREME_DOT_R = EXTREME_R + 1;

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
  /** The series it belongs to; hovering that series lights it (#2216). */
  readonly series?: string;
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
  /** Points along the label's line, best first, where it may sit instead
   *  of the end (#2217). The end is always tried first. */
  readonly along?: readonly (readonly [number, number])[];
  /** The series it belongs to (#2216). */
  readonly series?: string;
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
      .attr('data-line-number', l.lineNumber)
      .attr('data-series-name', l.series ?? null);
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
      ...(l.series && { series: l.series }),
      text: l.label,
      // A vertical line (horizontal bars) is labelled at its top.
      x: x2,
      y: frame.horizontal ? y1 : y2,
      color: l.color,
      lineNumber: l.lineNumber,
      kind: l.kind,
      ...(!frame.horizontal && {
        along: [0.75, 0.5, 0.25, 0].map(
          (f) => [x1 + (x2 - x1) * f, y2] as const
        ),
      }),
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
    Partial<Pick<ValueAxisFrame, 'height' | 'left' | 'width'>>,
  bg: string,
  avoid: readonly PointCircle[] = [],
  /** Shared with the extremes (#2217), so neither prints over the other. */
  placement?: LabelPlacement
): LabelRect[] {
  if (!frame.horizontal)
    return drawPlacedOverlayLabels(svg, labels, frame, bg, avoid, placement);
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
      .attr('data-series-name', p.l.series ?? null)
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

/** The overlay kinds whose label can drop its series name (#2217). */
const SHORTENS: ReadonlySet<OverlayKind> = new Set(['mean', 'median']);

/** "Apple sensor mean 72.9" → "mean 72.9": the legend names the series. */
function shortForm(l: OverlayLabel): string | null {
  if (!SHORTENS.has(l.kind)) return null;
  const at = l.text.indexOf(` ${l.kind} `);
  return at > 0 ? l.text.slice(at + 1) : null;
}

/** Every spot a label on a horizontal line (or a path) could take. */
function lineSpots(
  l: OverlayLabel,
  text: string,
  h: number,
  costBase: number
): Spot[] {
  const w = measureText(text, ANNOTATION_FONT, { bold: true });
  const spots: Spot[] = [];
  const at = (x: number, y: number, anchor: Anchor, cost: number) => {
    const above = y - LABEL_GAP - h;
    const below = y + LABEL_GAP;
    for (const [top, extra] of [
      [above, 0],
      [below, 0.5],
    ] as const)
      spots.push({
        x,
        baseline: top + ANNOTATION_FONT,
        anchor,
        rect: boxFor(x, top, w, h, anchor),
        cost: costBase + cost + extra,
      });
  };
  // Hugging the line: its right end, then along it toward the left.
  at(l.x, l.y, 'end', 0);
  (l.along ?? []).forEach(([x, y], i) =>
    at(x, y, i === (l.along?.length ?? 0) - 1 ? 'start' : 'middle', 1 + i)
  );
  // Off the line, joined by a leader: from the end, then along it.
  const roots: (readonly [number, number])[] = [[l.x, l.y], ...(l.along ?? [])];
  roots.forEach(([rx, ry], i) => {
    for (const d of LEADER_DISTANCES)
      for (const dir of [-1, 1]) {
        const top = dir < 0 ? ry - d - h : ry + d;
        for (const anchor of ['end', 'middle', 'start'] as const) {
          const rect = boxFor(rx, top, w, h, anchor);
          const [tx, ty] = nearestOnBox(rect, rx, ry);
          spots.push({
            x: rx,
            baseline: top + ANNOTATION_FONT,
            anchor,
            rect,
            leader: [rx, ry, tx, ty],
            cost: costBase + LEADER_COST + d / 4 + i * 2 + (dir > 0 ? 1 : 0),
          });
        }
      }
  });
  return spots;
}

function drawLabelText(
  svg: Svg,
  cls: string,
  lineNumber: number,
  spot: Spot,
  text: string,
  color: string,
  bg: string,
  series?: string
): void {
  if (spot.leader) {
    const [x1, y1, x2, y2] = spot.leader;
    svg
      .append('line')
      .attr('class', 'dgmo-overlay-leader')
      .attr('data-line-number', lineNumber)
      .attr('data-series-name', series ?? null)
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', color)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.7);
  }
  svg
    .append('text')
    .attr('class', cls)
    .attr('data-line-number', lineNumber)
    .attr('data-series-name', series ?? null)
    .attr('x', spot.x)
    .attr('y', spot.baseline)
    .attr('text-anchor', spot.anchor)
    .attr('fill', color)
    .attr('font-size', ANNOTATION_FONT)
    .attr('font-weight', 600)
    .attr('font-family', FONT_FAMILY)
    .attr('stroke', bg)
    .attr('stroke-width', 3)
    .attr('stroke-linejoin', 'round')
    .attr('paint-order', 'stroke')
    .text(text);
}

/**
 * Labels on horizontal overlay lines and on trend / moving-average paths
 * (#2217): each takes the best clear spot hugging its line, sliding along it
 * to open space, else a spot off it with a leader; then the same for its
 * short form; with none it is not drawn. Returns the drawn boxes.
 */
function drawPlacedOverlayLabels(
  svg: Svg,
  labels: readonly OverlayLabel[],
  frame: Pick<ValueAxisFrame, 'top'> &
    Partial<Pick<ValueAxisFrame, 'height' | 'left' | 'width'>>,
  bg: string,
  avoid: readonly PointCircle[],
  shared?: LabelPlacement
): LabelRect[] {
  const h = ANNOTATION_FONT + 2;
  const placement = shared ?? overlayPlacement({ markers: avoid });
  const bounds: Bounds = {
    left: frame.left ?? -Infinity,
    top: frame.top,
    right:
      frame.left !== undefined && frame.width !== undefined
        ? frame.left + frame.width
        : Infinity,
    bottom: frame.height === undefined ? Infinity : frame.top + frame.height,
  };
  // Without a shared placement the avoid marks are already its markers;
  // with one, they are checked here on top of its own.
  const hitsAvoid = (r: LabelRect) =>
    shared !== undefined && avoid.some((m) => rectCircleOverlap(r, m));
  const boxes: LabelRect[] = [];
  for (const l of [...labels].sort((a, b) => a.y - b.y)) {
    const short = shortForm(l);
    const spots = [
      ...lineSpots(l, l.text, h, 0),
      ...(short ? lineSpots(l, short, h, 1000) : []),
    ].filter((sp) => !hitsAvoid(sp.rect));
    const spot = pickSpot(placement, spots, bounds);
    if (!spot) continue;
    const text = spot.cost >= 1000 ? short! : l.text;
    placement.commit(spot.rect, spot.leader);
    boxes.push(spot.rect);
    drawLabelText(
      svg,
      `dgmo-overlay-label dgmo-overlay-${l.kind}-label`,
      l.lineNumber,
      spot,
      text,
      l.color,
      bg,
      l.series
    );
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
        ...(s.name && { series: s.name }),
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
  /** The series it belongs to (#2216). */
  readonly series?: string;
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
      .attr('data-line-number', path.lineNumber)
      .attr('data-series-name', path.series ?? null);
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
    const step = Math.max(1, Math.floor(pts.length / 4));
    labels.push({
      ...(path.series && { series: path.series }),
      text: path.label,
      x,
      y,
      color: path.color,
      lineNumber: path.lineNumber,
      kind: path.kind,
      along: pts
        .slice(0, -1)
        .filter((_, k) => k % step === 0)
        .reverse()
        .map(([px, py]) => [px, py] as const),
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
      ...(s.name && { series: s.name }),
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
        ...(s.name && { series: s.name }),
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
  /** The series it belongs to (#2216). */
  readonly series?: string;
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
 * Draws `extremes` (#1954): a filled dot on each mark and its value beside
 * it — above a high, below a low — placed like every overlay label (#2217):
 * hugging the dot, else off it with a leader, else not drawn. On by default
 * for a line (#2213). Returns the label boxes and the marks that got one.
 */
export function drawExtremes(
  svg: Svg,
  marks: readonly ExtremeMark[],
  plot: Bounds,
  bg: string,
  shared?: LabelPlacement
): { boxes: LabelRect[]; labelled: Set<ExtremeMark> } {
  const boxes: LabelRect[] = [];
  const labelled = new Set<ExtremeMark>();
  const h = ANNOTATION_FONT + 2;
  const placement =
    shared ??
    overlayPlacement({
      markers: marks.map((m) => ({ cx: m.x, cy: m.y, r: EXTREME_DOT_R })),
    });
  for (const m of marks) {
    const g = svg
      .append('g')
      .attr('class', `dgmo-overlay dgmo-overlay-extremes`)
      .attr('data-line-number', m.lineNumber)
      .attr('data-series-name', m.series ?? null)
      // The dot sits on the data point it marks; hover and click must reach
      // that point and its series group underneath (#2227).
      .attr('pointer-events', 'none');
    g.append('circle')
      .attr('class', m.high ? 'dgmo-extreme-high' : 'dgmo-extreme-low')
      .attr('cx', m.x)
      .attr('cy', m.y)
      .attr('r', EXTREME_R)
      .attr('fill', m.fill)
      .attr('stroke', bg)
      .attr('stroke-width', 2);
  }
  for (const m of marks) {
    const w = measureText(m.text, ANNOTATION_FONT, { bold: true });
    const gap = EXTREME_R + LABEL_GAP;
    const sides = m.high ? [-1, 1] : [1, -1];
    const spots: Spot[] = [];
    sides.forEach((dir, si) => {
      const top = dir < 0 ? m.y - gap - h : m.y + gap;
      (['middle', 'start', 'end'] as const).forEach((anchor, ai) => {
        const x =
          anchor === 'start'
            ? m.x - EXTREME_R
            : anchor === 'end'
              ? m.x + EXTREME_R
              : m.x;
        spots.push({
          x,
          baseline: top + ANNOTATION_FONT,
          anchor,
          rect: boxFor(x, top, w, h, anchor),
          cost: si * 10 + ai,
        });
      });
      for (const d of LEADER_DISTANCES)
        for (const [dx, anchor] of [
          [d * 0.6, 'start'],
          [-d * 0.6, 'end'],
          [0, 'middle'],
        ] as const) {
          const top = dir < 0 ? m.y - d - h : m.y + d;
          const x = m.x + dx;
          const rect = boxFor(x, top, w, h, anchor);
          const [tx, ty] = nearestOnBox(rect, m.x, m.y);
          const len = Math.hypot(tx - m.x, ty - m.y) || 1;
          spots.push({
            x,
            baseline: top + ANNOTATION_FONT,
            anchor,
            rect,
            leader: [
              m.x + ((tx - m.x) / len) * (EXTREME_R + 1),
              m.y + ((ty - m.y) / len) * (EXTREME_R + 1),
              tx,
              ty,
            ],
            cost: LEADER_COST + d / 4 + si * 10,
          });
        }
    });
    const spot = pickSpot(placement, spots, plot);
    if (!spot) continue;
    placement.commit(spot.rect, spot.leader);
    boxes.push(spot.rect);
    labelled.add(m);
    drawLabelText(
      svg,
      'dgmo-overlay-label dgmo-overlay-extremes-label',
      m.lineNumber,
      spot,
      m.text,
      m.color,
      bg,
      m.series
    );
  }
  return { boxes, labelled };
}
