// ============================================================
// Venn circle layout — equal and area-proportional (#1992).
// ============================================================
//
// Pure geometry: no DOM, no palette. The renderer fits the circles returned
// here to its canvas, so the units are arbitrary — only ratios matter.
//
// Proportional: a circle's AREA is its set's `size:`, and a pair's lens area
// is the pair's `size:` (the count both sets share, any third set included).
// Two sets are exact. Three sets place each pair at the distance that gives
// its lens exactly, then, when the all-sets overlap has a size, move the
// three distances to trade pair error for all-sets error — three circles
// have three degrees of freedom and four region targets, so the layout is
// approximate there (the usual area-proportional compromise).

export interface VennCircle {
  x: number;
  y: number;
  r: number;
}

/** Inputs for {@link proportionalLayout}; index order is set order. */
export interface ProportionalInput {
  /** One positive size per set. */
  sizes: number[];
  /**
   * Pair overlap sizes keyed `"i-j"` (i < j). A missing key or `null` means
   * "no size given": the pair is drawn at the equal layout's depth.
   */
  pairs: Map<string, number | null>;
  /** The all-sets size of a three-set venn, or null. */
  triple: number | null;
}

/** The equal layout's centre distance, as a share of the two radii summed. */
const DEFAULT_DEPTH = 0.7;
/** Gap between two disjoint circles, as a share of the smaller radius. */
const DISJOINT_GAP = 0.06;

/** Equal radii, ~30% overlap depth: centre distance 1.4r (the default look). */
export function equalLayout(n: number): VennCircle[] {
  const BASE_R = 100;
  const d = BASE_R * 2 * DEFAULT_DEPTH;
  if (n === 2) {
    return [
      { x: -d / 2, y: 0, r: BASE_R },
      { x: d / 2, y: 0, r: BASE_R },
    ];
  }
  // Equilateral triangle with side d; the third circle on top.
  const h = (Math.sqrt(3) / 2) * d;
  return [
    { x: -d / 2, y: h / 3, r: BASE_R },
    { x: d / 2, y: h / 3, r: BASE_R },
    { x: 0, y: -(2 * h) / 3, r: BASE_R },
  ];
}

/** Area of the lens two circles share at centre distance `d`. */
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  const rMin = Math.min(r1, r2);
  if (d <= Math.abs(r1 - r2)) return Math.PI * rMin * rMin;
  const a1 = Math.acos(clamp((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)));
  const a2 = Math.acos(clamp((d * d + r2 * r2 - r1 * r1) / (2 * d * r2)));
  const k = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2);
  return r1 * r1 * a1 + r2 * r2 * a2 - 0.5 * Math.sqrt(Math.max(0, k));
}

/** Centre distance at which two circles share `area`. */
export function distanceForOverlap(
  r1: number,
  r2: number,
  area: number
): number {
  const rMin = Math.min(r1, r2);
  if (area <= 0) return r1 + r2 + DISJOINT_GAP * rMin;
  if (area >= Math.PI * rMin * rMin) return Math.abs(r1 - r2);
  // lensArea falls as d grows, so bisect.
  let lo = Math.abs(r1 - r2);
  let hi = r1 + r2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (lensArea(r1, r2, mid) > area) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

interface IxPoint {
  x: number;
  y: number;
  parents: [number, number];
}

function circleIntersections(
  a: VennCircle,
  b: VennCircle
): { x: number; y: number }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d >= a.r + b.r || d <= Math.abs(a.r - b.r) || d < 1e-12) return [];
  const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - along * along));
  const mx = a.x + (dx * along) / d;
  const my = a.y + (dy * along) / d;
  return [
    { x: mx - (dy * h) / d, y: my + (dx * h) / d },
    { x: mx + (dy * h) / d, y: my - (dx * h) / d },
  ];
}

/** Both points where two circles cross, or [] when they do not. */
export function pairIntersections(
  a: VennCircle,
  b: VennCircle
): { x: number; y: number }[] {
  return circleIntersections(a, b);
}

function inside(p: { x: number; y: number }, c: VennCircle): boolean {
  return Math.hypot(p.x - c.x, p.y - c.y) <= c.r + 1e-9 * Math.max(1, c.r);
}

/** Area of a circular segment of height `width` in a circle of radius r. */
function segmentArea(r: number, width: number): number {
  return (
    r * r * Math.acos(clamp(1 - width / r)) -
    (r - width) * Math.sqrt(Math.max(0, width * (2 * r - width)))
  );
}

/**
 * Exact area common to every circle given: a curvilinear polygon through the
 * crossing points that lie in all circles, plus the circular segment on each
 * of its edges. With no such polygon, the smallest circle counts when it lies
 * inside every other, and the area is 0 otherwise.
 */
export function intersectionArea(circles: VennCircle[]): number {
  const pts: IxPoint[] = [];
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      for (const p of circleIntersections(circles[i]!, circles[j]!)) {
        pts.push({ ...p, parents: [i, j] });
      }
    }
  }
  const inner = pts.filter((p) => circles.every((c) => inside(p, c)));
  if (inner.length > 1) {
    const cx = inner.reduce((s, p) => s + p.x, 0) / inner.length;
    const cy = inner.reduce((s, p) => s + p.y, 0) / inner.length;
    const angle = (p: IxPoint) => Math.atan2(p.x - cx, p.y - cy);
    inner.sort((a, b) => angle(b) - angle(a));
    let polygon = 0;
    let arcs = 0;
    let p2 = inner[inner.length - 1]!;
    for (const p1 of inner) {
      polygon += (p2.x + p1.x) * (p1.y - p2.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      let best: { r: number; width: number } | null = null;
      for (const j of p1.parents) {
        if (!p2.parents.includes(j)) continue;
        const c = circles[j]!;
        const a1 = Math.atan2(p1.x - c.x, p1.y - c.y);
        const a2 = Math.atan2(p2.x - c.x, p2.y - c.y);
        let diff = a2 - a1;
        if (diff < 0) diff += 2 * Math.PI;
        const a = a2 - diff / 2;
        let width = Math.hypot(
          mid.x - (c.x + c.r * Math.sin(a)),
          mid.y - (c.y + c.r * Math.cos(a))
        );
        if (width > c.r * 2) width = c.r * 2;
        if (!best || best.width > width) best = { r: c.r, width };
      }
      if (best) {
        arcs += segmentArea(best.r, best.width);
        p2 = p1;
      }
    }
    return arcs + polygon / 2;
  }
  let smallest = circles[0]!;
  for (const c of circles) if (c.r < smallest.r) smallest = c;
  const contained = circles.every(
    (c) =>
      Math.hypot(c.x - smallest.x, c.y - smallest.y) <=
      Math.abs(smallest.r - c.r) + 1e-9
  );
  return contained ? Math.PI * smallest.r * smallest.r : 0;
}

/** Circles whose areas follow the sizes — see the file header. */
export function proportionalLayout(input: ProportionalInput): VennCircle[] {
  const { sizes, pairs, triple } = input;
  const r = sizes.map((s) => Math.sqrt(Math.max(s, 1e-9) / Math.PI));
  const target = (i: number, j: number): number => {
    const sz = pairs.get(`${i}-${j}`);
    // r indices come from sizes, so i and j are in-bounds.
    if (sz == null)
      return lensArea(r[i]!, r[j]!, DEFAULT_DEPTH * (r[i]! + r[j]!));
    return sz;
  };
  if (sizes.length === 2) {
    const d = distanceForOverlap(r[0]!, r[1]!, target(0, 1));
    return [
      { x: -d / 2, y: 0, r: r[0]! },
      { x: d / 2, y: 0, r: r[1]! },
    ];
  }
  const t01 = target(0, 1);
  const t02 = target(0, 2);
  const t12 = target(1, 2);
  const start = [
    distanceForOverlap(r[0]!, r[1]!, t01),
    distanceForOverlap(r[0]!, r[2]!, t02),
    distanceForOverlap(r[1]!, r[2]!, t12),
  ];
  const place = (d: number[]): VennCircle[] =>
    placeTriangle(r[0]!, r[1]!, r[2]!, d[0]!, d[1]!, d[2]!);
  if (triple == null) return centre(place(start));

  // Normalize by the smallest set so every term is a share of one circle.
  const norm = Math.min(...sizes);
  const loss = (d: number[]): number => {
    const c = place(d);
    const dist = (a: VennCircle, b: VennCircle) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const e = [
      lensArea(r[0]!, r[1]!, dist(c[0]!, c[1]!)) - t01,
      lensArea(r[0]!, r[2]!, dist(c[0]!, c[2]!)) - t02,
      lensArea(r[1]!, r[2]!, dist(c[1]!, c[2]!)) - t12,
      intersectionArea(c) - triple,
    ];
    return e.reduce((s, v) => s + (v / norm) ** 2, 0);
  };
  const best = simplexMinimize(loss, start, Math.min(...r) * 0.2);
  return centre(place(best));
}

/**
 * Three circles from their pairwise centre distances: 0 and 1 on a line,
 * 2 above them. Distances that break the triangle inequality collapse to a
 * line rather than fail.
 */
function placeTriangle(
  r0: number,
  r1: number,
  r2: number,
  d01: number,
  d02: number,
  d12: number
): VennCircle[] {
  const base = Math.max(d01, 1e-9);
  const x = (base * base + d02 * d02 - d12 * d12) / (2 * base);
  const y = -Math.sqrt(Math.max(0, d02 * d02 - x * x));
  return [
    { x: 0, y: 0, r: r0 },
    { x: base, y: 0, r: r1 },
    { x, y, r: r2 },
  ];
}

function centre(circles: VennCircle[]): VennCircle[] {
  const cx = circles.reduce((s, c) => s + c.x, 0) / circles.length;
  const cy = circles.reduce((s, c) => s + c.y, 0) / circles.length;
  return circles.map((c) => ({ x: c.x - cx, y: c.y - cy, r: c.r }));
}

/** Deterministic downhill-simplex minimizer over distances (kept ≥ 0). */
function simplexMinimize(
  f: (x: number[]) => number,
  x0: number[],
  step: number
): number[] {
  const n = x0.length;
  const fx = (x: number[]) => f(x.map((v) => Math.max(0, v)));
  let simplex: { x: number[]; v: number }[] = [{ x: x0, v: fx(x0) }];
  for (let i = 0; i < n; i++) {
    const x = [...x0];
    x[i] = x[i]! + step;
    simplex.push({ x, v: fx(x) });
  }
  const combine = (a: number[], b: number[], t: number) =>
    a.map((ai, k) => ai + t * (b[k]! - ai));
  for (let iter = 0; iter < 300; iter++) {
    simplex.sort((a, b) => a.v - b.v);
    const bestV = simplex[0]!.v;
    const worst = simplex[n]!;
    if (worst.v - bestV < 1e-10) break;
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) centroid[k]! += simplex[i]!.x[k]! / n;
    const reflect = combine(centroid, worst.x, -1);
    const vr = fx(reflect);
    if (vr < bestV) {
      const expand = combine(centroid, worst.x, -2);
      const ve = fx(expand);
      simplex[n] = ve < vr ? { x: expand, v: ve } : { x: reflect, v: vr };
    } else if (vr < simplex[n - 1]!.v) {
      simplex[n] = { x: reflect, v: vr };
    } else {
      const contract = combine(centroid, worst.x, 0.5);
      const vc = fx(contract);
      if (vc < worst.v) simplex[n] = { x: contract, v: vc };
      else {
        const b = simplex[0]!.x;
        simplex = simplex.map((p, i) => {
          if (i === 0) return p;
          const x = combine(b, p.x, 0.5);
          return { x, v: fx(x) };
        });
      }
    }
  }
  simplex.sort((a, b) => a.v - b.v);
  return simplex[0]!.x.map((v) => Math.max(0, v));
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
