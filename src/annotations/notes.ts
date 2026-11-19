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
//
// A bar's note is its caption (#2136): it stands above the bar (past a
// horizontal bar's end), lifted straight up past taller neighbours when it
// must, or beside the bar's end only where neither its text nor its leader
// crosses a bar, a value label, another note or another note's leader.

import type { Svg } from '../charts-d3/shared';
import { FONT_FAMILY } from '../fonts';
import {
  createLabelPlacement,
  segmentRectOverlap,
  type Leader,
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
  /** Widest the text runs before it wraps; NOTE_MAX_W when absent. */
  readonly wrap?: number;
}

/** Distances tried first past a bar's end: the caption, lifted a little. */
const BEYOND_DISTANCES = [4, 12, 24, 36, 48];
/** Distances beside a bar's end, tried when no near caption spot is clear. */
const SIDE_DISTANCES = [8, 20, 36];
/** Step the caption rises by past BEYOND_DISTANCES, up to the canvas edge. */
const LIFT_STEP = 8;
/** Distance past a ring before a leader is tested: the data line runs
 *  through the datum, so its first few px always meet that line. */
const LEADER_SKIP = 4;
/** Radius a leader keeps from a line sample: past half `sampleLines`'
 *  default 6px step, so a leader crossing a line always meets a sample. */
const LEADER_SAMPLE_R = 3.2;
/** Most a leader keeps from a point: a point's mark, not its text pad. */
const LEADER_MARK_R = 5;
/** Narrowest a caption wraps to; a word longer than this still runs whole. */
const CAPTION_MIN_W = 24;
/** A leader shorter than this past a bar's end is not drawn. */
const CAPTION_NO_LEADER = 16;

/** The width a column's caption wraps to, given the category step. */
export function captionWrap(step: number): number {
  return Math.max(CAPTION_MIN_W, Math.min(NOTE_MAX_W, step - 6));
}

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
  /** Boxes a bar note's leader must not cross though its text may cover
   *  them: value labels, which yield to a note's text. */
  readonly leaderObstacles?: readonly LabelRect[];
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

/** Shortest distance from (px, py) to the segment (x0, y0)–(x1, y1). */
function segmentPointDistance(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  px: number,
  py: number
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const t =
    l2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
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
export function noteBlock(
  text: string,
  maxW: number = NOTE_MAX_W
): {
  lines: string[];
  w: number;
  h: number;
} {
  const lines = text
    .split('\n')
    .flatMap((l) => wrapTextToWidth(l, NOTE_FONT, maxW));
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
  // The note with least room places first: a bar note on the bar reaching
  // furthest, so a shorter neighbour's note cannot take the air above it.
  const reach = (n: PlacedNoteDatum) =>
    n.beyond === 'above' ? n.y : n.beyond === 'right' ? -n.x : Infinity;
  const order = notes
    .map((_, i) => i)
    .sort((a, b) => reach(notes[a]!) - reach(notes[b]!) || a - b);
  const boxes: LabelRect[] = new Array(notes.length);
  const blocks: ReturnType<typeof noteBlock>[] = new Array(notes.length);
  const beyond0 = (n: PlacedNoteDatum) => n.beyond !== undefined;
  // The line from each bar's end out to the canvas edge is that bar's own:
  // its caption and leader rise along it, so a neighbour's text placed
  // earlier must leave it free (#2136).
  const air = notes.map((n): LabelRect | null =>
    n.beyond === 'above'
      ? { x: n.x - 1, y: opts.canvas.top, w: 2, h: n.y - opts.canvas.top }
      : n.beyond === 'right'
        ? { x: n.x, y: n.y - 1, w: opts.canvas.right - n.x, h: 2 }
        : null
  );
  const placedYet = new Set<number>();
  /** Leaders already committed: a later note's text must not sit on one. */
  const leaders: Leader[] = [];
  for (const i of order) {
    const n = notes[i]!;
    // A bar's caption keeps its full width where that is clear and wraps to
    // the bar's own width only where it is not.
    const full = noteBlock(n.text);
    const narrow =
      n.wrap && n.wrap < NOTE_MAX_W ? noteBlock(n.text, n.wrap) : full;
    // A noted neighbour close enough for the full-width text to meet its
    // caption means the bars are crowded: wrap from the start.
    const crowded = notes.some(
      (o) =>
        o !== n &&
        o.beyond === n.beyond &&
        Math.abs(n.beyond === 'right' ? o.y - n.y : o.x - n.x) <
          (full.w + narrow.w) / 2 + 2 * NOTE_PAD
    );
    const sizes =
      narrow.lines.length <= full.lines.length
        ? [full]
        : crowded
          ? [narrow]
          : [full, narrow];
    const { w, h } = beyond0(n) ? sizes[sizes.length - 1]! : full;
    const othersAir = air.filter(
      (a, j): a is LabelRect => a !== null && j !== i && !placedYet.has(j)
    );
    const beyond: [number, number] | null =
      n.beyond === 'above' ? [0, -1] : n.beyond === 'right' ? [1, 0] : null;
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
    const ownAir = (b: LabelRect) =>
      !othersAir.some(
        (a) =>
          b.x < a.x + a.w &&
          a.x < b.x + b.w &&
          b.y < a.y + a.h &&
          a.y < b.y + b.h
      );
    /** Room past NOTE_PAD before the box meets anything, capped. */
    const room = (b: LabelRect) => {
      let r = 0;
      while (r < ROOM_CAP && free(b, NOTE_PAD + r + ROOM_STEP)) r += ROOM_STEP;
      return r;
    };
    const roomiest = (area: Bounds, leaderToo: boolean) => {
      let best: LabelRect | undefined;
      let bestScore = -Infinity;
      for (const s of spots) {
        if (!clear(s.box, area)) continue;
        if (leaderToo && !(onNoLeader(s.box) && leaderClear(s.box))) continue;
        const score = room(s.box) - s.cost;
        if (score > bestScore) {
          best = s.box;
          bestScore = score;
        }
      }
      return best;
    };
    /** The leader from the datum to the box's nearest point, trimmed off
     *  the bar's end or the ring, or null when none is drawn. */
    const ringR = beyond ? 0 : n.r + RING_GAP;
    const leaderTo = (b: LabelRect): Leader | null => {
      const tx = Math.max(b.x, Math.min(n.x, b.x + b.w));
      const ty = Math.max(b.y, Math.min(n.y, b.y + b.h));
      const len = Math.hypot(tx - n.x, ty - n.y);
      if (beyond ? len < CAPTION_NO_LEADER : len <= ringR + 2) return null;
      const ux = (tx - n.x) / len;
      const uy = (ty - n.y) / len;
      const s0 = beyond ? 3 : ringR + LEADER_SKIP;
      if (len - 3 <= s0) return null;
      return [n.x + ux * s0, n.y + uy * s0, tx - ux * 3, ty - uy * 3];
    };
    // Marks a leader must keep off: line samples, points, other notes'
    // rings. Its own datum and ring are where it starts, so they are not;
    // a point's clearance pad is for text, so a leader keeps only off the
    // mark itself.
    const leaderMarks = (opts.markers ?? [])
      .filter((m) => Math.hypot(m.cx - n.x, m.cy - n.y) > ringR + 1)
      .map((m) => ({
        ...m,
        r: Math.max(LEADER_SAMPLE_R, Math.min(m.r, LEADER_MARK_R)),
      }));
    const ringMarks = notes
      .filter((o) => o !== n && !o.beyond)
      .map((o) => ({ cx: o.x, cy: o.y, r: o.r + RING_GAP + 1 }));
    // A value label whose edge the datum sits on is the bar's own: the
    // leader starts on it.
    const leaderBlocks = (opts.leaderObstacles ?? []).filter(
      (r) =>
        !(
          n.x >= r.x - 1 &&
          n.x <= r.x + r.w + 1 &&
          n.y >= r.y - 1 &&
          n.y <= r.y + r.h + 1
        )
    );
    const leaderClear = (b: LabelRect) => {
      const l = leaderTo(b);
      if (!l) return true;
      const [x0, y0, x1, y1] = l;
      return (
        !placement.leaderCrosses(l) &&
        !placement.leaderHitsPlaced(l) &&
        ![...(opts.obstacles ?? []), ...leaderBlocks].some((r) =>
          segmentRectOverlap(x0, y0, x1, y1, r)
        ) &&
        ![...leaderMarks, ...ringMarks].some(
          (m) => segmentPointDistance(x0, y0, x1, y1, m.cx, m.cy) < m.r
        )
      );
    };
    /** The text keeps off every leader already drawn. */
    const onNoLeader = (b: LabelRect) =>
      !leaders.some(([x0, y0, x1, y1]) =>
        segmentRectOverlap(x0, y0, x1, y1, pad(b, NOTE_PAD))
      );
    const fits = (b: LabelRect, area: Bounds) =>
      clear(b, area) && ownAir(b) && onNoLeader(b) && leaderClear(b);

    /** Caption boxes past the bar's end at distance d: centred on it, then
     *  ending at it, then starting at it, each kept inside `area` across. */
    const captionsAt = (
      d: number,
      area: Bounds,
      w: number,
      h: number
    ): LabelRect[] => {
      if (!beyond) return [];
      return (['middle', 'end', 'start'] as const).map((a) => {
        const r = boxAt(n, [beyond[0], beyond[1], a], d + n.r, w, h);
        return beyond[1] !== 0
          ? { ...r, x: Math.max(area.left, Math.min(r.x, area.right - r.w)) }
          : { ...r, y: Math.max(area.top, Math.min(r.y, area.bottom - r.h)) };
      });
    };
    /** Spots beside the bar's end, across the bar's axis. */
    const sides = (w: number, h: number): LabelRect[] => {
      if (!beyond) return [];
      const across: readonly (readonly [number, number])[] =
        beyond[1] !== 0
          ? [
              [1, 0],
              [-1, 0],
              [1, -1],
              [-1, -1],
            ]
          : [
              [0, -1],
              [0, 1],
              [1, -1],
              [1, 1],
            ];
      return SIDE_DISTANCES.flatMap((d) =>
        across.map((dir) => boxAt(n, dir, d, w, h))
      );
    };
    /** Caption spots lifted past BEYOND_DISTANCES until they leave `area`. */
    const lifted = (area: Bounds, w: number, h: number): LabelRect[] => {
      if (!beyond) return [];
      const out: LabelRect[] = [];
      const far = BEYOND_DISTANCES[BEYOND_DISTANCES.length - 1]!;
      for (let d = far + LIFT_STEP; ; d += LIFT_STEP) {
        const row = captionsAt(d, area, w, h);
        if (!row.some((b) => inside(b, area))) break;
        out.push(...row);
      }
      return out;
    };
    /** The first clear box of a tier, trying the full width before the
     *  wrapped one; the block it used goes with it. */
    let block = beyond ? sizes[sizes.length - 1]! : full;
    const tier = (
      gen: (w: number, h: number) => readonly LabelRect[],
      area: Bounds
    ): LabelRect | undefined => {
      for (const size of sizes) {
        const b = gen(size.w, size.h).find((r) => fits(r, area));
        if (b) {
          block = size;
          return b;
        }
      }
      return undefined;
    };
    const near = (area: Bounds) => (w: number, h: number) =>
      BEYOND_DISTANCES.flatMap((d) => captionsAt(d, area, w, h));

    const box = beyond
      ? (tier(near(opts.plot), opts.plot) ??
        tier(sides, opts.plot) ??
        tier((w, h) => lifted(opts.plot, w, h), opts.plot) ??
        tier(near(opts.canvas), opts.canvas) ??
        tier(sides, opts.canvas) ??
        tier((w, h) => lifted(opts.canvas, w, h), opts.canvas) ??
        // No caption or side spot is clear: any spot whose text and leader
        // both are, nearest first; only then the caption, overlapping.
        tier(
          (w, h) =>
            DISTANCES.flatMap((d) =>
              DIRECTIONS.map((dir) => boxAt(n, dir, d + n.r, w, h))
            ),
          opts.canvas
        ) ??
        clamp(
          captionsAt(BEYOND_DISTANCES[0]!, opts.canvas, w, h)[0]!,
          opts.canvas
        ))
      : // A spot whose leader crosses nothing first; only then one whose
        // text alone is clear (#2158).
        (roomiest(opts.plot, true) ??
        roomiest(opts.canvas, true) ??
        roomiest(opts.plot, false) ??
        roomiest(opts.canvas, false) ??
        clamp(spots[0]!.box, opts.canvas));
    blocks[i] = block;
    const leader = leaderTo(box) ?? undefined;
    placement.commit(pad(box, NOTE_PAD), leader);
    if (leader) leaders.push(leader);
    boxes[i] = box;
    placedYet.add(i);
  }

  notes.forEach((n, i) => {
    const box = boxes[i]!;
    const { lines } = blocks[i]!;
    const beyond = n.beyond;

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
    if (len > ringR + 2 && !(beyond && len < CAPTION_NO_LEADER)) {
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
  });
  return boxes;
}

function clamp(r: LabelRect, b: Bounds): LabelRect {
  return {
    ...r,
    x: Math.max(b.left, Math.min(r.x, b.right - r.w)),
    y: Math.max(b.top, Math.min(r.y, b.bottom - r.h)),
  };
}
