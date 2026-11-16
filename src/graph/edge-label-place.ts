// Edge-label placement shared by the state and flowchart renderers (#1948).
// dagre reserves no room for an edge label, so a label at its edge's middle
// can land on a node. A label that does is moved along its edge to the
// nearest spot whose box clears every obstacle; with no clear spot it stays
// where it was.

export interface ObstacleBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

type Pt = { readonly x: number; readonly y: number };

/** Fractions of the edge's length tried in turn, nearest the middle first. */
const STOPS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
/** Space kept between a label's box and an obstacle. */
const CLEARANCE = 2;

/** The label's drawn box for a centre: the renderers draw it at
 *  (cx - w/2, cy - h/2 - 1). */
function boxAt(cx: number, cy: number, w: number, h: number): ObstacleBox {
  return { x: cx - w / 2, y: cy - h / 2 - 1, w, h };
}

function clear(b: ObstacleBox, obstacles: readonly ObstacleBox[]): boolean {
  for (const o of obstacles) {
    if (
      b.x < o.x + o.w + CLEARANCE &&
      o.x - CLEARANCE < b.x + b.w &&
      b.y < o.y + o.h + CLEARANCE &&
      o.y - CLEARANCE < b.y + b.h
    )
      return false;
  }
  return true;
}

/** The point at fraction `t` of the route's length, with its direction. */
function along(
  route: readonly Pt[],
  t: number
): { x: number; y: number; dx: number; dy: number } | null {
  let total = 0;
  for (let i = 1; i < route.length; i++)
    total += Math.hypot(
      route[i]!.x - route[i - 1]!.x,
      route[i]!.y - route[i - 1]!.y
    );
  if (total === 0) return null;
  let want = total * t;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    if (want <= seg || i === route.length - 1) {
      const f = Math.min(1, want / seg);
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        dx: (b.x - a.x) / seg,
        dy: (b.y - a.y) / seg,
      };
    }
    want -= seg;
  }
  return null;
}

/**
 * Where an edge label goes. `start` is the renderer's usual spot; it is kept
 * when its box is clear. Otherwise each stop along `route` is tried, on the
 * line and then a label's height to either side of it, and the first clear
 * one wins. No clear spot keeps `start`.
 */
export function clearEdgeLabel(
  route: readonly Pt[],
  start: Pt,
  w: number,
  h: number,
  obstacles: readonly ObstacleBox[]
): Pt {
  if (clear(boxAt(start.x, start.y, w, h), obstacles)) return start;
  if (route.length < 2) return start;
  for (const t of STOPS) {
    const p = along(route, t);
    if (!p) return start;
    // Perpendicular to the edge: sideways for a vertical run, up/down for a
    // horizontal one, with the offset sized to the label's own box.
    const off = Math.abs(p.dx) > Math.abs(p.dy) ? h / 2 + 4 : w / 2 + 4;
    for (const s of [0, 1, -1]) {
      const c = { x: p.x - p.dy * off * s, y: p.y + p.dx * off * s };
      if (clear(boxAt(c.x, c.y, w, h), obstacles)) return c;
    }
  }
  return start;
}
