// ============================================================
// The shared label engine's second rule (#1828): avoid collisions. Each label
// tries its candidate spots in order and takes the first that is clear; a
// label with no clear spot is dropped. Labels are placed in priority order —
// larger |value| first, then a series' end points — so a crowd loses its
// least important label, never its most important one. The caller keeps the
// dropped value on hover.
// ============================================================

import {
  createLabelPlacement,
  type LabelRect,
  type PointCircle,
} from '../label-layout';
import { measureText } from './text-measure';

export type LabelAnchor = 'start' | 'middle' | 'end';

/** One place a label may go: its baseline anchor point. */
export interface LabelSpot {
  x: number;
  y: number;
  anchor: LabelAnchor;
}

export interface LabelCandidate {
  text: string;
  /** Spots to try, best first. */
  spots: LabelSpot[];
  /** Larger places first. */
  priority: number;
  /** Breaks a priority tie: true places first. */
  endpoint?: boolean;
}

export interface PlacedLabel {
  /** The spot taken, or null when every spot was blocked. */
  spot: LabelSpot | null;
}

export interface PlaceLabelsOptions {
  fontSize: number;
  /** Boxes already taken before the pass — other text a label must clear. */
  reserved?: readonly LabelRect[];
  /** Markers a label must clear (point dots). */
  markers?: readonly PointCircle[];
  /** A label box must lie inside this rectangle. */
  bounds?: { left: number; top: number; right: number; bottom: number };
}

/** Px trimmed from each side of a box before the hit test. */
const HIT_INSET = 1;

function inset(r: LabelRect, d: number): LabelRect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d };
}

/** A label's box from its baseline anchor, `fontSize` tall. */
export function labelBox(
  text: string,
  spot: LabelSpot,
  fontSize: number
): LabelRect {
  const w = measureText(text, fontSize);
  const x =
    spot.anchor === 'middle'
      ? spot.x - w / 2
      : spot.anchor === 'end'
        ? spot.x - w
        : spot.x;
  return { x, y: spot.y - fontSize * 0.8, w, h: fontSize };
}

/**
 * Place every candidate, in priority order, at its first spot that touches no
 * placed label, no marker and nothing outside `bounds`. Returns one result per
 * candidate, in input order.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  opts: PlaceLabelsOptions
): PlacedLabel[] {
  const placement = createLabelPlacement({
    reserved: opts.reserved ?? [],
    markers: opts.markers ?? [],
  });
  const b = opts.bounds;
  const inside = (r: LabelRect): boolean =>
    !b ||
    (r.x >= b.left &&
      r.x + r.w <= b.right &&
      r.y >= b.top &&
      r.y + r.h <= b.bottom);

  const order = candidates
    .map((_, i) => i)
    .sort((a, c) => {
      const ca = candidates[a]!;
      const cc = candidates[c]!;
      return (
        cc.priority - ca.priority ||
        Number(cc.endpoint ?? false) - Number(ca.endpoint ?? false) ||
        a - c
      );
    });

  const out: PlacedLabel[] = candidates.map(() => ({ spot: null }));
  for (const i of order) {
    const c = candidates[i]!;
    const pick = c.spots
      .map((spot) => ({ spot, box: labelBox(c.text, spot, opts.fontSize) }))
      .find(({ box }) => {
        // The box is a full em tall and digits are shorter, so two boxes
        // meeting at a corner sliver are not a collision.
        const core = inset(box, HIT_INSET);
        return (
          inside(box) &&
          !placement.hitsPlaced(core) &&
          !placement.hitsMarker(core)
        );
      });
    if (!pick) continue;
    placement.commit(inset(pick.box, HIT_INSET));
    out[i] = { spot: pick.spot };
  }
  return out;
}
