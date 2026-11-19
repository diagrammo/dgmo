// ============================================================
// Chart annotations — drawing `note` on a data chart (#2039)
// ============================================================
//
// A ring on the datum and the note's text in empty plot space, joined by a
// leader line. Each note tries spots around its datum that touch no placed
// text, no data mark, no reference line and nothing outside the plot, and of
// the clear ones takes the roomiest: open space beats a gap between lines,
// with nearness and direction only breaking ties (#2134). The leader may
// cross a line; the text may not. With no clear spot inside the plot it may
// use the chart's margins (the gutter), and with none there either it takes
// its first spot anyway: every note is drawn.

import type { Svg } from '../charts-d3/shared';
import { FONT_FAMILY } from '../fonts';
import {
  createLabelPlacement,
  type LabelRect,
  type PointCircle,
} from '../label-layout';
import type { PaletteColors } from '../palettes';
import {
  renderInlineText,
  stripInlineMarkdown,
} from '../utils/inline-markdown';
import { measureText, wrapTextToWidth } from '../utils/text-measure';

/** Note text size: the annotation size, a step under the tick labels. */
export const NOTE_FONT = 11;
const NOTE_LINE = NOTE_FONT * 1.3;
/** Widest a note's text runs before it wraps. */
const NOTE_MAX_W = 170;
/** Ring radius past the datum's own mark. */
const RING_GAP = 4;
/** Clear space kept around a note's text. */
const NOTE_PAD = 3;
const DISTANCES = [26, 42, 64, 80, 96, 128];
/** Clearance past which more room adds nothing to a spot's score. */
const ROOM_CAP = 24;
/** Steps the clearance is measured in, up to ROOM_CAP. */
const ROOM_STEP = 3;
/** Score lost per px a spot stands from its datum. */
const FAR_COST = 0.1;
/** Score lost per step down the direction order: a tie goes above-right. */
const TURN_COST = 0.25;
/** How a box straight above or below its datum lines up with it: centred,
 *  ending at it (the text to its left) or starting at it. */
type Align = 'middle' | 'end' | 'start';
/** Directions to try, best first: above-right, above-left, then the rest.
 *  The side-aligned verticals let a note at the plot's edge rise or drop
 *  straight past the lines into open space (#2134). */
const DIRECTIONS: readonly (readonly [number, number, Align?])[] = [
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [0, 1],
  [0, -1, 'end'],
  [0, -1, 'start'],
  [0, 1, 'end'],
  [0, 1, 'start'],
];

/** One note, at its datum's pixel position. */
export interface PlacedNoteDatum {
  readonly x: number;
  readonly y: number;
  /** The datum mark's radius (a point's dot); 0 for a bar end. */
  readonly r: number;
  readonly text: string;
  readonly color: string | null;
  readonly lineNumber: number;
  /** A bar's end (#2078): the note stands just past it — above a column,
   *  right of a horizontal bar — with no ring, which would sit on the bar. */
  readonly beyond?: 'above' | 'right';
}

/** Distances tried first past a bar's end, before the usual spots. */
const BEYOND_DISTANCES = [4, 12, 24];

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface DrawNotesOptions {
  /** Where a note should go: the plot. */
  readonly plot: Bounds;
  /** Where a note may go when the plot is full: the whole drawing. */
  readonly canvas: Bounds;
  /** Text already placed (titles, markers' labels, legend). */
  readonly reserved?: readonly LabelRect[];
  /** Data marks a note must clear: points, bars, reference lines. */
  readonly obstacles?: readonly LabelRect[];
  readonly markers?: readonly PointCircle[];
  readonly colors: { readonly text: string; readonly bg: string };
  readonly palette: PaletteColors;
}

/** Samples each polyline every few px, so a note's text keeps off the lines. */
export function sampleLines(
  lines: readonly (readonly [number, number])[][],
  step = 6
): PointCircle[] {
  const out: PointCircle[] = [];
  for (const pts of lines)
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 0; k <= n; k++)
        out.push({
          cx: x0 + ((x1 - x0) * k) / n,
          cy: y0 + ((y1 - y0) * k) / n,
          r: 1.5,
        });
    }
  return out;
}

function inside(r: LabelRect, b: Bounds): boolean {
  return (
    r.x >= b.left &&
    r.x + r.w <= b.right &&
    r.y >= b.top &&
    r.y + r.h <= b.bottom
  );
}

function pad(r: LabelRect, d: number): LabelRect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

/** Wraps a note's markdown text into lines and measures the block. */
export function noteBlock(text: string): {
  lines: string[];
  w: number;
  h: number;
} {
  const lines = text
    .split('\n')
    .flatMap((l) => wrapTextToWidth(l, NOTE_FONT, NOTE_MAX_W));
  const w = Math.max(
    1,
    ...lines.map((l) => measureText(stripInlineMarkdown(l), NOTE_FONT))
  );
  return { lines, w, h: lines.length * NOTE_LINE };
}

/** The box for direction `dir` at distance `d` from the datum. */
function boxAt(
  n: PlacedNoteDatum,
  dir: readonly [number, number, Align?],
  d: number,
  w: number,
  h: number
): LabelRect {
  const k = dir[0] !== 0 && dir[1] !== 0 ? Math.SQRT1_2 : 1;
  const ax = n.x + dir[0] * d * k;
  const ay = n.y + dir[1] * d * k;
  const align = dir[2] ?? 'middle';
  const x =
    dir[0] > 0 || align === 'start'
      ? ax
      : dir[0] < 0 || align === 'end'
        ? ax - w
        : ax - w / 2;
  const y = dir[1] > 0 ? ay : dir[1] < 0 ? ay - h : ay - h / 2;
  return { x, y, w, h };
}

/** Draws every note; returns their text boxes, which point values must clear. */
export function drawChartNotes(
  svg: Svg,
  notes: readonly PlacedNoteDatum[],
  opts: DrawNotesOptions
): LabelRect[] {
  const placement = createLabelPlacement({
    reserved: opts.reserved ?? [],
    obstacles: opts.obstacles ?? [],
    markers: [
      ...(opts.markers ?? []),
      // Every note's ring is a mark the other notes must clear.
      ...notes
        .filter((n) => !n.beyond)
        .map((n) => ({ cx: n.x, cy: n.y, r: n.r + RING_GAP + 2 })),
    ],
  });
  const boxes: LabelRect[] = [];
  for (const n of notes) {
    const { lines, w, h } = noteBlock(n.text);
    const beyond: [number, number] | null =
      n.beyond === 'above' ? [0, -1] : n.beyond === 'right' ? [1, 0] : null;
    // A bar's caption spots come first, nearest first: past the bar's end
    // the note reads as its label, so any clear one wins outright.
    const captions = beyond
      ? BEYOND_DISTANCES.map((d) => boxAt(n, beyond, d + n.r, w, h))
      : [];
    const spots = DISTANCES.flatMap((d) =>
      DIRECTIONS.map((dir, k) => ({
        box: boxAt(n, dir, d + n.r, w, h),
        cost: d * FAR_COST + k * TURN_COST,
      }))
    );
    const free = (b: LabelRect, gap: number) => {
      const p = pad(b, gap);
      return (
        !placement.hitsPlaced(p) &&
        !placement.hitsObstacle(p) &&
        !placement.hitsMarker(p)
      );
    };
    const clear = (b: LabelRect, area: Bounds) =>
      inside(b, area) && free(b, NOTE_PAD);
    /** Room past NOTE_PAD before the box meets anything, capped. */
    const room = (b: LabelRect) => {
      let r = 0;
      while (r < ROOM_CAP && free(b, NOTE_PAD + r + ROOM_STEP)) r += ROOM_STEP;
      return r;
    };
    const roomiest = (area: Bounds) => {
      let best: LabelRect | undefined;
      let bestScore = -Infinity;
      for (const s of spots) {
        if (!clear(s.box, area)) continue;
        const score = room(s.box) - s.cost;
        if (score > bestScore) {
          best = s.box;
          bestScore = score;
        }
      }
      return best;
    };
    const box =
      captions.find((b) => clear(b, opts.plot)) ??
      roomiest(opts.plot) ??
      captions.find((b) => clear(b, opts.canvas)) ??
      roomiest(opts.canvas) ??
      clamp(captions[0] ?? spots[0]!.box, opts.canvas);
    placement.commit(pad(box, NOTE_PAD));
    boxes.push(box);

    const stroke = n.color ?? opts.colors.text;
    const ringR = beyond ? 0 : n.r + RING_GAP;
    const g = svg
      .append('g')
      .attr('class', 'dgmo-chart-note')
      .attr('data-line-number', n.lineNumber);
    if (!beyond)
      g.append('circle')
        .attr('class', 'dgmo-chart-note-ring')
        .attr('cx', n.x)
        .attr('cy', n.y)
        .attr('r', ringR)
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-width', 1.5);
    // Leader: from the ring's rim to the nearest point of the text box.
    const tx = Math.max(box.x, Math.min(n.x, box.x + box.w));
    const ty = Math.max(box.y, Math.min(n.y, box.y + box.h));
    const len = Math.hypot(tx - n.x, ty - n.y);
    // A note standing just past a bar's end reads as its caption: no leader.
    if (len > ringR + 2 && !(beyond && len < 16)) {
      const ux = (tx - n.x) / len;
      const uy = (ty - n.y) / len;
      g.append('line')
        .attr('class', 'dgmo-chart-note-leader')
        .attr('x1', n.x + ux * ringR)
        .attr('y1', n.y + uy * ringR)
        .attr('x2', tx - ux * 2)
        .attr('y2', ty - uy * 2)
        .attr('stroke', stroke)
        .attr('stroke-width', 1);
    }
    lines.forEach((line, i) => {
      const t = g
        .append('text')
        .attr('x', box.x)
        .attr('y', box.y + NOTE_FONT * 0.95 + i * NOTE_LINE)
        .attr('text-anchor', 'start')
        .attr('fill', opts.colors.text)
        .attr('font-size', NOTE_FONT)
        .attr('font-family', FONT_FAMILY)
        .attr('stroke', opts.colors.bg)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('paint-order', 'stroke');
      renderInlineText(t, line, opts.palette, NOTE_FONT);
    });
  }
  return boxes;
}

function clamp(r: LabelRect, b: Bounds): LabelRect {
  return {
    ...r,
    x: Math.max(b.left, Math.min(r.x, b.right - r.w)),
    y: Math.max(b.top, Math.min(r.y, b.bottom - r.h)),
  };
}
