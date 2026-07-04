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
import type {
  ParsedSwimlane,
  SwimDirection,
  SwimLayoutEdge,
  SwimLayoutNode,
  SwimShape,
  SwimlaneLayoutResult,
  LayoutBand,
} from './types';

const MARGIN = 30;
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

interface Pt {
  x: number;
  y: number;
}

function nodeSize(shape: SwimShape): { w: number; h: number } {
  if (shape === 'exclusive' || shape === 'parallel')
    return { w: DIAMOND, h: DIAMOND };
  if (shape === 'terminal') return { w: TERM_D, h: TERM_D };
  return { w: NODE_W, h: NODE_H };
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
  laneOf: (id: string) => string
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
  const size = new Map(parsed.nodes.map((n) => [n.id, nodeSize(n.shape)]));
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
  const { dag } = acyclicOrient(ids, realEdges);
  const laneOf = (id: string): string => nodeById.get(id)!.lane;
  // Compact ranking: same-lane edges advance the flow column (+1); cross-lane
  // handoffs keep the column (0) and render as a same-rank vertical connector
  // (see edge routing below), stacking lane changes beneath their predecessor —
  // except two same-lane nodes joined by a path are kept on separate columns.
  const baseRank = compactRanks(
    ids,
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
  const finalRank = new Map<string, number>();
  for (const id of ids) finalRank.set(id, baseRank.get(id) ?? 0);

  // Contiguous rank indices.
  const usedRanks = Array.from(
    new Set(ids.map((id) => finalRank.get(id)!))
  ).sort((a, b) => a - b);
  const rankIndex = new Map(usedRanks.map((r, i) => [r, i]));
  const R = usedRanks.length;
  const riOf = (id: string): number => rankIndex.get(finalRank.get(id)!) ?? 0;

  // ── Flow columns ────────────────────────────────────────────
  const contentFlowStart = LANE_HEADER + MARGIN;
  const colFlowLen: number[] = Array.from({ length: R }, () => 0);
  for (const id of ids) {
    const ri = riOf(id);
    colFlowLen[ri] = Math.max(colFlowLen[ri]!, flowLenOf(id));
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

  // ── Lane cross bands ────────────────────────────────────────
  const contentCrossStart = (parsed.phases.length ? PHASE_HEADER : 0) + MARGIN;
  // Per-cell occupancy → lane thickness.
  const cellNodes = new Map<string, string[]>(); // `${laneId}\x00${ri}` → ids
  for (const n of parsed.nodes) {
    const key = `${n.lane}\x00${riOf(n.id)}`;
    (cellNodes.get(key) ?? cellNodes.set(key, []).get(key)!).push(n.id);
  }
  const cellCross = (laneId: string, ri: number): number => {
    const arr = cellNodes.get(`${laneId}\x00${ri}`) ?? [];
    if (arr.length === 0) return 0;
    return (
      arr.reduce((s, id) => s + crossLenOf(id), 0) +
      INTRA_GAP * (arr.length - 1)
    );
  };
  const laneCrossStart = new Map<string, number>();
  const laneThick = new Map<string, number>();
  const laneCenter = new Map<string, number>();
  {
    let acc = contentCrossStart;
    for (const lane of parsed.lanes) {
      let maxCell = 0;
      for (let ri = 0; ri < R; ri++)
        maxCell = Math.max(maxCell, cellCross(lane.id, ri));
      const thick = Math.max(MIN_LANE, maxCell + 2 * LANE_PAD);
      laneCrossStart.set(lane.id, acc);
      laneThick.set(lane.id, thick);
      laneCenter.set(lane.id, acc + thick / 2);
      acc += thick;
    }
  }
  const laneCrossEnd = (() => {
    let acc = contentCrossStart;
    for (const lane of parsed.lanes) acc += laneThick.get(lane.id)!;
    return acc;
  })();

  // ── Node cross positions (intra-cell stack around lane center) ──
  const nodeFlow = new Map<string, number>();
  const nodeCross = new Map<string, number>();
  for (const [key, arr] of cellNodes) {
    const sep = key.indexOf('\x00');
    const laneId = key.slice(0, sep);
    const center = laneCenter.get(laneId) ?? contentCrossStart;
    const stackH =
      arr.reduce((s, id) => s + crossLenOf(id), 0) +
      INTRA_GAP * (arr.length - 1);
    let c = center - stackH / 2;
    for (const id of arr) {
      const cl = crossLenOf(id);
      nodeCross.set(id, c + cl / 2);
      c += cl + INTRA_GAP;
      nodeFlow.set(id, flowCenter[riOf(id)]!);
    }
  }

  // ── Back-edge channels (below the lanes, nested) ────────────
  let backCount = 0;
  for (const e of realEdges)
    if ((finalRank.get(e.to) ?? 0) < (finalRank.get(e.from) ?? 0)) backCount++;
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
      x: p.x,
      y: p.y,
      width: s.w,
      height: s.h,
      lineNumber: n.lineNumber,
    };
  });

  // ── Forward-edge channel staggering ─────────────────────────
  // Edges from the same source column into the same target otherwise bend at
  // the identical midpoint, so their vertical channels coincide and render as
  // ONE overlapping line (e.g. a 3-way parallel join). Fan each onto its own
  // channel near the bend so every incoming edge stays visible.
  const CHANNEL_GAP = 16;
  const bendOffset: number[] = new Array(parsed.edges.length).fill(0);
  {
    const groups = new Map<string, number[]>();
    parsed.edges.forEach((e, i) => {
      const s = nodeById.get(e.source);
      const t = nodeById.get(e.target);
      if (!s || !t || s.id === t.id) return;
      const sR = finalRank.get(s.id) ?? 0;
      const tR = finalRank.get(t.id) ?? 0;
      if (tR <= sR) return;
      if (
        Math.abs((nodeCross.get(s.id) ?? 0) - (nodeCross.get(t.id) ?? 0)) < 0.5
      )
        return;
      const key = `${e.target}\x00${sR}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
    });
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      idxs.sort(
        (a, b) =>
          (nodeCross.get(parsed.edges[a]!.source) ?? 0) -
          (nodeCross.get(parsed.edges[b]!.source) ?? 0)
      );
      idxs.forEach((idx, k) => {
        bendOffset[idx] = (k - (idxs.length - 1) / 2) * CHANNEL_GAP;
      });
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
    for (const id of ids) {
      if (id === selfId) continue;
      const fh = flowLenOf(id) / 2 + BLOCK_CLEAR;
      if (Math.abs(nodeFlow.get(id)! - flow) >= fh) continue;
      const ch = crossLenOf(id) / 2;
      const c = nodeCross.get(id)!;
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
    if (tRank > sRank) {
      // Forward: leading edge of source → trailing edge of target.
      const a = sFlow + sFlowHalf;
      const b = tFlow - tFlowHalf;
      if (Math.abs(sCross - tCross) < 0.5) {
        pts = [project(a, sCross), project(b, tCross)];
      } else {
        const mid = (a + b) / 2 + bendOffset[ei]!;
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
    layoutEdges.push({
      source: e.source,
      target: e.target,
      ...(e.label !== undefined && { label: e.label }),
      points: pts,
      back,
      lineNumber: e.lineNumber,
    });
  });

  // ── Lane bands (full flow extent, label gutter at flow start) ──
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
    const box = projectBand(
      0,
      totalFlow,
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
    lanes,
    phases: phaseBands,
    width: isLR ? totalFlow : totalCross,
    height: isLR ? totalCross : totalFlow,
  };
}
