// ============================================================
// Swimlane Diagram — obstacle-aware orthogonal routing
// ============================================================
//
// The rule (#1874): an edge never passes through a node box. The layout's
// cheap routes (straight, one bend at a column gap, the loop channel) are
// tried first; any route that enters a box — and every message flow and
// boundary-event exit — goes through `routeAround`, a shortest-path search on
// a sparse grid built from the boxes' own edges. Bends cost extra, so the
// search prefers the fewest turns among the clear routes.
//
// Everything here works in final (projected) x/y, the same coordinates the
// renderer draws, so a test that reads rendered paths checks the same thing.

export interface Pt {
  x: number;
  y: number;
}

/** Axis-aligned box, corners (x1, y1) top-left and (x2, y2) bottom-right. */
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A unit direction: one of (±1, 0) or (0, ±1). */
export interface Dir {
  dx: number;
  dy: number;
}

/** Where a route ends: a port on a box side, or anywhere along a bar edge. */
export type RouteGoal =
  | { kind: 'port'; at: Pt; out: Dir }
  | {
      /** Reach the line `axis = value`, between `from` and `to` on the other axis. */
      kind: 'line';
      axis: 'x' | 'y';
      value: number;
      from: number;
      to: number;
      /** Direction pointing away from the bar, toward where the route comes from. */
      out: Dir;
    };

/** A drawn segment another route should not run along. */
export type Seg = readonly [Pt, Pt];

/** Two parallel runs closer than this read as one line. */
const NEAR = 4;
/** Cost per unit of length run along an existing line (vs 1 for clear). */
export const OVERLAP_COST = 8;

/** Length over which segment a→b runs on top of segment c→d. */
function segOverlap(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const h1 = Math.abs(a.y - b.y) < 0.01;
  const h2 = Math.abs(c.y - d.y) < 0.01;
  const v1 = Math.abs(a.x - b.x) < 0.01;
  const v2 = Math.abs(c.x - d.x) < 0.01;
  if (h1 && h2 && !v1 && !v2) {
    if (Math.abs(a.y - c.y) >= NEAR) return 0;
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    return Math.max(0, hi - lo);
  }
  if (v1 && v2 && !h1 && !h2) {
    if (Math.abs(a.x - c.x) >= NEAR) return 0;
    const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    return Math.max(0, hi - lo);
  }
  return 0;
}

/** Total length of the polyline that runs on top of any of `segs`. */
export function overlapLength(
  pts: readonly Pt[],
  segs: readonly Seg[]
): number {
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++)
    for (const [c, d] of segs) total += segOverlap(pts[i]!, pts[i + 1]!, c, d);
  return total;
}

/** The segments of a polyline. */
export function segmentsOf(pts: readonly Pt[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i]!, pts[i + 1]!]);
  return out;
}

/** Gap kept between a routed line and any box it passes. */
const CLEAR = 10;
/** Length of the straight run out of a port before the first bend. */
export const PORT_STUB = 14;
const BEND_COST = 36;
const EPS = 0.5;

/** True when segment a→b enters the interior of `box` (touching is fine). */
export function segmentHitsBox(a: Pt, b: Pt, box: Box, pad = 0): boolean {
  const x1 = box.x1 - pad + EPS;
  const x2 = box.x2 + pad - EPS;
  const y1 = box.y1 - pad + EPS;
  const y2 = box.y2 + pad - EPS;
  if (x1 >= x2 || y1 >= y2) return false;
  // Liang–Barsky clip of the segment against the shrunk box.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - x1)) return false;
  if (!clip(dx, x2 - a.x)) return false;
  if (!clip(-dy, a.y - y1)) return false;
  if (!clip(dy, y2 - a.y)) return false;
  return t0 < t1;
}

/** True when any segment of the polyline enters any of the boxes. */
export function pathHitsBoxes(
  pts: readonly Pt[],
  boxes: readonly Box[]
): boolean {
  for (let i = 0; i + 1 < pts.length; i++)
    for (const b of boxes)
      if (segmentHitsBox(pts[i]!, pts[i + 1]!, b)) return true;
  return false;
}

const inside = (p: Pt, b: Box, pad: number): boolean =>
  p.x > b.x1 - pad + EPS &&
  p.x < b.x2 + pad - EPS &&
  p.y > b.y1 - pad + EPS &&
  p.y < b.y2 + pad - EPS;

/** Drop interior points of straight runs (and zero-length steps). */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01)
      continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out[out.length - 3]!;
      const b = out[out.length - 2]!;
      const c = out[out.length - 1]!;
      const colinear =
        (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
        (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
      if (!colinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/** Small binary min-heap keyed on cost. */
class Heap {
  private items: Array<[number, number]> = [];
  get size(): number {
    return this.items.length;
  }
  push(cost: number, v: number): void {
    const a = this.items;
    a.push([cost, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

const DIRS: readonly Dir[] = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
const dirIndex = (d: Dir): number =>
  d.dx === 1 ? 0 : d.dx === -1 ? 1 : d.dy === 1 ? 2 : 3;

/**
 * Shortest clear orthogonal route from `start` (leaving along `startOut`) to
 * `goal`, avoiding `boxes` by `CLEAR`. Returns the full polyline, port to
 * port, or null when no clear route exists on the grid.
 */
export function routeAround(
  start: Pt,
  startOut: Dir,
  goal: RouteGoal,
  boxes: readonly Box[],
  extra: {
    xs?: readonly number[];
    ys?: readonly number[];
    /** Lines already drawn: running along one costs OVERLAP_COST per unit. */
    avoid?: readonly Seg[];
  } = {}
): Pt[] | null {
  const avoid = extra.avoid ?? [];
  const s0: Pt = {
    x: start.x + startOut.dx * PORT_STUB,
    y: start.y + startOut.dy * PORT_STUB,
  };
  const blockedPt = (p: Pt): boolean =>
    boxes.some((b) => inside(p, b, CLEAR - 1));
  if (blockedPt(s0)) return null;

  let g0: Pt | null = null;
  if (goal.kind === 'port') {
    g0 = {
      x: goal.at.x + goal.out.dx * PORT_STUB,
      y: goal.at.y + goal.out.dy * PORT_STUB,
    };
    if (blockedPt(g0)) return null;
  }
  const lineStub =
    goal.kind === 'line'
      ? goal.value + (goal.axis === 'y' ? goal.out.dy : goal.out.dx) * PORT_STUB
      : 0;

  // Grid lines: each box's sides pushed out by CLEAR, the midpoints between
  // neighbouring lines (corridor centres), and the two stubs.
  const xsSet = new Set<number>([s0.x, ...(extra.xs ?? [])]);
  const ysSet = new Set<number>([s0.y, ...(extra.ys ?? [])]);
  if (g0) {
    xsSet.add(g0.x);
    ysSet.add(g0.y);
  } else if (goal.kind === 'line') {
    if (goal.axis === 'y') {
      ysSet.add(lineStub);
      xsSet.add(Math.min(Math.max(s0.x, goal.from), goal.to));
    } else {
      xsSet.add(lineStub);
      ysSet.add(Math.min(Math.max(s0.y, goal.from), goal.to));
    }
  }
  // A free track beside every drawn line, so the search can run parallel to
  // one instead of on top of it.
  for (const [c, d] of avoid) {
    if (Math.abs(c.x - d.x) < 0.01) {
      xsSet.add(c.x - CLEAR);
      xsSet.add(c.x + CLEAR);
    } else if (Math.abs(c.y - d.y) < 0.01) {
      ysSet.add(c.y - CLEAR);
      ysSet.add(c.y + CLEAR);
    }
  }
  for (const b of boxes) {
    xsSet.add(b.x1 - CLEAR);
    xsSet.add(b.x2 + CLEAR);
    ysSet.add(b.y1 - CLEAR);
    ysSet.add(b.y2 + CLEAR);
  }
  const withMids = (set: Set<number>): number[] => {
    const v = [...set].sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < v.length; i++) {
      out.push(v[i]!);
      if (i + 1 < v.length && v[i + 1]! - v[i]! > 2 * CLEAR)
        out.push((v[i]! + v[i + 1]!) / 2);
    }
    return out;
  };
  const xs = withMids(xsSet);
  const ys = withMids(ysSet);
  const W = xs.length;
  const H = ys.length;
  const idx = (xi: number, yi: number): number => yi * W + xi;
  const free = new Uint8Array(W * H);
  for (let yi = 0; yi < H; yi++)
    for (let xi = 0; xi < W; xi++)
      free[idx(xi, yi)] = blockedPt({ x: xs[xi]!, y: ys[yi]! }) ? 0 : 1;

  const near = (arr: number[], v: number): number => {
    let best = 0;
    for (let i = 1; i < arr.length; i++)
      if (Math.abs(arr[i]! - v) < Math.abs(arr[best]! - v)) best = i;
    return best;
  };
  const sIdx = idx(near(xs, s0.x), near(ys, s0.y));
  const isGoal = (xi: number, yi: number): boolean => {
    if (g0)
      return Math.abs(xs[xi]! - g0.x) < 0.01 && Math.abs(ys[yi]! - g0.y) < 0.01;
    if (goal.kind !== 'line') return false;
    if (goal.axis === 'y')
      return (
        Math.abs(ys[yi]! - lineStub) < 0.01 &&
        xs[xi]! >= goal.from - 0.01 &&
        xs[xi]! <= goal.to + 0.01
      );
    return (
      Math.abs(xs[xi]! - lineStub) < 0.01 &&
      ys[yi]! >= goal.from - 0.01 &&
      ys[yi]! <= goal.to + 0.01
    );
  };
  // The direction the route must travel on its last stub.
  const arrive: Dir = { dx: -goal.out.dx, dy: -goal.out.dy };

  const segClear = (a: Pt, b: Pt): boolean =>
    !boxes.some((bx) => segmentHitsBox(a, b, bx, CLEAR - 1));

  const N = W * H * 4;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new Heap();
  const startState = sIdx * 4 + dirIndex(startOut);
  dist[startState] = 0;
  heap.push(0, startState);
  let found = -1;
  while (heap.size > 0) {
    const [d, st] = heap.pop();
    if (d > dist[st]!) continue;
    const node = st >> 2;
    const di = st & 3;
    const xi = node % W;
    const yi = (node - xi) / W;
    if (isGoal(xi, yi)) {
      const dir = DIRS[di]!;
      if (dir.dx === arrive.dx && dir.dy === arrive.dy) {
        found = st;
        break;
      }
      // Turning onto the final stub costs one bend.
      const ts = node * 4 + dirIndex(arrive);
      if (d + BEND_COST < dist[ts]!) {
        dist[ts] = d + BEND_COST;
        prev[ts] = st;
        heap.push(d + BEND_COST, ts);
      }
      continue;
    }
    for (let k = 0; k < 4; k++) {
      const dir = DIRS[k]!;
      // No U-turns.
      if (dir.dx === -DIRS[di]!.dx && dir.dy === -DIRS[di]!.dy) continue;
      const nx = xi + dir.dx;
      const ny = yi + dir.dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nNode = idx(nx, ny);
      if (!free[nNode]) continue;
      const a = { x: xs[xi]!, y: ys[yi]! };
      const b = { x: xs[nx]!, y: ys[ny]! };
      if (!segClear(a, b)) continue;
      let over = 0;
      for (const [c, e] of avoid) over += segOverlap(a, b, c, e);
      const step =
        Math.abs(b.x - a.x) +
        Math.abs(b.y - a.y) +
        (k === di ? 0 : BEND_COST) +
        OVERLAP_COST * over;
      const ns = nNode * 4 + k;
      if (d + step < dist[ns]!) {
        dist[ns] = d + step;
        prev[ns] = st;
        heap.push(d + step, ns);
      }
    }
  }
  if (found < 0) return null;
  const rev: Pt[] = [];
  for (let st = found; st >= 0; st = prev[st]!) {
    const node = st >> 2;
    const xi = node % W;
    const yi = (node - xi) / W;
    rev.push({ x: xs[xi]!, y: ys[yi]! });
  }
  rev.reverse();
  const tail: Pt =
    goal.kind === 'port'
      ? goal.at
      : goal.axis === 'y'
        ? { x: rev[rev.length - 1]!.x, y: goal.value }
        : { x: goal.value, y: rev[rev.length - 1]!.y };
  return simplify([start, ...rev, tail]);
}
