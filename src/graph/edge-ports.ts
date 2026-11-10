// ============================================================
// Edge ports — unbundle edges that dagre lands on one spot (#1839)
// ============================================================
//
// Two defects, one pass, run on the final routes before anything reads them:
//
// 1. Parallel edges. dagre keeps one edge per (source, target) pair, so every
//    edge of such a pair gets the SAME route and they draw as one curve —
//    two transitions with different labels look like one. A
//    dagre multigraph would route them apart, but dagre 3.1.1 leaves a dummy
//    node unpositioned on some cyclic graphs with a parallel pair and throws
//    ("Not possible to find intersection inside of the rectangle"). So the
//    pair is fanned here instead: each label's copy has its waypoints moved
//    sideways off the shared route by `PARALLEL_GAP`, its endpoints along the
//    node side.
// 2. Converging arrivals. Edges from different sources can end within a few
//    pixels of each other on one side of their target, so their arrowheads
//    overlap and read as one. Arrivals on one side closer than
//    `MIN_ARRIVAL_GAP` are spread apart along that side, unless that adds a
//    crossing anywhere in the diagram.
// 3. Oblique arrivals. dagre aims an edge's last segment at its target's
//    centre, so an edge coming in from the side meets the box face at a
//    slant — up to 72° off square in the gallery — and the arrowhead, which
//    follows the curve's end tangent, points into the box at that slant. Two
//    waypoints are inserted on the line square to the face (the centre's ray
//    for a pseudostate's circle), so the curve turns before it arrives and
//    runs straight in, `APPROACH` px, under its arrowhead. Kept unless it
//    adds a crossing.
//
// Only edges with something to fix move; every other route is returned as is.

type Pt = { readonly x: number; readonly y: number };

/** A node box, centred on (x, y). */
export interface PortBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * The node's shape. A `pseudostate` (a circle) is arrived at along its
   * centre's ray; a `decision` keeps its route, since the renderer
   * re-projects its endpoint onto the diamond. Any other shape is a box.
   */
  readonly shape?: string;
}

/** Space between the routes of a parallel pair — dagre's own `edgesep`. */
const PARALLEL_GAP = 20;
/** The least space between two arrowheads on one node side: wider than one. */
const MIN_ARRIVAL_GAP = 14;
/** An endpoint keeps at least this far from its side's corners. */
const CORNER_MARGIN = 4;
/**
 * How long the straight run is that an arrival ends on, square to its
 * target's face: longer than the arrowhead (`ARROWHEAD_WIDTH`, 10), so the
 * curve is straight under the whole head. Capped at 0.4 of the room the
 * last waypoint leaves in front of the face.
 */
const APPROACH = 12;
/** Below this straight run an arrival keeps dagre's slant. */
const MIN_APPROACH = 8;
/** An arrival whose last segment is this close to square is left alone. */
const SQUARE_SLACK = 0.5;

type Side = 'left' | 'right' | 'top' | 'bottom';

function sideOf(p: Pt, b: PortBox): Side {
  const d: [Side, number][] = [
    ['left', Math.abs(p.x - (b.x - b.width / 2))],
    ['right', Math.abs(p.x - (b.x + b.width / 2))],
    ['top', Math.abs(p.y - (b.y - b.height / 2))],
    ['bottom', Math.abs(p.y - (b.y + b.height / 2))],
  ];
  d.sort((a, c) => a[1] - c[1]);
  return d[0]![0];
}

const vertical = (s: Side): boolean => s === 'left' || s === 'right';

/** The range an endpoint may slide in along `side`, corners kept clear. */
function sideRange(b: PortBox, side: Side): [number, number] {
  const half = (vertical(side) ? b.height : b.width) / 2;
  const c = vertical(side) ? b.y : b.x;
  const m = Math.min(CORNER_MARGIN, half);
  return [c - half + m, c + half - m];
}

/** `p` slid along `side` to coordinate `t` (clamped), staying on the side. */
function slide(p: Pt, b: PortBox, side: Side, t: number): Pt {
  const [lo, hi] = sideRange(b, side);
  const at = Math.min(hi, Math.max(lo, t));
  return vertical(side) ? { x: p.x, y: at } : { x: at, y: p.y };
}

const along = (p: Pt, side: Side): number => (vertical(side) ? p.y : p.x);

/** Fans one parallel copy `off` px to the left of the route's direction. */
function fanRoute(
  pts: readonly Pt[],
  off: number,
  from: PortBox | undefined,
  to: PortBox | undefined
): Pt[] {
  const n = pts.length;
  const out: Pt[] = pts.slice();
  const normal = (i: number): Pt => {
    const a = pts[Math.max(0, i - 1)]!;
    const c = pts[Math.min(n - 1, i + 1)]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  for (let i = 1; i < n - 1; i++) {
    const nv = normal(i);
    out[i] = { x: pts[i]!.x + nv.x * off, y: pts[i]!.y + nv.y * off };
  }
  const end = (i: number, box: PortBox | undefined): void => {
    if (!box) return;
    const p = pts[i]!;
    const nv = normal(i);
    const side = sideOf(p, box);
    const shift = vertical(side) ? nv.y * off : nv.x * off;
    out[i] = slide(p, box, side, along(p, side) + shift);
  };
  end(0, from);
  end(n - 1, to);
  return out;
}

/**
 * Spreads arrivals on one side of one node to at least `MIN_ARRIVAL_GAP`
 * apart, keeping their order and their centre; the side's length caps it.
 */
function spreadSide(
  routes: Pt[][],
  idx: number[],
  box: PortBox,
  side: Side
): boolean {
  const at = (i: number): number => along(routes[i]!.at(-1)!, side);
  // Where each arrives along the side, and where its last waypoint sits.
  const from = (i: number): number => {
    const r = routes[i]!;
    return along(r[Math.max(0, r.length - 2)]!, side);
  };
  const [lo, hi] = sideRange(box, side);
  const gap = Math.min(MIN_ARRIVAL_GAP, (hi - lo) / (idx.length - 1));
  // Clusters: runs of neighbours closer than the gap. Spreading one can bring
  // it within the gap of the next, so the pass repeats until none is left.
  let moved = false;
  for (let pass = 0; pass < idx.length; pass++) {
    const order = idx
      .slice()
      .sort((a, b) => at(a) - at(b) || from(a) - from(b));
    if (!spreadClusters(routes, order, box, side, gap, lo, hi, at, from)) break;
    moved = true;
  }
  return moved;
}

function spreadClusters(
  routes: Pt[][],
  order: readonly number[],
  box: PortBox,
  side: Side,
  gap: number,
  lo: number,
  hi: number,
  at: (i: number) => number,
  from: (i: number) => number
): boolean {
  let moved = false;
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (
      j + 1 < order.length &&
      at(order[j + 1]!) - at(order[j]!) < gap - 0.01
    )
      j++;
    if (j > k) {
      moved = true;
      // Inside a cluster the arrivals are laid out in the order they come
      // from, so spreading them never makes two cross.
      const run = order.slice(k, j + 1).sort((a, b) => from(a) - from(b));
      const mid = run.reduce((s, i) => s + at(i), 0) / run.length;
      let start = mid - (gap * (run.length - 1)) / 2;
      start = Math.max(lo, Math.min(hi - gap * (run.length - 1), start));
      run.forEach((i, r) => {
        const pts = routes[i]!;
        pts[pts.length - 1] = slide(pts.at(-1)!, box, side, start + gap * r);
      });
    }
    k = j + 1;
  }
  return moved;
}

/** The outward normal of a box face. */
function faceNormal(side: Side): Pt {
  if (vertical(side)) return { x: side === 'left' ? -1 : 1, y: 0 };
  return { x: 0, y: side === 'top' ? -1 : 1 };
}

/**
 * `pts` ending at `end` and arriving square to the outward normal `nv`: two
 * waypoints on the square line, `d` and `2d` out — a basis curve whose last
 * three control points are collinear runs straight over its last `d`.
 * `'square'` when the last segment already is, null when the last waypoint
 * leaves too little room in front of the face.
 */
function approach(
  pts: readonly Pt[],
  end: Pt,
  nv: Pt
): readonly Pt[] | 'square' | null {
  const prev = pts[pts.length - 2]!;
  const dx = prev.x - end.x;
  const dy = prev.y - end.y;
  // How far out in front of the face the last waypoint sits, and how far
  // off the square line through the end.
  const room = dx * nv.x + dy * nv.y;
  if (room <= 0) return null;
  if (Math.abs(dx * nv.y - dy * nv.x) < SQUARE_SLACK) return 'square';
  const d = Math.min(APPROACH, room * 0.4);
  // Too little room to straighten under the head: a slant reads better than
  // a curve that bends beneath its arrowhead.
  if (d < MIN_APPROACH) return null;
  return [
    ...pts.slice(0, -1),
    { x: end.x + nv.x * 2 * d, y: end.y + nv.y * 2 * d },
    { x: end.x + nv.x * d, y: end.y + nv.y * d },
    end,
  ];
}

/**
 * `pts` turned to meet its end square-on: along the outward normal of the
 * box face it lands on, or the centre's ray for a circle. An edge that
 * arrives almost along its face — too little room in front of it — moves to
 * the face its last waypoint sits out from, at the point facing it, unless
 * that lands within `MIN_ARRIVAL_GAP` of an endpoint in `taken`. Unchanged
 * when it is already square, when the target is a diamond, or when no face
 * leaves room.
 */
function squareArrival(
  pts: readonly Pt[],
  box: PortBox,
  taken: readonly Pt[]
): readonly Pt[] {
  const n = pts.length;
  if (n < 2 || box.shape === 'decision') return pts;
  const end = pts[n - 1]!;
  if (box.shape === 'pseudostate') {
    const len = Math.hypot(end.x - box.x, end.y - box.y);
    if (len === 0) return pts;
    const r = approach(pts, end, {
      x: (end.x - box.x) / len,
      y: (end.y - box.y) / len,
    });
    return Array.isArray(r) ? r : pts;
  }
  const side = sideOf(end, box);
  const r = approach(pts, end, faceNormal(side));
  if (r !== null) return r === 'square' ? pts : r;
  const prev = pts[n - 2]!;
  for (const s of ['left', 'right', 'top', 'bottom'] as const) {
    if (s === side) continue;
    const nv = faceNormal(s);
    const onFace = {
      x: box.x + (nv.x * box.width) / 2,
      y: box.y + (nv.y * box.height) / 2,
    };
    const at = slide(onFace, box, s, along(prev, s));
    if (taken.some((t) => Math.hypot(t.x - at.x, t.y - at.y) < MIN_ARRIVAL_GAP))
      continue;
    const moved = [...pts.slice(0, -1), at];
    const r2 = approach(moved, at, nv);
    if (r2 === 'square') return moved;
    if (r2) return r2;
  }
  return pts;
}

/**
 * The routes with parallel edges fanned apart and converging arrivals spread
 * along their target's side, and every arrival turned square to the face it
 * lands on. `routes[i]` is `edges[i]`'s route; `boxes` holds
 * every node box by id; `crossings` counts the true crossings of a set of
 * routes, and the spread or the squaring is dropped if it raises that count;
 * `pierces` counts curves through a node box, and the squaring is dropped if
 * it raises that one too. A route that
 * needs nothing comes back unchanged.
 */
export function unbundleEdges(
  edges: readonly {
    readonly source: string;
    readonly target: string;
    readonly label?: string;
  }[],
  routes: readonly (readonly Pt[])[],
  boxes: ReadonlyMap<string, PortBox>,
  crossings: (
    routes: readonly (readonly Pt[])[],
    only?: readonly number[]
  ) => number,
  pierces: (
    routes: readonly (readonly Pt[])[],
    only?: readonly number[]
  ) => number = () => 0
): Pt[][] {
  let out: Pt[][] = routes.map((r) => r.slice());

  // 1. Parallel edges: one ordered pair, one shared route. One lane per
  // distinct label — the same edge written twice (a flowchart restating
  // `A -> B` in two chains) is one edge, and stays one curve.
  const pairs = new Map<string, Map<string, number[]>>();
  // A restated edge → the first edge it restates.
  const twin = new Map<number, number>();
  edges.forEach((e, i) => {
    if (e.source === e.target || (routes[i]?.length ?? 0) < 2) return;
    const key = `${e.source}\u0000${e.target}`;
    let lanes = pairs.get(key);
    if (!lanes) pairs.set(key, (lanes = new Map<string, number[]>()));
    const lane = lanes.get(e.label ?? '');
    if (lane) {
      lane.push(i);
      twin.set(i, lane[0]!);
    } else lanes.set(e.label ?? '', [i]);
  });
  for (const lanes of pairs.values()) {
    if (lanes.size < 2) continue;
    [...lanes.values()].forEach((lane, r) => {
      const off = (r - (lanes.size - 1) / 2) * PARALLEL_GAP;
      for (const i of lane) {
        const e = edges[i]!;
        out[i] = fanRoute(
          routes[i]!,
          off,
          boxes.get(e.source),
          boxes.get(e.target)
        );
      }
    });
  }

  // 2. Arrivals that land on one spot of one side. Kept only when no curve
  // gains a crossing: an arrival slid past its neighbour's approach would
  // trade an overlap for an X.
  const fanned = out;
  out = fanned.map((r) => r.slice());
  let spread = false;
  const bySide = new Map<string, { box: PortBox; side: Side; idx: number[] }>();
  edges.forEach((e, i) => {
    if (e.source === e.target || out[i]!.length < 2 || twin.has(i)) return;
    const box = boxes.get(e.target);
    if (!box) return;
    const side = sideOf(out[i]!.at(-1)!, box);
    const key = `${e.target}\u0000${side}`;
    const slot = bySide.get(key);
    if (slot) slot.idx.push(i);
    else bySide.set(key, { box, side, idx: [i] });
  });
  for (const { box, side, idx } of bySide.values())
    if (idx.length > 1 && spreadSide(out, idx, box, side)) spread = true;
  if (spread) {
    // A restated edge follows the edge it restates.
    for (const [i, first] of twin) out[i] = out[first]!.slice();
    if (crossings(out) > crossings(fanned)) out = fanned;
  } else out = fanned;

  // 3. Oblique arrivals, turned square to their target's face. All at once
  // when that adds no crossing and pierces no node; otherwise one edge at a
  // time, each kept only if neither count rises.
  // Every endpoint on each node, which an arrival moved to another face
  // keeps clear of.
  const ends = new Map<string, { i: number; p: Pt }[]>();
  const put = (id: string, i: number, p: Pt | undefined): void => {
    if (!p) return;
    const list = ends.get(id);
    if (list) list.push({ i, p });
    else ends.set(id, [{ i, p }]);
  };
  edges.forEach((e, i) => {
    put(e.source, i, out[i]![0]);
    put(e.target, i, out[i]!.at(-1));
  });
  const squared = out.map((r, i) => {
    const e = edges[i]!;
    const box = boxes.get(e.target);
    if (e.source === e.target || !box || twin.has(i)) return r;
    const taken = (ends.get(e.target) ?? [])
      .filter((t) => t.i !== i && twin.get(t.i) !== i)
      .map((t) => t.p);
    return squareArrival(r, box, taken) as Pt[];
  });
  // A restated edge turns with the edge it restates.
  for (const [i, first] of twin)
    squared[i] =
      squared[first] === out[first] ? out[i]! : squared[first]!.slice();
  if (squared.every((r, i) => r === out[i])) return out;
  if (crossings(squared) <= crossings(out) && pierces(squared) <= pierces(out))
    return squared;
  // One edge at a time. Only edge `i`'s curve moves, so a trial is scored on
  // the pairs of `i` with each curve its waypoints' box overlaps (a basis
  // curve stays in its waypoints' hull): every other pair scores the same.
  const bbox = (r: readonly Pt[]): [number, number, number, number] => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of r) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return [x0, y0, x1, y1];
  };
  for (let i = 0; i < out.length; i++) {
    if (squared[i] === out[i] || twin.has(i)) continue;
    const trial = out.slice();
    const moved = [i];
    trial[i] = squared[i]!;
    // A restated edge turns with the edge it restates.
    for (const [j, first] of twin)
      if (first === i) {
        trial[j] = squared[j]!;
        moved.push(j);
      }
    const [ax0, ay0, ax1, ay1] = bbox([...out[i]!, ...squared[i]!]);
    const near = moved.slice();
    out.forEach((r, j) => {
      if (moved.includes(j) || r.length < 2) return;
      const [bx0, by0, bx1, by1] = bbox(r);
      if (bx1 >= ax0 && ax1 >= bx0 && by1 >= ay0 && ay1 >= by0) near.push(j);
    });
    // Pair by pair: only the pairs a moved curve is in can change.
    let delta = 0;
    for (let a = 0; a < moved.length; a++)
      for (let b = a + 1; b < near.length; b++) {
        const pair = [moved[a]!, near[b]!];
        delta += crossings(trial, pair) - crossings(out, pair);
      }
    if (delta > 0) continue;
    if (pierces(trial, moved) > pierces(out, moved)) continue;
    out = trial;
  }
  return out;
}
