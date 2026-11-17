// ============================================================
// Swimlane Diagram — Layout
// ============================================================
//
// Purpose-built rank + lane-band pass (Technical Decision 1): lanes are an
// ORTHOGONAL constraint to the flow axis, so we must NOT run dagre (it would
// pick the cross-axis to minimize crossings — exactly the freedom we remove)
// and must NOT call `groupedTierCandidates` (its tier-banding is along the flow
// axis). We reuse only the three pure helpers from the boxes-and-lines grouped
// layout: `acyclicOrient`, `longestPath`, `median`.
//
// Pipeline (LR core): lane→cross band • baseRank=longestPath • finalRank=
// max(baseRank, phaseFloor) monotonic across phases • intra-cell stack • flow
// columns • edge routing (forward gutter / same-rank connector / back-channel
// loop) • bbox. TB is a pure axis-swap projection on top of the same core.

import { acyclicOrient } from '../boxes-and-lines/layout-grouped';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import {
  pathHitsBoxes,
  routeAround,
  type Box,
  type Dir,
  type RouteGoal,
} from './route';
import type {
  ParsedSwimlane,
  SwimArtifact,
  SwimDirection,
  SwimEventPosition,
  SwimLayoutArtifact,
  SwimLayoutEdge,
  SwimLayoutMessage,
  SwimLayoutNode,
  SwimNode,
  SwimShape,
  SwimlaneLayoutResult,
  LayoutBand,
  LayoutPool,
} from './types';

export const MARGIN = 30;
const COL_GAP = 64; // flow-axis gap between rank columns
const NODE_W = 124;
const NODE_H = 44;
const DIAMOND = 56; // gateway bounding box
const TERM_D = 40; // terminal circle diameter
const INTRA_GAP = 16; // cross-axis gap between stacked nodes in one cell
const LANE_PAD = 22; // cross-axis pad inside a lane band
const MIN_LANE = NODE_H + 2 * LANE_PAD;
const LANE_HEADER = 116; // flow-start gutter for lane labels
const PHASE_HEADER = 30; // cross-start gutter for phase labels
const BACK_CHANNEL = 28; // first back-edge channel offset beyond the bands
const BACK_STEP = 18; // nesting step for additional back-edges
const POOL_HEADER = 30; // pool name band (rotated name), flow-start side
const POOL_GAP = 18; // cross-axis gap between pools
const COLLAPSED_POOL = 44; // thickness of a pool with no lanes
export const BOUNDARY_D = 28; // boundary event circle diameter
const BOUNDARY_ROOM = 30; // cross room a boundary event takes past its task
const ARTIFACT_GAP = 22; // host → attachment gap (holds the dotted link)
export const ARTIFACT_FONT = 11;
const ARTIFACT_LINE_H = 13;
const NOTE_MAX_W = 150;
const STORE_W = 40;
const STORE_H = 32;
const DATA_W = 28;
const DATA_H = 36;

interface Pt {
  x: number;
  y: number;
}

function nodeSize(n: SwimNode): { w: number; h: number } {
  const shape: SwimShape = n.shape;
  if (n.boundaryOf !== undefined) return { w: BOUNDARY_D, h: BOUNDARY_D };
  if (
    shape === 'exclusive' ||
    shape === 'parallel' ||
    shape === 'inclusive' ||
    shape === 'event-based'
  )
    return { w: DIAMOND, h: DIAMOND };
  if (shape === 'terminal') return { w: TERM_D, h: TERM_D };
  return { w: NODE_W, h: NODE_H };
}

/**
 * An attachment's box: the glyph plus its caption (store, data) or the
 * wrapped note text beside its bracket. Sizes are layout-independent.
 */
function artifactBox(a: SwimArtifact): {
  w: number;
  h: number;
  lines: string[];
} {
  if (a.kind === 'note') {
    const lines = wrapTextToWidth(a.label, ARTIFACT_FONT, NOTE_MAX_W - 12);
    const textW = Math.max(...lines.map((l) => measureText(l, ARTIFACT_FONT)));
    return {
      w: Math.max(48, Math.ceil(textW) + 14),
      h: lines.length * ARTIFACT_LINE_H + 10,
      lines,
    };
  }
  const lines = wrapTextToWidth(a.label, ARTIFACT_FONT, NODE_W);
  const textW = Math.max(...lines.map((l) => measureText(l, ARTIFACT_FONT)));
  const gw = a.kind === 'store' ? STORE_W : DATA_W;
  const gh = a.kind === 'store' ? STORE_H : DATA_H;
  return {
    w: Math.max(gw, Math.ceil(textW) + 4),
    h: gh + 4 + lines.length * ARTIFACT_LINE_H,
    lines,
  };
}

/**
 * Lane-aware compact rank on a DAG (Kahn topo-order + relaxation).
 *
 * Compaction: a same-lane edge advances the flow column (+1); a cross-lane
 * handoff keeps the column (+0) so a successor in another lane lands in the
 * SAME column as its predecessor — the flow steps straight down (a vertical
 * connector) instead of marching diagonally to the right.
 *
 * Strict same-lane separation: two nodes in the SAME lane connected by a path
 * must NOT share a column — otherwise a loop-back node (A→B→A) collapses onto
 * its ancestor and the edges cross through boxes. We enforce this by tracking,
 * per node, the max rank of every same-lane ancestor and pushing a colliding
 * node one column forward. PARALLEL same-lane branches (no path between them,
 * e.g. fork siblings) are left free to share a column — that stacking is
 * intentional.
 */
function compactRanks(
  ids: string[],
  edges: { from: string; to: string }[],
  laneOf: (id: string) => string,
  floors?: Map<string, number>
): Map<string, number> {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    adj.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  // Per-node max ancestor rank keyed by lane, accumulated as preds are visited.
  const laneMaxIn = new Map<string, Map<string, number>>();
  for (const id of ids) laneMaxIn.set(id, new Map());
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi]!;
    const lu = laneOf(u);
    const accIn = laneMaxIn.get(u)!;
    // Corridor floors (back-edge blocker shifting) apply before separation.
    const fl = floors?.get(u);
    if (fl !== undefined && (rank.get(u) ?? 0) < fl) rank.set(u, fl);
    // Strict separation: if a same-lane ancestor already occupies this column or
    // beyond, step u forward past it.
    const sameLaneAnc = accIn.get(lu);
    if (sameLaneAnc !== undefined && (rank.get(u) ?? 0) <= sameLaneAnc) {
      rank.set(u, sameLaneAnc + 1);
    }
    const ru = rank.get(u)!;
    // u's own lane contribution flows to its descendants.
    const accOut = new Map(accIn);
    accOut.set(lu, Math.max(accOut.get(lu) ?? -1, ru));
    for (const w of adj.get(u) ?? []) {
      const cand = ru + (laneOf(w) === lu ? 1 : 0);
      if (cand > (rank.get(w) ?? 0)) rank.set(w, cand);
      const wIn = laneMaxIn.get(w)!;
      for (const [lane, r] of accOut)
        if (r > (wIn.get(lane) ?? -1)) wIn.set(lane, r);
      const d = (indeg.get(w) ?? 0) - 1;
      indeg.set(w, d);
      if (d === 0) queue.push(w);
    }
  }
  return rank;
}

export function layoutSwimlane(parsed: ParsedSwimlane): SwimlaneLayoutResult {
  const dir: SwimDirection = parsed.direction;
  const isLR = dir === 'LR';

  const nodeById = new Map(parsed.nodes.map((n) => [n.id, n]));
  const ids = parsed.nodes.map((n) => n.id);
  // Boundary events ride on their task: no rank, column or cell of their own.
  const hostOf = (id: string): string | undefined => {
    const h = nodeById.get(id)?.boundaryOf;
    return h !== undefined && nodeById.has(h) ? h : undefined;
  };
  const isBoundary = (id: string): boolean => hostOf(id) !== undefined;
  const anchor = (id: string): string => hostOf(id) ?? id;
  const rankIds = ids.filter((id) => !isBoundary(id));
  const size = new Map(parsed.nodes.map((n) => [n.id, nodeSize(n)]));

  // ── Attachments (store / data / note) ───────────────────────
  interface ArtDraft {
    id: string;
    host: string;
    a: SwimArtifact;
    lines: string[];
    lineNumber: number;
  }
  const artsByHost = new Map<string, ArtDraft[]>();
  const allArts: ArtDraft[] = [];
  for (const n of parsed.nodes) {
    (n.artifacts ?? []).forEach((a, k) => {
      const box = artifactBox(a);
      const id = `${n.id}␞${a.kind}␞${k}`;
      size.set(id, { w: box.w, h: box.h });
      const d: ArtDraft = {
        id,
        host: n.id,
        a,
        lines: box.lines,
        lineNumber: n.lineNumber,
      };
      allArts.push(d);
      (artsByHost.get(n.id) ?? artsByHost.set(n.id, []).get(n.id)!).push(d);
    });
  }
  const boundariesOf = new Map<string, string[]>();
  for (const id of ids) {
    const h = hostOf(id);
    if (h) (boundariesOf.get(h) ?? boundariesOf.set(h, []).get(h)!).push(id);
  }

  const flowLenOf = (id: string): number => {
    const s = size.get(id)!;
    return isLR ? s.w : s.h;
  };
  const crossLenOf = (id: string): number => {
    const s = size.get(id)!;
    return isLR ? s.h : s.w;
  };

  // ── Rank: acyclic longest-path over real edges ──────────────
  const realEdges = parsed.edges
    .map((e, idx) => ({ from: e.source, to: e.target, idx }))
    .filter(
      (e) => e.from !== e.to && nodeById.has(e.from) && nodeById.has(e.to)
    );
  // A boundary event's flow ranks from its task.
  const rankEdges = realEdges
    .map((e) => ({ from: anchor(e.from), to: anchor(e.to), idx: e.idx }))
    .filter((e) => e.from !== e.to);
  const { dag } = acyclicOrient(rankIds, rankEdges);
  const laneOf = (id: string): string => nodeById.get(id)!.lane;
  // Compact ranking: same-lane edges advance the flow column (+1); cross-lane
  // handoffs keep the column (0) and render as a same-rank vertical connector
  // (see edge routing below), stacking lane changes beneath their predecessor —
  // except two same-lane nodes joined by a path are kept on separate columns.
  const baseRank = compactRanks(
    rankIds,
    dag.map((d) => ({ from: d.from, to: d.to })),
    laneOf
  );

  // ── Phase reconciliation (compact ACROSS phases) ────────────
  // Phases do NOT push nodes forward into disjoint column bands: the compact
  // flow rank drives every column directly, so a cross-lane handoff at a phase
  // boundary stacks into the previous phase's column (e.g. Validate sits under
  // Submit Claim) instead of starting a fresh column. `baseRank` already
  // guarantees no two same-lane connected nodes share a column, so this can't
  // reintroduce collisions. Phases survive only as header bands (drawn from the
  // columns their members actually land in — consecutive bands may overlap by
  // the shared handoff column, so the header labels/dividers are approximate).
  let finalRank = new Map<string, number>();
  for (const id of rankIds) finalRank.set(id, baseRank.get(id) ?? 0);

  // ── Back-edge corridor reservation (blocker shifting) ───────
  // A back-edge's vertical legs (node → loop channel below the lanes) must
  // drop through every lane beneath the node. Rather than snaking the edge
  // around boxes, shift the BOXES: any node in a lower lane sharing a leg's
  // column gets its rank floored past the conflict, and the DAG is re-ranked
  // so same-lane successors march right with it. Floors only ever grow, so
  // the loop terminates; anything still blocked after the cap (e.g. a fork
  // sibling stacked in the node's own cell) falls back to the routing jog.
  {
    const laneIdx = new Map(parsed.lanes.map((l, i) => [l.id, i]));
    const dagEdges = dag.map((d) => ({ from: d.from, to: d.to }));
    const floors = new Map<string, number>();
    for (let pass = 0; pass < rankIds.length; pass++) {
      let changed = false;
      for (const e of rankEdges) {
        const fr = finalRank.get(e.from) ?? 0;
        const tr = finalRank.get(e.to) ?? 0;
        if (tr === fr && laneOf(e.from) !== laneOf(e.to)) {
          // A same-column handoff is a straight connector across the lanes
          // between. When a box sits in its way — a node in a lane it crosses,
          // or the source's own attachment below it — step the target one
          // column on, so the handoff becomes a clear forward edge.
          const lf = laneIdx.get(laneOf(e.from))!;
          const lt = laneIdx.get(laneOf(e.to))!;
          const [lo, hi] = lf < lt ? [lf, lt] : [lt, lf];
          const blocked =
            (lt > lf && artsByHost.has(e.from)) ||
            (lt < lf && artsByHost.has(e.to)) ||
            rankIds.some((id) => {
              if (id === e.from || id === e.to) return false;
              if (finalRank.get(id) !== fr) return false;
              const li = laneIdx.get(laneOf(id)) ?? -1;
              return li > lo && li < hi;
            });
          if (blocked && (floors.get(e.to) ?? 0) <= fr) {
            floors.set(e.to, fr + 1);
            changed = true;
          }
          continue;
        }
        if (tr >= fr) continue; // forward — no loop channel legs
        for (const leg of [e.from, e.to]) {
          const legRank = finalRank.get(leg)!;
          const legLane = laneIdx.get(laneOf(leg))!;
          for (const id of rankIds) {
            if (id === e.from || id === e.to) continue;
            if (finalRank.get(id) !== legRank) continue;
            if ((laneIdx.get(laneOf(id)) ?? 0) <= legLane) continue;
            if ((floors.get(id) ?? 0) <= legRank) {
              floors.set(id, legRank + 1);
              changed = true;
            }
          }
        }
      }
      if (!changed) break;
      finalRank = compactRanks(rankIds, dagEdges, laneOf, floors);
    }
  }
  for (const id of ids) {
    const h = hostOf(id);
    if (h) finalRank.set(id, finalRank.get(h) ?? 0);
  }

  // Contiguous rank indices.
  const usedRanks = Array.from(
    new Set(rankIds.map((id) => finalRank.get(id)!))
  ).sort((a, b) => a - b);
  const rankIndex = new Map(usedRanks.map((r, i) => [r, i]));
  const R = usedRanks.length;
  const riOf = (id: string): number =>
    rankIndex.get(finalRank.get(anchor(id))!) ?? 0;

  // ── Flow columns ────────────────────────────────────────────
  const hasPools = parsed.pools.length > 0;
  const poolHeader = hasPools ? POOL_HEADER : 0;
  const contentFlowStart = poolHeader + LANE_HEADER + MARGIN;
  const colFlowLen: number[] = Array.from({ length: R }, () => 0);
  for (const id of [...rankIds, ...allArts.map((a) => a.id)]) {
    const ri = riOf(allArts.find((a) => a.id === id)?.host ?? id);
    // Top-down, a task's boundary events hang below it on the flow axis, so
    // its column keeps that room on both sides to stay centred.
    const room = !isLR && boundariesOf.has(id) ? 2 * BOUNDARY_ROOM : 0;
    colFlowLen[ri] = Math.max(colFlowLen[ri]!, flowLenOf(id) + room);
  }
  const flowCenter: number[] = [];
  const colLen: number[] = [];
  {
    let acc = contentFlowStart;
    for (let ri = 0; ri < R; ri++) {
      const len = Math.max(colFlowLen[ri]!, NODE_W);
      colLen[ri] = len;
      flowCenter[ri] = acc + len / 2;
      acc += len + COL_GAP;
    }
  }
  // Midpoint of the node-free gap between columns gi and gi+1 — columns only
  // ever hold nodes within colLen/2 of their center, so this corridor is
  // guaranteed clear of boxes.
  const gapMid = (gi: number): number =>
    flowCenter[gi]! + colLen[gi]! / 2 + COL_GAP / 2;
  const totalFlow =
    (R > 0
      ? flowCenter[R - 1]! + Math.max(colFlowLen[R - 1]!, NODE_W) / 2
      : contentFlowStart) + MARGIN;

  // ── Cells: a lane × column holds its nodes, each followed by its
  //    attachments; a task with boundary events keeps room under it. ──
  interface CellItem {
    id: string;
    art: boolean;
  }
  const contentCrossStart = (parsed.phases.length ? PHASE_HEADER : 0) + MARGIN;
  const cellNodes = new Map<string, CellItem[]>(); // `${laneId}\x00${ri}`
  for (const n of parsed.nodes) {
    if (isBoundary(n.id)) continue;
    const key = `${n.lane}\x00${riOf(n.id)}`;
    const arr = cellNodes.get(key) ?? cellNodes.set(key, []).get(key)!;
    arr.push({ id: n.id, art: false });
    for (const a of artsByHost.get(n.id) ?? [])
      arr.push({ id: a.id, art: true });
  }
  /** Offsets of each item from the stack start, and the stack length. */
  const stackOf = (
    arr: CellItem[]
  ): { pos: number[]; len: number; single: boolean } => {
    const pos: number[] = [];
    let c = 0;
    let pendingRoom = false; // the last node carries boundary events
    arr.forEach((it, k) => {
      if (k > 0) {
        c += it.art ? ARTIFACT_GAP : INTRA_GAP;
        if (pendingRoom) c += BOUNDARY_ROOM;
        pendingRoom = false;
      }
      pos.push(c);
      c += crossLenOf(it.id);
      // Left-right, boundary events hang below the task on the cross axis.
      if (!it.art) pendingRoom = isLR && boundariesOf.has(it.id);
    });
    if (pendingRoom) c += BOUNDARY_ROOM;
    return { pos, len: c, single: arr.filter((x) => !x.art).length === 1 };
  };
  /** Cross room a cell needs (a lone node stays centred on its lane). */
  const cellNeed = (arr: CellItem[]): number => {
    if (arr.length === 0) return 0;
    const st = stackOf(arr);
    if (!st.single) return st.len;
    const half = crossLenOf(arr[0]!.id) / 2;
    return 2 * Math.max(half, st.len - half);
  };

  // ── Rows: lanes, grouped by pool; a lane-less pool is one thin bar ──
  type Row =
    | { kind: 'lane'; id: string; gapBefore: number }
    | { kind: 'pool'; id: string; gapBefore: number };
  const rows: Row[] = [];
  if (!hasPools) {
    for (const l of parsed.lanes)
      rows.push({ kind: 'lane', id: l.id, gapBefore: 0 });
  } else {
    const laneIds = new Set(parsed.lanes.map((l) => l.id));
    parsed.pools.forEach((pool, pi) => {
      const gap = pi === 0 ? 0 : POOL_GAP;
      const own = pool.lanes.filter((l) => laneIds.has(l));
      if (own.length === 0)
        rows.push({ kind: 'pool', id: pool.id, gapBefore: gap });
      else
        own.forEach((l, k) =>
          rows.push({ kind: 'lane', id: l, gapBefore: k === 0 ? gap : 0 })
        );
    });
    // Lanes outside every pool (an error, still drawn) go last.
    for (const l of parsed.lanes)
      if (l.pool === undefined)
        rows.push({ kind: 'lane', id: l.id, gapBefore: POOL_GAP });
  }
  const laneCrossStart = new Map<string, number>();
  const laneThick = new Map<string, number>();
  const laneCenter = new Map<string, number>();
  const poolCross = new Map<string, { start: number; end: number }>();
  let laneCrossEnd = contentCrossStart;
  {
    let acc = contentCrossStart;
    for (const row of rows) {
      acc += row.gapBefore;
      if (row.kind === 'pool') {
        poolCross.set(row.id, { start: acc, end: acc + COLLAPSED_POOL });
        acc += COLLAPSED_POOL;
        continue;
      }
      let maxCell = 0;
      for (let ri = 0; ri < R; ri++)
        maxCell = Math.max(
          maxCell,
          cellNeed(cellNodes.get(`${row.id}\x00${ri}`) ?? [])
        );
      const thick = Math.max(MIN_LANE, maxCell + 2 * LANE_PAD);
      laneCrossStart.set(row.id, acc);
      laneThick.set(row.id, thick);
      laneCenter.set(row.id, acc + thick / 2);
      acc += thick;
    }
    laneCrossEnd = acc;
    for (const pool of parsed.pools) {
      if (poolCross.has(pool.id)) continue;
      const own = pool.lanes.filter((l) => laneCrossStart.has(l));
      if (own.length === 0) continue;
      const first = own[0]!;
      const last = own[own.length - 1]!;
      poolCross.set(pool.id, {
        start: laneCrossStart.get(first)!,
        end: laneCrossStart.get(last)! + laneThick.get(last)!,
      });
    }
  }

  // ── Node cross positions (intra-cell stack around lane center) ──
  const nodeFlow = new Map<string, number>();
  const nodeCross = new Map<string, number>();
  for (const [key, arr] of cellNodes) {
    const sep = key.indexOf('\x00');
    const laneId = key.slice(0, sep);
    const center = laneCenter.get(laneId) ?? contentCrossStart;
    const st = stackOf(arr);
    const start = st.single
      ? center - crossLenOf(arr[0]!.id) / 2
      : center - st.len / 2;
    arr.forEach((it, k) => {
      nodeCross.set(it.id, start + st.pos[k]! + crossLenOf(it.id) / 2);
      const hostId = it.art ? allArts.find((a) => a.id === it.id)!.host : it.id;
      nodeFlow.set(it.id, flowCenter[riOf(hostId)]!);
    });
  }
  // Boundary events sit on their task's bottom edge: the cross-far edge in
  // LR, the flow-far edge in TB.
  for (const [h, bs] of boundariesOf) {
    const hf = nodeFlow.get(h);
    const hc = nodeCross.get(h);
    if (hf === undefined || hc === undefined) continue;
    bs.forEach((b, k) => {
      const frac = bs.length === 1 ? 0.45 : -0.55 + (1.1 * k) / (bs.length - 1);
      if (isLR) {
        nodeFlow.set(b, hf + (flowLenOf(h) / 2) * frac);
        nodeCross.set(b, hc + crossLenOf(h) / 2);
      } else {
        nodeFlow.set(b, hf + flowLenOf(h) / 2);
        nodeCross.set(b, hc + (crossLenOf(h) / 2) * frac);
      }
    });
  }

  // ── Back-edge channels (below the lanes, nested) ────────────
  let backCount = 0;
  for (const e of realEdges)
    if (
      !isBoundary(e.from) &&
      !isBoundary(e.to) &&
      (finalRank.get(e.to) ?? 0) < (finalRank.get(e.from) ?? 0)
    )
      backCount++;
  const needsBack = backCount > 0;
  // Reserve only down to the DEEPEST back-edge channel — routing uses
  // backIdx 0..backCount-1, so the deepest channel is BACK_STEP*(backCount-1)
  // beyond BACK_CHANNEL. The old formula added an extra channel step plus a
  // second MARGIN, leaving dead whitespace below the loop-back.
  const backReserve = needsBack
    ? BACK_CHANNEL + BACK_STEP * (backCount - 1)
    : 0;
  const totalCross = laneCrossEnd + backReserve + MARGIN;

  const project = (flow: number, cross: number): Pt =>
    isLR ? { x: flow, y: cross } : { x: cross, y: flow };

  // ── Event position (start / mid / end) from sequence flow only ──
  const seqIn = new Map<string, number>();
  const seqOut = new Map<string, number>();
  for (const e of realEdges) {
    seqOut.set(e.from, (seqOut.get(e.from) ?? 0) + 1);
    seqIn.set(e.to, (seqIn.get(e.to) ?? 0) + 1);
  }
  const eventPosition = (id: string): SwimEventPosition => {
    if (isBoundary(id)) return 'mid';
    if (!seqIn.get(id)) return 'start';
    if (!seqOut.get(id)) return 'end';
    return 'mid';
  };

  // ── Layout nodes ────────────────────────────────────────────
  const layoutNodes: SwimLayoutNode[] = parsed.nodes.map((n) => {
    const s = size.get(n.id)!;
    const p = project(nodeFlow.get(n.id)!, nodeCross.get(n.id)!);
    return {
      id: n.id,
      label: n.label,
      shape: n.shape,
      event: n.event,
      lane: n.lane,
      ...(n.phase !== undefined && { phase: n.phase }),
      ...(n.color !== undefined && { color: n.color }),
      tags: n.tags,
      ...(n.taskType !== undefined && { taskType: n.taskType }),
      ...(n.shape === 'terminal' && { eventPosition: eventPosition(n.id) }),
      ...(isBoundary(n.id) && { boundaryOf: hostOf(n.id)! }),
      x: p.x,
      y: p.y,
      width: s.w,
      height: s.h,
      lineNumber: n.lineNumber,
    };
  });

  // ── Obstacles: every node, boundary event and attachment box ──
  const boxIds = [...ids, ...allArts.map((a) => a.id)];
  const boxOf = (id: string): Box => {
    const s = size.get(id)!;
    const p = project(nodeFlow.get(id)!, nodeCross.get(id)!);
    return {
      x1: p.x - s.w / 2,
      y1: p.y - s.h / 2,
      x2: p.x + s.w / 2,
      y2: p.y + s.h / 2,
    };
  };
  const obstacles: Box[] = boxIds
    .filter((id) => nodeFlow.has(id) && nodeCross.has(id))
    .map(boxOf);

  // ── Forward-edge channel tracks ─────────────────────────────
  // A forward edge that changes cross position bends in the node-free gap
  // just before its target's column. Several edges bending in one gap would
  // share one vertical line, so each source gets its own track there (edges
  // fanning out of one source keep one trunk). Downward edges from a higher
  // source take tracks nearer the target, so their runs do not cross.
  const CHANNEL_GAP = 16;
  const bendFlow: number[] = new Array(parsed.edges.length).fill(NaN);
  {
    const byGap = new Map<number, number[]>();
    parsed.edges.forEach((e, i) => {
      const s = nodeById.get(e.source);
      const t = nodeById.get(e.target);
      if (!s || !t || s.id === t.id) return;
      if (isBoundary(s.id) || isBoundary(t.id)) return;
      const sR = finalRank.get(s.id) ?? 0;
      const tR = finalRank.get(t.id) ?? 0;
      if (tR <= sR) return;
      if (
        Math.abs((nodeCross.get(s.id) ?? 0) - (nodeCross.get(t.id) ?? 0)) < 0.5
      )
        return;
      const gi = riOf(t.id) - 1;
      (byGap.get(gi) ?? byGap.set(gi, []).get(gi)!).push(i);
    });
    for (const [gi, idxs] of byGap) {
      const sources = [...new Set(idxs.map((i) => parsed.edges[i]!.source))];
      const key = (src: string): number => {
        const e =
          parsed.edges[idxs.find((i) => parsed.edges[i]!.source === src)!]!;
        const sc = nodeCross.get(e.source) ?? 0;
        const down = (nodeCross.get(e.target) ?? 0) > sc;
        return down ? -sc : -1e6 + sc;
      };
      sources.sort((a, b) => key(a) - key(b));
      const n = sources.length;
      const step = n > 1 ? Math.min(CHANNEL_GAP, (COL_GAP - 16) / (n - 1)) : 0;
      const track = new Map(
        sources.map((src, k) => [src, gapMid(gi) + (k - (n - 1) / 2) * step])
      );
      for (const i of idxs) bendFlow[i] = track.get(parsed.edges[i]!.source)!;
    }
  }

  // ── Back-edge leg clearance ─────────────────────────────────
  // A back-edge's vertical legs (source→channel drop, channel→target rise) run
  // at the node's column center — straight through any node stacked below it in
  // another lane (compact ranking deliberately shares columns across lanes).
  // When a leg is blocked, jog it sideways into the node-free gap between
  // columns: exit the node, descend into the clear corridor above the first
  // blocker, shift to the gap, then continue to the channel. Crossing other
  // EDGES there is fine — cutting through a BOX is not.
  const BLOCK_CLEAR = 4;
  interface BackLeg {
    flow: number; // flow coordinate the leg uses at the channel
    jogCross?: number; // clear corridor to shift sideways in (set when jogged)
  }
  const routeBackLeg = (
    selfId: string,
    flow: number,
    fromCross: number,
    toCross: number,
    ri: number,
    towardFlow: number
  ): BackLeg => {
    let firstBlockTop = Infinity;
    for (const id of boxIds) {
      if (id === selfId) continue;
      const nf = nodeFlow.get(id);
      const c = nodeCross.get(id);
      if (nf === undefined || c === undefined) continue;
      const fh = flowLenOf(id) / 2 + BLOCK_CLEAR;
      if (Math.abs(nf - flow) >= fh) continue;
      const ch = crossLenOf(id) / 2;
      if (c + ch <= fromCross || c - ch >= toCross) continue;
      firstBlockTop = Math.min(firstBlockTop, c - ch);
    }
    if (firstBlockTop === Infinity) return { flow };
    // Jog toward the other endpoint when a gap exists on that side; else away.
    const leftGap = ri - 1;
    const rightGap = ri < R - 1 ? ri : -1;
    let gi = towardFlow < flow ? leftGap : rightGap;
    if (gi < 0) gi = towardFlow < flow ? rightGap : leftGap;
    if (gi < 0) return { flow }; // single column — nowhere to jog
    return { flow: gapMid(gi), jogCross: (fromCross + firstBlockTop) / 2 };
  };

  // ── Obstacle-aware fallback ─────────────────────────────────
  // Grid hints for the router: column centres and gaps, lane centres, and the
  // back-edge channels.
  const hintFlow = [
    ...flowCenter,
    ...flowCenter.slice(0, -1).map((_, gi) => gapMid(gi)),
  ];
  const hintCross = [
    ...laneCenter.values(),
    ...Array.from(
      { length: backCount },
      (_, k) => laneCrossEnd + BACK_CHANNEL + BACK_STEP * k
    ),
  ];
  const hints = isLR
    ? { xs: hintFlow, ys: hintCross }
    : { xs: hintCross, ys: hintFlow };
  interface Port {
    at: Pt;
    out: Dir;
  }
  const portsOf = (id: string): Port[] => {
    const b = boxOf(id);
    const cx = (b.x1 + b.x2) / 2;
    const cy = (b.y1 + b.y2) / 2;
    return [
      { at: { x: b.x2, y: cy }, out: { dx: 1, dy: 0 } },
      { at: { x: b.x1, y: cy }, out: { dx: -1, dy: 0 } },
      { at: { x: cx, y: b.y2 }, out: { dx: 0, dy: 1 } },
      { at: { x: cx, y: b.y1 }, out: { dx: 0, dy: -1 } },
    ];
  };
  const cost = (pts: readonly Pt[]): number => {
    let c = 0;
    for (let i = 0; i + 1 < pts.length; i++)
      c +=
        Math.abs(pts[i + 1]!.x - pts[i]!.x) +
        Math.abs(pts[i + 1]!.y - pts[i]!.y);
    return c + 36 * Math.max(0, pts.length - 2);
  };
  /** Port a route actually leaves (first segment) or enters (last). */
  const portFromPath = (pts: readonly Pt[], end: boolean): Port | null => {
    if (pts.length < 2) return null;
    const a = end ? pts[pts.length - 1]! : pts[0]!;
    const b = end ? pts[pts.length - 2]! : pts[1]!;
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    if ((dx === 0) === (dy === 0)) return null;
    return { at: a, out: { dx, dy } };
  };
  const routeBetween = (
    sid: string,
    tid: string,
    prefer: { s?: Port | null; t?: Port | null }
  ): Pt[] | null => {
    if (prefer.s && prefer.t) {
      const r = routeAround(
        prefer.s.at,
        prefer.s.out,
        { kind: 'port', at: prefer.t.at, out: prefer.t.out },
        obstacles,
        hints
      );
      if (r) return r;
    }
    let best: Pt[] | null = null;
    const sPorts = prefer.s ? [prefer.s, ...portsOf(sid)] : portsOf(sid);
    const tPorts = prefer.t ? [prefer.t, ...portsOf(tid)] : portsOf(tid);
    for (const sp of sPorts)
      for (const tp of tPorts) {
        const r = routeAround(
          sp.at,
          sp.out,
          { kind: 'port', at: tp.at, out: tp.out },
          obstacles,
          hints
        );
        if (r && (!best || cost(r) < cost(best))) best = r;
      }
    return best;
  };
  const crossOut = (sign: number): Dir =>
    isLR ? { dx: 0, dy: sign } : { dx: sign, dy: 0 };
  const flowIn: Dir = isLR ? { dx: -1, dy: 0 } : { dx: 0, dy: -1 };

  // ── Edge routing ────────────────────────────────────────────
  let backIdx = 0;
  const layoutEdges: SwimLayoutEdge[] = [];
  parsed.edges.forEach((e, ei) => {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t || s.id === t.id) return;
    const sFlow = nodeFlow.get(s.id)!;
    const sCross = nodeCross.get(s.id)!;
    const tFlow = nodeFlow.get(t.id)!;
    const tCross = nodeCross.get(t.id)!;
    const sFlowHalf = flowLenOf(s.id) / 2;
    const tFlowHalf = flowLenOf(t.id) / 2;
    const sCrossHalf = crossLenOf(s.id) / 2;
    const tCrossHalf = crossLenOf(t.id) / 2;
    const sRank = finalRank.get(s.id) ?? 0;
    const tRank = finalRank.get(t.id) ?? 0;

    let pts: Pt[];
    let back = false;
    if (isBoundary(s.id) || isBoundary(t.id)) {
      // The exception path leaves the boundary event downward (cross-far in
      // LR, flow-far in TB), then the router finds the clear way to the target.
      const sPort: Port | null = isBoundary(s.id)
        ? {
            at: isLR
              ? project(sFlow, sCross + sCrossHalf)
              : project(sFlow + sFlowHalf, sCross),
            out: { dx: 0, dy: 1 },
          }
        : null;
      const tPort: Port | null =
        tRank > sRank || isBoundary(s.id)
          ? {
              at: project(tFlow - tFlowHalf, tCross),
              out: flowIn,
            }
          : null;
      pts = routeBetween(s.id, t.id, { s: sPort, t: tPort }) ?? [
        sPort?.at ?? project(sFlow, sCross),
        tPort?.at ?? project(tFlow, tCross),
      ];
    } else if (tRank > sRank) {
      // Forward: leading edge of source → trailing edge of target.
      const a = sFlow + sFlowHalf;
      const b = tFlow - tFlowHalf;
      if (Math.abs(sCross - tCross) < 0.5) {
        pts = [project(a, sCross), project(b, tCross)];
      } else {
        const mid = Number.isNaN(bendFlow[ei]!) ? (a + b) / 2 : bendFlow[ei]!;
        pts = [
          project(a, sCross),
          project(mid, sCross),
          project(mid, tCross),
          project(b, tCross),
        ];
      }
    } else if (tRank === sRank) {
      // Same rank, different lane: a cross-axis connector.
      const downward = tCross >= sCross;
      const a = sCross + (downward ? sCrossHalf : -sCrossHalf);
      const b = tCross + (downward ? -tCrossHalf : tCrossHalf);
      if (Math.abs(sFlow - tFlow) < 0.5) {
        pts = [project(sFlow, a), project(tFlow, b)];
      } else {
        const midC = (a + b) / 2;
        pts = [
          project(sFlow, a),
          project(sFlow, midC),
          project(tFlow, midC),
          project(tFlow, b),
        ];
      }
    } else {
      // Back-edge: loop through a reserved channel below the lanes.
      back = true;
      const channelC = laneCrossEnd + BACK_CHANNEL + BACK_STEP * backIdx;
      backIdx++;
      const sBottom = sCross + sCrossHalf;
      const tBottom = tCross + tCrossHalf;
      const sLeg = routeBackLeg(
        s.id,
        sFlow,
        sBottom,
        channelC,
        riOf(s.id),
        tFlow
      );
      const tLeg = routeBackLeg(
        t.id,
        tFlow,
        tBottom,
        channelC,
        riOf(t.id),
        sFlow
      );
      pts = [
        project(sFlow, sBottom),
        ...(sLeg.jogCross !== undefined
          ? [project(sFlow, sLeg.jogCross), project(sLeg.flow, sLeg.jogCross)]
          : []),
        project(sLeg.flow, channelC),
        project(tLeg.flow, channelC),
        ...(tLeg.jogCross !== undefined
          ? [project(tLeg.flow, tLeg.jogCross), project(tFlow, tLeg.jogCross)]
          : []),
        project(tFlow, tBottom),
      ];
    }
    // The rule: an edge never passes through a box. A cheap route that does
    // is replaced by a clear one from the router.
    if (pathHitsBoxes(pts, obstacles)) {
      const clear = routeBetween(s.id, t.id, {
        s: portFromPath(pts, false),
        t: portFromPath(pts, true),
      });
      if (clear) pts = clear;
    }
    layoutEdges.push({
      source: e.source,
      target: e.target,
      ...(e.label !== undefined && { label: e.label }),
      points: pts,
      back,
      lineNumber: e.lineNumber,
    });
  });

  // ── Bands (lanes, pools, phases) ────────────────────────────
  const projectBand = (
    flowStart: number,
    flowExtent: number,
    crossStart: number,
    crossExtent: number
  ): { x: number; y: number; width: number; height: number } =>
    isLR
      ? { x: flowStart, y: crossStart, width: flowExtent, height: crossExtent }
      : { x: crossStart, y: flowStart, width: crossExtent, height: flowExtent };

  const lanes: LayoutBand[] = parsed.lanes.map((lane) => {
    // Inside a pool a lane starts after the pool's name band.
    const fs = lane.pool !== undefined ? poolHeader : 0;
    const box = projectBand(
      fs,
      totalFlow - fs,
      laneCrossStart.get(lane.id)!,
      laneThick.get(lane.id)!
    );
    return {
      id: lane.id,
      label: lane.label,
      ...(lane.color !== undefined && { color: lane.color }),
      ...box,
      headerSize: LANE_HEADER,
      lineNumber: lane.lineNumber,
    };
  });

  const pools: LayoutPool[] = [];
  for (const pool of parsed.pools) {
    const pc = poolCross.get(pool.id);
    if (!pc) continue;
    pools.push({
      id: pool.id,
      label: pool.label,
      ...projectBand(0, totalFlow, pc.start, pc.end - pc.start),
      headerSize: POOL_HEADER,
      collapsed: !pool.lanes.some((l) => laneCrossStart.has(l)),
      lineNumber: pool.lineNumber,
    });
  }

  // ── Attachments: placed in their cell, linked by a dotted line ──
  const artifacts: SwimLayoutArtifact[] = allArts.map((d) => {
    const s = size.get(d.id)!;
    const f = nodeFlow.get(d.id)!;
    const c = nodeCross.get(d.id)!;
    const hc = nodeCross.get(d.host)!;
    const hostEdge = hc + crossLenOf(d.host) / 2;
    const p = project(f, c);
    return {
      id: d.id,
      kind: d.a.kind,
      label: d.a.label,
      lines: d.lines,
      host: d.host,
      x: p.x,
      y: p.y,
      width: s.w,
      height: s.h,
      // A note's association meets its bracket's open corner; a store's or a
      // data object's meets the glyph's near edge.
      link:
        d.a.kind === 'note'
          ? [project(f, hostEdge), { x: p.x - s.w / 2, y: p.y - s.h / 2 }]
          : [project(f, hostEdge), project(f, c - crossLenOf(d.id) / 2)],
      lineNumber: d.lineNumber,
    };
  });

  // ── Message flows (`~>`), between pools ─────────────────────
  const messages: SwimLayoutMessage[] = [];
  const crossOfPool = (id: string): { start: number; end: number } | null =>
    poolCross.get(id) ?? null;
  for (const m of parsed.messages) {
    const sNode = m.sourceIsPool ? undefined : nodeById.get(m.source);
    const tNode = m.targetIsPool ? undefined : nodeById.get(m.target);
    const sPool = m.sourceIsPool ? crossOfPool(m.source) : null;
    const tPool = m.targetIsPool ? crossOfPool(m.target) : null;
    if ((!sNode && !sPool) || (!tNode && !tPool)) continue;
    const midOf = (n: SwimNode | undefined, p: typeof sPool): number =>
      n ? nodeCross.get(n.id)! : (p!.start + p!.end) / 2;
    const sMid = midOf(sNode, sPool);
    const tMid = midOf(tNode, tPool);
    const down = tMid > sMid ? 1 : -1;
    const nodePort = (n: SwimNode, sign: number): Port => ({
      at: project(
        nodeFlow.get(n.id)!,
        nodeCross.get(n.id)! + (sign * crossLenOf(n.id)) / 2
      ),
      out: crossOut(sign),
    });
    const poolEdge = (
      p: { start: number; end: number },
      sign: number
    ): number => (sign > 0 ? p.end : p.start);
    const flowSpan = {
      from: contentFlowStart - COL_GAP / 2,
      to: totalFlow - 8,
    };
    let pts: Pt[] | null = null;
    if (sNode && tNode) {
      pts = routeBetween(sNode.id, tNode.id, {
        s: nodePort(sNode, down),
        t: nodePort(tNode, -down),
      });
    } else if (sNode && tPool) {
      const sp = nodePort(sNode, down);
      const v = poolEdge(tPool, -down);
      const goal: RouteGoal = {
        kind: 'line',
        axis: isLR ? 'y' : 'x',
        value: v,
        ...flowSpan,
        out: crossOut(-down),
      };
      pts = routeAround(sp.at, sp.out, goal, obstacles, hints);
    } else if (sPool && tNode) {
      const tp = nodePort(tNode, -down);
      const start = project(nodeFlow.get(tNode.id)!, poolEdge(sPool, down));
      pts = routeAround(
        start,
        crossOut(down),
        { kind: 'port', at: tp.at, out: tp.out },
        obstacles,
        hints
      );
    } else if (sPool && tPool) {
      const f = (flowSpan.from + flowSpan.to) / 2;
      pts = [
        project(f, poolEdge(sPool, down)),
        project(f, poolEdge(tPool, -down)),
      ];
    }
    if (!pts) {
      const a = sNode
        ? project(nodeFlow.get(sNode.id)!, sMid)
        : project(contentFlowStart, poolEdge(sPool!, down));
      const b = tNode
        ? project(nodeFlow.get(tNode.id)!, tMid)
        : project(contentFlowStart, poolEdge(tPool!, -down));
      pts = [a, b];
    }
    messages.push({
      source: m.source,
      target: m.target,
      points: pts,
      lineNumber: m.lineNumber,
    });
  }

  // ── Phase bands (clean, non-overlapping column ranges) ──────
  // Under cross-phase compaction a single column can hold nodes from two
  // phases, so member min/max flow extents overlap and the header dividers go
  // ragged. Instead, PARTITION the columns: assign each column to the earliest
  // phase that owns a node there, then make that assignment monotonic so the
  // bands stay contiguous and in declaration order. Each band spans from the
  // midpoint before its first column to the midpoint after its last — tidy,
  // gap-free, non-overlapping, ready for zebra striping + centered labels.
  const phaseOrder = new Map(parsed.phases.map((ph, i) => [ph.id, i]));
  const colMinPhase: (number | undefined)[] = Array.from(
    { length: R },
    () => undefined
  );
  for (const n of parsed.nodes) {
    if (n.phase === undefined) continue;
    const po = phaseOrder.get(n.phase);
    if (po === undefined) continue;
    const ri = riOf(n.id);
    const cur = colMinPhase[ri];
    if (cur === undefined || po < cur) colMinPhase[ri] = po;
  }
  const colPhase: number[] = Array.from({ length: R }, () => 0);
  let carry = 0;
  for (let ri = 0; ri < R; ri++) {
    const v = colMinPhase[ri];
    if (v !== undefined && v > carry) carry = v;
    colPhase[ri] = carry;
  }
  const colMid = (i: number, j: number): number =>
    (flowCenter[i]! + flowCenter[j]!) / 2;
  const phaseBands: LayoutBand[] = [];
  if (parsed.phases.length > 0 && R > 0) {
    let start = 0;
    for (let ri = 1; ri <= R; ri++) {
      if (ri === R || colPhase[ri] !== colPhase[start]) {
        const a = start;
        const b = ri - 1;
        const phase = parsed.phases[colPhase[start]!]!;
        const leftEdge = a === 0 ? 0 : colMid(a - 1, a);
        const rightEdge = b === R - 1 ? totalFlow : colMid(b, b + 1);
        phaseBands.push({
          id: phase.id,
          label: phase.label,
          ...projectBand(leftEdge, rightEdge - leftEdge, 0, totalCross),
          headerSize: PHASE_HEADER,
          lineNumber: phase.lineNumber,
        });
        start = ri;
      }
    }
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    messages,
    artifacts,
    pools,
    lanes,
    phases: phaseBands,
    width: isLR ? totalFlow : totalCross,
    height: isLR ? totalCross : totalFlow,
  };
}
