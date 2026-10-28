import type { LabelRect } from '../label-layout';

/**
 * Inline label placement for a lone POI dot — the slot a singleton's label takes
 * beside its own marker, chosen from eight candidates around it.
 *
 * Pure geometry: everything the choice reads arrives in the arguments, so a test
 * can drive it with hand-made dots and no map. `layoutMap` supplies the real
 * obstacles (`collides`) and the land/water sampler (`openness`).
 */

/** Candidate inline placements around a marker, in escalation order: the four
 *  cardinal sides first (most legible — horizontal flanks, then above/below for
 *  a hub whose edges leave sideways and block both flanks, e.g. a POI fed by
 *  routes from the east AND west). The four DIAGONAL corners are a fallback tier
 *  (standard 8-position cartographic placement): a route hub fed from several
 *  cardinal directions leaves the diagonal gaps open, so a corner label clears
 *  the arrows + neighbour dots instead of being dumped on top of them. */
export type DotLabelSide =
  | 'right'
  | 'left'
  | 'above'
  | 'below'
  | 'below-right'
  | 'below-left'
  | 'above-right'
  | 'above-left';

/** A marker as label placement sees it: screen centre and radius. */
export interface LabelDot {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** A connector piece as `[x1, y1, x2, y2]` in screen px. */
export type LabelSegment = readonly [number, number, number, number];

/** px between a dot's rim and its inline label. */
export const DOT_LABEL_GAP = 3;

/** The label box for `side` of `dot`, `w`×`h` px. */
export function dotLabelRect(
  dot: LabelDot,
  w: number,
  h: number,
  side: DotLabelSide
): LabelRect {
  const GAP = DOT_LABEL_GAP;
  switch (side) {
    case 'right':
      return { x: dot.cx + dot.r + GAP, y: dot.cy - h / 2, w, h };
    case 'left':
      return { x: dot.cx - dot.r - GAP - w, y: dot.cy - h / 2, w, h };
    case 'above':
      return { x: dot.cx - w / 2, y: dot.cy - dot.r - GAP - h, w, h };
    case 'below':
      return { x: dot.cx - w / 2, y: dot.cy + dot.r + GAP, w, h };
    // Diagonal corners: offset both axes by (r+GAP)/√2 so the box's near
    // corner clears the dot rim by the same gap as a cardinal side.
    case 'below-right': {
      const d = (dot.r + GAP) * 0.7071;
      return { x: dot.cx + d, y: dot.cy + d, w, h };
    }
    case 'below-left': {
      const d = (dot.r + GAP) * 0.7071;
      return { x: dot.cx - d - w, y: dot.cy + d, w, h };
    }
    case 'above-right': {
      const d = (dot.r + GAP) * 0.7071;
      return { x: dot.cx + d, y: dot.cy - d - h, w, h };
    }
    case 'above-left': {
      const d = (dot.r + GAP) * 0.7071;
      return { x: dot.cx - d - w, y: dot.cy - d - h, w, h };
    }
  }
}

/** True when `rect` lies wholly on the `width`×`height` canvas and hits nothing. */
export function dotLabelFits(
  rect: LabelRect,
  width: number,
  height: number,
  collides: (rect: LabelRect) => boolean
): boolean {
  return (
    rect.x >= 0 &&
    rect.x + rect.w <= width &&
    rect.y >= 0 &&
    rect.y + rect.h <= height &&
    !collides(rect)
  );
}

// Placement quality for a singleton's inline label. Beyond the hard collision
// veto (dotLabelFits drops any slot that overlaps a dot/label/arrow), we rank
// the SURVIVING candidates so the label takes the roomiest slot, not just the
// first clean cardinal flank. Three terms:
//   • clearance (PRIMARY) — how far the slot sits from the NEAREST other POI
//     dot and the nearest connector arrow (capped). This is what makes a hub
//     run its label out into the open AWAY from a neighbour cluster + the legs,
//     rather than hugging them on a technically-clean flank.
//   • openness (secondary tiebreaker) — water-facing + canvas-edge clearance
//     (the caller's sampler), down-weighted so a roomy slot beats a cramped one
//     even when the cramped slot sits over slightly more open water.
//   • legibility (tertiary) — a mild prior: horizontal flanks read best, then
//     above/below, then the diagonal corners. Breaks near-ties toward the
//     conventional layout without overriding a clearly roomier slot.
const CLEAR_CAP = 48; // px past which a slot already reads as wide-open
const CLEAR_W = 8; // weight on clearance (CLEAR_CAP·W ≈ 384 — the dominant term)
const WATER_W = 0.25; // down-weight the openness term to a tiebreaker (≤ ~250)
const LEGIBILITY: Record<DotLabelSide, number> = {
  right: 160,
  left: 160,
  above: 100,
  below: 100,
  'below-right': 0,
  'below-left': 0,
  'above-right': 0,
  'above-left': 0,
};
const ALL_SIDES = Object.keys(LEGIBILITY) as DotLabelSide[];

function ptSegDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function clearanceOf(
  rect: LabelRect,
  ownId: string,
  dots: readonly LabelDot[],
  segments: readonly LabelSegment[]
): number {
  const cxL = rect.x + rect.w / 2;
  const cyL = rect.y + rect.h / 2;
  let d = CLEAR_CAP;
  for (const q of dots) {
    if (q.id === ownId) continue; // its own dot is meant to be adjacent
    d = Math.min(d, Math.hypot(q.cx - cxL, q.cy - cyL) - q.r);
  }
  for (const s of segments)
    d = Math.min(d, ptSegDist(cxL, cyL, s[0], s[1], s[2], s[3]));
  return Math.max(0, d);
}

/**
 * The roomiest clean inline slot for `dot`'s `w`×`h` label, or null when every
 * one of the eight is off-canvas or collides. Ties keep the earlier side in
 * escalation order.
 */
export function placeDotLabel(args: {
  readonly dot: LabelDot;
  /** Label box size in px. */
  readonly w: number;
  readonly h: number;
  /** Canvas size in px; a slot must lie wholly inside it. */
  readonly width: number;
  readonly height: number;
  /** Hard veto: true when a slot overlaps a marker, a committed label or a leg. */
  readonly collides: (rect: LabelRect) => boolean;
  /** Every dot on the map; `dot` itself is skipped by id. */
  readonly dots: readonly LabelDot[];
  /** Connector pieces the label should keep clear of. */
  readonly segments: readonly LabelSegment[];
  /** Open-space score of a slot (higher = more open). */
  readonly openness: (rect: LabelRect) => number;
}): { readonly side: DotLabelSide; readonly rect: LabelRect } | null {
  const { dot, w, h, width, height, collides, dots, segments, openness } = args;
  let best: { side: DotLabelSide; rect: LabelRect; v: number } | null = null;
  for (const side of ALL_SIDES) {
    const rect = dotLabelRect(dot, w, h, side);
    if (!dotLabelFits(rect, width, height, collides)) continue;
    const v =
      CLEAR_W * clearanceOf(rect, dot.id, dots, segments) +
      WATER_W * openness(rect) +
      LEGIBILITY[side];
    if (best === null || v > best.v) best = { side, rect, v };
  }
  return best && { side: best.side, rect: best.rect };
}
