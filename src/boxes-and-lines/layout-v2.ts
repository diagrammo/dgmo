// ============================================================
// Boxes and Lines Diagram — Layout Engine V2
// ============================================================
//
// Custom rank + constraint solver layout.
// Pipeline: cycle breaking → spine detection → rank assignment →
//   within-rank ordering → node positioning → port assignment
//
// No external layout dependencies (no dagre, no d3-force).

import type {
  ParsedBoxesAndLines,
  BLGroup,
  BLLayoutResultV2,
  BLLayoutNodeV2,
  BLLayoutEdgeV2,
  BLLayoutGroupV2,
  PortSide,
} from './types';

// ── Constants ──────────────────────────────────────────────
const MARGIN = 40;
const NODE_HEIGHT = 60;
const NODE_WIDTH = Math.round(NODE_HEIGHT * 1.618); // golden ratio ≈ 97
const RANK_SPACING = 180;
const NODE_SPACING = 90;
const RANK_SPACING_DENSE = Math.round(RANK_SPACING * 0.7);
const NODE_SPACING_DENSE = Math.round(NODE_SPACING * 0.7);
const CONTAINER_PAD_X = 30;
const CONTAINER_PAD_TOP = 40;
const CONTAINER_PAD_BOTTOM = 24;
const GRID_SNAP_TOLERANCE = 10;
const GRID_SNAP_TOLERANCE_DENSE = 20;
const MAX_POSITIONING_PASSES = 20;
const BARYCENTER_PASSES = 6;
const RADIAL_THRESHOLD = 7;
const MAX_PARALLEL_EDGES = 5;
const PARALLEL_SPACING = 24;
const DENSE_NODE_THRESHOLD = 20;

// ── Internal types ─────────────────────────────────────────

interface InternalNode {
  label: string;
  rank: number;
  rankOrder: number;
  x: number;
  y: number;
  width: number;
  height: number;
  spine: boolean;
  group?: string;
}

interface InternalEdge {
  source: string;
  target: string;
  label?: string;
  bidirectional: boolean;
  lineNumber: number;
  reversed: boolean;
  selfRef: boolean;
  index: number;
  metadata: Record<string, string>;
}

// ── 1. Cycle Breaking ─────────────────────────────────────

interface CycleBreakResult {
  edges: InternalEdge[];
  reversedEdges: { source: string; target: string }[];
}

function breakCycles(
  nodeLabels: string[],
  edges: InternalEdge[]
): CycleBreakResult {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const label of nodeLabels) color.set(label, WHITE);

  // Build adjacency using edge indices to avoid mutation-during-iteration
  const adj = new Map<string, number[]>();
  for (const label of nodeLabels) adj.set(label, []);
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].selfRef) continue;
    adj.get(edges[i].source)?.push(i);
  }

  // Collect indices of back-edges to reverse AFTER DFS completes
  const backEdgeIndices: number[] = [];

  function dfs(u: string): void {
    color.set(u, GRAY);
    for (const ei of adj.get(u) ?? []) {
      const e = edges[ei];
      const v = e.target;
      if (color.get(v) === GRAY) {
        backEdgeIndices.push(ei);
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  for (const label of nodeLabels) {
    if (color.get(label) === WHITE) dfs(label);
  }

  // Reverse back-edges after DFS is complete
  const reversedEdges: { source: string; target: string }[] = [];
  for (const ei of backEdgeIndices) {
    const e = edges[ei];
    reversedEdges.push({ source: e.source, target: e.target });
    e.reversed = true;
    const tmp = e.source;
    e.source = e.target;
    e.target = tmp;
  }

  return { edges, reversedEdges };
}

// ── 2. Spine Detection ────────────────────────────────────

function detectSpine(nodeLabels: string[], edges: InternalEdge[]): Set<string> {
  // Build adjacency for forward edges only
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const label of nodeLabels) {
    adj.set(label, []);
    inDeg.set(label, 0);
  }
  for (const e of edges) {
    if (e.selfRef) continue;
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  // Find all source nodes (in-degree 0)
  const sources = nodeLabels.filter((l) => (inDeg.get(l) ?? 0) === 0);
  if (sources.length === 0) sources.push(nodeLabels[0]); // fallback

  // BFS/DFS from all sources, track longest path to each node
  const dist = new Map<string, number>();
  const pred = new Map<string, string | null>();
  for (const label of nodeLabels) {
    dist.set(label, -1);
    pred.set(label, null);
  }

  // Topological order via Kahn's
  const topoOrder: string[] = [];
  const inDegCopy = new Map(inDeg);
  const queue: string[] = [];
  for (const s of sources) {
    if ((inDegCopy.get(s) ?? 0) === 0) {
      queue.push(s);
      dist.set(s, 0);
    }
  }
  // Also seed any remaining in-degree-0 nodes
  for (const label of nodeLabels) {
    if ((inDegCopy.get(label) ?? 0) === 0 && !queue.includes(label)) {
      queue.push(label);
      dist.set(label, 0);
    }
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    topoOrder.push(u);
    for (const v of adj.get(u) ?? []) {
      const newDist = (dist.get(u) ?? 0) + 1;
      if (newDist > (dist.get(v) ?? -1)) {
        dist.set(v, newDist);
        pred.set(v, u);
      }
      const d = (inDegCopy.get(v) ?? 1) - 1;
      inDegCopy.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  // Handle nodes not reached by topo sort (isolated)
  for (const label of nodeLabels) {
    if (dist.get(label) === -1) {
      dist.set(label, 0);
    }
  }

  // Find the endpoint with maximum distance
  let endNode = nodeLabels[0];
  let maxDist = 0;
  for (const label of nodeLabels) {
    const d = dist.get(label) ?? 0;
    if (d > maxDist) {
      maxDist = d;
      endNode = label;
    }
  }

  // Trace back the longest path
  const spineSet = new Set<string>();
  let cur: string | null = endNode;
  while (cur !== null) {
    spineSet.add(cur);
    cur = pred.get(cur) ?? null;
  }

  return spineSet;
}

// ── 3. Rank Assignment ────────────────────────────────────

function assignRanks(
  nodeLabels: string[],
  edges: InternalEdge[]
): Map<string, number> {
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const label of nodeLabels) {
    adj.set(label, []);
    inDeg.set(label, 0);
  }
  for (const e of edges) {
    if (e.selfRef) continue;
    adj.get(e.source)?.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  // Longest path rank assignment
  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const label of nodeLabels) {
    if ((inDeg.get(label) ?? 0) === 0) {
      queue.push(label);
      rank.set(label, 0);
    }
  }
  // Seed any unreached nodes
  if (queue.length === 0 && nodeLabels.length > 0) {
    queue.push(nodeLabels[0]);
    rank.set(nodeLabels[0], 0);
  }

  const inDegCopy = new Map(inDeg);
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of adj.get(u) ?? []) {
      const newRank = (rank.get(u) ?? 0) + 1;
      if (newRank > (rank.get(v) ?? -1)) {
        rank.set(v, newRank);
      }
      const d = (inDegCopy.get(v) ?? 1) - 1;
      inDegCopy.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  // Ensure all nodes have a rank
  for (const label of nodeLabels) {
    if (!rank.has(label)) rank.set(label, 0);
  }

  return rank;
}

// ── 4. Within-Rank Ordering ───────────────────────────────

function countCrossings(
  ranksMap: Map<number, string[]>,
  edges: InternalEdge[]
): number {
  let crossings = 0;
  const rankNums = [...ranksMap.keys()].sort((a, b) => a - b);

  for (let ri = 0; ri < rankNums.length - 1; ri++) {
    const r0 = rankNums[ri];
    const r1 = rankNums[ri + 1];
    const order0 = ranksMap.get(r0) ?? [];
    const order1 = ranksMap.get(r1) ?? [];
    const pos0 = new Map<string, number>();
    const pos1 = new Map<string, number>();
    order0.forEach((l, i) => pos0.set(l, i));
    order1.forEach((l, i) => pos1.set(l, i));

    // Collect edges between consecutive ranks
    const pairs: [number, number][] = [];
    for (const e of edges) {
      if (e.selfRef) continue;
      const s = pos0.get(e.source);
      const t = pos1.get(e.target);
      if (s !== undefined && t !== undefined) pairs.push([s, t]);
      // Also check reverse direction
      const s2 = pos0.get(e.target);
      const t2 = pos1.get(e.source);
      if (s2 !== undefined && t2 !== undefined) pairs.push([s2, t2]);
    }

    // Count inversions
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) {
          crossings++;
        }
      }
    }
  }

  return crossings;
}

function orderWithinRanks(
  nodeLabels: string[],
  ranks: Map<string, number>,
  edges: InternalEdge[],
  sourceOrderMap: Map<string, number>
): Map<number, string[]> {
  // Group nodes by rank
  const ranksMap = new Map<number, string[]>();
  for (const label of nodeLabels) {
    const r = ranks.get(label) ?? 0;
    if (!ranksMap.has(r)) ranksMap.set(r, []);
    ranksMap.get(r)!.push(label);
  }

  // Initial order: source order within each rank
  for (const [r, nodes] of ranksMap) {
    nodes.sort(
      (a, b) => (sourceOrderMap.get(a) ?? 0) - (sourceOrderMap.get(b) ?? 0)
    );
    ranksMap.set(r, nodes);
  }

  // Build adjacency (forward + backward for barycenter)
  const fwdNeighbors = new Map<string, string[]>();
  const bwdNeighbors = new Map<string, string[]>();
  for (const label of nodeLabels) {
    fwdNeighbors.set(label, []);
    bwdNeighbors.set(label, []);
  }
  for (const e of edges) {
    if (e.selfRef) continue;
    fwdNeighbors.get(e.source)?.push(e.target);
    bwdNeighbors.get(e.target)?.push(e.source);
  }

  const rankNums = [...ranksMap.keys()].sort((a, b) => a - b);
  let bestCrossings = countCrossings(ranksMap, edges);
  let bestOrder = new Map<number, string[]>();
  for (const [r, nodes] of ranksMap) bestOrder.set(r, [...nodes]);

  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    const leftToRight = pass % 2 === 0;
    const order = leftToRight ? rankNums : [...rankNums].reverse();

    for (const r of order) {
      const nodes = ranksMap.get(r);
      if (!nodes || nodes.length <= 1) continue;

      // Find the adjacent rank to use as reference
      const refRank = leftToRight ? r - 1 : r + 1;
      const refNodes = ranksMap.get(refRank);
      if (!refNodes) continue;

      const refPos = new Map<string, number>();
      refNodes.forEach((l, i) => refPos.set(l, i));

      // Compute barycenter for each node
      const barycenters = new Map<string, number>();
      for (const label of nodes) {
        const neighbors = leftToRight
          ? (bwdNeighbors.get(label) ?? [])
          : (fwdNeighbors.get(label) ?? []);
        const positions = neighbors
          .map((n) => refPos.get(n))
          .filter((p): p is number => p !== undefined);
        if (positions.length > 0) {
          barycenters.set(
            label,
            positions.reduce((a, b) => a + b, 0) / positions.length
          );
        } else {
          // Keep source order position as fallback
          barycenters.set(label, nodes.indexOf(label));
        }
      }

      // Sort by barycenter, using source order as tiebreaker
      nodes.sort((a, b) => {
        const diff = (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0);
        if (Math.abs(diff) > 0.001) return diff;
        return (sourceOrderMap.get(a) ?? 0) - (sourceOrderMap.get(b) ?? 0);
      });
    }

    const crossings = countCrossings(ranksMap, edges);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      bestOrder = new Map<number, string[]>();
      for (const [r, nodes] of ranksMap) bestOrder.set(r, [...nodes]);
    }
  }

  return bestOrder;
}

// ── 5. Node Positioning ───────────────────────────────────

function positionNodes(
  ranksMap: Map<number, string[]>,
  edges: InternalEdge[],
  direction: 'LR' | 'TB',
  dense: boolean,
  spineSet: Set<string>
): Map<string, InternalNode> {
  const rankSpacing = dense ? RANK_SPACING_DENSE : RANK_SPACING;
  const nodeSpacing = dense ? NODE_SPACING_DENSE : NODE_SPACING;
  const gridSnap = dense ? GRID_SNAP_TOLERANCE_DENSE : GRID_SNAP_TOLERANCE;

  const nodes = new Map<string, InternalNode>();
  const rankNums = [...ranksMap.keys()].sort((a, b) => a - b);

  // Initial placement: evenly distributed within each rank
  for (const r of rankNums) {
    const labels = ranksMap.get(r) ?? [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      let x: number, y: number;

      if (direction === 'LR') {
        x = MARGIN + r * rankSpacing;
        y = MARGIN + i * (NODE_HEIGHT + nodeSpacing);
      } else {
        x = MARGIN + i * (NODE_WIDTH + nodeSpacing);
        y = MARGIN + r * rankSpacing;
      }

      nodes.set(label, {
        label,
        rank: r,
        rankOrder: i,
        x,
        y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        spine: spineSet.has(label),
      });
    }
  }

  // Find the maximum number of nodes in any rank to compute centerline
  let maxNodesInRank = 0;
  for (const labels of ranksMap.values()) {
    maxNodesInRank = Math.max(maxNodesInRank, labels.length);
  }

  // Center each rank's nodes so spine is on the visual midline
  const totalCrossExtent =
    direction === 'LR'
      ? (maxNodesInRank - 1) * (NODE_HEIGHT + nodeSpacing)
      : (maxNodesInRank - 1) * (NODE_WIDTH + nodeSpacing);
  const centerline = MARGIN + totalCrossExtent / 2;

  for (const r of rankNums) {
    const labels = ranksMap.get(r) ?? [];
    const numNodes = labels.length;
    const extent =
      direction === 'LR'
        ? (numNodes - 1) * (NODE_HEIGHT + nodeSpacing)
        : (numNodes - 1) * (NODE_WIDTH + nodeSpacing);
    const offset = centerline - extent / 2;

    for (let i = 0; i < labels.length; i++) {
      const node = nodes.get(labels[i])!;
      if (direction === 'LR') {
        node.y = offset + i * (NODE_HEIGHT + nodeSpacing);
      } else {
        node.x = offset + i * (NODE_WIDTH + nodeSpacing);
      }
    }
  }

  // Iterative constraint solver: separate overlaps + snap to grid
  for (let pass = 0; pass < MAX_POSITIONING_PASSES; pass++) {
    let moved = false;

    // Separate overlaps within each rank (x,y are top-left coords)
    for (const r of rankNums) {
      const labels = ranksMap.get(r) ?? [];
      if (labels.length < 2) continue;

      // Sort by cross-axis position (top-left)
      const sorted = labels
        .map((l) => nodes.get(l)!)
        .sort((a, b) => (direction === 'LR' ? a.y - b.y : a.x - b.x));

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        // x,y = top-left: prevEnd = top-left + dimension
        const prevEnd =
          direction === 'LR' ? prev.y + prev.height : prev.x + prev.width;
        const currStart = direction === 'LR' ? curr.y : curr.x;

        if (currStart - prevEnd < nodeSpacing) {
          const shift = nodeSpacing - (currStart - prevEnd);
          const halfShift = shift / 2;
          // F7 fix: push both nodes apart symmetrically
          if (direction === 'LR') {
            prev.y -= halfShift;
            curr.y += halfShift;
          } else {
            prev.x -= halfShift;
            curr.x += halfShift;
          }
          moved = true;
        }
      }
    }

    // Soft grid snap
    for (const node of nodes.values()) {
      const axis = direction === 'LR' ? node.y : node.x;
      const gridSize =
        direction === 'LR'
          ? NODE_HEIGHT + nodeSpacing
          : NODE_WIDTH + nodeSpacing;
      const nearest = Math.round(axis / gridSize) * gridSize;
      if (Math.abs(axis - nearest) < gridSnap) {
        if (direction === 'LR') {
          node.y = nearest;
        } else {
          node.x = nearest;
        }
      }
    }

    if (!moved) break;
  }

  // Parent-alignment pass: when a node has exactly one incoming edge,
  // snap it to the same cross-axis position as its parent if no collision
  const incomingEdges = new Map<string, string[]>();
  for (const e of edges) {
    if (e.selfRef) continue;
    if (!incomingEdges.has(e.target)) incomingEdges.set(e.target, []);
    incomingEdges.get(e.target)!.push(e.source);
  }

  for (const [label, sources] of incomingEdges) {
    if (sources.length !== 1) continue;
    const node = nodes.get(label);
    const parent = nodes.get(sources[0]);
    if (!node || !parent) continue;

    // Try aligning cross-axis with parent
    const targetVal = direction === 'LR' ? parent.y : parent.x;
    const currentVal = direction === 'LR' ? node.y : node.x;
    if (Math.abs(targetVal - currentVal) < 1) continue; // already aligned

    // Check for collisions with same-rank siblings
    const siblings = (ranksMap.get(node.rank) ?? [])
      .filter((l) => l !== label)
      .map((l) => nodes.get(l)!)
      .filter(Boolean);

    let wouldCollide = false;
    for (const sib of siblings) {
      const sibVal = direction === 'LR' ? sib.y : sib.x;
      const dim = direction === 'LR' ? node.height : node.width;
      const sibDim = direction === 'LR' ? sib.height : sib.width;
      if (Math.abs(targetVal - sibVal) < (dim + sibDim) / 2 + nodeSpacing) {
        wouldCollide = true;
        break;
      }
    }

    if (!wouldCollide) {
      if (direction === 'LR') {
        node.y = targetVal;
      } else {
        node.x = targetVal;
      }
    }
  }

  return nodes;
}

// ── 6. Port Assignment ────────────────────────────────────

interface PortInfo {
  x: number;
  y: number;
  side: PortSide;
}

function getFlowPorts(direction: 'LR' | 'TB'): {
  outSide: PortSide;
  inSide: PortSide;
} {
  if (direction === 'LR') {
    return { outSide: 'right', inSide: 'left' };
  }
  return { outSide: 'bottom', inSide: 'top' };
}

function getPortPosition(
  node: InternalNode,
  side: PortSide
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

function determineSide(
  sourceNode: InternalNode,
  targetNode: InternalNode,
  direction: 'LR' | 'TB',
  isReversed: boolean
): { sourceSide: PortSide; targetSide: PortSide } {
  const { outSide, inSide } = getFlowPorts(direction);

  if (isReversed) {
    return { sourceSide: inSide, targetSide: outSide };
  }

  // Check if target is significantly off the flow axis (>45°)
  const srcCx = sourceNode.x + sourceNode.width / 2;
  const srcCy = sourceNode.y + sourceNode.height / 2;
  const tgtCx = targetNode.x + targetNode.width / 2;
  const tgtCy = targetNode.y + targetNode.height / 2;
  const dx = Math.abs(tgtCx - srcCx);
  const dy = Math.abs(tgtCy - srcCy);

  if (direction === 'LR') {
    // Off-axis if dy > dx (>45° from horizontal)
    if (dy > dx && dx < NODE_WIDTH) {
      const sourceSide: PortSide = tgtCy > srcCy ? 'bottom' : 'top';
      const targetSide: PortSide = tgtCy > srcCy ? 'top' : 'bottom';
      return { sourceSide, targetSide };
    }
  } else {
    // Off-axis if dx > dy (>45° from vertical)
    if (dx > dy && dy < NODE_HEIGHT) {
      const sourceSide: PortSide = tgtCx > srcCx ? 'right' : 'left';
      const targetSide: PortSide = tgtCx > srcCx ? 'left' : 'right';
      return { sourceSide, targetSide };
    }
  }

  return { sourceSide: outSide, targetSide: inSide };
}

function assignPorts(
  edges: InternalEdge[],
  nodes: Map<string, InternalNode>,
  direction: 'LR' | 'TB'
): Map<number, { source: PortInfo; target: PortInfo }> {
  const ports = new Map<number, { source: PortInfo; target: PortInfo }>();

  // Count edges per node per side for fan-out detection
  const edgeCountPerNodeSide = new Map<string, Map<PortSide, number>>();

  // First pass: determine sides
  const sides = new Map<
    number,
    { sourceSide: PortSide; targetSide: PortSide }
  >();
  for (const edge of edges) {
    if (edge.selfRef) continue;
    const srcNode = nodes.get(edge.source);
    const tgtNode = nodes.get(edge.target);
    if (!srcNode || !tgtNode) continue;
    const s = determineSide(srcNode, tgtNode, direction, edge.reversed);
    sides.set(edge.index, s);

    // Track counts
    if (!edgeCountPerNodeSide.has(edge.source))
      edgeCountPerNodeSide.set(edge.source, new Map());
    const srcCounts = edgeCountPerNodeSide.get(edge.source)!;
    srcCounts.set(s.sourceSide, (srcCounts.get(s.sourceSide) ?? 0) + 1);
  }

  // Check for radial mode (7+ edges from one node on one side)
  const radialNodes = new Set<string>();
  for (const [nodeLabel, sideCounts] of edgeCountPerNodeSide) {
    for (const count of sideCounts.values()) {
      if (count >= RADIAL_THRESHOLD) {
        radialNodes.add(nodeLabel);
      }
    }
  }

  // Second pass: assign actual port positions
  // Track port usage for fan-out
  const sideUsage = new Map<string, Map<PortSide, number>>();

  for (const edge of edges) {
    if (edge.selfRef) {
      // Self-referencing: arc from right to bottom (LR) or bottom to right (TB)
      const node = nodes.get(edge.source);
      if (!node) continue;
      const srcPort = getPortPosition(
        node,
        direction === 'LR' ? 'right' : 'bottom'
      );
      const tgtPort = getPortPosition(
        node,
        direction === 'LR' ? 'bottom' : 'right'
      );
      ports.set(edge.index, {
        source: { ...srcPort, side: direction === 'LR' ? 'right' : 'bottom' },
        target: { ...tgtPort, side: direction === 'LR' ? 'bottom' : 'right' },
      });
      continue;
    }

    const srcNode = nodes.get(edge.source);
    const tgtNode = nodes.get(edge.target);
    if (!srcNode || !tgtNode) continue;

    const sideInfo = sides.get(edge.index);
    const flowPorts = getFlowPorts(direction);
    let sourceSide: PortSide = sideInfo?.sourceSide ?? flowPorts.outSide;
    const targetSide: PortSide = sideInfo?.targetSide ?? flowPorts.inSide;

    // Radial mode: distribute edges around all 4 sides
    if (radialNodes.has(edge.source)) {
      const allSides: PortSide[] = ['top', 'right', 'bottom', 'left'];
      if (!sideUsage.has(edge.source)) sideUsage.set(edge.source, new Map());
      const usage = sideUsage.get(edge.source)!;
      // Pick the side with least usage
      let minSide = sourceSide;
      let minCount = Infinity;
      for (const s of allSides) {
        const c = usage.get(s) ?? 0;
        if (c < minCount) {
          minCount = c;
          minSide = s;
        }
      }
      sourceSide = minSide;
      usage.set(minSide, (usage.get(minSide) ?? 0) + 1);
    }

    const srcPort = getPortPosition(srcNode, sourceSide);
    const tgtPort = getPortPosition(tgtNode, targetSide);

    ports.set(edge.index, {
      source: { ...srcPort, side: sourceSide },
      target: { ...tgtPort, side: targetSide },
    });
  }

  return ports;
}

// ── 7. Group Layout ───────────────────────────────────────

function computeGroupLayouts(
  groups: BLGroup[],
  nodes: Map<string, InternalNode>,
  collapsedGroupLabels: Set<string>,
  collapsedChildCounts: Map<string, number>
): BLLayoutGroupV2[] {
  const layoutGroups: BLLayoutGroupV2[] = [];

  // Compute nesting levels
  const nestingLevel = new Map<string, number>();
  for (const group of groups) {
    let level = 0;
    let parent = group.parentGroup;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      level++;
      const parentGroup = groups.find((g) => g.label === parent);
      parent = parentGroup?.parentGroup;
    }
    nestingLevel.set(group.label, level);
  }

  // Sort groups: innermost first so we can size them, then parents
  const sortedGroups = [...groups].sort(
    (a, b) =>
      (nestingLevel.get(b.label) ?? 0) - (nestingLevel.get(a.label) ?? 0)
  );

  // Track group bounding boxes for nesting
  const groupBounds = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();

  for (const group of sortedGroups) {
    // Collect bounding boxes of children (both nodes and sub-groups)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let hasChildren = false;

    for (const child of group.children) {
      // Check if child is a sub-group
      const subGroupBounds = groupBounds.get(child);
      if (subGroupBounds) {
        minX = Math.min(minX, subGroupBounds.x);
        minY = Math.min(minY, subGroupBounds.y);
        maxX = Math.max(maxX, subGroupBounds.x + subGroupBounds.width);
        maxY = Math.max(maxY, subGroupBounds.y + subGroupBounds.height);
        hasChildren = true;
        continue;
      }

      // Check if child is a node
      const node = nodes.get(child);
      if (node) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
        hasChildren = true;
      }
    }

    if (!hasChildren) {
      // Empty group or all children are in other groups — give minimal size
      const firstNode = nodes.values().next().value;
      const refX = firstNode ? firstNode.x : MARGIN;
      const refY = firstNode ? firstNode.y : MARGIN;
      minX = refX;
      minY = refY;
      maxX = refX + NODE_WIDTH;
      maxY = refY + NODE_HEIGHT;
    }

    const gx = minX - CONTAINER_PAD_X;
    const gy = minY - CONTAINER_PAD_TOP;
    const gw = maxX - minX + 2 * CONTAINER_PAD_X;
    const gh = maxY - minY + CONTAINER_PAD_TOP + CONTAINER_PAD_BOTTOM;

    groupBounds.set(group.label, { x: gx, y: gy, width: gw, height: gh });

    layoutGroups.push({
      label: group.label,
      lineNumber: group.lineNumber,
      x: gx,
      y: gy,
      width: gw,
      height: gh,
      collapsed: false,
      nestingLevel: nestingLevel.get(group.label) ?? 0,
      parentGroup: group.parentGroup,
    });
  }

  // Add collapsed groups as node-sized rectangles
  for (const label of collapsedGroupLabels) {
    const node = nodes.get(`__group_${label}`);
    if (node) {
      layoutGroups.push({
        label,
        lineNumber: 0,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        collapsed: true,
        childCount: collapsedChildCounts.get(label) ?? 0,
        nestingLevel: 0,
      });
    }
  }

  return layoutGroups;
}

// ── 8. Dense Mode ─────────────────────────────────────────

function isDenseMode(nodeCount: number): boolean {
  return nodeCount > DENSE_NODE_THRESHOLD;
}

// ── Main Entry Point ──────────────────────────────────────

export function layoutBoxesAndLinesV2(
  parsed: ParsedBoxesAndLines,
  collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: BLGroup[];
  }
): BLLayoutResultV2 {
  const direction = parsed.direction;

  // Determine collapsed groups
  const collapsedGroupLabels = new Set<string>();
  if (collapseInfo) {
    for (const og of collapseInfo.originalGroups) {
      if (!parsed.groups.some((g) => g.label === og.label)) {
        collapsedGroupLabels.add(og.label);
      }
    }
  }

  // Build node label list (including collapsed groups as nodes)
  const nodeLabels = parsed.nodes.map((n) => n.label);
  for (const label of collapsedGroupLabels) {
    nodeLabels.push(`__group_${label}`);
  }

  // Source order map for tiebreaking
  const sourceOrderMap = new Map<string, number>();
  nodeLabels.forEach((l, i) => sourceOrderMap.set(l, i));

  // Build internal edges
  const internalEdges: InternalEdge[] = parsed.edges.map((e, i) => ({
    source: e.source,
    target: e.target,
    label: e.label,
    bidirectional: e.bidirectional,
    lineNumber: e.lineNumber,
    reversed: false,
    selfRef: e.source === e.target,
    index: i,
    metadata: e.metadata,
  }));

  // Handle edges to/from collapsed groups
  for (const edge of internalEdges) {
    if (collapsedGroupLabels.has(edge.source)) {
      edge.source = `__group_${edge.source}`;
    }
    if (collapsedGroupLabels.has(edge.target)) {
      edge.target = `__group_${edge.target}`;
    }
  }

  // Assign group membership to nodes
  const nodeGroup = new Map<string, string>();
  for (const group of parsed.groups) {
    for (const child of group.children) {
      if (nodeLabels.includes(child)) {
        nodeGroup.set(child, group.label);
      }
    }
  }

  const dense = isDenseMode(nodeLabels.length);

  // === Pipeline ===

  // 1. Cycle breaking
  const { edges: dagEdges, reversedEdges } = breakCycles(
    nodeLabels,
    internalEdges
  );

  // 2. Spine detection
  const spineSet = detectSpine(nodeLabels, dagEdges);

  // 3. Rank assignment
  const ranks = assignRanks(nodeLabels, dagEdges);

  // 4. Within-rank ordering
  const ranksMap = orderWithinRanks(
    nodeLabels,
    ranks,
    dagEdges,
    sourceOrderMap
  );

  // 5. Node positioning
  const positionedNodes = positionNodes(
    ranksMap,
    dagEdges,
    direction,
    dense,
    spineSet
  );

  // Apply group membership
  for (const [label, groupLabel] of nodeGroup) {
    const node = positionedNodes.get(label);
    if (node) node.group = groupLabel;
  }

  // 6. Port assignment
  const portAssignments = assignPorts(dagEdges, positionedNodes, direction);

  // === Build output ===

  // Parallel edge offsets
  const edgeYOffsets: number[] = new Array(parsed.edges.length).fill(0);
  const edgeParallelCounts: number[] = new Array(parsed.edges.length).fill(1);
  const parallelGroups = new Map<string, number[]>();

  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    const [a, b] =
      edge.source < edge.target
        ? [edge.source, edge.target]
        : [edge.target, edge.source];
    const key = `${a}\x00${b}`;
    if (!parallelGroups.has(key)) parallelGroups.set(key, []);
    parallelGroups.get(key)!.push(i);
  }

  for (const group of parallelGroups.values()) {
    const capped = group.slice(0, MAX_PARALLEL_EDGES);
    for (const idx of group.slice(MAX_PARALLEL_EDGES)) {
      edgeParallelCounts[idx] = 0;
    }
    if (capped.length < 2) continue;
    const effectiveSpacing = PARALLEL_SPACING;
    for (let j = 0; j < capped.length; j++) {
      edgeYOffsets[capped[j]] =
        (j - (capped.length - 1) / 2) * effectiveSpacing;
      edgeParallelCounts[capped[j]] = capped.length;
    }
  }

  // Build layout nodes
  const layoutNodes: BLLayoutNodeV2[] = [];
  for (const node of positionedNodes.values()) {
    // Skip internal group nodes from output
    if (node.label.startsWith('__group_')) continue;
    layoutNodes.push({
      label: node.label,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rank: node.rank,
      rankOrder: node.rankOrder,
      spine: node.spine,
      group: node.group,
    });
  }

  // Build layout edges (ports assigned, routing deferred to Phase 3)
  const layoutEdges: BLLayoutEdgeV2[] = [];
  for (let i = 0; i < dagEdges.length; i++) {
    const edge = dagEdges[i];
    if (edgeParallelCounts[i] === 0) continue;

    const portInfo = portAssignments.get(edge.index);

    const defaultPort = { x: 0, y: 0, side: 'right' as PortSide };
    const sourcePort = portInfo?.source ?? defaultPort;
    const targetPort = portInfo?.target ?? defaultPort;

    // Initial straight-line path (routing will refine this)
    const routedPath = [
      { x: sourcePort.x, y: sourcePort.y },
      { x: targetPort.x, y: targetPort.y },
    ];

    // Simple SVG path (will be replaced by routing)
    const smoothPath = `M ${sourcePort.x} ${sourcePort.y} L ${targetPort.x} ${targetPort.y}`;

    layoutEdges.push({
      source: edge.source,
      target: edge.target,
      label: edge.label,
      bidirectional: edge.bidirectional,
      lineNumber: edge.lineNumber,
      sourcePort,
      targetPort,
      routedPath,
      smoothPath,
      hops: [],
      reversed: edge.reversed,
      selfRef: edge.selfRef,
      yOffset: edgeYOffsets[edge.index],
      parallelCount: edgeParallelCounts[edge.index],
      metadata: edge.metadata,
    });
  }

  // Build groups
  const layoutGroups = computeGroupLayouts(
    parsed.groups,
    positionedNodes,
    collapsedGroupLabels,
    collapseInfo?.collapsedChildCounts ?? new Map()
  );

  // Compute total dimensions
  let maxX = 0;
  let maxY = 0;
  for (const node of layoutNodes) {
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  for (const group of layoutGroups) {
    maxX = Math.max(maxX, group.x + group.width);
    maxY = Math.max(maxY, group.y + group.height);
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    groups: layoutGroups,
    width: maxX + MARGIN,
    height: maxY + MARGIN,
    direction,
    spineNodeLabels: [...spineSet].filter((l) => !l.startsWith('__group_')),
    reversedEdges,
  };
}
