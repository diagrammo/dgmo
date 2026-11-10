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
//
// Only edges with something to fix move; every other route is returned as is.

type Pt = { readonly x: number; readonly y: number };

/** A node box, centred on (x, y). */
export interface PortBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Space between the routes of a parallel pair — dagre's own `edgesep`. */
const PARALLEL_GAP = 20;
/** The least space between two arrowheads on one node side: wider than one. */
const MIN_ARRIVAL_GAP = 14;
/** An endpoint keeps at least this far from its side's corners. */
const CORNER_MARGIN = 4;

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

/**
 * The routes with parallel edges fanned apart and converging arrivals spread
 * along their target's side. `routes[i]` is `edges[i]`'s route; `boxes` holds
 * every node box by id; `crossings` counts the true crossings of a set of
 * routes, and the spread is dropped if it raises that count. A route that
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
  crossings: (routes: readonly (readonly Pt[])[]) => number
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
  if (!spread) return fanned;
  // A restated edge follows the edge it restates.
  for (const [i, first] of twin) out[i] = out[first]!.slice();
  return crossings(out) > crossings(fanned) ? fanned : out;
}
