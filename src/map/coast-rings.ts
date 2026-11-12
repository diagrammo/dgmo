// Coastline water-lines as REAL offset rings (`coastline`, §24B.2; #1770).
//
// The rings used to be drawn in the renderer as wide round-joined strokes of the
// whole coast (a colour pass + a flat-water erase pass per ring, under a land
// mask): 10 full-coast strokes up to ~25 px wide, which is what blocked the main
// thread on raster in the app (#1770: ~550 ms per redraw on the map fixture).
//
// Here, once per layout (in the app's layout worker), we sample a signed distance
// field from the coast on a grid, then trace each ring as the iso-line of that
// field at the ring's centre distance (marching squares). The renderer strokes
// those iso-lines THIN (the ring's own width), with no erase pass and no mask.
// The iso-line of "distance from the coast" is exactly the edge of the union of
// discs the old wide stroke painted, so narrow inlets and straits close the same
// way, and the line can only ever lie on water.
//
// Field sample values:
//   - water: distance to the nearest coast segment, capped at `cap`
//   - land:  -1 (below every level, so no ring is traced inside land)
//   - NaN:   masked — every grid cell touching one emits nothing, so a ring
//            simply ENDS there (inset-box moats, neighbour land in an inset)

type Pt = readonly [number, number];

export interface CoastQuad {
  readonly points: ReadonlyArray<Pt>;
}

export interface CoastFieldInput {
  /** Field extent `[x0, y0, x1, y1]`, screen px. Rings end at its edge. */
  readonly bounds: readonly [number, number, number, number];
  /** Coast polylines the distance is measured from. `closed` adds last→first. */
  readonly sources: ReadonlyArray<{
    readonly pts: ReadonlyArray<Pt>;
    readonly closed: boolean;
  }>;
  /** Land: each entry is ONE fill group (even-odd over its rings), OR'd in. */
  readonly land: ReadonlyArray<ReadonlyArray<ReadonlyArray<Pt>>>;
  /** Water cut back out of land (lakes), each entry one even-odd group. */
  readonly water: ReadonlyArray<ReadonlyArray<ReadonlyArray<Pt>>>;
  /** Masked: each entry one even-odd group; samples inside emit no ring. */
  readonly masked: ReadonlyArray<ReadonlyArray<ReadonlyArray<Pt>>>;
  /** Quads whose interior, dilated by `reach`, is masked (the main map's moat
   *  around each AK/HI inset box). */
  readonly maskInside?: {
    readonly quads: ReadonlyArray<CoastQuad>;
    readonly reach: number;
  };
  /** A quad whose interior, eroded by `reach`, is the ONLY unmasked area (an
   *  inset box: rings fade out before its frame). */
  readonly keepInside?: { readonly quad: CoastQuad; readonly reach: number };
  /** Ring centre distances from the coast, screen px. */
  readonly levels: readonly number[];
  /** Grid spacing, screen px. */
  readonly cell: number;
}

/** Line simplification (drop points within `tol` of the chord), iterative. Keeps the first and last point. */
function simplify(pts: ReadonlyArray<Pt>, tol: number): Pt[] {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      let d2: number;
      if (len2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const c = (px - ax) * dy - (py - ay) * dx;
        d2 = (c * c) / len2;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best !== -1) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]!);
  return out;
}

function quadContains(q: ReadonlyArray<Pt>, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i]!;
    const [xj, yj] = q[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function segDist2(
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
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

function quadEdgeDist2(q: ReadonlyArray<Pt>, px: number, py: number): number {
  let best = Infinity;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const d = segDist2(px, py, q[j]![0], q[j]![1], q[i]![0], q[i]![1]);
    if (d < best) best = d;
  }
  return best;
}

const fmt = (v: number): string => String(Math.round(v * 10) / 10);

/** One SVG path `d` per level (`''` where the level traces nothing). */
export function traceCoastRings(input: CoastFieldInput): string[] {
  const [x0, y0, x1, y1] = input.bounds;
  const W = x1 - x0;
  const H = y1 - y0;
  if (!(W > 0 && H > 0) || !input.levels.length)
    return input.levels.map(() => '');
  const nx = Math.max(2, Math.ceil(W / input.cell) + 1);
  const ny = Math.max(2, Math.ceil(H / input.cell) + 1);
  const cx = W / (nx - 1);
  const cy = H / (ny - 1);
  const N = nx * ny;
  // Sample positions for inside tests sit a hair inside the extent, so a region
  // clipped exactly at the frame still reads as land on the frame's own row.
  const eps = 0.01;
  const sx = (i: number): number =>
    Math.min(x1 - eps, Math.max(x0 + eps, x0 + i * cx));
  const sy = (j: number): number =>
    Math.min(y1 - eps, Math.max(y0 + eps, y0 + j * cy));

  // ── Rasterise even-odd fill groups at the sample points (row by row) ──
  // 0 = water, 1 = land, 2 = masked.
  const kind = new Uint8Array(N);
  const fillGroup = (
    rings: ReadonlyArray<ReadonlyArray<Pt>>,
    value: number
  ): void => {
    const rows = new Map<number, number[]>();
    for (const ring of rings) {
      const n = ring.length;
      if (n < 3) continue;
      for (let a = n - 1, b = 0; b < n; a = b++) {
        const [ax, ay] = ring[a]!;
        const [bx, by] = ring[b]!;
        if (ay === by) continue;
        const lo = Math.min(ay, by);
        const hi = Math.max(ay, by);
        const j0 = Math.max(0, Math.floor((lo - y0) / cy));
        const j1 = Math.min(ny - 1, Math.ceil((hi - y0) / cy));
        for (let j = j0; j <= j1; j++) {
          const y = sy(j);
          if (ay > y === by > y) continue;
          const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
          const row = rows.get(j);
          if (row) row.push(x);
          else rows.set(j, [x]);
        }
      }
    }
    for (const [j, xs] of rows) {
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k]! - x0) / cx) - 1);
        const i1 = Math.min(nx - 1, Math.floor((xs[k + 1]! - x0) / cx) + 1);
        for (let i = i0; i <= i1; i++) {
          const x = sx(i);
          if (x < xs[k]! || x >= xs[k + 1]!) continue;
          const idx = j * nx + i;
          // Masked always wins; a later water group clears land only.
          if (value === 2 || kind[idx] !== 2) kind[idx] = value;
        }
      }
    }
  };
  for (const g of input.land) fillGroup(g, 1);
  for (const g of input.water) fillGroup(g, 0);
  for (const g of input.masked) fillGroup(g, 2);
  if (input.maskInside) {
    const { quads, reach } = input.maskInside;
    const r2 = reach * reach;
    for (const q of quads) {
      let qx0 = Infinity,
        qy0 = Infinity,
        qx1 = -Infinity,
        qy1 = -Infinity;
      for (const [x, y] of q.points) {
        qx0 = Math.min(qx0, x);
        qx1 = Math.max(qx1, x);
        qy0 = Math.min(qy0, y);
        qy1 = Math.max(qy1, y);
      }
      const i0 = Math.max(0, Math.floor((qx0 - reach - x0) / cx));
      const i1 = Math.min(nx - 1, Math.ceil((qx1 + reach - x0) / cx));
      const j0 = Math.max(0, Math.floor((qy0 - reach - y0) / cy));
      const j1 = Math.min(ny - 1, Math.ceil((qy1 + reach - y0) / cy));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * cx;
          const y = y0 + j * cy;
          if (
            quadContains(q.points, x, y) ||
            quadEdgeDist2(q.points, x, y) < r2
          )
            kind[j * nx + i] = 2;
        }
    }
  }
  if (input.keepInside) {
    const { quad, reach } = input.keepInside;
    const r2 = reach * reach;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cx;
        const y = y0 + j * cy;
        if (
          !quadContains(quad.points, x, y) ||
          quadEdgeDist2(quad.points, x, y) < r2
        )
          kind[j * nx + i] = 2;
      }
  }

  // ── Distance to the coast, water samples only, capped ──
  const maxLevel = Math.max(...input.levels);
  const cap = maxLevel + 2 * Math.max(cx, cy);
  const cap2 = cap * cap;
  const dist = new Float32Array(N).fill(cap2);
  for (const src of input.sources) {
    // Sub-pixel vertices change nothing at ring scale; drop them first.
    const raw =
      src.closed && src.pts.length > 2 ? [...src.pts, src.pts[0]!] : src.pts;
    const pts = simplify(raw, 0.2);
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, ay] = pts[s]!;
      const [bx, by] = pts[s + 1]!;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - cap - x0) / cx));
      const i1 = Math.min(
        nx - 1,
        Math.ceil((Math.max(ax, bx) + cap - x0) / cx)
      );
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - cap - y0) / cy));
      const j1 = Math.min(
        ny - 1,
        Math.ceil((Math.max(ay, by) + cap - y0) / cy)
      );
      for (let j = j0; j <= j1; j++) {
        const y = y0 + j * cy;
        const row = j * nx;
        for (let i = i0; i <= i1; i++) {
          const idx = row + i;
          if (kind[idx] !== 0) continue;
          const d2 = segDist2(x0 + i * cx, y, ax, ay, bx, by);
          if (d2 < dist[idx]!) dist[idx] = d2;
        }
      }
    }
  }
  const val = new Float32Array(N);
  for (let k = 0; k < N; k++)
    val[k] = kind[k] === 2 ? NaN : kind[k] === 1 ? -1 : Math.sqrt(dist[k]!);

  // ── Marching squares per level, chained by shared grid edge ──
  // Edge ids: horizontal edge (i,j)-(i+1,j) = j*nx+i; vertical (i,j)-(i,j+1) =
  // N + j*nx+i. Each crossing is shared by at most two cells.
  const edgePoint = (e: number, L: number): Pt => {
    const vert = e >= N;
    const k = vert ? e - N : e;
    const i = k % nx;
    const j = (k - i) / nx;
    const va = val[k]!;
    const vb = val[vert ? k + nx : k + 1]!;
    const t = (L - va) / (vb - va);
    return vert
      ? [x0 + i * cx, y0 + (j + t) * cy]
      : [x0 + (i + t) * cx, y0 + j * cy];
  };
  // Only cells whose corner values straddle some level can emit a segment;
  // collect them once so each level scans the coast band, not the whole grid.
  const minL = Math.min(...input.levels);
  const band: number[] = [];
  for (let j = 0; j + 1 < ny; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const k = j * nx + i;
      const a = val[k]!;
      const b = val[k + 1]!;
      const c = val[k + nx]!;
      const e = val[k + nx + 1]!;
      if (a !== a || b !== b || c !== c || e !== e) continue; // NaN
      const lo = Math.min(a, b, c, e);
      const hi = Math.max(a, b, c, e);
      if (hi >= minL && lo < maxLevel) band.push(k);
    }
  return input.levels.map((L) => {
    const adj = new Map<number, number[]>();
    const link = (a: number, b: number): void => {
      const la = adj.get(a);
      if (la) la.push(b);
      else adj.set(a, [b]);
      const lb = adj.get(b);
      if (lb) lb.push(a);
      else adj.set(b, [a]);
    };
    for (const k of band) {
      const v00 = val[k]!;
      const v10 = val[k + 1]!;
      const v01 = val[k + nx]!;
      const v11 = val[k + nx + 1]!;
      const code =
        (v00 >= L ? 1 : 0) |
        (v10 >= L ? 2 : 0) |
        (v11 >= L ? 4 : 0) |
        (v01 >= L ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const eT = k; // top: v00–v10
      const eB = k + nx; // bottom: v01–v11
      const eL = N + k; // left: v00–v01
      const eR = N + k + 1; // right: v10–v11
      const centre = (v00 + v10 + v01 + v11) / 4 >= L;
      switch (code) {
        case 1:
        case 14:
          link(eL, eT);
          break;
        case 2:
        case 13:
          link(eT, eR);
          break;
        case 3:
        case 12:
          link(eL, eR);
          break;
        case 4:
        case 11:
          link(eR, eB);
          break;
        case 6:
        case 9:
          link(eT, eB);
          break;
        case 7:
        case 8:
          link(eL, eB);
          break;
        case 5:
          if (centre) {
            link(eT, eR);
            link(eB, eL);
          } else {
            link(eL, eT);
            link(eR, eB);
          }
          break;
        case 10:
          if (centre) {
            link(eL, eT);
            link(eR, eB);
          } else {
            link(eT, eR);
            link(eB, eL);
          }
          break;
      }
    }
    const seen = new Set<number>();
    let d = '';
    const walk = (start: number): void => {
      const chain: Pt[] = [edgePoint(start, L)];
      seen.add(start);
      let prev = -1;
      let cur = start;
      let closed: boolean;
      for (;;) {
        const nb = adj.get(cur)!;
        let next = -1;
        for (const c of nb)
          if (c !== prev && !seen.has(c)) {
            next = c;
            break;
          }
        if (next === -1) {
          closed = nb.length === 2 && nb.includes(start) && chain.length > 2;
          break;
        }
        seen.add(next);
        chain.push(edgePoint(next, L));
        prev = cur;
        cur = next;
      }
      const pts = simplify(closed ? [...chain, chain[0]!] : chain, 0.15);
      if (closed) pts.pop();
      if (pts.length < 2) return;
      d +=
        'M' +
        pts.map((p) => fmt(p[0]) + ',' + fmt(p[1])).join('L') +
        (closed ? 'Z' : '');
    };
    // Open chains first (from their ends), then the remaining closed loops.
    for (const [e, nb] of adj) if (nb.length === 1 && !seen.has(e)) walk(e);
    for (const e of adj.keys()) if (!seen.has(e)) walk(e);
    return d;
  });
}

// ── Coast sources from region rings (moved from the renderer) ──

function pointInRing(px: number, py: number, ring: ReadonlyArray<Pt>): boolean {
  return quadContains(ring, px, py);
}

/** Split a ring at every edge that runs ALONG the canvas frame. A region clipped
 *  to the viewport (the antimeridian, a regional clipExtent cut) gains a synthetic
 *  straight edge on the frame; it is not a real coast and must not grow rings.
 *  Without a `frame` the ring is returned whole (closed). */
function ringToCoastRuns(
  ring: ReadonlyArray<Pt>,
  frame?: { w: number; h: number }
): Array<{ pts: Pt[]; closed: boolean }> {
  if (!frame) return [{ pts: ring.slice(), closed: true }];
  const n = ring.length;
  const e = 0.75;
  const isFrameEdge = (a: Pt, b: Pt): boolean =>
    (Math.abs(a[0]) <= e && Math.abs(b[0]) <= e) ||
    (Math.abs(a[0] - frame.w) <= e && Math.abs(b[0] - frame.w) <= e) ||
    (Math.abs(a[1]) <= e && Math.abs(b[1]) <= e) ||
    (Math.abs(a[1] - frame.h) <= e && Math.abs(b[1] - frame.h) <= e);
  let firstBreak = -1;
  for (let i = 0; i < n; i++)
    if (isFrameEdge(ring[i]!, ring[(i + 1) % n]!)) {
      firstBreak = i;
      break;
    }
  if (firstBreak === -1) return [{ pts: ring.slice(), closed: true }];
  const runs: Array<{ pts: Pt[]; closed: boolean }> = [];
  let cur: Pt[] = [];
  const start = (firstBreak + 1) % n;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    if (isFrameEdge(a, b)) {
      if (cur.length >= 2) runs.push({ pts: cur, closed: false });
      cur = [];
      continue;
    }
    if (cur.length === 0) cur.push(a);
    cur.push(b);
  }
  if (cur.length >= 2) runs.push({ pts: cur, closed: false });
  return runs;
}

/** Every region's OUTER rings whose bbox extent clears `minExtent`. Holes and
 *  enclaves (odd containment depth) are skipped, so a lake-hole or Lesotho is
 *  never ringed as a fake coast on land (R11). */
export function coastOuterRings(
  regionRings: ReadonlyArray<ReadonlyArray<ReadonlyArray<Pt>>>,
  minExtent: number
): Array<ReadonlyArray<Pt>> {
  const out: Array<ReadonlyArray<Pt>> = [];
  for (const rings of regionRings)
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]!;
      if (ring.length < 3) continue;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (Math.max(maxX - minX, maxY - minY) < minExtent) continue;
      const [fx, fy] = ring[0]!;
      let depth = 0;
      for (let j = 0; j < rings.length; j++)
        if (j !== i && pointInRing(fx, fy, rings[j]!)) depth++;
      if (depth % 2 === 1) continue;
      out.push(ring);
    }
  return out;
}

export function coastSources(
  outer: ReadonlyArray<ReadonlyArray<Pt>>,
  frame?: { w: number; h: number }
): Array<{ pts: Pt[]; closed: boolean }> {
  return outer.flatMap((r) => ringToCoastRuns(r, frame));
}
