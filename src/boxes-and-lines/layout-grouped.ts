// ============================================================
// Boxes and Lines — tier-banded grouped layered candidate generator
// ============================================================
//
// The default dagre placement engine hands `[Group]` containers to dagre as
// compound clusters and lets dagre rank everything globally. Dagre keeps each
// cluster contiguous but has NO notion of tier ORDER between sibling groups and
// NO cycle-aware routing. Two pathologies follow for tiered architecture
// diagrams (Clients → Edge → Services → Data style):
//
//   1. Back-edge ballooning — an edge that runs UP-tier (a Services node →  a
//      Clients node) is shortened by dagre hoisting its source to the top of the
//      group, ballooning the whole group and squashing its siblings.
//   2. Tier collision — a group with one member that is topologically DEEPER
//      than its siblings (an intra-tier `A -> B` edge) forces that group's band
//      to span two ranks; a sibling group at the deeper rank is then placed
//      SIDE-BY-SIDE instead of below, and the cross edges spray horizontally.
//
// This generator fixes both by making groups first-class TIERS: derive a tier
// order from the inter-group flow, give each top-level group/unit a DISJOINT,
// ORDERED band of ranks, rank members locally inside their band, minimize
// crossings under a group-contiguity constraint, and route the few against-tier
// edges around the periphery (reusing the layered engine's loop routing).
//
// ADDITIVE, like layout-layered.ts: the caller throws these into the same
// placement-search pool and the spline-crossing scorer keeps a grouped candidate
// ONLY when it strictly lowers total badness. A worse candidate is never chosen,
// so there is no regression risk. Declines (returns []) on cases it does not yet
// model (group-endpoint edges, collapsed groups, out-of-range node counts).

import type { ParsedBoxesAndLines } from './types';
import { NODE_WIDTH, NODE_HEIGHT } from './node-metrics';
import { clipEndpointsToNodes, type ClipRect } from './edge-clip';
import type {
  BLLayoutResult,
  BLLayoutEdge,
  BLLayoutNode,
  BLLayoutGroup,
} from './layout';

type Size = { width: number; height: number };
type Pt = { x: number; y: number };

const NODESEP = 50; // cross-axis gap between siblings in a rank
const RANKSEP = 60; // rank-axis gap between adjacent ranks WITHIN a band
const DUMMY_THICK = 10; // cross-axis footprint of a long-edge dummy
const MARGIN = 40;
// Group-box padding + label-zone — MUST match renderer.ts / layout-search.ts so
// the rects this generator emits are scored against the same metric the dagre
// candidates are.
const GROUP_PAD = 16;
const GROUP_LABEL_ZONE = 32;
// Extra cross-axis gap between two adjacent top-level groups so their padded
// boxes (and the lower one's label zone) never collide.
const GROUP_GAP = 24;
// Extra rank-axis gap added when crossing a TIER boundary — clears the lower
// group's label zone plus both groups' vertical pad.
const TIER_GAP = GROUP_LABEL_ZONE + 2 * GROUP_PAD;

// Edge-straightening weights for coordinate assignment (dagre-style): keep long
// dummy chains ruler-straight so they hug one side instead of sweeping across.
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

// Exported (median / acyclicOrient / longestPath) — also consumed by the
// swimlane layout (src/swimlane/layout.ts), which reuses the same pure
// rank+order primitives. No behavior change for boxes-and-lines.
export function median(vals: number[]): number {
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
}

// Break cycles by DFS (mark edges that close a cycle) and return each edge in a
// strict from→to (lower-rank → higher-rank) orientation plus the reversed set.
export function acyclicOrient(
  ids: readonly string[],
  edges: readonly { from: string; to: string; idx: number }[]
): { dag: { from: string; to: string; idx: number; rev: boolean }[] } {
  const adj = new Map<string, { to: string; idx: number }[]>();
  for (const l of ids) adj.set(l, []);
  for (const e of edges) adj.get(e.from)?.push({ to: e.to, idx: e.idx });
  const reversed = new Set<number>();
  const state = new Map<string, 0 | 1 | 2>();
  for (const l of ids) state.set(l, 0);
  const stack: string[] = [];
  const visit = (root: string): void => {
    // Iterative DFS (architecture diagrams can chain deep; avoid call-stack).
    stack.push(root);
    const it = new Map<string, number>();
    while (stack.length) {
      const u = stack[stack.length - 1]!;
      if (state.get(u) === 0) state.set(u, 1);
      const list = adj.get(u)!;
      let i = it.get(u) ?? 0;
      let descended = false;
      for (; i < list.length; i++) {
        const { to, idx } = list[i]!;
        const st = state.get(to)!;
        if (st === 1) reversed.add(idx);
        else if (st === 0) {
          it.set(u, i + 1);
          stack.push(to);
          descended = true;
          break;
        }
      }
      if (!descended) {
        it.set(u, list.length);
        state.set(u, 2);
        stack.pop();
      }
    }
  };
  for (const l of ids) if (state.get(l) === 0) visit(l);
  const dag = edges.map((e) =>
    reversed.has(e.idx)
      ? { from: e.to, to: e.from, idx: e.idx, rev: true }
      : { from: e.from, to: e.to, idx: e.idx, rev: false }
  );
  return { dag };
}

// Longest-path ranking over an acyclic edge set. Returns null if a cycle slips
// through (caller bails). Ranks start at 0.
export function longestPath(
  ids: readonly string[],
  dag: readonly { from: string; to: string }[]
): Map<string, number> | null {
  const out = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const l of ids) {
    out.set(l, []);
    inDeg.set(l, 0);
  }
  for (const d of dag) {
    out.get(d.from)!.push(d.to);
    inDeg.set(d.to, (inDeg.get(d.to) ?? 0) + 1);
  }
  const rank = new Map<string, number>();
  for (const l of ids) rank.set(l, 0);
  const queue = ids.filter((l) => (inDeg.get(l) ?? 0) === 0);
  const indeg2 = new Map(inDeg);
  let seen = 0;
  while (queue.length) {
    const u = queue.shift()!;
    seen++;
    for (const v of out.get(u)!) {
      rank.set(v, Math.max(rank.get(v)!, rank.get(u)! + 1));
      indeg2.set(v, indeg2.get(v)! - 1);
      if (indeg2.get(v) === 0) queue.push(v);
    }
  }
  return seen === ids.length ? rank : null;
}

interface LNode {
  id: string;
  dummy: boolean;
  rank: number; // GLOBAL rank (tier band offset + local rank)
  cross: number;
  thick: number; // cross-axis footprint
  depth: number; // rank-axis footprint
  realW: number;
  realH: number;
  unit: string; // top-level unit key (group label or synthetic singleton)
  /** Group path top→direct (group labels) for contiguity ordering. */
  path: string[];
}

/**
 * Build tier-banded layered candidates for a GROUPED boxes-and-lines graph.
 * Returns [] when the graph has no groups, has group-endpoint edges, or is out
 * of the supported size range — the dagre path handles those.
 */
export function groupedTierCandidates(
  parsed: ParsedBoxesAndLines,
  sizes: ReadonlyMap<string, Size>,
  opts?: { restarts?: number; keepK?: number }
): BLLayoutResult[] {
  if (parsed.groups.length === 0) return [];
  const nCount = parsed.nodes.length;
  if (nCount < 3 || nCount > 60) return [];

  const isTB = parsed.direction === 'TB';
  const labels = parsed.nodes.map((n) => n.label);
  const labelSet = new Set(labels);

  // Decline on group-endpoint edges (`__group_<label>` source/target) — not yet
  // modelled here; dagre routes those.
  for (const e of parsed.edges)
    if (e.source.startsWith('__group_') || e.target.startsWith('__group_'))
      return [];

  // ── Group hierarchy ────────────────────────────────────────
  const groupByLabel = new Map(parsed.groups.map((g) => [g.label, g]));
  const directGroupOf = new Map<string, string>();
  for (const grp of parsed.groups)
    for (const c of grp.children)
      if (labelSet.has(c)) directGroupOf.set(c, grp.label);
  // Top-level group of a label: walk parentGroup to the root.
  const topGroupOf = (groupLabel: string): string => {
    let cur = groupLabel;
    const guard = new Set<string>();
    while (true) {
      const g = groupByLabel.get(cur);
      if (!g?.parentGroup || guard.has(cur)) return cur;
      guard.add(cur);
      cur = g.parentGroup;
    }
  };
  // Group path (top→direct) for a node, [] if ungrouped.
  const pathOf = (label: string): string[] => {
    const direct = directGroupOf.get(label);
    if (!direct) return [];
    const chain: string[] = [direct];
    let cur = direct;
    const guard = new Set<string>([direct]);
    while (true) {
      const g = groupByLabel.get(cur);
      if (!g?.parentGroup || guard.has(g.parentGroup)) break;
      chain.push(g.parentGroup);
      guard.add(g.parentGroup);
      cur = g.parentGroup;
    }
    return chain.reverse();
  };
  // Unit = top-level group label, or a synthetic singleton for ungrouped nodes.
  const SINGLE = '\x00node\x00';
  const unitOf = (label: string): string => {
    const direct = directGroupOf.get(label);
    return direct ? topGroupOf(direct) : SINGLE + label;
  };

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

  // ── Tier order over units (group-flow DAG) ─────────────────
  const unitOfNode = new Map<string, string>();
  for (const l of labels) unitOfNode.set(l, unitOf(l));
  const units = Array.from(new Set(labels.map((l) => unitOfNode.get(l)!)));
  const interUnit = edges
    .filter(({ e }) => unitOfNode.get(e.source) !== unitOfNode.get(e.target))
    .map(({ e, i }) => ({
      from: unitOfNode.get(e.source)!,
      to: unitOfNode.get(e.target)!,
      idx: i,
    }));
  const { dag: unitDag } = acyclicOrient(units, interUnit);
  const tier = longestPath(
    units,
    unitDag.map((d) => ({ from: d.from, to: d.to }))
  );
  if (!tier) return [];

  // ── Local rank inside each unit (intra-unit DAG) ───────────
  const localRank = new Map<string, number>();
  const unitMembers = new Map<string, string[]>();
  for (const l of labels) {
    const u = unitOfNode.get(l)!;
    (unitMembers.get(u) ?? unitMembers.set(u, []).get(u)!).push(l);
  }
  for (const [u, members] of unitMembers) {
    const memberSet = new Set(members);
    const intra = edges
      .filter(
        ({ e }) =>
          unitOfNode.get(e.source) === u &&
          unitOfNode.get(e.target) === u &&
          memberSet.has(e.source) &&
          memberSet.has(e.target)
      )
      .map(({ e, i }) => ({ from: e.source, to: e.target, idx: i }));
    const { dag } = acyclicOrient(members, intra);
    const lr = longestPath(
      members,
      dag.map((d) => ({ from: d.from, to: d.to }))
    );
    if (!lr) return [];
    for (const m of members) localRank.set(m, lr.get(m)!);
  }

  // ── Stack tiers into disjoint rank bands ───────────────────
  const maxTier = Math.max(...units.map((u) => tier.get(u)!));
  const bandHeight: number[] = Array.from({ length: maxTier + 1 }, () => 1);
  for (const u of units) {
    const h = Math.max(
      ...unitMembers.get(u)!.map((m) => localRank.get(m)! + 1)
    );
    const t = tier.get(u)!;
    bandHeight[t] = Math.max(bandHeight[t]!, h);
  }
  const tierBase: number[] = [];
  let accBase = 0;
  for (let t = 0; t <= maxTier; t++) {
    tierBase[t] = accBase;
    accBase += bandHeight[t]!;
  }
  const tierStartRanks = new Set(tierBase.slice(1)); // first rank of each tier>0

  const globalRank = new Map<string, number>();
  for (const l of labels)
    globalRank.set(
      l,
      tierBase[tier.get(unitOfNode.get(l)!)!]! + localRank.get(l)!
    );
  const maxRank = Math.max(...labels.map((l) => globalRank.get(l)!));

  // ── Node model + edge classification by global rank ────────
  const node = new Map<string, LNode>();
  for (const n of parsed.nodes) {
    const s = sizes.get(n.label) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
    node.set(n.label, {
      id: n.label,
      dummy: false,
      rank: globalRank.get(n.label)!,
      cross: 0,
      thick: isTB ? s.width : s.height,
      depth: isTB ? s.height : s.width,
      realW: s.width,
      realH: s.height,
      unit: unitOfNode.get(n.label)!,
      path: pathOf(n.label),
    });
  }

  interface EChain {
    edgeIdx: number;
    chain: string[];
  }
  const chains: EChain[] = [];
  const segs: { a: string; b: string }[] = [];
  const backEdges: { edgeIdx: number; src: string; tgt: string }[] = [];
  const flatEdges: { edgeIdx: number; a: string; b: string }[] = [];
  for (const { e, i } of edges) {
    const rs = globalRank.get(e.source)!;
    const rt = globalRank.get(e.target)!;
    if (rs === rt) {
      flatEdges.push({ edgeIdx: i, a: e.source, b: e.target });
      continue;
    }
    if (rt < rs) {
      backEdges.push({ edgeIdx: i, src: e.source, tgt: e.target });
      continue;
    }
    // Forward (down-tier): dummy chain across intervening ranks.
    const chain: string[] = [e.source];
    let prev = e.source;
    for (let r = rs + 1; r < rt; r++) {
      const id = `__d${i}_${r}`;
      node.set(id, {
        id,
        dummy: true,
        rank: r,
        cross: 0,
        thick: DUMMY_THICK,
        depth: 0,
        realW: 0,
        realH: 0,
        unit: SINGLE + id,
        path: [],
      });
      segs.push({ a: prev, b: id });
      chain.push(id);
      prev = id;
    }
    segs.push({ a: prev, b: e.target });
    chain.push(e.target);
    chains.push({ edgeIdx: i, chain });
  }

  // Rank buckets + adjacency for ordering.
  const ranks: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of node.values()) ranks[n.rank]!.push(n.id);
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

  // ── Ordering: wmedian + transpose (crossing minimization) ──
  const orderOf = new Map<string, number>();
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
          const a = ids[i]!,
            b = ids[i + 1]!;
          ids[i] = b;
          ids[i + 1] = a;
          orderOf.set(b, i);
          orderOf.set(a, i + 1);
          const after =
            (r > 0 ? gapCrossings(r - 1) : 0) +
            (r < maxRank ? gapCrossings(r) : 0);
          if (after < before) improved = true;
          else {
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
      if (r)
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [ids[i], ids[j]] = [ids[j]!, ids[i]!];
        }
      ranks[rr] = ids;
      ids.forEach((id, i) => orderOf.set(id, i));
    }
  };

  const restarts =
    opts?.restarts ?? (nCount <= 16 ? 20 : nCount <= 30 ? 12 : 6);
  const keepK = opts?.keepK ?? 3;
  const found: { sig: string; cross: number; order: Map<string, number> }[] =
    [];
  for (let s = 0; s < restarts; s++) {
    initOrder(s);
    let best = totalCrossings();
    let bestSnap = new Map(orderOf);
    for (let iter = 0; iter < 8; iter++) {
      if (iter % 2 === 0)
        for (let r = 1; r <= maxRank; r++) wmedianRank(r, true);
      else for (let r = maxRank - 1; r >= 0; r--) wmedianRank(r, false);
      transpose();
      const c = totalCrossings();
      if (c < best) {
        best = c;
        bestSnap = new Map(orderOf);
      }
      if (c === 0) break;
    }
    for (const [k, v] of bestSnap) orderOf.set(k, v);
    for (let r = 0; r <= maxRank; r++)
      ranks[r]!.sort((a, b) => orderOf.get(a)! - orderOf.get(b)!);
    const sig = ranks.map((r) => r.join(',')).join('|');
    if (!found.some((f) => f.sig === sig))
      found.push({ sig, cross: best, order: new Map(bestSnap) });
  }
  found.sort((a, b) => a.cross - b.cross);
  const keep = found.slice(0, keepK);
  if (keep.length === 0) return [];

  // ── Realize each kept ordering ─────────────────────────────
  const results: BLLayoutResult[] = [];
  for (const cand of keep) {
    for (const [k, v] of cand.order) orderOf.set(k, v);
    const rk: string[][] = Array.from({ length: maxRank + 1 }, () => []);
    for (const n of node.values()) rk[n.rank]!.push(n.id);
    for (let r = 0; r <= maxRank; r++)
      rk[r]!.sort((a, b) => cand.order.get(a)! - cand.order.get(b)!);
    results.push(realize(rk));
  }
  return results;

  function weight(a: LNode, b: LNode): number {
    if (a.dummy && b.dummy) return W_DUMMY_DUMMY;
    if (a.dummy || b.dummy) return W_REAL_DUMMY;
    return W_REAL_REAL;
  }

  // Place ordered ids at desired cross-coords, preserving order and per-gap
  // minimum separation (block-merging / PAV). `gap[i]` is the required
  // center-to-center distance between ids[i-1] and ids[i].
  function placeWithSeparation(
    ids: string[],
    desired: number[],
    gap: number[]
  ): void {
    const n = ids.length;
    if (n === 0) return;
    const off: number[] = [0];
    for (let i = 1; i < n; i++) off[i] = off[i - 1]! + gap[i]!;
    const d = desired.map((v, i) => v - off[i]!);
    type Block = {
      pos: number;
      count: number;
      sumOffset: number;
      first: number;
    };
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

  // Required center-to-center gap between two adjacent nodes in a rank, widened
  // at group boundaries so padded group boxes don't collide.
  function gapBetween(a: LNode, b: LNode): number {
    const base = a.thick / 2 + b.thick / 2 + NODESEP;
    if (a.dummy || b.dummy) return base;
    if (a.unit !== b.unit) return base + 2 * GROUP_PAD + GROUP_GAP;
    // Same top unit but different direct group → nested sibling boxes.
    const da = a.path[a.path.length - 1];
    const db = b.path[b.path.length - 1];
    if (da !== db && (da || db)) return base + 2 * GROUP_PAD;
    return base;
  }

  function realize(rk: string[][]): BLLayoutResult {
    // Rank-axis band centres — extra gap when crossing a tier boundary.
    const bandDepth = rk.map((ids) =>
      Math.max(0, ...ids.map((id) => node.get(id)!.depth))
    );
    const bandCenter: number[] = [];
    let acc = MARGIN;
    for (let r = 0; r <= maxRank; r++) {
      if (r > 0) acc += RANKSEP + (tierStartRanks.has(r) ? TIER_GAP : 0);
      bandCenter[r] = acc + bandDepth[r]! / 2;
      acc += bandDepth[r]!;
    }

    // Cross-axis: initial spread, then iterate median alignment.
    const gapsFor = (ids: string[]): number[] =>
      ids.map((id, i) =>
        i === 0 ? 0 : gapBetween(node.get(ids[i - 1]!)!, node.get(id)!)
      );
    for (let r = 0; r <= maxRank; r++) {
      const ids = rk[r]!;
      const gap = gapsFor(ids);
      let x = MARGIN;
      for (let i = 0; i < ids.length; i++) {
        const n = node.get(ids[i]!)!;
        x += gap[i]!;
        n.cross = i === 0 ? MARGIN + n.thick / 2 : x;
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
        placeWithSeparation(ids, desired, gapsFor(ids));
      }
    }

    // Normalize so min content cross = MARGIN.
    let minC = Infinity;
    for (const n of node.values()) minC = Math.min(minC, n.cross - n.thick / 2);
    const shiftC = MARGIN - minC;
    for (const n of node.values()) n.cross += shiftC;

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

    // Peripheral routing for against-tier (back) edges. Each loops around the
    // nearer side; lanes nest multiple returns so they don't overlap.
    let minCross = Infinity,
      maxCross = -Infinity;
    for (const n of node.values()) {
      if (n.dummy) continue;
      minCross = Math.min(minCross, n.cross - n.thick / 2);
      maxCross = Math.max(maxCross, n.cross + n.thick / 2);
    }
    const GAP = 34;
    const LANE = 28;
    const faceLim = (depth: number): number => Math.max(0, depth / 2 - 6);
    const sideOf = (b: { src: string; tgt: string }): number => {
      const d = node.get(b.src)!.cross - node.get(b.tgt)!.cross;
      return d >= 0 ? 1 : -1;
    };
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
      const frac = K > 1 ? (k + 1) / (K + 1) : 0;
      const srcR = srcCtr - frac * faceLim(src.depth);
      const tgtR = tgtCtr + frac * faceLim(tgt.depth);
      const m = (c: number, rr: number): Pt =>
        isTB ? { x: c, y: rr } : { x: rr, y: c };
      const off = 10;
      const srcEdgeC = src.cross + s * (src.thick / 2 + off);
      const tgtEdgeC = tgt.cross + s * (tgt.thick / 2 + off);
      // src is the LOWER-rank endpoint (higher global rank); tgt is UP-tier.
      backPoints.set(b.edgeIdx, [
        m(src.cross, srcCtr),
        m(srcEdgeC, srcR),
        m(laneC, srcR),
        m(laneC, tgtR),
        m(tgtEdgeC, tgtR),
        m(tgt.cross, tgtCtr),
      ]);
    }

    // Flat (same-rank) edges: a shallow arc bowing off the rank band so it does
    // not run straight through any node sitting between the two endpoints.
    const flatPoints = new Map<number, Pt[]>();
    for (const f of flatEdges) {
      const a = node.get(f.a)!;
      const b = node.get(f.b)!;
      const ctr = bandCenter[a.rank]!;
      const bow = ctr - (a.depth / 2 + 26);
      const m = (c: number, rr: number): Pt =>
        isTB ? { x: c, y: rr } : { x: rr, y: c };
      flatPoints.set(f.edgeIdx, [
        m(a.cross, ctr),
        m(a.cross, bow),
        m(b.cross, bow),
        m(b.cross, ctr),
      ]);
    }

    // Every branch below routes centre-to-centre, which leaves the marker-end
    // sitting under the target's own opaque rect. dagre clips for itself; this
    // generator has to (#625).
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
        if (backPoints.has(i)) points = backPoints.get(i)!;
        else if (flatPoints.has(i)) points = flatPoints.get(i)!;
        else {
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

    // ── Group rects (bottom-up so parents enclose nested children) ──
    const nodeBox = new Map(
      layoutNodes.map((n) => [
        n.label,
        {
          l: n.x - n.width / 2,
          r: n.x + n.width / 2,
          t: n.y - n.height / 2,
          b: n.y + n.height / 2,
        },
      ])
    );
    // Order groups so children are computed before parents (deepest first).
    const depthOf = (label: string): number => {
      let d = 0;
      let cur: string | undefined = label;
      const guard = new Set<string>();
      while (cur && !guard.has(cur)) {
        guard.add(cur);
        cur = groupByLabel.get(cur)?.parentGroup;
        if (cur) d++;
      }
      return d;
    };
    const childGroups = new Map<string, string[]>();
    for (const g of parsed.groups)
      if (g.parentGroup)
        (
          childGroups.get(g.parentGroup) ??
          childGroups.set(g.parentGroup, []).get(g.parentGroup)!
        ).push(g.label);
    const rectByGroup = new Map<
      string,
      { l: number; r: number; t: number; b: number }
    >();
    const ordered = [...parsed.groups].sort(
      (a, b) => depthOf(b.label) - depthOf(a.label)
    );
    const layoutGroups: BLLayoutGroup[] = [];
    for (const grp of ordered) {
      let l = Infinity,
        r = -Infinity,
        t = Infinity,
        bm = -Infinity;
      const acc = (box: {
        l: number;
        r: number;
        t: number;
        b: number;
      }): void => {
        l = Math.min(l, box.l);
        r = Math.max(r, box.r);
        t = Math.min(t, box.t);
        bm = Math.max(bm, box.b);
      };
      for (const c of grp.children) {
        const nb = nodeBox.get(c);
        if (nb) acc(nb);
      }
      for (const sub of childGroups.get(grp.label) ?? []) {
        const sr = rectByGroup.get(sub);
        if (sr) acc(sr);
      }
      if (!Number.isFinite(l)) continue; // empty group — skip
      const x0 = l - GROUP_PAD;
      const x1 = r + GROUP_PAD;
      const y0 = t - GROUP_LABEL_ZONE;
      const y1 = bm + GROUP_PAD;
      rectByGroup.set(grp.label, { l: x0, r: x1, t: y0, b: y1 });
      layoutGroups.push({
        label: grp.label,
        lineNumber: grp.lineNumber,
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        width: x1 - x0,
        height: y1 - y0,
        collapsed: false,
        childCount: grp.children.length,
      });
    }

    // Content bbox over nodes, edge points, and group rects; shift to margin.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const ext = (x0: number, y0: number, x1: number, y1: number): void => {
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    };
    for (const n of layoutNodes)
      ext(
        n.x - n.width / 2,
        n.y - n.height / 2,
        n.x + n.width / 2,
        n.y + n.height / 2
      );
    for (const e of layoutEdges)
      for (const p of e.points) ext(p.x, p.y, p.x, p.y);
    for (const g of layoutGroups)
      ext(
        g.x - g.width / 2,
        g.y - g.height / 2,
        g.x + g.width / 2,
        g.y + g.height / 2
      );
    const sx = MARGIN - minX;
    const sy = MARGIN - minY;
    const shift = sx !== 0 || sy !== 0;
    return {
      nodes: shift
        ? layoutNodes.map((n) => ({ ...n, x: n.x + sx, y: n.y + sy }))
        : layoutNodes,
      edges: shift
        ? layoutEdges.map((e) => ({
            ...e,
            points: e.points.map((p) => ({ x: p.x + sx, y: p.y + sy })),
          }))
        : layoutEdges,
      groups: shift
        ? layoutGroups.map((g) => ({ ...g, x: g.x + sx, y: g.y + sy }))
        : layoutGroups,
      width: maxX + sx + MARGIN,
      height: maxY + sy + MARGIN,
    };
  }
}
