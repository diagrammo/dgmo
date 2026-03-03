// ============================================================
// Initiative Status Diagram — Layout (dagre + post-optimization)
//
// Strategy:
//  1. Dagre assigns ranks (columns) and initial positions
//  2. Optimize within-rank ordering to minimize crossings,
//     using edge length as tiebreaker
//  3. Barycentric coordinate assignment to reduce edge lengths
//  4. Iteratively refine ordering + positions
//  5. Recompute edge waypoints for final positions
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedInitiativeStatus, InitiativeStatus } from './types';

export interface ISLayoutNode {
  label: string;
  status: import('./types').InitiativeStatus;
  shape: import('../sequence/parser').ParticipantType;
  lineNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ISLayoutEdge {
  source: string;
  target: string;
  label?: string;
  status: import('./types').InitiativeStatus;
  lineNumber: number;
  points: { x: number; y: number }[];
}

export interface ISLayoutGroup {
  label: string;
  status: InitiativeStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  lineNumber: number;
}

export interface ISLayoutResult {
  nodes: ISLayoutNode[];
  edges: ISLayoutEdge[];
  groups: ISLayoutGroup[];
  width: number;
  height: number;
}

const STATUS_PRIORITY: Record<string, number> = { todo: 3, wip: 2, done: 1, na: 0 };

function rollUpStatus(members: ISLayoutNode[]): InitiativeStatus {
  let worst: InitiativeStatus = null;
  let worstPri = -1;
  for (const m of members) {
    const pri = m.status ? (STATUS_PRIORITY[m.status] ?? -1) : -1;
    if (pri > worstPri) {
      worstPri = pri;
      worst = m.status;
    }
  }
  return worst;
}

const PHI = 1.618;
const NODE_HEIGHT = 60;
const NODE_WIDTH = Math.round(NODE_HEIGHT * PHI);
const GROUP_PADDING = 20;
const NODESEP = 80;
const RANKSEP = 160;

// ============================================================
// Metrics: crossings + edge length
// ============================================================

function interpolateY(
  sx: number, sy: number, tx: number, ty: number, x: number,
): number {
  if (sx === tx) return sy;
  return sy + (ty - sy) * (x - sx) / (tx - sx);
}

function countCrossings(
  edges: { source: string; target: string }[],
  posX: Map<string, number>,
  posY: Map<string, number>,
): number {
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    const sx1 = posX.get(edges[i].source)!;
    const sy1 = posY.get(edges[i].source)!;
    const tx1 = posX.get(edges[i].target)!;
    const ty1 = posY.get(edges[i].target)!;
    const minX1 = Math.min(sx1, tx1);
    const maxX1 = Math.max(sx1, tx1);
    for (let j = i + 1; j < edges.length; j++) {
      const sx2 = posX.get(edges[j].source)!;
      const sy2 = posY.get(edges[j].source)!;
      const tx2 = posX.get(edges[j].target)!;
      const ty2 = posY.get(edges[j].target)!;
      const xStart = Math.max(minX1, Math.min(sx2, tx2));
      const xEnd = Math.min(maxX1, Math.max(sx2, tx2));
      if (xStart >= xEnd) continue;
      const ya0 = interpolateY(sx1, sy1, tx1, ty1, xStart);
      const ya1 = interpolateY(sx1, sy1, tx1, ty1, xEnd);
      const yb0 = interpolateY(sx2, sy2, tx2, ty2, xStart);
      const yb1 = interpolateY(sx2, sy2, tx2, ty2, xEnd);
      if ((ya0 - yb0) * (ya1 - yb1) < 0) crossings++;
    }
  }
  return crossings;
}

// Sum of squared y-distances for all edges (encourages compact layouts)
function totalEdgeLengthSq(
  edges: { source: string; target: string }[],
  posY: Map<string, number>,
): number {
  let total = 0;
  for (const e of edges) {
    const dy = (posY.get(e.source) ?? 0) - (posY.get(e.target) ?? 0);
    total += dy * dy;
  }
  return total;
}

// Combined score: crossings dominate, edge length is tiebreaker
function layoutScore(
  edges: { source: string; target: string }[],
  posX: Map<string, number>,
  posY: Map<string, number>,
): number {
  const crossings = countCrossings(edges, posX, posY);
  const length = totalEdgeLengthSq(edges, posY);
  // Crossings dominate: 1 crossing >> any edge length difference
  return crossings * 1e8 + length;
}

// ============================================================
// Within-rank ordering optimization
// ============================================================

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

interface RankInfo {
  x: number;
  labels: string[];
  ySlots: number[];
}

function optimizeRank(
  rank: RankInfo,
  edges: { source: string; target: string }[],
  posX: Map<string, number>,
  currentY: Map<string, number>,
): void {
  if (rank.labels.length <= 1) return;

  if (rank.labels.length <= 7) {
    const perms = permutations(rank.labels);
    let bestScore = Infinity;
    let bestPerm = rank.labels;

    for (const perm of perms) {
      const testY = new Map(currentY);
      for (let i = 0; i < perm.length; i++) {
        testY.set(perm[i], rank.ySlots[i]);
      }
      const s = layoutScore(edges, posX, testY);
      if (s < bestScore) {
        bestScore = s;
        bestPerm = perm;
      }
    }
    for (let i = 0; i < bestPerm.length; i++) {
      currentY.set(bestPerm[i], rank.ySlots[i]);
    }
  } else {
    // Greedy adjacent swap for larger ranks
    const order = [...rank.labels].sort(
      (a, b) => (currentY.get(a) ?? 0) - (currentY.get(b) ?? 0),
    );
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++) {
        const testY = new Map(currentY);
        for (let k = 0; k < order.length; k++) {
          testY.set(order[k], rank.ySlots[k]);
        }
        const before = layoutScore(edges, posX, testY);

        [order[i], order[i + 1]] = [order[i + 1], order[i]];
        const testY2 = new Map(currentY);
        for (let k = 0; k < order.length; k++) {
          testY2.set(order[k], rank.ySlots[k]);
        }
        const after = layoutScore(edges, posX, testY2);

        if (after < before) {
          improved = true;
        } else {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
        }
      }
    }
    for (let i = 0; i < order.length; i++) {
      currentY.set(order[i], rank.ySlots[i]);
    }
  }
}

// ============================================================
// Barycentric coordinate assignment (conservative)
//
// Moves nodes toward the average y of their neighbors.
// Only applies changes that don't increase crossings.
// ============================================================

function barycentricAssignment(
  ranks: RankInfo[],
  edges: { source: string; target: string }[],
  posX: Map<string, number>,
  posY: Map<string, number>,
): void {
  const neighbors = new Map<string, string[]>();
  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, []);
    if (!neighbors.has(e.target)) neighbors.set(e.target, []);
    neighbors.get(e.source)!.push(e.target);
    neighbors.get(e.target)!.push(e.source);
  }

  const sortedRanks = [...ranks].sort((a, b) => a.x - b.x);

  for (let iter = 0; iter < 6; iter++) {
    const order = iter % 2 === 0 ? sortedRanks : [...sortedRanks].reverse();
    let anyImproved = false;

    for (const rank of order) {
      if (rank.labels.length === 0) continue;

      const scoreBefore = layoutScore(edges, posX, posY);
      const saved = rank.labels.map((l) => [l, posY.get(l)!] as [string, number]);

      const sorted = [...rank.labels].sort(
        (a, b) => (posY.get(a) ?? 0) - (posY.get(b) ?? 0),
      );

      const newY: number[] = sorted.map((label) => {
        const nbrs = neighbors.get(label) ?? [];
        if (nbrs.length === 0) return posY.get(label) ?? 0;
        let sum = 0;
        for (const n of nbrs) sum += posY.get(n) ?? 0;
        return sum / nbrs.length;
      });

      // Enforce minimum spacing (top-down then bottom-up)
      for (let i = 1; i < newY.length; i++) {
        if (newY[i] < newY[i - 1] + NODESEP) {
          newY[i] = newY[i - 1] + NODESEP;
        }
      }
      for (let i = newY.length - 2; i >= 0; i--) {
        if (newY[i] > newY[i + 1] - NODESEP) {
          newY[i] = newY[i + 1] - NODESEP;
        }
      }

      for (let i = 0; i < sorted.length; i++) {
        posY.set(sorted[i], newY[i]);
      }

      // Revert this rank if score didn't improve
      const scoreAfter = layoutScore(edges, posX, posY);
      if (scoreAfter >= scoreBefore) {
        for (const [l, y] of saved) posY.set(l, y);
      } else {
        anyImproved = true;
      }
    }

    if (!anyImproved) break;
  }
}

// ============================================================
// Rank-shift compaction: shift entire ranks toward neighbors
//
// Moves all nodes in a rank by the same delta, preserving
// within-rank order (so no new crossings from reordering).
// ============================================================

function compactRanks(
  ranks: RankInfo[],
  edges: { source: string; target: string }[],
  posX: Map<string, number>,
  posY: Map<string, number>,
): void {
  const neighbors = new Map<string, string[]>();
  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, []);
    if (!neighbors.has(e.target)) neighbors.set(e.target, []);
    neighbors.get(e.source)!.push(e.target);
    neighbors.get(e.target)!.push(e.source);
  }

  for (let iter = 0; iter < 4; iter++) {
    let anyImproved = false;
    for (const rank of ranks) {
      if (rank.labels.length === 0) continue;

      // Compute current rank center and ideal center (avg of all neighbors' barycenters)
      let currentSum = 0;
      let idealSum = 0;
      let idealCount = 0;
      for (const label of rank.labels) {
        currentSum += posY.get(label) ?? 0;
        const nbrs = neighbors.get(label) ?? [];
        for (const n of nbrs) {
          idealSum += posY.get(n) ?? 0;
          idealCount++;
        }
      }
      if (idealCount === 0) continue;

      const currentCenter = currentSum / rank.labels.length;
      const idealCenter = idealSum / idealCount;
      const shift = idealCenter - currentCenter;
      if (Math.abs(shift) < 1) continue;

      const scoreBefore = layoutScore(edges, posX, posY);
      const saved = rank.labels.map((l) => [l, posY.get(l)!] as [string, number]);

      for (const label of rank.labels) {
        posY.set(label, (posY.get(label) ?? 0) + shift);
      }

      const scoreAfter = layoutScore(edges, posX, posY);
      if (scoreAfter >= scoreBefore) {
        for (const [l, y] of saved) posY.set(l, y);
      } else {
        anyImproved = true;
      }
    }
    if (!anyImproved) break;
  }
}

// ============================================================
// Per-node compaction: shift individual nodes toward neighbors
//
// Unlike barycentric (which replaces all rank positions at once),
// this tries one node at a time, using fractional moves.
// ============================================================

function perNodeCompaction(
  ranks: RankInfo[],
  edges: { source: string; target: string }[],
  posX: Map<string, number>,
  posY: Map<string, number>,
): void {
  const neighbors = new Map<string, string[]>();
  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, []);
    if (!neighbors.has(e.target)) neighbors.set(e.target, []);
    neighbors.get(e.source)!.push(e.target);
    neighbors.get(e.target)!.push(e.source);
  }

  // Build rank membership for bounds checking
  const labelToRank = new Map<string, RankInfo>();
  for (const rank of ranks) {
    for (const label of rank.labels) labelToRank.set(label, rank);
  }

  for (let iter = 0; iter < 3; iter++) {
    let anyImproved = false;

    for (const rank of ranks) {
      // Sort rank by current y for bounds computation
      const sorted = [...rank.labels].sort(
        (a, b) => (posY.get(a) ?? 0) - (posY.get(b) ?? 0),
      );

      for (let idx = 0; idx < sorted.length; idx++) {
        const label = sorted[idx];
        const nbrs = neighbors.get(label) ?? [];
        if (nbrs.length === 0) continue;

        let sum = 0;
        for (const n of nbrs) sum += posY.get(n) ?? 0;
        const barycenter = sum / nbrs.length;
        const current = posY.get(label) ?? 0;

        // Compute valid y-range: stay NODESEP away from rank neighbors
        const minY = idx > 0 ? (posY.get(sorted[idx - 1]) ?? -Infinity) + NODESEP : -Infinity;
        const maxY = idx < sorted.length - 1 ? (posY.get(sorted[idx + 1]) ?? Infinity) - NODESEP : Infinity;

        // Clamp barycenter to valid range
        const target = Math.max(minY, Math.min(maxY, barycenter));
        const delta = target - current;
        if (Math.abs(delta) < 2) continue;

        const scoreBefore = layoutScore(edges, posX, posY);

        // Try full move, then half, then quarter
        let accepted = false;
        for (const frac of [1.0, 0.5, 0.25]) {
          const newPos = current + delta * frac;
          const clamped = Math.max(minY, Math.min(maxY, newPos));
          posY.set(label, clamped);
          const scoreAfter = layoutScore(edges, posX, posY);
          if (scoreAfter < scoreBefore) {
            anyImproved = true;
            accepted = true;
            break;
          }
          posY.set(label, current); // revert
        }
      }
    }
    if (!anyImproved) break;
  }
}

// ============================================================
// Straighten pass: align nodes with their single-neighbor
//
// After all optimization, for each node that has exactly one
// neighbor in the next (or previous) rank, try to move it to
// that neighbor's Y.  Accept only if crossings don't increase.
// ============================================================

function straightenEdges(
  ranks: RankInfo[],
  edges: { source: string; target: string }[],
  posX: Map<string, number>,
  posY: Map<string, number>,
): void {
  // Build neighbor maps per direction
  const fwdNeighbors = new Map<string, string[]>(); // neighbors in higher-x ranks
  const bwdNeighbors = new Map<string, string[]>(); // neighbors in lower-x ranks
  for (const e of edges) {
    const sx = posX.get(e.source) ?? 0;
    const tx = posX.get(e.target) ?? 0;
    if (sx < tx) {
      if (!fwdNeighbors.has(e.source)) fwdNeighbors.set(e.source, []);
      fwdNeighbors.get(e.source)!.push(e.target);
      if (!bwdNeighbors.has(e.target)) bwdNeighbors.set(e.target, []);
      bwdNeighbors.get(e.target)!.push(e.source);
    } else {
      if (!fwdNeighbors.has(e.target)) fwdNeighbors.set(e.target, []);
      fwdNeighbors.get(e.target)!.push(e.source);
      if (!bwdNeighbors.has(e.source)) bwdNeighbors.set(e.source, []);
      bwdNeighbors.get(e.source)!.push(e.target);
    }
  }

  // Multiple passes: first straighten nodes with a single forward neighbor,
  // then single backward neighbor
  for (let pass = 0; pass < 3; pass++) {
    let anyMoved = false;
    for (const rank of ranks) {
      const sorted = [...rank.labels].sort(
        (a, b) => (posY.get(a) ?? 0) - (posY.get(b) ?? 0),
      );

      for (let idx = 0; idx < sorted.length; idx++) {
        const label = sorted[idx];
        // Try to align with a single forward OR backward neighbor
        const fwd = fwdNeighbors.get(label) ?? [];
        const bwd = bwdNeighbors.get(label) ?? [];
        let targetY: number | undefined;
        if (fwd.length === 1 && bwd.length <= 1) {
          targetY = posY.get(fwd[0]);
        } else if (bwd.length === 1 && fwd.length <= 1) {
          targetY = posY.get(bwd[0]);
        }
        if (targetY === undefined) continue;

        const current = posY.get(label) ?? 0;
        if (Math.abs(targetY - current) < 2) continue;

        // Clamp to rank neighbor bounds
        const minY = idx > 0 ? (posY.get(sorted[idx - 1]) ?? -Infinity) + NODESEP : -Infinity;
        const maxY = idx < sorted.length - 1 ? (posY.get(sorted[idx + 1]) ?? Infinity) - NODESEP : Infinity;
        const clamped = Math.max(minY, Math.min(maxY, targetY));
        if (Math.abs(clamped - current) < 2) continue;

        const crossingsBefore = countCrossings(edges, posX, posY);
        posY.set(label, clamped);
        const crossingsAfter = countCrossings(edges, posX, posY);

        // Accept if crossings don't increase (straighter edges are worth
        // a small increase in total edge length)
        if (crossingsAfter <= crossingsBefore) {
          anyMoved = true;
        } else {
          posY.set(label, current); // revert
        }
      }
    }
    if (!anyMoved) break;
  }
}

// ============================================================
// Edge waypoint generation
// ============================================================

function generateWaypoints(
  srcX: number, srcY: number, srcW: number,
  tgtX: number, tgtY: number, tgtW: number,
  allNodes?: ISLayoutNode[],
): { x: number; y: number }[] {
  const exitX = srcX + srcW / 2;
  const enterX = tgtX - tgtW / 2;
  const gap = enterX - exitX;
  const clearance = Math.min(gap / 3, RANKSEP / 3);

  // For short edges (adjacent or close ranks), use simple 4-point path
  if (!allNodes || gap < RANKSEP * 1.8) {
    return [
      { x: exitX, y: srcY },
      { x: exitX + clearance, y: srcY },
      { x: enterX - clearance, y: tgtY },
      { x: enterX, y: tgtY },
    ];
  }

  // For long edges spanning multiple ranks, route around ALL nodes
  // in the path (including target's rank) to avoid collisions.
  const pad = NODE_HEIGHT / 2;
  const obstacleNodes = allNodes.filter((n) => {
    const nRight = n.x + n.width / 2 + pad;
    const nLeft = n.x - n.width / 2 - pad;
    return nRight > exitX && nLeft < enterX;
  });

  if (obstacleNodes.length === 0) {
    return [
      { x: exitX, y: srcY },
      { x: exitX + clearance, y: srcY },
      { x: enterX - clearance, y: tgtY },
      { x: enterX, y: tgtY },
    ];
  }

  // Find the max bottom of all obstacle nodes (and source/target)
  let maxBottom = Math.max(srcY, tgtY);
  for (const n of obstacleNodes) {
    const bottom = n.y + n.height / 2;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  const detourY = maxBottom + NODESEP * 0.7;

  const points: { x: number; y: number }[] = [];
  points.push({ x: exitX, y: srcY });
  points.push({ x: exitX + clearance, y: srcY });
  // Descend to detour Y
  points.push({ x: exitX + clearance * 2, y: detourY });
  // Horizontal segment at detour Y
  points.push({ x: enterX - clearance * 2, y: detourY });
  // Ascend back to target
  points.push({ x: enterX - clearance, y: tgtY });
  points.push({ x: enterX, y: tgtY });

  return points;
}

// ============================================================
// Main layout function
// ============================================================

export function layoutInitiativeStatus(parsed: ParsedInitiativeStatus): ISLayoutResult {
  if (parsed.nodes.length === 0) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  // Phase 1: Dagre for rank assignment and initial positions
  const hasGroups = parsed.groups.length > 0;
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: hasGroups });
  g.setGraph({ rankdir: 'LR', nodesep: NODESEP, ranksep: RANKSEP, edgesep: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const group of parsed.groups) {
    g.setNode(`__group_${group.label}`, { label: group.label, clusterLabelPos: 'top' });
  }
  for (const node of parsed.nodes) {
    g.setNode(node.label, { label: node.label, width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const group of parsed.groups) {
    const groupId = `__group_${group.label}`;
    for (const nodeLabel of group.nodeLabels) {
      if (g.hasNode(nodeLabel)) g.setParent(nodeLabel, groupId);
    }
  }
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    g.setEdge(edge.source, edge.target, { label: edge.label ?? '' }, `e${i}`);
  }

  dagre.layout(g);

  // Collect dagre positions
  const dagrePos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const node of parsed.nodes) {
    const pos = g.node(node.label);
    dagrePos.set(node.label, { x: pos.x, y: pos.y, w: pos.width, h: pos.height });
  }

  // Phase 2: Group by rank
  const rankMap = new Map<number, string[]>();
  for (const [label, pos] of dagrePos) {
    let found = false;
    for (const [key, labels] of rankMap) {
      if (Math.abs(key - pos.x) < 20) {
        labels.push(label);
        found = true;
        break;
      }
    }
    if (!found) {
      rankMap.set(pos.x, [label]);
    }
  }

  const posX = new Map<string, number>();
  const dagreY = new Map<string, number>();
  for (const [label, pos] of dagrePos) {
    posX.set(label, pos.x);
    dagreY.set(label, pos.y);
  }

  const simpleEdges = parsed.edges.map((e) => ({ source: e.source, target: e.target }));
  const dagreScore = layoutScore(simpleEdges, posX, dagreY);

  // Phase 3: Iterative optimization (ordering + barycentric)
  const optimizedY = new Map(dagreY);
  let ranks = buildRanks(rankMap, dagrePos);

  for (let round = 0; round < 3; round++) {
    const scoreBefore = layoutScore(simpleEdges, posX, optimizedY);

    // Ordering pass
    const sortedRanks = [...ranks].sort((a, b) => a.x - b.x);
    for (let sweep = 0; sweep < 4; sweep++) {
      const order = sweep % 2 === 0 ? sortedRanks : [...sortedRanks].reverse();
      for (const rank of order) {
        optimizeRank(rank, simpleEdges, posX, optimizedY);
      }
    }

    // Barycentric pass
    barycentricAssignment(ranks, simpleEdges, posX, optimizedY);

    // Rank-shift compaction pass
    compactRanks(ranks, simpleEdges, posX, optimizedY);

    // Update y-slots for next round (positions may have shifted)
    ranks = rebuildRankSlots(ranks, optimizedY);

    const scoreAfter = layoutScore(simpleEdges, posX, optimizedY);
    if (scoreAfter >= scoreBefore) break;
  }

  // Final compaction passes (after all ordering is settled)
  compactRanks(ranks, simpleEdges, posX, optimizedY);
  ranks = rebuildRankSlots(ranks, optimizedY);
  perNodeCompaction(ranks, simpleEdges, posX, optimizedY);

  // Straighten pass: align nodes with single-neighbor connections
  straightenEdges(ranks, simpleEdges, posX, optimizedY);
  ranks = rebuildRankSlots(ranks, optimizedY);

  // Normalize: shift all y so the topmost node sits at its dagre position
  // (prevents compaction from creating excessive top whitespace)
  let minOptY = Infinity;
  let minDagreY = Infinity;
  for (const [label] of optimizedY) {
    const oy = optimizedY.get(label)!;
    const dy = dagreY.get(label)!;
    if (oy < minOptY) minOptY = oy;
    if (dy < minDagreY) minDagreY = dy;
  }
  if (isFinite(minOptY) && isFinite(minDagreY)) {
    const shift = minDagreY - minOptY;
    if (Math.abs(shift) > 1) {
      for (const [label] of optimizedY) {
        optimizedY.set(label, optimizedY.get(label)! + shift);
      }
    }
  }

  const optimizedScore = layoutScore(simpleEdges, posX, optimizedY);
  const useOptimized = optimizedScore <= dagreScore;
  const finalY = useOptimized ? optimizedY : dagreY;

  // Phase 4: Build layout nodes
  const layoutNodes: ISLayoutNode[] = parsed.nodes.map((node) => {
    const dp = dagrePos.get(node.label)!;
    return {
      label: node.label,
      status: node.status,
      shape: node.shape,
      lineNumber: node.lineNumber,
      x: dp.x,
      y: finalY.get(node.label) ?? dp.y,
      width: dp.w,
      height: dp.h,
    };
  });

  // Phase 5: Edge waypoints
  const nodeMap = new Map(layoutNodes.map((n) => [n.label, n]));
  let layoutEdges: ISLayoutEdge[];

  if (useOptimized) {
    layoutEdges = parsed.edges.map((edge) => {
      const src = nodeMap.get(edge.source)!;
      const tgt = nodeMap.get(edge.target)!;
      return {
        source: edge.source, target: edge.target,
        label: edge.label, status: edge.status, lineNumber: edge.lineNumber,
        points: generateWaypoints(src.x, src.y, src.width, tgt.x, tgt.y, tgt.width, layoutNodes),
      };
    });
  } else {
    layoutEdges = parsed.edges.map((edge, i) => {
      const edgeData = g.edge(edge.source, edge.target, `e${i}`);
      return {
        source: edge.source, target: edge.target,
        label: edge.label, status: edge.status, lineNumber: edge.lineNumber,
        points: edgeData?.points ?? [],
      };
    });
  }

  // Compute group bounding boxes
  const layoutGroups: ISLayoutGroup[] = [];
  if (parsed.groups.length > 0) {
    const nMap = new Map(layoutNodes.map((n) => [n.label, n]));
    for (const group of parsed.groups) {
      const members = group.nodeLabels
        .map((label) => nMap.get(label))
        .filter((n): n is ISLayoutNode => n !== undefined);
      if (members.length === 0) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const member of members) {
        const left = member.x - member.width / 2;
        const right = member.x + member.width / 2;
        const top = member.y - member.height / 2;
        const bottom = member.y + member.height / 2;
        if (left < minX) minX = left;
        if (right > maxX) maxX = right;
        if (top < minY) minY = top;
        if (bottom > maxY) maxY = bottom;
      }

      layoutGroups.push({
        label: group.label, status: rollUpStatus(members),
        x: minX - GROUP_PADDING, y: minY - GROUP_PADDING,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2,
        lineNumber: group.lineNumber,
      });
    }
  }

  // Compute total dimensions
  let totalWidth = 0;
  let totalHeight = 0;
  for (const node of layoutNodes) {
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  for (const group of layoutGroups) {
    if (group.x + group.width > totalWidth) totalWidth = group.x + group.width;
    if (group.y + group.height > totalHeight) totalHeight = group.y + group.height;
  }
  for (const edge of layoutEdges) {
    for (const pt of edge.points) {
      if (pt.x > totalWidth) totalWidth = pt.x;
      if (pt.y > totalHeight) totalHeight = pt.y;
    }
  }
  totalWidth += 40;
  totalHeight += 40;

  return { nodes: layoutNodes, edges: layoutEdges, groups: layoutGroups, width: totalWidth, height: totalHeight };
}

// ============================================================
// Helpers
// ============================================================

function buildRanks(
  rankMap: Map<number, string[]>,
  dagrePos: Map<string, { x: number; y: number; w: number; h: number }>,
): RankInfo[] {
  const ranks: RankInfo[] = [];
  for (const [x, labels] of rankMap) {
    const sorted = [...labels].sort(
      (a, b) => (dagrePos.get(a)?.y ?? 0) - (dagrePos.get(b)?.y ?? 0),
    );
    ranks.push({ x, labels: sorted, ySlots: sorted.map((l) => dagrePos.get(l)!.y) });
  }
  return ranks;
}

// Rebuild y-slots from current positions (preserving order)
function rebuildRankSlots(ranks: RankInfo[], posY: Map<string, number>): RankInfo[] {
  return ranks.map((rank) => {
    const sorted = [...rank.labels].sort(
      (a, b) => (posY.get(a) ?? 0) - (posY.get(b) ?? 0),
    );
    return {
      x: rank.x,
      labels: sorted,
      ySlots: sorted.map((l) => posY.get(l)!),
    };
  });
}
