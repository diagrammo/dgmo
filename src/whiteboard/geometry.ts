// ============================================================
// Whiteboard diagram — connector geometry (spec §39)
// ============================================================
//
// Containment IS the binding: an arrow or line end whose stored point lies
// inside a shape is attached to it, and is drawn clipped at that shape's
// border. Nothing in the source records the attachment — it is read off the
// geometry every time, so moving a shape (and the ends inside it) keeps it.
//
// Pure functions, no DOM: the renderer uses them to draw, and the app canvas
// uses them both to draw and to learn which ends move with a shape.
//
// Every outline is the one the renderer draws, decomposed into convex pieces
// (axis-aligned rectangles and ellipses) whose UNION is the shape. The first
// point where a segment enters a union of convex pieces is the earliest entry
// into any one of them, so the clip is exact for every kind:
//   rectangle — two rectangles plus four corner circles (the rounded corners)
//   ellipse   — the ellipse
//   database  — the body rectangle plus the top and bottom cap ellipses
//   queue     — the body rectangle plus the left and right cap ellipses
//   note      — a sticky note's card: a rectangle with its top-right corner
//               cut on the diagonal (the fold), one convex polygon
//
// A sticky note is attachable exactly like a shape: "shape" below means any
// boxed element a connector end can sit in.

import { CYLINDER_RY, QUEUE_CAP } from '../shape-caps';
import type {
  WhiteboardArrow,
  WhiteboardElement,
  WhiteboardLine,
  WhiteboardNote,
  WhiteboardShape,
} from './types';

/** Corner radius of a whiteboard rectangle, before clamping to its size. */
export const RECT_RADIUS = 6;
/** Leg of a sticky note's folded top-right corner, before clamping, px. */
const NOTE_FOLD = 18;

/**
 * Leg of a sticky note's folded corner: its top-right corner is cut on the
 * diagonal this far along each edge. Shared by the renderer, the connector
 * clip and the app canvas.
 */
export function whiteboardNoteFold(width: number, height: number): number {
  return Math.max(0, Math.min(NOTE_FOLD, width / 3, height / 3));
}

/** An element a connector end can attach to: a shape or a sticky note. */
export type WhiteboardAttachable = WhiteboardShape | WhiteboardNote;

function isAttachable(el: WhiteboardElement): el is WhiteboardAttachable {
  return el.kind === 'shape' || el.kind === 'note';
}

/** Containment and collapse tolerance, px. */
const EPS = 1e-6;

export interface WhiteboardPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A drawn connector, `x1 y1` the tail and `x2 y2` the head end. A bent
 * connector also carries `cx cy`, the control point of the quadratic curve
 * it is drawn along; a straight one has none.
 */
export interface WhiteboardSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly cx?: number;
  readonly cy?: number;
}

/** Element indices of the shapes each end is attached to; -1 for a free end. */
export interface WhiteboardConnectorAttachments {
  readonly from: number;
  readonly to: number;
}

type Piece =
  | {
      readonly kind: 'rect';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
    }
  | {
      readonly kind: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    }
  | {
      /** A convex polygon, corners clockwise on screen (y down). */
      readonly kind: 'poly';
      readonly pts: readonly WhiteboardPoint[];
    };

function rect(x0: number, y0: number, x1: number, y1: number): Piece[] {
  return x1 >= x0 && y1 >= y0 ? [{ kind: 'rect', x0, y0, x1, y1 }] : [];
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Piece[] {
  return rx > 0 && ry > 0 ? [{ kind: 'ellipse', cx, cy, rx, ry }] : [];
}

/** A rounded rectangle as a union of convex pieces. */
function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): Piece[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return rect(x, y, x + w, y + h);
  return [
    ...rect(x + r, y, x + w - r, y + h),
    ...rect(x, y + r, x + w, y + h - r),
    ...ellipse(x + r, y + r, r, r),
    ...ellipse(x + w - r, y + r, r, r),
    ...ellipse(x + r, y + h - r, r, r),
    ...ellipse(x + w - r, y + h - r, r, r),
  ];
}

/** The element's drawn outline as a union of convex pieces. */
function piecesOf(s: WhiteboardAttachable): Piece[] {
  const { x, y, width: w, height: h } = s;
  if (s.kind === 'note') {
    const f = whiteboardNoteFold(w, h);
    if (f === 0) return rect(x, y, x + w, y + h);
    const pts = [
      { x, y },
      { x: x + w - f, y },
      { x: x + w, y: y + f },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    return [{ kind: 'poly', pts }];
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (s.shape) {
    case 'rectangle':
      return roundedRect(x, y, w, h, RECT_RADIUS);
    case 'ellipse':
      return ellipse(cx, cy, w / 2, h / 2);
    case 'database': {
      // drawCylinderCard: sides from y+ry to y+h-ry, a full cap ellipse on
      // top and a half one below, both w/2 × ry.
      const ry = CYLINDER_RY;
      return [
        ...rect(x, y + ry, x + w, y + h - ry),
        ...ellipse(cx, y + ry, w / 2, ry),
        ...ellipse(cx, y + h - ry, w / 2, ry),
      ];
    }
    case 'queue': {
      // drawQueueCard: a body between two caps of half-width QUEUE_CAP.
      const cap = QUEUE_CAP;
      return [
        ...rect(x + cap, y, x + w - cap, y + h),
        ...ellipse(x + cap, cy, cap, h / 2),
        ...ellipse(x + w - cap, cy, cap, h / 2),
      ];
    }
  }
}

/**
 * Each edge of a clockwise convex polygon as `[nx, ny, c]`: a point is inside
 * that edge's half-plane when `nx·x + ny·y <= c`.
 */
function halfPlanes(
  pts: readonly WhiteboardPoint[]
): [number, number, number][] {
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    // Outward normal of a clockwise (y-down) edge a → b.
    const nx = b.y - a.y;
    const ny = -(b.x - a.x);
    const len = Math.hypot(nx, ny) || 1;
    return [nx / len, ny / len, (nx * a.x + ny * a.y) / len];
  });
}

function pieceContains(p: Piece, px: number, py: number): boolean {
  if (p.kind === 'poly') {
    return halfPlanes(p.pts).every(
      ([nx, ny, c]) => nx * px + ny * py <= c + EPS
    );
  }
  if (p.kind === 'rect') {
    return (
      px >= p.x0 - EPS &&
      px <= p.x1 + EPS &&
      py >= p.y0 - EPS &&
      py <= p.y1 + EPS
    );
  }
  const nx = (px - p.cx) / p.rx;
  const ny = (py - p.cy) / p.ry;
  return nx * nx + ny * ny <= 1 + EPS;
}

/** Whether `point` lies inside (or on) the shape's or note's drawn outline. */
export function whiteboardShapeContains(
  shape: WhiteboardAttachable,
  point: WhiteboardPoint
): boolean {
  return piecesOf(shape).some((p) => pieceContains(p, point.x, point.y));
}

/**
 * Index in `elements` of the topmost shape or sticky note containing `point`
 * — the one latest in the file — or -1 when the point is on none.
 */
export function whiteboardShapeAt(
  point: WhiteboardPoint,
  elements: readonly WhiteboardElement[]
): number {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (isAttachable(el) && whiteboardShapeContains(el, point)) return i;
  }
  return -1;
}

/**
 * Which shape each end of `connector` is attached to. An end attaches to the
 * topmost shape containing it — unless the other end lies inside that same
 * shape, in which case the end stays free.
 */
export function whiteboardConnectorAttachments(
  connector: WhiteboardArrow | WhiteboardLine,
  elements: readonly WhiteboardElement[]
): WhiteboardConnectorAttachments {
  const a = { x: connector.x1, y: connector.y1 };
  const b = { x: connector.x2, y: connector.y2 };
  const attach = (end: WhiteboardPoint, other: WhiteboardPoint): number => {
    const i = whiteboardShapeAt(end, elements);
    if (i < 0) return -1;
    return whiteboardShapeContains(elements[i] as WhiteboardAttachable, other)
      ? -1
      : i;
  };
  return { from: attach(a, b), to: attach(b, a) };
}

/**
 * Parameter interval [tIn, tOut] where `a + t·(b − a)` is inside `p`, or null.
 */
function interval(
  p: Piece,
  ax: number,
  ay: number,
  dx: number,
  dy: number
): [number, number] | null {
  if (p.kind === 'poly') {
    // Cyrus–Beck: clip the line against each edge's half-plane.
    let lo = -Infinity;
    let hi = Infinity;
    for (const [nx, ny, c] of halfPlanes(p.pts)) {
      const num = c - (nx * ax + ny * ay);
      const den = nx * dx + ny * dy;
      if (Math.abs(den) < EPS) {
        if (num < -EPS) return null;
        continue;
      }
      const t = num / den;
      if (den > 0) hi = Math.min(hi, t);
      else lo = Math.max(lo, t);
    }
    return lo <= hi ? [lo, hi] : null;
  }
  if (p.kind === 'rect') {
    let lo = -Infinity;
    let hi = Infinity;
    for (const [o, d, min, max] of [
      [ax, dx, p.x0, p.x1],
      [ay, dy, p.y0, p.y1],
    ] as const) {
      if (Math.abs(d) < EPS) {
        if (o < min - EPS || o > max + EPS) return null;
        continue;
      }
      const t0 = (min - o) / d;
      const t1 = (max - o) / d;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
    return lo <= hi ? [lo, hi] : null;
  }
  // Scale to the unit circle: |o + t·d|² = 1.
  const ox = (ax - p.cx) / p.rx;
  const oy = (ay - p.cy) / p.ry;
  const ux = dx / p.rx;
  const uy = dy / p.ry;
  const qa = ux * ux + uy * uy;
  const qb = 2 * (ox * ux + oy * uy);
  const qc = ox * ox + oy * oy - 1;
  const disc = qb * qb - 4 * qa * qc;
  if (qa === 0 || disc < 0) return null;
  const s = Math.sqrt(disc);
  return [(-qb - s) / (2 * qa), (-qb + s) / (2 * qa)];
}

/**
 * The first `t` in [0, 1] at which the segment `a → b` enters `shape`.
 * `a` is outside the shape and `b` inside it, so an entry always exists.
 */
function entryParam(
  shape: WhiteboardAttachable,
  a: WhiteboardPoint,
  b: WhiteboardPoint
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let best = 1;
  for (const p of piecesOf(shape)) {
    const iv = interval(p, a.x, a.y, dx, dy);
    if (!iv || iv[1] < 0 || iv[0] > 1) continue;
    best = Math.min(best, Math.max(0, iv[0]));
  }
  return best;
}

/**
 * The segment a connector is DRAWN along: each attached end aimed at its
 * shape's centre — wherever inside the shape the stored point sits — then
 * pulled back to where the segment first crosses that shape's outline, so an
 * arrowhead sits on the border and a plain line meets the edge. Falls back to
 * the stored segment when it has no length, or when clipping both ends would
 * leave nothing (the ends' shapes overlap along it).
 */
export function clipWhiteboardConnector(
  connector: WhiteboardArrow | WhiteboardLine,
  elements: readonly WhiteboardElement[]
): WhiteboardSegment {
  const { x1, y1, x2, y2 } = connector;
  const stored = { x1, y1, x2, y2 };
  if (Math.hypot(x2 - x1, y2 - y1) < EPS) return stored;
  const { from, to } = whiteboardConnectorAttachments(connector, elements);
  if (connector.bend !== 0) return clipCurve(connector, elements, from, to);
  if (from < 0 && to < 0) return stored;
  const { a, b } = aimedEnds(connector, elements, from, to);
  if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) return stored;
  // Each end measured from the OTHER stored point, so a border point comes
  // out exact rather than as 1 − t.
  const uEnd =
    to < 0 ? 1 : entryParam(elements[to] as WhiteboardAttachable, a, b);
  const uStart =
    from < 0 ? 1 : entryParam(elements[from] as WhiteboardAttachable, b, a);
  if (uEnd + uStart - 1 < EPS) return stored;
  return {
    x1: b.x + (a.x - b.x) * uStart,
    y1: b.y + (a.y - b.y) * uStart,
    x2: a.x + (b.x - a.x) * uEnd,
    y2: a.y + (b.y - a.y) * uEnd,
  };
}

/** Each end aimed at its attached shape's centre; a free end stays put. */
function aimedEnds(
  connector: WhiteboardArrow | WhiteboardLine,
  elements: readonly WhiteboardElement[],
  from: number,
  to: number
): { a: WhiteboardPoint; b: WhiteboardPoint } {
  const centre = (i: number, x: number, y: number): WhiteboardPoint => {
    if (i < 0) return { x, y };
    const s = elements[i] as WhiteboardAttachable;
    return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  };
  return {
    a: centre(from, connector.x1, connector.y1),
    b: centre(to, connector.x2, connector.y2),
  };
}

/**
 * The frame a bend is measured in: the aimed chord's ends, its midpoint and
 * its unit normal to the RIGHT of travel on screen (y down), or null when the
 * chord has no length.
 */
function bendFrame(
  connector: WhiteboardArrow | WhiteboardLine,
  elements: readonly WhiteboardElement[]
): {
  a: WhiteboardPoint;
  b: WhiteboardPoint;
  mid: WhiteboardPoint;
  nx: number;
  ny: number;
} | null {
  const { from, to } = whiteboardConnectorAttachments(connector, elements);
  const { a, b } = aimedEnds(connector, elements, from, to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  return {
    a,
    b,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    nx: -dy / len,
    ny: dx / len,
  };
}

/**
 * Where a connector's bend handle sits: on the curve, halfway along it —
 * `bend` px off the middle of the aimed chord. A straight connector's handle
 * is the chord's midpoint.
 */
export function whiteboardBendHandle(
  connector: WhiteboardArrow | WhiteboardLine,
  elements: readonly WhiteboardElement[]
): WhiteboardPoint {
  const f = bendFrame(connector, elements);
  if (!f) return { x: connector.x1, y: connector.y1 };
  return {
    x: f.mid.x + f.nx * connector.bend,
    y: f.mid.y + f.ny * connector.bend,
  };
}

/**
 * The `bend:` that puts the handle nearest `p` — its signed distance from the
 * aimed chord, rounded to a whole px. Callers snap small values to 0.
 */
export function whiteboardBendFor(
  connector: WhiteboardArrow | WhiteboardLine,
  elements: readonly WhiteboardElement[],
  p: WhiteboardPoint
): number {
  const f = bendFrame(connector, elements);
  if (!f) return 0;
  return Math.round((p.x - f.mid.x) * f.nx + (p.y - f.mid.y) * f.ny);
}

/** Steps a curve is walked in to find where it leaves an end's shape. */
const CURVE_STEPS = 64;

/** A point on the quadratic `a → b` with control `c`. */
function quad(
  a: WhiteboardPoint,
  c: WhiteboardPoint,
  b: WhiteboardPoint,
  t: number
): WhiteboardPoint {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/**
 * A bent connector: one quadratic through the bend handle, each attached end
 * pulled back to where the curve crosses its shape's outline — the curve
 * analogue of the straight clip above. The drawn piece of a quadratic is
 * itself a quadratic, so the result is still one control point.
 */
function clipCurve(
  connector: WhiteboardArrow | WhiteboardLine,
  elements: readonly WhiteboardElement[],
  from: number,
  to: number
): WhiteboardSegment {
  const { x1, y1, x2, y2 } = connector;
  const f = bendFrame(connector, elements);
  if (!f) return { x1, y1, x2, y2 };
  const { a, b } = f;
  const h = {
    x: f.mid.x + f.nx * connector.bend,
    y: f.mid.y + f.ny * connector.bend,
  };
  const c = { x: 2 * h.x - f.mid.x, y: 2 * h.y - f.mid.y };
  const inside = (i: number, t: number): boolean => {
    const p = quad(a, c, b, t);
    return whiteboardShapeContains(elements[i] as WhiteboardAttachable, p);
  };
  // The last t still inside shape `i`, walking from `start` towards `end`.
  const leave = (i: number, start: number, end: number): number => {
    let inT = start;
    for (let k = 1; k <= CURVE_STEPS; k++) {
      const t = start + ((end - start) * k) / CURVE_STEPS;
      if (!inside(i, t)) {
        let lo = inT;
        let hi = t;
        for (let n = 0; n < 24; n++) {
          const m = (lo + hi) / 2;
          if (inside(i, m)) lo = m;
          else hi = m;
        }
        return (lo + hi) / 2;
      }
      inT = t;
    }
    return end;
  };
  const t0 = from < 0 ? 0 : leave(from, 0, 1);
  const t1 = to < 0 ? 1 : leave(to, 1, 0);
  const [s0, s1] = t1 - t0 > EPS ? [t0, t1] : [0, 1];
  const p0 = quad(a, c, b, s0);
  const p1 = quad(a, c, b, s1);
  // Blossom of the sub-curve [s0, s1]: its control point.
  const w0 = (1 - s0) * (1 - s1);
  const w1 = (1 - s0) * s1 + s0 * (1 - s1);
  const w2 = s0 * s1;
  return {
    x1: p0.x,
    y1: p0.y,
    x2: p1.x,
    y2: p1.y,
    cx: w0 * a.x + w1 * c.x + w2 * b.x,
    cy: w0 * a.y + w1 * c.y + w2 * b.y,
  };
}

/**
 * The point a connector's label is centred on: halfway along what is drawn —
 * the segment's midpoint, or the curve's point at t = ½.
 */
export function whiteboardSegmentMidpoint(
  s: WhiteboardSegment
): WhiteboardPoint {
  if (s.cx === undefined || s.cy === undefined) {
    return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  }
  return {
    x: (s.x1 + 2 * s.cx + s.x2) / 4,
    y: (s.y1 + 2 * s.cy + s.y2) / 4,
  };
}
