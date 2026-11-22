// ============================================================
// Map notes — a card in clear space beside a POI, region or edge (#2215)
// ============================================================
//
// A `note` indented under a map element draws a card: the element's name in
// bold, the note's heading in the element's colour, and its markdown body.
// Each card goes in clear space near its element, joined by a short straight
// leader. A card never covers a marker, an edge, another card or leader, the
// title and legend band, or the canvas edge, and the marker never moves.
//
// Notes are placed before any label, so labels fit around them. A note that
// finds no clear spot steps down to a numbered pin at its element, and its
// text goes to a key under the map. A card's body is never shortened.

import {
  rectCircleOverlap,
  rectsOverlap,
  segmentRectOverlap,
  type LabelRect,
  type PointCircle,
} from '../label-layout';
import { stripInlineMarkdown } from '../utils/inline-markdown';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import type { MapNote } from './types';

export const NOTE_NAME_FONT = 11;
export const NOTE_HEAD_FONT = 10.5;
export const NOTE_BODY_FONT = 10;
/** Line height as a multiple of each line's font size. */
export const NOTE_LINE_RATIO = 1.3;
/** Space inside the card, around its text. */
export const NOTE_CARD_PAD = 6;
/** Radius of a stepped-down note's numbered pin. */
export const NOTE_PIN_R = 7;
/** Space kept clear around a card. */
const CLEAR = 4;
/** Space kept between the card and the canvas edge. */
const EDGE = 6;
/** Gaps tried between an element's rim and its card, nearest first. Short:
 *  past the last one the note steps down to a pin rather than reach far. */
const GAPS = [8, 16, 28, 42, 60, 80, 104];
/** Canvas width at which the card text is full size; narrower canvases scale
 *  it down to NOTE_MIN_SCALE, as the mockup's phone width does. */
const FULL_SIZE_WIDTH = 720;
const NOTE_MIN_SCALE = 0.8;
/** Placement attempts: source order first, then the notes that stepped down
 *  moved to the front, keeping whichever leaves fewest pins. */
const ATTEMPTS = 4;
/** Cost per step down the direction order: a tie goes above-right. */
const TURN_COST = 3;
/** Widest a card's text runs before it wraps, as a share of the canvas. */
const WRAP_SHARE = 0.22;
const WRAP_MIN = 96;
const WRAP_MAX = 140;

/** The card's text scale on a canvas `width` px wide. */
export function noteScale(width: number): number {
  return Math.max(NOTE_MIN_SCALE, Math.min(1, width / FULL_SIZE_WIDTH));
}

/** One element with a note, at its pixel position. */
export interface MapNoteTarget {
  readonly kind: 'poi' | 'region' | 'edge';
  /** The POI id, region ISO or edge's first POI id: for `data-*` hooks. */
  readonly id: string;
  /** The element's own line. */
  readonly lineNumber: number;
  /** The name drawn in bold on the card. */
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** The element's marker radius; 0 for a region or an edge. */
  readonly r: number;
  /** The element's colour: the card's border and heading. */
  readonly color: string;
  readonly note: MapNote;
}

export interface MapLayoutNoteCard {
  /** Text scale: font sizes are the NOTE_*_FONT constants times this. */
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly nameLines: readonly string[];
  readonly headLines: readonly string[];
  readonly bodyLines: readonly string[];
}

/** A placed note: a card with its leader, or a numbered pin. */
export interface MapLayoutNote {
  readonly kind: MapNoteTarget['kind'];
  readonly id: string;
  /** The element's line. */
  readonly targetLine: number;
  /** The `note` line. */
  readonly lineNumber: number;
  readonly name: string;
  readonly heading: string;
  /** The markdown body, lines joined with `\n`. */
  readonly body: string;
  readonly color: string;
  /** Where the leader starts: the element's anchor. */
  readonly ax: number;
  readonly ay: number;
  readonly ar: number;
  readonly card?: MapLayoutNoteCard;
  readonly leader?: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  };
  /** Set when the note stepped down: its number in the key and its disc. */
  readonly pin?: {
    readonly num: number;
    readonly x: number;
    readonly y: number;
  };
}

export interface PlaceMapNotesOptions {
  readonly width: number;
  readonly height: number;
  /** The title and legend band, and anything else nothing may cover. */
  readonly reserved: readonly LabelRect[];
  /** Every marker on the map. */
  readonly markers: readonly PointCircle[];
  /** Every drawn connector, as straight segments. */
  readonly segments: ReadonlyArray<readonly [number, number, number, number]>;
}

const lineH = (font: number): number => font * NOTE_LINE_RATIO;

/** The card's text, wrapped, and its outer size. */
export function noteCardBlock(
  name: string,
  heading: string,
  body: string,
  wrap: number,
  scale = 1
): Omit<MapLayoutNoteCard, 'x' | 'y'> {
  const nf = NOTE_NAME_FONT * scale;
  const hf = NOTE_HEAD_FONT * scale;
  const bf = NOTE_BODY_FONT * scale;
  const nameLines = name ? wrapTextToWidth(name, nf, wrap, { bold: true }) : [];
  const headLines = heading
    ? wrapTextToWidth(heading, hf, wrap, { bold: true })
    : [];
  const bodyLines = body
    ? body.split('\n').flatMap((l) => wrapTextToWidth(l, bf, wrap))
    : [];
  const textW = Math.max(
    1,
    ...nameLines.map((l) => measureText(l, nf, { bold: true })),
    ...headLines.map((l) => measureText(l, hf, { bold: true })),
    ...bodyLines.map((l) => measureText(stripInlineMarkdown(l), bf))
  );
  const textH =
    nameLines.length * lineH(nf) +
    headLines.length * lineH(hf) +
    bodyLines.length * lineH(bf);
  const p = NOTE_CARD_PAD * scale;
  return {
    scale,
    w: Math.ceil(textW + 2 * p),
    h: Math.ceil(textH + 2 * p - 2),
    nameLines,
    headLines,
    bodyLines,
  };
}

/** Directions tried, best first, each with how the card lines up with the
 *  ray's end: `[dx, dy, along]`, `along` sliding the card across the ray. */
const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, -1, 0],
  [-1, -1, 0],
  [1, 1, 0],
  [-1, 1, 0],
  [1, 0, 0.5],
  [-1, 0, 0.5],
  [0, -1, 0.5],
  [0, 1, 0.5],
  [1, 0, 0],
  [1, 0, 1],
  [-1, 0, 0],
  [-1, 0, 1],
  [0, -1, 0],
  [0, -1, 1],
  [0, 1, 0],
  [0, 1, 1],
];

/** The card box for a direction and gap. `along` 0 puts the card's near
 *  corner at the ray's end, 0.5 centres it across the ray, 1 the far side. */
function boxAt(
  t: MapNoteTarget,
  dir: readonly [number, number, number],
  gap: number,
  w: number,
  h: number
): LabelRect {
  const [dx, dy, along] = dir;
  const diag = dx !== 0 && dy !== 0;
  const reach = t.r + gap;
  const ex = t.x + dx * reach * (diag ? Math.SQRT1_2 : 1);
  const ey = t.y + dy * reach * (diag ? Math.SQRT1_2 : 1);
  let x: number;
  let y: number;
  if (dx > 0) x = ex;
  else if (dx < 0) x = ex - w;
  else x = ex - w * along;
  if (dy > 0) y = ey;
  else if (dy < 0) y = ey - h;
  else y = ey - h * along;
  return { x, y, w, h };
}

/** Where a stepped-down note's disc may sit around its marker, best first:
 *  up-right, then round the clock. */
const PIN_ANGLES = [-45, -90, 0, -135, 45, 180, 90, 135].map(
  (d) => (d * Math.PI) / 180
);

/** Grid step of the fallback sweep. */
const GRID_STEP = 4;
/** Farthest a card's nearest edge may stand from its element's rim. */
const REACH = 110;

/** The clear box nearest `t`, from a sweep of positions within REACH. */
function gridSpot(
  t: MapNoteTarget,
  w: number,
  h: number,
  clear: (box: LabelRect) => boolean
): { box: LabelRect; cost: number } | null {
  const reach = t.r + REACH;
  const spots: Array<{ box: LabelRect; cost: number }> = [];
  for (let x = t.x - reach - w; x <= t.x + reach; x += GRID_STEP) {
    for (let y = t.y - reach - h; y <= t.y + reach; y += GRID_STEP) {
      const nx = Math.max(x, Math.min(t.x, x + w));
      const ny = Math.max(y, Math.min(t.y, y + h));
      const d = Math.hypot(nx - t.x, ny - t.y);
      // Never over the element itself, and never out of reach.
      if (d < t.r + GAPS[0]! || d > reach) continue;
      spots.push({ box: { x, y, w, h }, cost: d });
    }
  }
  spots.sort((a, b) => a.cost - b.cost);
  return spots.find((s) => clear(s.box)) ?? null;
}

const pad = (r: LabelRect, d: number): LabelRect => ({
  x: r.x - d,
  y: r.y - d,
  w: r.w + 2 * d,
  h: r.h + 2 * d,
});

/** The leader from the element's rim to the nearest point of the card. */
function leaderTo(
  t: MapNoteTarget,
  box: LabelRect
): { x1: number; y1: number; x2: number; y2: number } | null {
  const tx = Math.max(box.x, Math.min(t.x, box.x + box.w));
  const ty = Math.max(box.y, Math.min(t.y, box.y + box.h));
  const len = Math.hypot(tx - t.x, ty - t.y);
  const start = t.r + 1;
  if (len <= start + 2) return null;
  const ux = (tx - t.x) / len;
  const uy = (ty - t.y) / len;
  return { x1: t.x + ux * start, y1: t.y + uy * start, x2: tx, y2: ty };
}

/** Places every note: a card in clear space, or a numbered pin when there is
 *  none. Notes are tried in source order, so an earlier note wins a contested
 *  spot. */
export function placeMapNotes(
  targets: readonly MapNoteTarget[],
  opts: PlaceMapNotesOptions
): MapLayoutNote[] {
  let order = [...targets].sort(
    (a, b) => a.note.lineNumber - b.note.lineNumber
  );
  let best: MapLayoutNote[] | null = null;
  const pins = (r: readonly MapLayoutNote[]) => r.filter((n) => n.pin).length;
  for (let k = 0; k < ATTEMPTS; k++) {
    const inline = placeInOrder(order, opts, 'inline');
    const phased = placeInOrder(order, opts, 'phased');
    const result = pins(phased) < pins(inline) ? phased : inline;
    if (!best || pins(result) < pins(best)) best = result;
    if (pins(best) === 0) break;
    // Seat the notes that found no room first, then the rest in source order.
    const stepped = new Set(
      result.filter((n) => n.pin).map((n) => n.lineNumber)
    );
    const next = [
      ...order.filter((t) => stepped.has(t.note.lineNumber)),
      ...order.filter((t) => !stepped.has(t.note.lineNumber)),
    ];
    if (next.every((t, i) => t === order[i])) break;
    order = next;
  }
  // Pins are numbered in source order whatever order seated the cards.
  const out = [...best!].sort((a, b) => a.lineNumber - b.lineNumber);
  let num = 0;
  return out.map((n) => (n.pin ? { ...n, pin: { ...n.pin, num: ++num } } : n));
}

function placeInOrder(
  ordered: readonly MapNoteTarget[],
  opts: PlaceMapNotesOptions,
  /** `phased`: every note tries its near spots before any sweeps far.
   *  `inline`: each note sweeps far as soon as its near spots fail. */
  mode: 'phased' | 'inline'
): MapLayoutNote[] {
  const { width, height } = opts;
  const scale = noteScale(width);
  const wrap = Math.max(WRAP_MIN, Math.min(WRAP_MAX, width * WRAP_SHARE));
  const cards: LabelRect[] = [];
  const leaders: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const out: MapLayoutNote[] = [];
  const stepped: Array<{ t: MapNoteTarget; base: MapLayoutNote }> = [];

  const clearOf = (
    t: MapNoteTarget,
    box: LabelRect,
    leader: ReturnType<typeof leaderTo>
  ): boolean => {
    if (
      box.x < EDGE ||
      box.y < EDGE ||
      box.x + box.w > width - EDGE ||
      box.y + box.h > height - EDGE
    )
      return false;
    const padded = pad(box, CLEAR);
    if (opts.reserved.some((r) => rectsOverlap(padded, r))) return false;
    if (opts.markers.some((m) => rectCircleOverlap(padded, m))) return false;
    if (cards.some((c) => rectsOverlap(padded, c))) return false;
    if (
      opts.segments.some((s) =>
        segmentRectOverlap(s[0], s[1], s[2], s[3], padded)
      )
    )
      return false;
    // A card never covers another note's leader.
    if (leaders.some((l) => segmentRectOverlap(l.x1, l.y1, l.x2, l.y2, padded)))
      return false;
    if (leader) {
      // Its own leader crosses no other card and no other marker.
      if (
        cards.some((c) =>
          segmentRectOverlap(leader.x1, leader.y1, leader.x2, leader.y2, c)
        )
      )
        return false;
      const crossesMarker = opts.markers.some((m) => {
        if (Math.hypot(m.cx - t.x, m.cy - t.y) < 0.5) return false;
        return segmentRectOverlap(leader.x1, leader.y1, leader.x2, leader.y2, {
          x: m.cx - m.r,
          y: m.cy - m.r,
          w: 2 * m.r,
          h: 2 * m.r,
        });
      });
      if (crossesMarker) return false;
    }
    return true;
  };

  const seat = (
    t: MapNoteTarget,
    base: MapLayoutNote,
    block: ReturnType<typeof noteCardBlock>,
    box: LabelRect
  ): void => {
    const leader = leaderTo(t, box);
    cards.push(pad(box, CLEAR));
    if (leader) leaders.push(leader);
    out.push({
      ...base,
      card: { x: box.x, y: box.y, ...block },
      ...(leader && { leader }),
    });
  };

  // Pass 1: every note tries the tidy spots near its element, so no note's
  // long reach takes another's near spot.
  const pending: Array<{
    t: MapNoteTarget;
    base: MapLayoutNote;
    block: ReturnType<typeof noteCardBlock>;
  }> = [];
  for (const t of ordered) {
    const block = noteCardBlock(
      t.name,
      t.note.heading,
      t.note.body,
      wrap,
      scale
    );
    const base: MapLayoutNote = {
      kind: t.kind,
      id: t.id,
      targetLine: t.lineNumber,
      lineNumber: t.note.lineNumber,
      name: t.name,
      heading: t.note.heading,
      body: t.note.body,
      color: t.color,
      ax: t.x,
      ay: t.y,
      ar: t.r,
    };
    let best: { box: LabelRect; cost: number } | null = null;
    for (const gap of GAPS) {
      DIRECTIONS.forEach((dir, i) => {
        const box = boxAt(t, dir, gap, block.w, block.h);
        const cost = gap + i * TURN_COST;
        if (best && best.cost <= cost) return;
        if (clearOf(t, box, leaderTo(t, box))) best = { box, cost };
      });
      // A nearer gap always beats a farther one by more than the turn cost of
      // every direction, so the first gap with a clear spot settles it.
      if (best) break;
    }
    if (best) seat(t, base, block, (best as { box: LabelRect }).box);
    else if (mode === 'phased') pending.push({ t, base, block });
    else {
      const spot = gridSpot(t, block.w, block.h, (box) =>
        clearOf(t, box, leaderTo(t, box))
      );
      if (spot) seat(t, base, block, spot.box);
      else stepped.push({ t, base });
    }
  }

  // Pass 2: the rest sweep every position within reach, shortest leader first.
  for (const { t, base, block } of pending) {
    const spot = gridSpot(t, block.w, block.h, (box) =>
      clearOf(t, box, leaderTo(t, box))
    );
    if (spot) seat(t, base, block, spot.box);
    else stepped.push({ t, base });
  }

  // Stepped-down notes: a numbered disc beside the element, up and right when
  // that is clear of every card and earlier disc.
  const discs: LabelRect[] = [];
  for (const { t, base } of stepped) {
    const reach = t.r > 0 ? t.r + NOTE_PIN_R * 0.4 : 0;
    const spots = PIN_ANGLES.map((a) => {
      const x = Math.min(
        width - NOTE_PIN_R - 1,
        Math.max(NOTE_PIN_R + 1, t.x + Math.cos(a) * reach)
      );
      const y = Math.min(
        height - NOTE_PIN_R - 1,
        Math.max(NOTE_PIN_R + 1, t.y + Math.sin(a) * reach)
      );
      return { x, y };
    });
    const discAt = (q: { x: number; y: number }): LabelRect => ({
      x: q.x - NOTE_PIN_R,
      y: q.y - NOTE_PIN_R,
      w: 2 * NOTE_PIN_R,
      h: 2 * NOTE_PIN_R,
    });
    const q =
      spots.find((q) => {
        const d = discAt(q);
        return (
          !cards.some((c) => rectsOverlap(d, c)) &&
          !discs.some((o) => rectsOverlap(d, o))
        );
      }) ?? spots[0]!;
    discs.push(discAt(q));
    out.push({ ...base, pin: { num: 0, x: q.x, y: q.y } });
  }
  return out;
}

/** The footprint each placed note claims, for the label passes to dodge. */
export function noteObstacles(notes: readonly MapLayoutNote[]): LabelRect[] {
  const rects: LabelRect[] = [];
  for (const n of notes) {
    if (n.card) rects.push(pad(n.card, CLEAR));
    if (n.pin)
      rects.push({
        x: n.pin.x - NOTE_PIN_R - 1,
        y: n.pin.y - NOTE_PIN_R - 1,
        w: 2 * NOTE_PIN_R + 2,
        h: 2 * NOTE_PIN_R + 2,
      });
  }
  return rects;
}
