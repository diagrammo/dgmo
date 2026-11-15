// ============================================================
// Chart annotations — drawing on a value axis (#1832)
// ============================================================
//
// Bands go down first, behind gridlines and data. Reference lines go on top
// of the data, with their label haloed so it reads over bars and lines.

import type { Svg } from '../charts-d3/shared';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import { labelBox } from '../utils/place-labels';
import { measureText } from '../utils/text-measure';
import type { LabelRect } from '../label-layout';
import type { ChartAnnotation, ChartBand, ChartRefLine } from './types';

/** Annotation label size: a step under the tick labels, so it reads as chart furniture. */
export const ANNOTATION_FONT = 11;
/** Gap between a mark and its label. */
const LABEL_GAP = 4;
/** How far into the background a band's color is mixed. */
const BAND_TINT = 14;

/** Where the plot sits and how the value axis maps onto it. */
export interface ValueAxisFrame {
  /** Value → pixel along the value axis. */
  readonly pos: (v: number) => number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** True when values run along x (horizontal bars). */
  readonly horizontal: boolean;
}

export interface AnnotationColors {
  readonly text: string;
  readonly muted: string;
  readonly bg: string;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Pixel span of [a, b] on the axis, cut to the plot; null when off it. */
function span(
  frame: ValueAxisFrame,
  a: number,
  b: number
): [number, number] | null {
  const pa = frame.pos(a);
  const pb = frame.pos(b);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return null;
  const [lo, hi] = frame.horizontal
    ? [frame.left, frame.left + frame.width]
    : [frame.top, frame.top + frame.height];
  const s = clamp(Math.min(pa, pb), lo, hi);
  const e = clamp(Math.max(pa, pb), lo, hi);
  return e > s || pa === pb ? [s, e] : null;
}

/** Draws every `band`; returns the label boxes other labels must clear. */
export function drawBands(
  svg: Svg,
  annotations: readonly ChartAnnotation[] | undefined,
  frame: ValueAxisFrame,
  colors: AnnotationColors
): LabelRect[] {
  const boxes: LabelRect[] = [];
  const bands = (annotations ?? []).filter(
    (a): a is ChartBand => a.kind === 'band'
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
    // The label sits inside the band's top-left corner.
    const x = frame.horizontal ? s + LABEL_GAP : frame.left + LABEL_GAP;
    const y = frame.horizontal
      ? frame.top + ANNOTATION_FONT + LABEL_GAP
      : s + ANNOTATION_FONT + LABEL_GAP / 2;
    g.append('text')
      .attr('x', x)
      .attr('y', y)
      .attr('text-anchor', 'start')
      .attr('fill', b.color ?? colors.text)
      .attr('fill-opacity', 0.8)
      .attr('font-size', ANNOTATION_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(b.label);
    boxes.push(labelBox(b.label, { x, y, anchor: 'start' }, ANNOTATION_FONT));
  }
  return boxes;
}

/** Draws every `ref-line`; returns the label boxes other labels must clear. */
export function drawRefLines(
  svg: Svg,
  annotations: readonly ChartAnnotation[] | undefined,
  frame: ValueAxisFrame,
  colors: AnnotationColors
): LabelRect[] {
  const boxes: LabelRect[] = [];
  const lines = (annotations ?? []).filter(
    (a): a is ChartRefLine => a.kind === 'ref-line'
  );
  for (const r of lines) {
    const p = frame.pos(r.value);
    if (!Number.isFinite(p)) continue;
    const [lo, hi] = frame.horizontal
      ? [frame.left, frame.left + frame.width]
      : [frame.top, frame.top + frame.height];
    if (p < lo - 0.5 || p > hi + 0.5) continue;
    const stroke = r.color ?? colors.text;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-annotation-ref-line')
      .attr('data-line-number', r.lineNumber);
    g.append('line')
      .attr('x1', frame.horizontal ? p : frame.left)
      .attr('x2', frame.horizontal ? p : frame.left + frame.width)
      .attr('y1', frame.horizontal ? frame.top : p)
      .attr('y2', frame.horizontal ? frame.top + frame.height : p)
      .attr('stroke', stroke)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5 4');
    if (!r.label) continue;
    // Vertical plot: right end, just above the line — below it when the
    // line sits at the plot's top. Horizontal bars: top end, just right of
    // the line — left of it when that would leave the plot.
    const w = measureText(r.label, ANNOTATION_FONT);
    const flip = frame.horizontal
      ? p + LABEL_GAP + w > frame.left + frame.width
      : p - LABEL_GAP - ANNOTATION_FONT < frame.top;
    const x = frame.horizontal
      ? flip
        ? p - LABEL_GAP
        : p + LABEL_GAP
      : frame.left + frame.width;
    const y = frame.horizontal
      ? frame.top + ANNOTATION_FONT
      : flip
        ? p + LABEL_GAP + ANNOTATION_FONT
        : p - LABEL_GAP;
    const anchor = frame.horizontal && !flip ? 'start' : 'end';
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
