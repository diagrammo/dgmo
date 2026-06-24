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

import { acyclicOrient, longestPath } from '../boxes-and-lines/layout-grouped';
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
  const baseRank =
    longestPath(
      ids,
      dag.map((d) => ({ from: d.from, to: d.to }))
    ) ?? new Map(ids.map((id) => [id, 0]));

  // ── Phase floor reconciliation (monotonic across phases) ────
  const finalRank = new Map<string, number>();
  if (parsed.phases.length === 0) {
    for (const id of ids) finalRank.set(id, baseRank.get(id) ?? 0);
  } else {
    let runningFloor = 0;
    for (const phase of parsed.phases) {
      const members = parsed.nodes.filter((n) => n.phase === phase.id);
      let maxFr = runningFloor - 1;
      for (const n of members) {
        const fr = Math.max(baseRank.get(n.id) ?? 0, runningFloor);
        finalRank.set(n.id, fr);
        if (fr > maxFr) maxFr = fr;
      }
      runningFloor = maxFr + 1;
    }
    // Nodes with no phase keep their base rank.
    for (const id of ids)
      if (!finalRank.has(id)) finalRank.set(id, baseRank.get(id) ?? 0);
  }

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
  {
    let acc = contentFlowStart;
    for (let ri = 0; ri < R; ri++) {
      const len = Math.max(colFlowLen[ri]!, NODE_W);
      flowCenter[ri] = acc + len / 2;
      acc += len + COL_GAP;
    }
  }
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
  const backReserve = needsBack
    ? BACK_CHANNEL + BACK_STEP * backCount + MARGIN
    : 0;
  const totalCross = laneCrossEnd + MARGIN + backReserve;

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

  // ── Edge routing ────────────────────────────────────────────
  let backIdx = 0;
  const layoutEdges: SwimLayoutEdge[] = [];
  for (const e of parsed.edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t || s.id === t.id) continue;
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
        const mid = (a + b) / 2;
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
      pts = [
        project(sFlow, sBottom),
        project(sFlow, channelC),
        project(tFlow, channelC),
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
  }

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

  // ── Phase bands (full cross extent, label gutter at cross start) ──
  const phaseBands: LayoutBand[] = parsed.phases.map((phase) => {
    const members = parsed.nodes.filter((n) => n.phase === phase.id);
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of members) {
      lo = Math.min(lo, nodeFlow.get(n.id)! - flowLenOf(n.id) / 2);
      hi = Math.max(hi, nodeFlow.get(n.id)! + flowLenOf(n.id) / 2);
    }
    if (!Number.isFinite(lo)) {
      lo = contentFlowStart;
      hi = contentFlowStart;
    }
    const flowStart = lo - COL_GAP / 2;
    const flowExtent = hi - lo + COL_GAP;
    const box = projectBand(flowStart, flowExtent, 0, totalCross);
    return {
      id: phase.id,
      label: phase.label,
      ...box,
      headerSize: PHASE_HEADER,
      lineNumber: phase.lineNumber,
    };
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    lanes,
    phases: phaseBands,
    width: isLR ? totalFlow : totalCross,
    height: isLR ? totalCross : totalFlow,
  };
}
