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
import type { LabelRect } from '../label-layout';
import { measureText } from '../utils/text-measure';
import { GRID_DASH, HAIRLINE_DASH } from '../utils/visual-conventions';
import { mean, median, roundStat } from './compute';
import type { ChartOverlay, OverlayKind } from './types';

/** Gap between a line and its label. */
const LABEL_GAP = 4;
/** An overlay line's stroke; a target is drawn heavier. */
const OVERLAY_STROKE = 1.5;
const TARGET_STROKE = 2;

/** Dash pattern per overlay; absent = solid. */
const DASH: Partial<Record<OverlayKind, string>> = {
  mean: GRID_DASH,
  median: HAIRLINE_DASH,
  target: GRID_DASH,
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
 * the labels to draw once the series are down.
 */
export function drawOverlayLevels(
  svg: Svg,
  levels: readonly OverlayLevel[],
  frame: ValueAxisFrame
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
 * top. Labels that would touch are pushed apart. Returns their boxes, which
 * point values must clear.
 */
export function drawOverlayLabels(
  svg: Svg,
  labels: readonly OverlayLabel[],
  frame: Pick<ValueAxisFrame, 'top' | 'horizontal'>,
  bg: string
): LabelRect[] {
  const h = ANNOTATION_FONT + 2;
  const placed = labels.map((l) => {
    const w = measureText(l.text, ANNOTATION_FONT, { bold: true });
    return frame.horizontal
      ? { l, w, x: l.x + LABEL_GAP, top: l.y, anchor: 'start' as const }
      : {
          l,
          w,
          x: l.x,
          // Above the line, or below it when that would leave the plot.
          top:
            l.y - LABEL_GAP - h < frame.top
              ? l.y + LABEL_GAP
              : l.y - LABEL_GAP - h,
          anchor: 'end' as const,
        };
  });
  // Push apart: walk top to bottom, each label at least one line under the
  // last one it overlaps sideways.
  const order = placed
    .map((_, i) => i)
    .sort((a, b) => placed[a]!.top - placed[b]!.top);
  const done: { x0: number; x1: number; bottom: number }[] = [];
  for (const i of order) {
    const p = placed[i]!;
    const x0 = p.anchor === 'end' ? p.x - p.w : p.x;
    const x1 = x0 + p.w;
    for (const d of done)
      if (x0 < d.x1 && d.x0 < x1 && p.top < d.bottom) p.top = d.bottom;
    done.push({ x0, x1, bottom: p.top + h });
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
