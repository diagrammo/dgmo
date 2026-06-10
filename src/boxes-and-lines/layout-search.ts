// ============================================================
// Boxes and Lines — experimental "search" layout (behind a flag)
// ============================================================
//
// dagre placement + spline routing, with a multi-seed search over node
// orderings, scored on the actual spline geometry (curveBasis, sampled
// headlessly — no DOM) plus an optional stability term (drift from the
// previous layout). Picks the lowest combined-score ordering.
//
// Rationale: dagre placement reads better than orthogonal routing; crossings
// come from within-layer ordering, so we search orderings rather than reroute.
// Sync (dagre) — no ELK, no async.

import dagre from '@dagrejs/dagre';
import { line as d3line, curveBasis } from 'd3-shape';
import type { ParsedBoxesAndLines, BLGroup } from './types';
import {
  computeNodeSize,
  NODE_WIDTH,
  NODE_HEIGHT,
  type BLLayoutResult,
  type BLLayoutEdge,
} from './layout';

type Pt = { x: number; y: number };

// Default stability weight: combined = crossings + lambda · (meanDriftPx / 100).
// Only applies when previousPositions is supplied (re-layout on edit/collapse).
const DEFAULT_LAMBDA = 4;

function rng(s: number) {
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(a: readonly T[], r: () => number): T[] {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [x[i], x[j]] = [x[j]!, x[i]!];
  }
  return x;
}

const splineGen = d3line<Pt>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(curveBasis);

// flatten an SVG path "d" (M/L/Q/C) into a polyline for crossing detection
function flatten(d: string): Pt[] {
  const toks = d.match(/[MLQC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const pts: Pt[] = [];
  let i = 0,
    cx = 0,
    cy = 0,
    cmd = '';
  const num = () => parseFloat(toks[i++]!);
  const samp = (p0: Pt, c1: Pt, c2: Pt | null, p1: Pt) => {
    for (let t = 0; t <= 1; t += 0.12) {
      const u = 1 - t;
      if (c2)
        pts.push({
          x:
            u * u * u * p0.x +
            3 * u * u * t * c1.x +
            3 * u * t * t * c2.x +
            t * t * t * p1.x,
          y:
            u * u * u * p0.y +
            3 * u * u * t * c1.y +
            3 * u * t * t * c2.y +
            t * t * t * p1.y,
        });
      else
        pts.push({
          x: u * u * p0.x + 2 * u * t * c1.x + t * t * p1.x,
          y: u * u * p0.y + 2 * u * t * c1.y + t * t * p1.y,
        });
    }
  };
  while (i < toks.length) {
    const tk = toks[i]!;
    if (/[MLQC]/i.test(tk)) {
      cmd = tk;
      i++;
    }
    if (cmd === 'M' || cmd === 'L') {
      const x = num(),
        y = num();
      pts.push({ x, y });
      cx = x;
      cy = y;
    } else if (cmd === 'Q') {
      const c1 = { x: num(), y: num() },
        p1 = { x: num(), y: num() };
      samp({ x: cx, y: cy }, c1, null, p1);
      cx = p1.x;
      cy = p1.y;
    } else if (cmd === 'C') {
      const c1 = { x: num(), y: num() },
        c2 = { x: num(), y: num() },
        p1 = { x: num(), y: num() };
      samp({ x: cx, y: cy }, c1, c2, p1);
      cx = p1.x;
      cy = p1.y;
    } else i++;
  }
  return pts;
}
function segPoint(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const den = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(den) < 1e-9) return null;
  const t =
      ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / den,
    u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / den;
  return t > 0 && t < 1 && u > 0 && u < 1
    ? { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
    : null;
}

// trustworthy crossing count on the spline geometry: exclude intersections
// near a genuinely shared endpoint node; cluster near-duplicate hits.
// Exported so the playground + benchmark score with the SAME counter the
// engine optimizes against.
export function countSplineCrossings(layout: BLLayoutResult): number {
  const center = new Map<string, Pt>();
  for (const n of layout.nodes) center.set(n.label, { x: n.x, y: n.y });
  // collapsed group boxes are edge endpoints too (`__group_<label>`); without
  // them, edges meeting AT a collapsed box are miscounted as crossings.
  for (const g of layout.groups)
    if (g.collapsed) center.set('__group_' + g.label, { x: g.x, y: g.y });
  const polys = layout.edges.map((e) => {
    const pts =
      e.points.length >= 2 ? flatten(splineGen(e.points as Pt[]) ?? '') : [];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { pts, s: e.source, t: e.target, x0, y0, x1, y1 };
  });
  const R = 34;
  let total = 0;
  for (let a = 0; a < polys.length; a++)
    for (let b = a + 1; b < polys.length; b++) {
      const A = polys[a]!,
        B = polys[b]!;
      if (A.pts.length < 2 || B.pts.length < 2) continue;
      if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) continue; // bbox disjoint
      const shared = [A.s, A.t]
        .filter((n) => n === B.s || n === B.t)
        .map((n) => center.get(n))
        .filter(Boolean) as Pt[];
      const hits: Pt[] = [];
      for (let i = 1; i < A.pts.length; i++)
        for (let j = 1; j < B.pts.length; j++) {
          const p = segPoint(
            A.pts[i - 1]!,
            A.pts[i]!,
            B.pts[j - 1]!,
            B.pts[j]!
          );
          if (!p) continue;
          if (shared.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < R))
            continue;
          if (!hits.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < 6))
            hits.push(p);
        }
      total += hits.length;
    }
  return total;
}
// Fast crossing estimate for RANKING candidates: straight segments on raw
// waypoints (no curveBasis flatten) + bbox pruning + early-out per pair.
// ~10× cheaper than countSplineCrossings; topology-equivalent for ranking.
function segCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1x = p2.x - p1.x,
    d1y = p2.y - p1.y,
    d2x = p4.x - p3.x,
    d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const s = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  return t > 0.001 && t < 0.999 && s > 0.001 && s < 0.999;
}
function countCrossingsFast(layout: BLLayoutResult): number {
  const E = layout.edges.filter((e) => e.points.length >= 2);
  const bb = E.map((e) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of e.points) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  });
  let count = 0;
  for (let i = 0; i < E.length; i++)
    for (let j = i + 1; j < E.length; j++) {
      const A = E[i]!,
        B = E[j]!;
      if (
        A.source === B.source ||
        A.source === B.target ||
        A.target === B.source ||
        A.target === B.target
      )
        continue;
      const a = bb[i]!,
        b = bb[j]!;
      if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
      const pa = A.points,
        pb = B.points;
      let hit = false;
      for (let ai = 0; ai < pa.length - 1 && !hit; ai++)
        for (let bi = 0; bi < pb.length - 1; bi++) {
          if (segCross(pa[ai]!, pa[ai + 1]!, pb[bi]!, pb[bi + 1]!)) {
            hit = true;
            break;
          }
        }
      if (hit) count++;
    }
  return count;
}
function meanDrift(
  layout: BLLayoutResult,
  prev: ReadonlyMap<string, Pt> | undefined
): number {
  if (!prev?.size) return 0;
  let sum = 0,
    n = 0;
  for (const node of layout.nodes) {
    const p = prev.get(node.label);
    if (p) {
      sum += Math.hypot(node.x - p.x, node.y - p.y);
      n++;
    }
  }
  return n ? sum / n : 0;
}
// total edge length — positioning tiebreaker (shorter/straighter reads better)
function edgeLength(layout: BLLayoutResult): number {
  let total = 0;
  for (const e of layout.edges)
    for (let i = 1; i < e.points.length; i++)
      total += Math.hypot(
        e.points[i]!.x - e.points[i - 1]!.x,
        e.points[i]!.y - e.points[i - 1]!.y
      );
  return total;
}

export function layoutBoxesAndLinesSearch(
  parsed: ParsedBoxesAndLines,
  collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: readonly BLGroup[];
  },
  opts?: {
    hideDescriptions?: boolean;
    previousPositions?: ReadonlyMap<string, Pt>;
    /** Number of seed orderings to search (default: adaptive by node count). */
    seeds?: number;
    /** Stability weight (default 4). */
    lambda?: number;
    /** How many top candidates to re-rank with the exact counter (default 6). */
    refineK?: number;
  }
): BLLayoutResult {
  const hideDescriptions = opts?.hideDescriptions ?? false;

  // collapsed group labels (shown as plain boxes) — mirrors the ELK path
  const collapsedGroupLabels = new Set<string>();
  if (collapseInfo) {
    const missing = new Set<string>();
    for (const og of collapseInfo.originalGroups)
      if (!parsed.groups.some((g) => g.label === og.label))
        missing.add(og.label);
    for (const label of missing) {
      const og = collapseInfo.originalGroups.find((g) => g.label === label);
      const parent = og?.parentGroup;
      if (!parent || !missing.has(parent)) collapsedGroupLabels.add(label);
    }
  }

  // node sizes (computeNodeSize + uniform-height pass) — identical to ELK path
  const sizes = new Map<string, { width: number; height: number }>();
  let maxDescH = 0;
  for (const node of parsed.nodes) {
    const s = hideDescriptions
      ? { width: NODE_WIDTH, height: NODE_HEIGHT }
      : computeNodeSize(node, parsed.showValues === true);
    sizes.set(node.label, s);
    if (!hideDescriptions && node.description && node.description.length > 0)
      maxDescH = Math.max(maxDescH, s.height);
  }
  if (maxDescH > 0)
    for (const node of parsed.nodes)
      if (node.description && node.description.length > 0) {
        const s = sizes.get(node.label)!;
        sizes.set(node.label, { width: s.width, height: maxDescH });
      }

  const gid = (label: string) => `__group_${label}`;
  const rankdir = parsed.direction === 'TB' ? 'TB' : 'LR';

  function place(cfg: {
    ranker: string;
    nodesep: number;
    ranksep: number;
    seed?: number;
  }): BLLayoutResult {
    const r = cfg.seed === undefined ? null : rng(cfg.seed + 1);
    const ord = <T>(a: readonly T[]): T[] => (r ? shuffle(a, r) : a.slice());
    const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
    g.setGraph({
      rankdir,
      ranker: cfg.ranker,
      nodesep: cfg.nodesep,
      ranksep: cfg.ranksep,
      edgesep: 20,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const grp of ord(parsed.groups))
      g.setNode(gid(grp.label), { label: grp.label });
    for (const node of ord(parsed.nodes)) {
      const s = sizes.get(node.label)!;
      g.setNode(node.label, { width: s.width, height: s.height });
    }
    for (const label of collapsedGroupLabels)
      g.setNode(gid(label), { width: NODE_WIDTH, height: NODE_HEIGHT });
    for (const grp of parsed.groups) {
      if (grp.parentGroup && g.hasNode(gid(grp.parentGroup)))
        g.setParent(gid(grp.label), gid(grp.parentGroup));
      for (const c of ord(grp.children)) {
        if (g.hasNode(c)) g.setParent(c, gid(grp.label));
      }
    }
    if (collapseInfo)
      for (const label of collapsedGroupLabels) {
        const og = collapseInfo.originalGroups.find((x) => x.label === label);
        if (
          og?.parentGroup &&
          !collapsedGroupLabels.has(og.parentGroup) &&
          g.hasNode(gid(og.parentGroup))
        )
          g.setParent(gid(label), gid(og.parentGroup));
      }
    for (const e of ord(parsed.edges))
      if (g.hasNode(e.source) && g.hasNode(e.target))
        g.setEdge(e.source, e.target, {});
    dagre.layout(g);

    const nodes = parsed.nodes.map((n) => {
      const p = g.node(n.label);
      return {
        label: n.label,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
      };
    });
    const groups: BLLayoutResult['groups'][number][] = parsed.groups.map(
      (grp) => {
        const p = g.node(gid(grp.label));
        return {
          label: grp.label,
          lineNumber: grp.lineNumber,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          collapsed: false,
          childCount: grp.children.length,
        };
      }
    );
    for (const label of collapsedGroupLabels) {
      const p = g.node(gid(label));
      groups.push({
        label,
        lineNumber: 0,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        collapsed: true,
        childCount: collapseInfo?.collapsedChildCounts.get(label) ?? 0,
      });
    }
    const edges: BLLayoutEdge[] = parsed.edges
      .filter((e) => g.hasEdge(e.source, e.target))
      .map((e) => {
        const ed = g.edge(e.source, e.target) as { points?: Pt[] };
        return {
          source: e.source,
          target: e.target,
          ...(e.label !== undefined && { label: e.label }),
          bidirectional: e.bidirectional,
          lineNumber: e.lineNumber,
          points: ed?.points ?? [],
          yOffset: 0,
          parallelCount: 1,
          metadata: e.metadata,
        };
      });
    const gg = g.graph() as { width?: number; height?: number };
    return {
      nodes,
      edges,
      groups,
      width: gg.width ?? 800,
      height: gg.height ?? 600,
    } as BLLayoutResult;
  }

  const n = parsed.nodes.length;
  // ~500ms budget: search a larger pool, then refine the top few exactly.
  const seedCount =
    opts?.seeds ?? (n <= 12 ? 80 : n <= 22 ? 40 : n <= 35 ? 22 : 10);
  const REFINE_K = opts?.refineK ?? 6;
  const lambda = opts?.lambda ?? DEFAULT_LAMBDA;
  const prev = opts?.previousPositions;

  // Candidate configs: every (ranker × spacing) combo + seed-shuffles of the
  // default. Diverse candidates lower the crossing floor; seed-shuffles vary
  // dagre's within-layer ordering.
  const RANKERS = ['network-simplex', 'tight-tree', 'longest-path'];
  const SPACINGS = [
    { nodesep: 50, ranksep: 60 },
    { nodesep: 34, ranksep: 46 },
    { nodesep: 66, ranksep: 82 },
  ];
  const configs: {
    ranker: string;
    nodesep: number;
    ranksep: number;
    seed?: number;
  }[] = [];
  for (const ranker of RANKERS)
    for (const sp of SPACINGS) configs.push({ ranker, ...sp });
  for (let s = 0; s < seedCount; s++)
    configs.push({
      ranker: 'network-simplex',
      nodesep: 50,
      ranksep: 60,
      seed: s,
    });

  // Objective: crossings dominate (×1e6, strictly fewer wins); ties broken by
  // total edge length (positioning) + stability drift (only when prev given).
  const objective = (lay: BLLayoutResult, crossings: number) =>
    crossings * 1e6 + edgeLength(lay) + lambda * meanDrift(lay, prev) * 10;

  // Build the candidate pool.
  const pool: BLLayoutResult[] = [];
  for (const cfg of configs) {
    try {
      pool.push(place(cfg));
    } catch {
      /* some rankers choke on odd graphs */
    }
  }
  if (!pool.length)
    return place({ ranker: 'network-simplex', nodesep: 50, ranksep: 60 });

  // Stage 1: rank the whole pool with the cheap straight-segment counter.
  pool.sort(
    (a, b) =>
      objective(a, countCrossingsFast(a)) - objective(b, countCrossingsFast(b))
  );

  // Stage 2: re-rank only the top-K with the trustworthy curveBasis counter
  // (captures crossings the straight-segment estimate misses) and pick the best.
  let best = pool[0]!;
  let bestExact = Infinity;
  for (let i = 0; i < Math.min(REFINE_K, pool.length); i++) {
    const lay = pool[i]!;
    const sc = objective(lay, countSplineCrossings(lay));
    if (sc < bestExact) {
      bestExact = sc;
      best = lay;
    }
  }
  return best;
}
