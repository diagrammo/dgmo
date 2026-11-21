// ============================================================
// Overlay label placement (#2217)
// ============================================================
//
// One placer for every overlay label — mean, median, target, trend,
// moving-average and the extremes. A label first hugs its line or dot; on a
// line it slides along to the least crowded stretch. With no clear spot it
// moves into open space and a thin leader joins it back. A shorter form is
// tried before a label is dropped. Nothing is ever printed over a placed
// label, a point, a data line or another overlay line.

import {
  createLabelPlacement,
  type LabelPlacement,
  type LabelRect,
  type Leader,
  type PointCircle,
} from '../label-layout';

export type Anchor = 'start' | 'middle' | 'end';

/** One place a label could go, best first by `cost`. */
export interface Spot {
  /** The text's anchor point and alignment. */
  readonly x: number;
  readonly baseline: number;
  readonly anchor: Anchor;
  readonly rect: LabelRect;
  /** From the line or dot to the box; absent when the label hugs it. */
  readonly leader?: Leader;
  readonly cost: number;
}

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Room a hugging label keeps from crowding: a spot this clear wins. */
const ROOMY_PAD = 4;
/** How far a leader runs, nearest first. */
export const LEADER_DISTANCES = [20, 30, 42, 56, 72];
/** A leader's extra cost over any hugging spot. */
export const LEADER_COST = 100;

export function overlayPlacement(init: {
  reserved?: readonly LabelRect[];
  markers?: readonly PointCircle[];
}): LabelPlacement {
  return createLabelPlacement({
    reserved: init.reserved ?? [],
    markers: init.markers ?? [],
  });
}

/** The box `w` wide and `h` tall whose text sits at x/baseline. */
export function boxFor(
  x: number,
  top: number,
  w: number,
  h: number,
  anchor: Anchor
): LabelRect {
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x: x0, y: top, w, h };
}

function inside(r: LabelRect, b: Bounds): boolean {
  return (
    r.x >= b.left &&
    r.y >= b.top &&
    r.x + r.w <= b.right &&
    r.y + r.h <= b.bottom
  );
}

function grow(r: LabelRect, d: number): LabelRect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

/** The point of `r` nearest (x, y): where a leader meets the box. */
export function nearestOnBox(
  r: LabelRect,
  x: number,
  y: number
): [number, number] {
  return [
    Math.max(r.x, Math.min(x, r.x + r.w)),
    Math.max(r.y, Math.min(y, r.y + r.h)),
  ];
}

/**
 * The best clear spot, or null. A spot is clear when its box is inside the
 * bounds and touches no placed box and no marker, and its leader (if any)
 * crosses no placed box and no other leader. Of the clear spots, one with
 * room around it beats a tight one; cost breaks ties within each.
 */
export function pickSpot(
  placement: LabelPlacement,
  spots: readonly Spot[],
  bounds: Bounds
): Spot | null {
  const clear = (r: LabelRect) =>
    inside(r, bounds) && !placement.hitsPlaced(r) && !placement.hitsMarker(r);
  const leaderOk = (s: Spot) =>
    !s.leader ||
    (!placement.leaderCrosses(s.leader) &&
      !placement.leaderHitsPlaced(s.leader));
  const ok = spots
    .filter((s) => clear(s.rect) && leaderOk(s))
    .sort((a, b) => a.cost - b.cost);
  if (ok.length === 0) return null;
  const roomy = ok.find(
    (s) =>
      !placement.hitsPlaced(grow(s.rect, ROOMY_PAD)) &&
      !placement.hitsMarker(grow(s.rect, ROOMY_PAD))
  );
  // A roomy hug beats a tight hug, but never sends a label down a leader
  // when a tight hug is clear.
  if (roomy && (!roomy.leader || ok[0]!.leader)) return roomy;
  return ok[0]!;
}
