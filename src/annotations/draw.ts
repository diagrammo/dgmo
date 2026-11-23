// ============================================================
// Chart annotations — drawing on a value axis (#1832, #2039)
// ============================================================
//
// Bands go down first, behind gridlines and data. Markers go on top of the
// data, with their label haloed so it reads over bars and lines.

import type { Svg } from '../charts-d3/shared';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import { labelBox } from '../utils/place-labels';
import { measureText } from '../utils/text-measure';
import type { LabelRect } from '../label-layout';
import type {
  AnnotationAxis,
  ChartAnnotation,
  ChartBand,
  ChartMarker,
} from './types';

/** Annotation label size: a step under the tick labels, so it reads as chart furniture. */
export const ANNOTATION_FONT = 11;
/** Gap between a mark and its label. */
const LABEL_GAP = 4;
/** Annotation text drawn under the data that drawMarkers lifts over it. */
export const LIFT_CLASS = 'dgmo-annotation-lift';
/** A band's label, lifted over the data by drawMarkers. */
const BAND_LABEL_CLASS = 'dgmo-annotation-band-label';
/** How far into the background a band's color is mixed. */
const BAND_TINT = 14;

/** Where the plot sits and how the value axis maps onto it. */
export interface ValueAxisFrame {
  /** Value → pixel along the value axis. */
  readonly pos: (v: number) => number;
  /** The axis's value range. A fixed `y-axis` range clamps `pos`, so a
   *  mark outside this range is not drawn rather than pinned to the edge. */
  readonly domain: readonly [number, number];
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** True when values run along x (horizontal bars). */
  readonly horizontal: boolean;
  /** Cross-axis position → pixel (category centre, or scatter x); undefined
   *  when the position is not on the axis. Absent: no cross markers. */
  readonly crossPos?: (at: number | string) => number | undefined;
  /** The value axis a band sits on when the chart has two (a dual-axis
   *  line's `left`); only marks drawn against it can fall inside it. */
  readonly side?: string | undefined;
}

/** A shaded span that lights the data marks inside it on hover (#2098). */
export const REGION_CLASS = 'dgmo-region';

/** Tags `el` as a hoverable region over [lo, hi] pixels along `axis`
 *  ('x' across, 'y' down), in the plot's own coordinate space. The
 *  interaction adapter reads these attributes, never the band's meaning. */
export function tagRegion(
  el: Element | null,
  axis: 'x' | 'y',
  lo: number,
  hi: number,
  side?: string
): void {
  if (!el) return;
  el.classList.add(REGION_CLASS);
  el.setAttribute('data-region-axis', axis);
  el.setAttribute('data-region-lo', String(Math.min(lo, hi)));
  el.setAttribute('data-region-hi', String(Math.max(lo, hi)));
  if (side) el.setAttribute('data-region-side', side);
}

export interface AnnotationColors {
  readonly text: string;
  readonly muted: string;
  readonly bg: string;
}

/** The part of [a, b] on the axis, as pixels; null when none of it is. */
function span(
  frame: ValueAxisFrame,
  a: number,
  b: number
): [number, number] | null {
  const [d0, d1] = frame.domain;
  const lo = Math.max(Math.min(a, b), Math.min(d0, d1));
  const hi = Math.min(Math.max(a, b), Math.max(d0, d1));
  if (!(hi > lo)) return null;
  const pa = frame.pos(lo);
  const pb = frame.pos(hi);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return null;
  return [Math.min(pa, pb), Math.max(pa, pb)];
}

/** True when `v` lies on the axis. */
function onAxis(frame: ValueAxisFrame, v: number): boolean {
  const [d0, d1] = frame.domain;
  return v >= Math.min(d0, d1) && v <= Math.max(d0, d1);
}

/** Draws every `band`; returns the label boxes other labels must clear. */
export function drawBands(
  svg: Svg,
  annotations: readonly ChartAnnotation[] | undefined,
  frame: ValueAxisFrame,
  colors: AnnotationColors,
  axis: AnnotationAxis = 'value'
): LabelRect[] {
  const boxes: LabelRect[] = [];
  const bands = (annotations ?? []).filter(
    (a): a is ChartBand => a.kind === 'band' && a.axis === axis
  );
  for (const b of bands) {
    const sp = span(frame, b.from, b.to);
    if (!sp) continue;
    const [s, e] = sp;
    const tint = b.color ?? colors.muted;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-annotation-band')
      .attr('data-line-number', b.lineNumber);
    tagRegion(g.node(), frame.horizontal ? 'x' : 'y', s, e, frame.side);
    if (frame.horizontal) {
      g.append('rect')
        .attr('x', s)
        .attr('y', frame.top)
        .attr('width', e - s)
        .attr('height', frame.height)
        .attr('fill', mix(tint, colors.bg, BAND_TINT));
    } else {
      g.append('rect')
        .attr('x', frame.left)
        .attr('y', s)
        .attr('width', frame.width)
        .attr('height', e - s)
        .attr('fill', mix(tint, colors.bg, BAND_TINT));
    }
    if (!b.label) continue;
    // The label sits inside the band's top edge at the plot's far end, where
    // a marker's label sits too (#2078). The band is behind the data, but its
    // label is not: drawMarkers raises it over the bars, haloed, so a bar
    // that crosses the band never hides it.
    const x = frame.horizontal ? s + LABEL_GAP : frame.left + frame.width;
    const y = frame.horizontal
      ? frame.top + ANNOTATION_FONT + LABEL_GAP
      : s + ANNOTATION_FONT + LABEL_GAP / 2;
    const anchor = frame.horizontal ? 'start' : 'end';
    const label = svg
      .append('text')
      .attr('class', BAND_LABEL_CLASS)
      .attr('data-line-number', b.lineNumber)
      .attr('x', x)
      .attr('y', y)
      .attr('text-anchor', anchor)
      .attr('fill', b.color ? mix(b.color, colors.text, 75) : colors.text)
      .attr('font-size', ANNOTATION_FONT)
      .attr('font-weight', 600)
      .attr('font-family', FONT_FAMILY)
      .attr('stroke', colors.bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .text(b.label);
    const box = labelBox(b.label, { x, y, anchor }, ANNOTATION_FONT);
    const el = label.node();
    tagRegion(el, frame.horizontal ? 'x' : 'y', s, e, frame.side);
    if (el)
      bandLabels.set(el, {
        s,
        e,
        frame,
        w: measureText(b.label, ANNOTATION_FONT),
        box,
      });
    boxes.push(box);
  }
  return boxes;
}

/** A band label's band, for settling it once the data is drawn. `box` is
 *  the box drawBands returned: settling moves it too, so labels placed
 *  later clear the label where it ends up. */
const bandLabels = new WeakMap<
  Element,
  {
    s: number;
    e: number;
    frame: ValueAxisFrame;
    w: number;
    box: LabelRect;
  }
>();

type Segment = readonly [number, number, number, number];

/** The marks drawn after `el` in its parent: the data and its labels. */
interface MarksAfter {
  /** Bars, and points as their square. */
  shapes: LabelRect[];
  /** Line strokes, as straight runs. */
  segments: Segment[];
  texts: LabelRect[];
}

/** True when a fill or stroke value paints something. */
function paints(v: string | null): boolean {
  return v !== null && v !== 'none' && v !== 'transparent';
}

/** True when `n` draws nothing: a hit target or a hidden hover mark. */
function invisible(n: Element): boolean {
  return n.getAttribute('opacity') === '0';
}

/** A path's outline as straight runs; curves are flattened. */
export function pathSegments(d: string): Segment[] {
  const out: Segment[] = [];
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) return out;
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const num = () => Number(tokens[i++]);
  const to = (x: number, y: number) => {
    out.push([cx, cy, x, y]);
    cx = x;
    cy = y;
  };
  const curve = (pts: readonly [number, number][]) => {
    // Bézier through the current point and `pts`, in eight straight runs.
    const all: [number, number][] = [[cx, cy], ...pts];
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      let row = all;
      while (row.length > 1)
        row = row
          .slice(1)
          .map((p, j) => [
            row[j]![0] + (p[0] - row[j]![0]) * t,
            row[j]![1] + (p[1] - row[j]![1]) * t,
          ]);
      to(row[0]![0], row[0]![1]);
    }
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        cx = ox + num();
        cy = oy + num();
        sx = cx;
        sy = cy;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L':
      case 'T':
        to(ox + num(), oy + num());
        break;
      case 'H':
        to(ox + num(), cy);
        break;
      case 'V':
        to(cx, oy + num());
        break;
      case 'C': {
        const p1: [number, number] = [ox + num(), oy + num()];
        const p2: [number, number] = [ox + num(), oy + num()];
        curve([p1, p2, [ox + num(), oy + num()]]);
        break;
      }
      case 'S':
      case 'Q': {
        const p1: [number, number] = [ox + num(), oy + num()];
        curve([p1, [ox + num(), oy + num()]]);
        break;
      }
      case 'A': {
        i += 5;
        to(ox + num(), oy + num());
        break;
      }
      case 'Z':
        to(sx, sy);
        break;
      default:
        i++;
    }
  }
  return out.filter((sg) => sg.every(Number.isFinite));
}

/** True when the segment crosses or lies in `r` (Liang–Barsky clip). */
function segmentHits(sg: Segment, r: LabelRect): boolean {
  const [x0, y0, x1, y1] = sg;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, x0 - r.x],
    [dx, r.x + r.w - x0],
    [-dy, y0 - r.y],
    [dy, r.y + r.h - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function marksAfter(el: Element): MarksAfter {
  const shapes: LabelRect[] = [];
  const segments: Segment[] = [];
  const texts: LabelRect[] = [];
  const num = (n: Element, a: string) => Number(n.getAttribute(a) ?? 0);
  for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
    const all = [
      sib,
      ...Array.from(sib.querySelectorAll('rect, circle, path, text')),
    ];
    for (const n of all) {
      const tag = n.tagName.toLowerCase();
      if (invisible(n)) continue;
      // A fill left unset paints black; a stroke left unset paints nothing.
      const filled =
        n.getAttribute('fill') === null || paints(n.getAttribute('fill'));
      const stroked = paints(n.getAttribute('stroke'));
      if (tag === 'rect') {
        // The transparent plot rect a crosshair reads is not a mark.
        if (filled || stroked)
          shapes.push({
            x: num(n, 'x'),
            y: num(n, 'y'),
            w: num(n, 'width'),
            h: num(n, 'height'),
          });
      } else if (tag === 'circle') {
        const r = num(n, 'r');
        if (r > 0 && (filled || stroked))
          shapes.push({
            x: num(n, 'cx') - r,
            y: num(n, 'cy') - r,
            w: 2 * r,
            h: 2 * r,
          });
      } else if (tag === 'path') {
        // A stroked line: a series, a slope, a trend. A fill alone (an
        // area, a series band) is ground the label may sit on, like the band.
        if (stroked && !n.closest('.tick') && !n.classList.contains('domain'))
          segments.push(...pathSegments(n.getAttribute('d') ?? ''));
      } else if (tag === 'text' && n.textContent) {
        const size = num(n, 'font-size') || 12;
        const anchor = (n.getAttribute('text-anchor') ?? 'start') as
          | 'start'
          | 'middle'
          | 'end';
        texts.push(
          labelBox(
            n.textContent,
            { x: num(n, 'x'), y: num(n, 'y'), anchor },
            size
          )
        );
      }
    }
  }
  return { shapes, segments, texts };
}

/** Clearance kept between a band label and a mark. */
const CLEAR = 2;

/** The spots a label of width `w` may take inside the visible band [s, e]:
 *  its top and bottom rows from the far end, then the rows between them. A
 *  band across the plot (horizontal bars) gives columns instead. */
function bandSpots(
  s: number,
  e: number,
  frame: ValueAxisFrame,
  w: number
): LabelRect[] {
  const h = ANNOTATION_FONT;
  const spots: LabelRect[] = [];
  const lanes = (first: number, last: number) => {
    const out = [first];
    if (last > first) out.push(last);
    for (let v = first + 4; v < last; v += 4) out.push(v);
    return out;
  };
  if (frame.horizontal) {
    for (const x of lanes(s + LABEL_GAP, e - w - LABEL_GAP))
      for (
        let y = frame.top + LABEL_GAP;
        y + h <= frame.top + frame.height;
        y += 4
      )
        spots.push({ x, y, w, h });
  } else {
    for (const y of lanes(s + LABEL_GAP / 2, e - h - LABEL_GAP / 2))
      for (
        let x = frame.left + frame.width - w;
        x >= frame.left + LABEL_GAP;
        x -= 4
      )
        spots.push({ x, y, w, h });
  }
  // Every spot lies inside the band's visible part, whatever the band's
  // off-axis edge (#2137).
  return spots.filter((r) =>
    frame.horizontal ? r.x >= s && r.x + r.w <= e : r.y >= s && r.y + r.h <= e
  );
}

/**
 * Moves a band's label to the first spot inside the band's visible part that
 * no mark drawn after it covers — bar, point, line, value or series label,
 * marker label — then lifts it over them (#2078, #2137). A thin or crowded
 * band may have no such spot: then the first clear of text and points (over
 * a bar or line, haloed), then the first clear of text; failing that it
 * stays at the far end of the top edge.
 */
function settleBandLabel(el: Element): void {
  const info = bandLabels.get(el);
  const parent = el.parentNode;
  if (!parent) return;
  if (info) {
    const { s, e, frame, w, box } = info;
    const { shapes, segments, texts } = marksAfter(el);
    const near = (r: LabelRect): LabelRect => ({
      x: r.x - CLEAR,
      y: r.y - CLEAR,
      w: r.w + 2 * CLEAR,
      h: r.h + 2 * CLEAR,
    });
    const overlaps = (a: LabelRect, b: LabelRect) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const onText = (r: LabelRect) => texts.some((m) => overlaps(near(r), m));
    const onShape = (r: LabelRect) => shapes.some((m) => overlaps(near(r), m));
    const onLine = (r: LabelRect) =>
      segments.some((sg) => segmentHits(sg, near(r)));
    const spots = bandSpots(s, e, frame, w);
    const spot =
      spots.find((r) => !onText(r) && !onShape(r) && !onLine(r)) ??
      spots.find((r) => !onText(r) && !onShape(r)) ??
      spots.find((r) => !onText(r));
    if (spot) {
      el.setAttribute('x', String(spot.x));
      el.setAttribute('y', String(spot.y + ANNOTATION_FONT * 0.82));
      el.setAttribute('text-anchor', 'start');
      Object.assign(box, { x: spot.x, y: spot.y, w, h: ANNOTATION_FONT });
    }
  }
  parent.appendChild(el);
}

/**
 * Settles every band label under `svg` against the marks drawn since
 * drawBands, and lifts it over them. A renderer calls it once its points,
 * lines, bars and their fixed labels are drawn, and before it places labels
 * that clear the band boxes (point values, notes): those then clear the
 * settled label.
 */
export function settleBandLabels(svg: Svg): void {
  const root = svg.node()?.ownerSVGElement ?? svg.node();
  if (root)
    root
      .querySelectorAll(`.${BAND_LABEL_CLASS}`)
      .forEach((el) => settleBandLabel(el));
}

/** Half the width of the strip a marker line blocks for a note's text. */
const MARKER_LINE_HALF = 1;

/** Draws every `marker`; returns the label boxes other labels must clear.
 *  `lines`, when given, also receives each drawn line as a thin rect: a
 *  note's text must not cross one, though its leader may (#2134). */
export function drawMarkers(
  svg: Svg,
  annotations: readonly ChartAnnotation[] | undefined,
  frame: ValueAxisFrame,
  colors: AnnotationColors,
  lines?: LabelRect[]
): LabelRect[] {
  // Annotation text drawn before the data (an era's title) is lifted over it
  // as it stands. Band labels wait for settleBandLabels.
  const root = svg.node()?.ownerSVGElement ?? svg.node();
  const host = svg.node();
  if (root && host)
    root.querySelectorAll(`.${LIFT_CLASS}`).forEach((el) => {
      if (host.contains(el)) host.appendChild(el);
    });
  const boxes: LabelRect[] = [];
  const markers = (annotations ?? []).filter(
    (a): a is ChartMarker => a.kind === 'marker'
  );
  for (const r of markers) {
    let p: number | undefined;
    if (r.axis === 'value') {
      if (typeof r.at !== 'number' || !onAxis(frame, r.at)) continue;
      p = frame.pos(r.at);
    } else p = frame.crossPos?.(r.at);
    if (p === undefined || !Number.isFinite(p)) continue;
    // A value marker runs across the plot; a cross marker runs along it.
    const vertical = r.axis === 'value' ? frame.horizontal : !frame.horizontal;
    const stroke = r.color ?? colors.text;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-annotation-marker')
      .attr('data-line-number', r.lineNumber);
    g.append('line')
      .attr('x1', vertical ? p : frame.left)
      .attr('x2', vertical ? p : frame.left + frame.width)
      .attr('y1', vertical ? frame.top : p)
      .attr('y2', vertical ? frame.top + frame.height : p)
      .attr('stroke', stroke)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5 4');
    lines?.push(
      vertical
        ? {
            x: p - MARKER_LINE_HALF,
            y: frame.top,
            w: 2 * MARKER_LINE_HALF,
            h: frame.height,
          }
        : {
            x: frame.left,
            y: p - MARKER_LINE_HALF,
            w: frame.width,
            h: 2 * MARKER_LINE_HALF,
          }
    );
    if (!r.label) continue;
    // A horizontal line: label at its right end, just above — below it when
    // the line sits at the plot's top. A vertical line: label at its top,
    // just right of it — left of it when that would leave the plot.
    const w = measureText(r.label, ANNOTATION_FONT);
    const flip = vertical
      ? p + LABEL_GAP + w > frame.left + frame.width
      : p - LABEL_GAP - ANNOTATION_FONT < frame.top;
    const x = vertical
      ? flip
        ? p - LABEL_GAP
        : p + LABEL_GAP
      : frame.left + frame.width;
    const y = vertical
      ? frame.top + ANNOTATION_FONT
      : flip
        ? p + LABEL_GAP + ANNOTATION_FONT
        : p - LABEL_GAP;
    const anchor = vertical && !flip ? 'start' : 'end';
    g.append('text')
      .attr('x', x)
      .attr('y', y)
      .attr('text-anchor', anchor)
      .attr('fill', stroke)
      .attr('font-size', ANNOTATION_FONT)
      .attr('font-weight', 600)
      .attr('font-family', FONT_FAMILY)
      .attr('stroke', colors.bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke')
      .text(r.label);
    boxes.push(labelBox(r.label, { x, y, anchor }, ANNOTATION_FONT));
  }
  return boxes;
}
