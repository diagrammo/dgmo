// ============================================================
// Boxes and Lines — home-grown layered (Sugiyama) candidate generator
// ============================================================
//
// A from-scratch layered layout used to produce EXTRA candidates for the
// placement-search pool (see layout-search.ts). dagre's single wmedian+transpose
// gets stuck at an ordering local-optimum on some graphs (e.g. the pirate-fleet
// K2,2 fan-out: dagre floor = 2 crossings, the true minimum = 1). Owning the
// crossing-minimization stage — many random restarts of wmedian + transpose over
// a properly dummied layered graph — lets us reach orderings dagre never tries.
//
// This is ADDITIVE: the caller throws these candidates into the same pool as the
// dagre ones and the existing two-stage spline-crossing scorer keeps the best.
// If a candidate is worse it is simply never chosen — so there is no regression
// risk. Flat graphs only (no expanded containers); returns [] otherwise.

import type { ParsedBoxesAndLines } from './types';
import { NODE_WIDTH, NODE_HEIGHT } from './node-metrics';
import { clipEndpointsToNodes, type ClipRect } from './edge-clip';
import type { BLLayoutResult, BLLayoutEdge, BLLayoutNode } from './layout';

type Size = { width: number; height: number };
type Pt = { x: number; y: number };

const NODESEP = 50; // cross-axis gap between siblings in a rank
const RANKSEP = 60; // rank-axis gap between layers
const DUMMY_THICK = 10; // cross-axis footprint of a long-edge dummy
const MARGIN = 40;

// Edge-straightening weights for coordinate assignment (dagre-style): keep long
// edges (dummy chains) ruler-straight so they hug one side instead of sweeping
// across the diagram and manufacturing spline crossings.
const W_REAL_REAL = 1;
const W_REAL_DUMMY = 2;
const W_DUMMY_DUMMY = 8;

function rng(s: number) {
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Graph model ────────────────────────────────────────────

interface LNode {
  id: string; // real node label, or `__d<edgeIdx>_<k>` for dummies
  dummy: boolean;
  rank: number;
  cross: number; // cross-axis center coordinate
  thick: number; // cross-axis footprint (width for TB, height for LR)
  depth: number; // rank-axis footprint (height for TB, width for LR)
  realW: number;
  realH: number;
}
// A layered edge segment connects two nodes in adjacent ranks.
interface LSeg {
  a: string; // upper-rank node id
  b: string; // lower-rank node id
}
// The realized routing chain for one parsed edge (in source→target order).
interface EChain {
  edgeIdx: number;
  chain: string[]; // node ids, source ... target
}

/**
 * Build several layered-layout candidates for a FLAT boxes-and-lines graph.
 * Returns [] when the graph has expanded containers (groups), self-loops only,
 * or is too trivial to benefit.
 */
export function layeredCandidates(
  parsed: ParsedBoxesAndLines,
  sizes: ReadonlyMap<string, Size>,
  opts?: {
    restarts?: number;
    keepK?: number;
    /** Cross-axis gap between siblings in a rank (default 50). */
    nodesep?: number;
    /** Rank-axis gap between layers (default 60). */
    ranksep?: number;
    /** Which side a back-edge loops around (default 'nearest'). */
    backEdgeSide?: 'nearest' | 'left' | 'right';
  }
): BLLayoutResult[] {
  // Flat graphs only — containers need a group-aware variant (future work).
  if (parsed.groups.length > 0) return [];
  const nCount = parsed.nodes.length;
  if (nCount < 3 || nCount > 40) return [];

  const isTB = parsed.direction === 'TB';
  const nodesep = opts?.nodesep ?? NODESEP;
  const ranksep = opts?.ranksep ?? RANKSEP;
  const backEdgeSide = opts?.backEdgeSide ?? 'nearest';
  // Restart count scales down with size to stay inside the search budget; the
  // engine is additive, so fewer restarts only risks missing a win, never a
  // regression.
  const restarts =
    opts?.restarts ?? (nCount <= 14 ? 28 : nCount <= 25 ? 14 : 6);
  const keepK = opts?.keepK ?? 3;

  const labels = parsed.nodes.map((n) => n.label);
  const labelSet = new Set(labels);
  // Real, non-self edges with both endpoints present.
  const edges = parsed.edges
    .map((e, i) => ({ e, i }))
    .filter(
      ({ e }) =>
        labelSet.has(e.source) &&
        labelSet.has(e.target) &&
        e.source !== e.target
    );
  if (edges.length === 0) return [];

  // ── Stage 1: make acyclic (DFS; reverse edges that close a cycle) ──
  const adj = new Map<string, { to: string; idx: number }[]>();
  for (const l of labels) adj.set(l, []);
  for (const { e, i } of edges)
    adj.get(e.source)!.push({ to: e.target, idx: i });
  const reversed = new Set<number>(); // edge indices treated as reversed
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen,1 on-stack,2 done
  for (const l of labels) state.set(l, 0);
  const dfs = (u: string): void => {
    state.set(u, 1);
    for (const { to, idx } of adj.get(u)!) {
      const st = state.get(to)!;
      if (st === 1)
        reversed.add(idx); // back-edge
      else if (st === 0) dfs(to);
    }
    state.set(u, 2);
  };
  for (const l of labels) if (state.get(l) === 0) dfs(l);

  // DAG orientation of each edge: (from → to) with from-rank < to-rank.
  const dag = edges.map(({ e, i }) =>
    reversed.has(i)
      ? { from: e.target, to: e.source, idx: i, rev: true }
      : { from: e.source, to: e.target, idx: i, rev: false }
  );

  // ── Stage 2: longest-path ranking on the DAG ──
  const outDag = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const l of labels) {
    outDag.set(l, []);
    inDeg.set(l, 0);
  }
  for (const d of dag) {
    outDag.get(d.from)!.push(d.to);
    inDeg.set(d.to, (inDeg.get(d.to) ?? 0) + 1);
  }
  // Topo order (Kahn) then longest-path rank.
  const rank = new Map<string, number>();
  for (const l of labels) rank.set(l, 0);
  const queue = labels.filter((l) => (inDeg.get(l) ?? 0) === 0);
  const indeg2 = new Map(inDeg);
  const topo: string[] = [];
  while (queue.length) {
    const u = queue.shift()!;
    topo.push(u);
    for (const v of outDag.get(u)!) {
      rank.set(v, Math.max(rank.get(v)!, rank.get(u)! + 1));
      indeg2.set(v, indeg2.get(v)! - 1);
      if (indeg2.get(v) === 0) queue.push(v);
    }
  }
  if (topo.length !== labels.length) return []; // cycle slipped through — bail
  // Pull sources down so single-child sources sit just above their child
  // (avoids needless tall first layers). ALAP for zero-out-degree-safe nodes:
  // keep as-is; longest-path is a fine, predictable baseline.
  const maxRank = Math.max(...labels.map((l) => rank.get(l)!));

  // ── Stage 3: dummy chains for edges spanning >1 rank ──
  const node = new Map<string, LNode>();
  for (const n of parsed.nodes) {
    const s = sizes.get(n.label) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
    node.set(n.label, {
      id: n.label,
      dummy: false,
      rank: rank.get(n.label)!,
      cross: 0,
      thick: isTB ? s.width : s.height,
      depth: isTB ? s.height : s.width,
      realW: s.width,
      realH: s.height,
    });
  }
  const segs: LSeg[] = [];
  const chains: EChain[] = [];
  // Reversed (cycle-closing) edges are routed AROUND the periphery, not threaded
  // through the core ranks as dummy chains. Threading a back-edge straight up
  // through the layers makes it cross the forward fan it loops back over (this is
  // exactly pirate-fleet's avoidable 2nd crossing). Keeping them out of the
  // ordering problem lets the forward graph reach its true minimum.
  const backEdges: { edgeIdx: number; src: string; tgt: string }[] = [];
  for (const d of dag) {
    if (d.rev) {
      // d.from is the upper-rank endpoint (original target); d.to is the lower.
      // Original orientation is source→target = d.to → d.from.
      backEdges.push({ edgeIdx: d.idx, src: d.to, tgt: d.from });
      continue;
    }
    const r0 = rank.get(d.from)!;
    const r1 = rank.get(d.to)!;
    const dagChain: string[] = [d.from];
    let prev = d.from;
    for (let r = r0 + 1; r < r1; r++) {
      const id = `__d${d.idx}_${r}`;
      node.set(id, {
        id,
        dummy: true,
        rank: r,
        cross: 0,
        thick: DUMMY_THICK,
        depth: 0,
        realW: 0,
        realH: 0,
      });
      segs.push({ a: prev, b: id });
      dagChain.push(id);
      prev = id;
    }
    segs.push({ a: prev, b: d.to });
    dagChain.push(d.to);
    // Output chain in original source→target orientation.
    chains.push({
      edgeIdx: d.idx,
      chain: d.rev ? dagChain.slice().reverse() : dagChain,
    });
  }

  // Rank buckets.
  const ranks: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of node.values()) ranks[n.rank]!.push(n.id);

  // Adjacency between adjacent ranks (for ordering + crossing count).
  // up[id] = ids in rank-1 connected; down[id] = ids in rank+1 connected.
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const id of node.keys()) {
    up.set(id, []);
    down.set(id, []);
  }
  for (const s of segs) {
    down.get(s.a)!.push(s.b);
    up.get(s.b)!.push(s.a);
  }

  // ── Stage 4: ordering — many restarts of wmedian + transpose ──
  const orderOf = new Map<string, number>();
  const applyOrder = (ord: ReadonlyMap<string, number>): void => {
    for (const id of node.keys()) orderOf.set(id, ord.get(id)!);
  };

  // Crossings between ranks r and r+1 given current orderOf (quadratic in the
  // segment count of that gap — graphs here are tiny).
  const gapCrossings = (r: number): number => {
    const lower = ranks[r + 1];
    if (!lower) return 0;
    const es: { p: number; q: number }[] = [];
    for (const a of ranks[r]!) {
      const pa = orderOf.get(a)!;
      for (const b of down.get(a)!) es.push({ p: pa, q: orderOf.get(b)! });
    }
    let c = 0;
    for (let i = 0; i < es.length; i++)
      for (let j = i + 1; j < es.length; j++) {
        const A = es[i]!,
          B = es[j]!;
        if ((A.p - B.p) * (A.q - B.q) < 0) c++;
      }
    return c;
  };
  const totalCrossings = (): number => {
    let c = 0;
    for (let r = 0; r < maxRank; r++) c += gapCrossings(r);
    return c;
  };

  const median = (vals: number[]): number => {
    if (vals.length === 0) return -1;
    vals.sort((x, y) => x - y);
    const m = Math.floor(vals.length / 2);
    if (vals.length % 2 === 1) return vals[m]!;
    if (vals.length === 2) return (vals[0]! + vals[1]!) / 2;
    const left = vals[m - 1]! - vals[0]!;
    const right = vals[vals.length - 1]! - vals[m]!;
    return left + right === 0
      ? (vals[m - 1]! + vals[m]!) / 2
      : (vals[m - 1]! * right + vals[m]! * left) / (left + right);
  };

  // One median sweep over a rank using the neighbour rank's current order.
  // No-neighbour nodes (median = -1) stay pinned at their current slot; the rest
  // are sorted by median and fill the remaining slots in order.
  const wmedianRank = (r: number, useUp: boolean): void => {
    const ids = ranks[r]!;
    const neigh = useUp ? up : down;
    const med = new Map<string, number>();
    for (const id of ids)
      med.set(id, median(neigh.get(id)!.map((x) => orderOf.get(x)!)));
    const movable = ids
      .filter((id) => med.get(id)! >= 0)
      .sort((a, b) => med.get(a)! - med.get(b)!);
    const out = new Array<string | null>(ids.length).fill(null);
    for (const id of ids) if (med.get(id)! < 0) out[orderOf.get(id)!] = id;
    let mi = 0;
    for (let slot = 0; slot < out.length; slot++)
      if (out[slot] === null) out[slot] = movable[mi++]!;
    const final = out as string[];
    final.forEach((id, i) => orderOf.set(id, i));
    ranks[r] = final;
  };

  // Greedy adjacent-swap transpose until no rank pair improves.
  const transpose = (): void => {
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 12) {
      improved = false;
      for (let r = 0; r <= maxRank; r++) {
        const ids = ranks[r]!;
        for (let i = 0; i < ids.length - 1; i++) {
          const before =
            (r > 0 ? gapCrossings(r - 1) : 0) +
            (r < maxRank ? gapCrossings(r) : 0);
          // swap i, i+1
          const a = ids[i]!,
            b = ids[i + 1]!;
          ids[i] = b;
          ids[i + 1] = a;
          orderOf.set(b, i);
          orderOf.set(a, i + 1);
          const after =
            (r > 0 ? gapCrossings(r - 1) : 0) +
            (r < maxRank ? gapCrossings(r) : 0);
          if (after < before) {
            improved = true;
          } else {
            // revert
            ids[i] = a;
            ids[i + 1] = b;
            orderOf.set(a, i);
            orderOf.set(b, i + 1);
          }
        }
      }
    }
  };

  const initOrder = (seed: number): void => {
    const r = seed === 0 ? null : rng(seed);
    for (let rr = 0; rr <= maxRank; rr++) {
      const ids = ranks[rr]!.slice();
      if (r) {
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [ids[i], ids[j]] = [ids[j]!, ids[i]!];
        }
      }
      ranks[rr] = ids;
      ids.forEach((id, i) => orderOf.set(id, i));
    }
  };

  // Run restarts; keep the best few DISTINCT orderings (by signature) to realize.
  const found: { sig: string; cross: number; order: Map<string, number> }[] =
    [];
  for (let s = 0; s < restarts; s++) {
    initOrder(s);
    let best = totalCrossings();
    let bestSnap = new Map(orderOf);
    for (let iter = 0; iter < 8; iter++) {
      const down1 = iter % 2 === 0;
      if (down1) for (let r = 1; r <= maxRank; r++) wmedianRank(r, true);
      else for (let r = maxRank - 1; r >= 0; r--) wmedianRank(r, false);
      transpose();
      const c = totalCrossings();
      if (c < best) {
        best = c;
        bestSnap = new Map(orderOf);
        // re-pin ranks to the snapshot
      }
      if (c === 0) break;
    }
    applyOrder(bestSnap);
    // rebuild ranks arrays from bestSnap order
    for (let r = 0; r <= maxRank; r++)
      ranks[r]!.sort((a, b) => orderOf.get(a)! - orderOf.get(b)!);
    const sig = ranks.map((r) => r.join(',')).join('|');
    if (!found.some((f) => f.sig === sig))
      found.push({ sig, cross: best, order: new Map(bestSnap) });
  }
  found.sort((a, b) => a.cross - b.cross);
  const keep = found.slice(0, keepK);
  if (keep.length === 0) return [];

  // ── Stage 5+6: coordinate assignment & realization, per kept ordering ──
  const results: BLLayoutResult[] = [];
  for (const cand of keep) {
    applyOrder(cand.order);
    // rebuild rank arrays from this ordering
    const rk: string[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (const n of node.values()) rk[n.rank]!.push(n.id);
    for (let r = 0; r <= maxRank; r++)
      rk[r]!.sort((a, b) => cand.order.get(a)! - cand.order.get(b)!);
    results.push(realize(rk));
  }
  return results;

  // Assign rank-axis & cross-axis coordinates, then build the layout result.
  function realize(rk: string[][]): BLLayoutResult {
    // Rank-axis band centers: stack by max depth in each rank + RANKSEP.
    const bandDepth = rk.map((ids) =>
      Math.max(0, ...ids.map((id) => node.get(id)!.depth))
    );
    const bandCenter: number[] = [];
    let acc = MARGIN;
    for (let r = 0; r <= maxRank; r++) {
      bandCenter[r] = acc + bandDepth[r]! / 2;
      acc += bandDepth[r]! + ranksep;
    }

    // Cross-axis: init evenly spaced, then iterate median alignment with a
    // separation-preserving placement (minimize displacement subject to gaps).
    for (let r = 0; r <= maxRank; r++) {
      let x = MARGIN;
      for (const id of rk[r]!) {
        const n = node.get(id)!;
        n.cross = x + n.thick / 2;
        x += n.thick + nodesep;
      }
    }
    const ITER = 18;
    for (let it = 0; it < ITER; it++) {
      const downPass = it % 2 === 0;
      const order = downPass
        ? Array.from({ length: maxRank + 1 }, (_, i) => i)
        : Array.from({ length: maxRank + 1 }, (_, i) => maxRank - i);
      for (const r of order) {
        const ids = rk[r]!;
        const desired = ids.map((id) => {
          const n = node.get(id)!;
          // weighted average of neighbour cross-coords (both directions)
          let sw = 0,
            sx = 0;
          for (const nb of up.get(id)!) {
            const w = weight(n, node.get(nb)!);
            sw += w;
            sx += w * node.get(nb)!.cross;
          }
          for (const nb of down.get(id)!) {
            const w = weight(n, node.get(nb)!);
            sw += w;
            sx += w * node.get(nb)!.cross;
          }
          return sw > 0 ? sx / sw : n.cross;
        });
        placeWithSeparation(ids, desired);
      }
    }

    // Normalize so min content x = MARGIN.
    let minC = Infinity;
    for (const n of node.values()) minC = Math.min(minC, n.cross - n.thick / 2);
    const shift = MARGIN - minC;
    for (const n of node.values()) n.cross += shift;

    // Map (rank-axis, cross-axis) → (x, y).
    const coord = (n: LNode): Pt =>
      isTB
        ? { x: n.cross, y: bandCenter[n.rank]! }
        : { x: bandCenter[n.rank]!, y: n.cross };

    const layoutNodes: BLLayoutNode[] = parsed.nodes.map((pn) => {
      const n = node.get(pn.label)!;
      const c = coord(n);
      return {
        label: pn.label,
        x: c.x,
        y: c.y,
        width: n.realW,
        height: n.realH,
      };
    });

    const chainById = new Map<number, string[]>();
    for (const ch of chains) chainById.set(ch.edgeIdx, ch.chain);

    // Peripheral routing for back-edges. Each loops around the nearer side; the
    // lane offset (k) nests multiple back-edges on the same side so they don't
    // overlap. Repeated lane corner points pin the curveBasis spline outward.
    let minCross = Infinity,
      maxCross = -Infinity;
    for (const n of node.values()) {
      if (n.dummy) continue;
      minCross = Math.min(minCross, n.cross - n.thick / 2);
      maxCross = Math.max(maxCross, n.cross + n.thick / 2);
    }
    const GAP = 34;
    const LANE = 28; // sibling back-edge lane spacing — wide enough not to "almost touch"
    // Pick the loop side by the SOURCE's position — it's the endpoint that must
    // escape sideways to a lane; the target is typically central (a hub). A
    // left-of-centre source loops left, a right-of-centre source loops right, so
    // returns don't all pile onto one side and stack.
    const sideOf = (b: { src: string; tgt: string }): number => {
      if (backEdgeSide === 'left') return -1;
      if (backEdgeSide === 'right') return 1;
      // Loop on the side the source sits relative to its (usually central) target
      // — splits returns left/right instead of piling them on one side.
      const d = node.get(b.src)!.cross - node.get(b.tgt)!.cross;
      return d >= 0 ? 1 : -1;
    };
    // Assign lanes: per side, longer rank-spans go further out (lower k = inner).
    const backSorted = backEdges
      .map((b) => ({
        ...b,
        side: sideOf(b),
        span: Math.abs(node.get(b.src)!.rank - node.get(b.tgt)!.rank),
      }))
      .sort((a, b) => a.side - b.side || a.span - b.span);
    const sideCounts = new Map<number, number>();
    for (const b of backSorted)
      sideCounts.set(b.side, (sideCounts.get(b.side) ?? 0) + 1);
    const laneCounter = new Map<number, number>();
    const backPoints = new Map<number, Pt[]>();
    const faceLim = (depth: number): number => Math.max(0, depth / 2 - 6);
    // Group same-side returns by shared TARGET. Siblings converging on one hub
    // would otherwise stack their final approach along the same node edge (the
    // pirate-fleet residual: two right-side returns into Captain). Give the inner
    // one the side face and route the outer one(s) over the target's rank-axis
    // top face instead, so the two converging arcs enter on different faces.
    const hubIndex = new Map<number, number>(); // edgeIdx → order among (side,tgt)
    const hubSize = new Map<string, number>();
    {
      const counter = new Map<string, number>();
      for (const b of backSorted) {
        const key = `${b.side}|${b.tgt}`;
        const idx = counter.get(key) ?? 0;
        counter.set(key, idx + 1);
        hubIndex.set(b.edgeIdx, idx);
      }
      for (const [key, v] of counter) hubSize.set(key, v);
    }
    for (const b of backSorted) {
      const s = b.side;
      const k = laneCounter.get(s) ?? 0;
      laneCounter.set(s, k + 1);
      const K = sideCounts.get(s)!;
      const src = node.get(b.src)!;
      const tgt = node.get(b.tgt)!;
      const laneC =
        s > 0 ? maxCross + GAP + k * LANE : minCross - GAP - k * LANE;
      const srcCtr = bandCenter[src.rank]!;
      const tgtCtr = bandCenter[tgt.rank]!;
      // Nested attachments for same-side siblings: outer lane attaches further
      // out at BOTH ends so the arcs nest (never cross). Enter the (upper) target
      // from its top half — away from its downward forward edges; leave the
      // (lower) source from its bottom half. Distributed by lane order across the
      // node face, so siblings into a shared hub fan apart instead of stacking.
      const frac = K > 1 ? (k + 1) / (K + 1) : 0;
      const srcR = srcCtr + frac * faceLim(src.depth);
      const tgtR = tgtCtr - frac * faceLim(tgt.depth);
      const m = (c: number, r: number): Pt =>
        isTB ? { x: c, y: r } : { x: r, y: c };
      // Aesthetic swoop: a single smooth loop, not a pinned rectangle. The curve
      // eases off the source's side, bows out to its lane (single control points
      // → curveBasis rounds the corners gracefully, no overshoot-and-return), and
      // eases back into the target's side. Whatever node a softer curve now clips
      // is bent away by the de-pierce pass downstream — so routing stays pretty
      // and obstacle-avoidance is handled separately.
      const off = 10;
      const srcEdgeC = src.cross + s * (src.thick / 2 + off);
      const tgtEdgeC = tgt.cross + s * (tgt.thick / 2 + off);
      const hubK = hubIndex.get(b.edgeIdx)!;
      const hubN = hubSize.get(`${s}|${b.tgt}`)!;
      if (hubN > 1 && hubK > 0) {
        // Outer sibling of a shared hub: come over the target's top (rank-axis)
        // face. Rise up the lane past the node's top, cross above it, then drop
        // straight into the centre — a clean loop that never shares the side
        // edge the inner sibling hugs. Nested by hubK so 3+ returns stay apart.
        const tgtTop = tgtCtr - (tgt.depth / 2 + GAP + (hubK - 1) * LANE);
        const entryCross = tgt.cross + s * faceLim(tgt.thick) * (hubK / hubN);
        backPoints.set(b.edgeIdx, [
          m(src.cross, srcCtr),
          m(srcEdgeC, srcR),
          m(laneC, srcR),
          m(laneC, tgtTop),
          m(entryCross, tgtTop),
          m(tgt.cross, tgtCtr),
        ]);
      } else {
        // Aesthetic swoop into the side face (the inner / sole sibling).
        backPoints.set(b.edgeIdx, [
          m(src.cross, srcCtr),
          m(srcEdgeC, srcR),
          m(laneC, srcR),
          m(laneC, tgtR),
          m(tgtEdgeC, tgtR),
          m(tgt.cross, tgtCtr),
        ]);
      }
    }

    // Centre-to-centre like the grouped generator, and with the same
    // consequence: an unclipped marker-end hides under the target's rect (#625).
    const nodeRect = (label: string): ClipRect | undefined => {
      const n = node.get(label);
      if (!n) return undefined;
      const c = coord(n);
      return { x: c.x, y: c.y, w: n.realW, h: n.realH };
    };

    const layoutEdges: BLLayoutEdge[] = [];
    for (let i = 0; i < parsed.edges.length; i++) {
      const e = parsed.edges[i]!;
      if (!labelSet.has(e.source) || !labelSet.has(e.target)) continue;
      let points: Pt[];
      if (e.source === e.target) {
        const c = coord(node.get(e.source)!);
        points = [c, c];
      } else {
        if (backPoints.has(i)) {
          points = backPoints.get(i)!;
        } else {
          const chain = chainById.get(i);
          if (!chain) continue;
          points = chain.map((id) => coord(node.get(id)!));
        }
        points = clipEndpointsToNodes(
          points,
          nodeRect(e.source),
          nodeRect(e.target)
        );
      }
      layoutEdges.push({
        source: e.source,
        target: e.target,
        ...(e.label !== undefined && { label: e.label }),
        bidirectional: e.bidirectional,
        lineNumber: e.lineNumber,
        points,
        yOffset: 0,
        parallelCount: 1,
        metadata: e.metadata,
      });
    }

    // Content bbox over nodes AND edge points (peripheral lanes can poke past
    // the node extent, or left of x=0). Shift so everything clears the margin.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of layoutNodes) {
      minX = Math.min(minX, n.x - n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }
    for (const e of layoutEdges)
      for (const p of e.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    const sx = MARGIN - minX;
    const sy = MARGIN - minY;
    const shifted =
      sx !== 0 || sy !== 0
        ? {
            nodes: layoutNodes.map((n) => ({ ...n, x: n.x + sx, y: n.y + sy })),
            edges: layoutEdges.map((e) => ({
              ...e,
              points: e.points.map((p) => ({ x: p.x + sx, y: p.y + sy })),
            })),
          }
        : { nodes: layoutNodes, edges: layoutEdges };
    return {
      nodes: shifted.nodes,
      edges: shifted.edges,
      groups: [],
      width: maxX + sx + MARGIN,
      height: maxY + sy + MARGIN,
    };
  }

  function weight(a: LNode, b: LNode): number {
    if (a.dummy && b.dummy) return W_DUMMY_DUMMY;
    if (a.dummy || b.dummy) return W_REAL_DUMMY;
    return W_REAL_REAL;
  }

  // Place ordered nodes at desired cross-coords, preserving order and minimum
  // separation, minimizing squared displacement (block-merging / PAV).
  function placeWithSeparation(ids: string[], desired: number[]): void {
    const n = ids.length;
    if (n === 0) return;
    // gap[i] = required center-to-center min between i-1 and i
    const half = ids.map((id) => node.get(id)!.thick / 2);
    // Blocks of nodes pinned together; each stores weighted desired sum.
    type Block = {
      pos: number;
      count: number;
      sumOffset: number;
      first: number;
    };
    // Convert desired to "left-anchored" desired (subtract cumulative min gaps)
    const off: number[] = [0];
    for (let i = 1; i < n; i++)
      off[i] = off[i - 1]! + half[i - 1]! + nodesep + half[i]!;
    const d = desired.map((v, i) => v - off[i]!);
    const blocks: Block[] = [];
    for (let i = 0; i < n; i++) {
      let b: Block = { pos: d[i]!, count: 1, sumOffset: d[i]!, first: i };
      while (blocks.length && blocks[blocks.length - 1]!.pos >= b.pos) {
        const prev = blocks.pop()!;
        const count = prev.count + b.count;
        const sumOffset = prev.sumOffset + b.sumOffset;
        b = { pos: sumOffset / count, count, sumOffset, first: prev.first };
      }
      blocks.push(b);
    }
    const xs = new Array<number>(n);
    for (const b of blocks)
      for (let k = 0; k < b.count; k++) xs[b.first + k] = b.pos;
    for (let i = 0; i < n; i++) node.get(ids[i]!)!.cross = xs[i]! + off[i]!;
  }
}
