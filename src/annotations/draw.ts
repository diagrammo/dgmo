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
    const el = label.node();
    if (el)
      bandLabels.set(el, {
        s,
        e,
        frame,
        w: measureText(b.label, ANNOTATION_FONT),
      });
    boxes.push(labelBox(b.label, { x, y, anchor }, ANNOTATION_FONT));
  }
  return boxes;
}

/** A band label's band, for settling it once the data is drawn. */
const bandLabels = new WeakMap<
  Element,
  { s: number; e: number; frame: ValueAxisFrame; w: number }
>();

/** The boxes of the marks drawn after `el` in its parent: the data. */
function marksAfter(el: Element): { shapes: LabelRect[]; texts: LabelRect[] } {
  const shapes: LabelRect[] = [];
  const texts: LabelRect[] = [];
  const num = (n: Element, a: string) => Number(n.getAttribute(a) ?? 0);
  for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
    const all = [sib, ...Array.from(sib.querySelectorAll('rect, text'))];
    for (const n of all) {
      const tag = n.tagName.toLowerCase();
      if (tag === 'rect')
        shapes.push({
          x: num(n, 'x'),
          y: num(n, 'y'),
          w: num(n, 'width'),
          h: num(n, 'height'),
        });
      else if (tag === 'text' && n.textContent) {
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
  return { shapes, texts };
}

/**
 * Moves a band's label to the first spot inside the band that no bar or
 * value label covers, then lifts it over them (#2078). Tried along the
 * band's top edge from the far end, then along its bottom edge. A thin band
 * may have no such spot: then the first one clear of text, over a bar, with
 * its halo; failing that it stays at the far end of the top edge.
 */
function settleBandLabel(el: Element): void {
  const info = bandLabels.get(el);
  const parent = el.parentNode;
  if (!parent) return;
  if (info) {
    const { s, e, frame, w } = info;
    const { shapes, texts } = marksAfter(el);
    const h = ANNOTATION_FONT;
    const hits = (marks: readonly LabelRect[]) => (r: LabelRect) =>
      marks.some(
        (m) =>
          r.x < m.x + m.w + 2 &&
          m.x < r.x + r.w + 2 &&
          r.y < m.y + m.h + 2 &&
          m.y < r.y + r.h + 2
      );
    const spots: LabelRect[] = [];
    if (frame.horizontal) {
      const x = s + LABEL_GAP;
      for (
        let y = frame.top + LABEL_GAP;
        y + h <= frame.top + frame.height;
        y += 4
      )
        spots.push({ x, y, w, h });
    } else {
      const rows = [s + LABEL_GAP / 2, e - h - LABEL_GAP / 2];
      for (const y of rows)
        for (
          let x = frame.left + frame.width - w;
          x >= frame.left + LABEL_GAP;
          x -= 4
        )
          spots.push({ x, y, w, h });
    }
    const fits = (r: LabelRect) =>
      frame.horizontal ? r.x + r.w <= e : r.y + r.h <= e;
    const onText = hits(texts);
    const onShape = hits(shapes);
    // Clear of everything first; else clear of text, over a bar, haloed.
    const spot =
      spots.find((r) => fits(r) && !onText(r) && !onShape(r)) ??
      spots.find((r) => fits(r) && !onText(r));
    if (spot) {
      el.setAttribute('x', String(spot.x));
      el.setAttribute('y', String(spot.y + h * 0.82));
      el.setAttribute('text-anchor', 'start');
    }
  }
  parent.appendChild(el);
}

/** Draws every `marker`; returns the label boxes other labels must clear. */
export function drawMarkers(
  svg: Svg,
  annotations: readonly ChartAnnotation[] | undefined,
  frame: ValueAxisFrame,
  colors: AnnotationColors
): LabelRect[] {
  // Band labels go over the data drawn since drawBands (#2078).
  const root = svg.node()?.ownerSVGElement ?? svg.node();
  if (root)
    root
      .querySelectorAll(`.${BAND_LABEL_CLASS}`)
      .forEach((el) => settleBandLabel(el));
  // Other annotation text drawn before the data (an era's title) is lifted
  // over it as it stands.
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
