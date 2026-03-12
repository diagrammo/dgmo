// ============================================================
// Initiative Status Diagram — Layout
//
// Uses dagre for rank assignment, node ordering, and edge
// routing.  Edge waypoints are taken directly from dagre's
// output without modification.
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedInitiativeStatus, InitiativeStatus } from './types';
import type { CollapseResult } from './collapse';

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
  // Layout contract for points[]:
  //   Back-edges:       5 points — [src.top/bottom_center, depart_ctrl, arc_control, approach_ctrl, tgt.top/bottom_center]
  //   Top/bottom-exit:  4 points — [src.top/bottom_center, depart_ctrl, tgt_approach, tgt.left_center]
  //   4-point elbow:    points[0] and points[last] pinned at node center Y; interior fans via yOffset
  //   fixedDagrePoints: points[0]=src.right, points[last]=tgt.left; interior from dagre
  points: { x: number; y: number }[];
  parallelCount: number; // 1 for unique edges, >1 for parallel groups — used by renderer to narrow hit area
}

export interface ISLayoutGroup {
  label: string;
  status: InitiativeStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  lineNumber: number;
  collapsed: boolean;
}

export interface ISLayoutResult {
  nodes: ISLayoutNode[];
  edges: ISLayoutEdge[];
  groups: ISLayoutGroup[];
  width: number;
  height: number;
}

const STATUS_PRIORITY: Record<string, number> = { todo: 3, wip: 2, done: 1, na: 0 };

export function rollUpStatus(members: { status: InitiativeStatus }[]): InitiativeStatus {
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
const PARALLEL_SPACING = 16; // px between parallel edges sharing same source→target (~27% of NODE_HEIGHT)
const PARALLEL_EDGE_MARGIN = 12; // total vertical margin reserved at top+bottom of node for edge bundles (6px each side)
const MAX_PARALLEL_EDGES = 5; // at most this many edges rendered between any directed source→target pair
const BACK_EDGE_MARGIN = 40; // clearance below/above nodes for back-edge arcs (~half NODESEP)
const BACK_EDGE_MIN_SPREAD = Math.round(NODE_WIDTH * 0.75); // minimum horizontal arc spread for near-same-X back-edges
const TOP_EXIT_STEP = 10; // px: control-point offset giving near-vertical departure tangent for top/bottom-exit elbows
const CHAR_WIDTH_RATIO = 0.6;
const NODE_FONT_SIZE = 13;
const NODE_TEXT_PADDING = 12;

// ============================================================
// Main layout function
// ============================================================

export function layoutInitiativeStatus(
  parsed: ParsedInitiativeStatus,
  collapseResult?: CollapseResult
): ISLayoutResult {
  if (parsed.nodes.length === 0 && (!collapseResult || collapseResult.collapsedGroupStatuses.size === 0)) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  // Derive collapse context
  const originalGroups = collapseResult?.originalGroups ?? parsed.groups;
  const collapsedGroupStatuses = collapseResult?.collapsedGroupStatuses ?? new Map<string, InitiativeStatus>();
  const collapsedGroupLabels = new Set(
    originalGroups
      .map((g) => g.label)
      .filter((l) => !parsed.groups.some((g) => g.label === l))
  );

  // Build and run dagre graph
  const hasGroups = parsed.groups.length > 0 || collapsedGroupLabels.size > 0;
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: hasGroups });
  g.setGraph({ rankdir: 'LR', nodesep: NODESEP, ranksep: RANKSEP });
  g.setDefaultEdgeLabel(() => ({}));

  // Collapsed groups → regular dagre nodes (no compound parent)
  for (const group of originalGroups) {
    if (collapsedGroupLabels.has(group.label)) {
      const collapsedW = Math.max(
        NODE_WIDTH,
        Math.ceil(group.label.length * CHAR_WIDTH_RATIO * NODE_FONT_SIZE) + NODE_TEXT_PADDING * 2
      );
      g.setNode(group.label, { label: group.label, width: collapsedW, height: NODE_HEIGHT });
    }
  }

  // Expanded groups → compound parents
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

  // Extract node positions
  const layoutNodes: ISLayoutNode[] = parsed.nodes.map((node) => {
    const pos = g.node(node.label);
    return {
      label: node.label,
      status: node.status,
      shape: node.shape,
      lineNumber: node.lineNumber,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    };
  });

  // Build a unified position map covering both regular nodes and collapsed groups
  interface NodePos { x: number; y: number; width: number; height: number }
  const posMap = new Map<string, NodePos>(layoutNodes.map((n) => [n.label, n]));
  for (const label of collapsedGroupLabels) {
    const pos = g.node(label);
    if (pos) posMap.set(label, { x: pos.x, y: pos.y, width: pos.width, height: pos.height });
  }

  const allNodeX = [...posMap.values()].map((n) => n.x);
  // avgNodeY / avgNodeX: O(1) scalars used for back-edge above/below heuristic and arc spread direction.
  // layoutNodes.length === 0 is unreachable here (early-return guard at line 92 exits for empty diagrams).
  const avgNodeY = layoutNodes.length > 0
    ? layoutNodes.reduce((s, n) => s + n.y, 0) / layoutNodes.length
    : 0;
  const avgNodeX = layoutNodes.length > 0
    ? layoutNodes.reduce((s, n) => s + n.x, 0) / layoutNodes.length
    : 0;

  // Adjacent-rank edges: 4-point elbow (perpendicular exit/entry, no crossings).
  // Multi-rank edges: dagre's interior waypoints for obstacle avoidance, with
  // first/last points pinned to exact node boundaries at node-center Y.

  // Precompute Y offsets and parallel counts for parallel edges (same directed source→target).
  // Edges beyond MAX_PARALLEL_EDGES in a group are marked with parallelCount=0 and excluded from layout.
  const edgeYOffsets: number[] = new Array(parsed.edges.length).fill(0);
  const edgeParallelCounts: number[] = new Array(parsed.edges.length).fill(1);
  const parallelGroups = new Map<string, number[]>();
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    const key = `${edge.source}\x00${edge.target}`; // null-byte separator — safe in all label strings
    parallelGroups.set(key, parallelGroups.get(key) ?? []);
    parallelGroups.get(key)!.push(i);
  }
  for (const group of parallelGroups.values()) {
    // Cap group to MAX_PARALLEL_EDGES; mark excess edges for exclusion
    const capped = group.slice(0, MAX_PARALLEL_EDGES);
    for (const idx of group.slice(MAX_PARALLEL_EDGES)) {
      edgeParallelCounts[idx] = 0; // sentinel: exclude from layout
    }
    if (capped.length < 2) continue;
    // Clamp spacing so the bundle fits within node bounds regardless of edge count
    const effectiveSpacing = Math.min(PARALLEL_SPACING, (NODE_HEIGHT - PARALLEL_EDGE_MARGIN) / (capped.length - 1));
    for (let j = 0; j < capped.length; j++) {
      edgeYOffsets[capped[j]] = (j - (capped.length - 1) / 2) * effectiveSpacing;
      edgeParallelCounts[capped[j]] = capped.length;
    }
  }

  const layoutEdges: ISLayoutEdge[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    const src = posMap.get(edge.source);
    const tgt = posMap.get(edge.target);
    // Exclude edges beyond the parallel cap and edges with missing node positions
    if (edgeParallelCounts[i] === 0) continue;
    if (!src || !tgt) continue;
    const yOffset = edgeYOffsets[i];
    const parallelCount = edgeParallelCounts[i];
    const exitX = src.x + src.width / 2;
    const enterX = tgt.x - tgt.width / 2;
    const dagreEdge = g.edge(edge.source, edge.target, `e${i}`);
    const dagrePoints: { x: number; y: number }[] = dagreEdge?.points ?? [];
    const hasIntermediateRank = allNodeX.some((x) => x > src.x + 20 && x < tgt.x - 20);
    const step = Math.max(0, Math.min((enterX - exitX) * 0.15, 20)); // clamped ≥0: guards overlapping nodes

    // 5-branch routing: isBackEdge → isTopExit → isBottomExit → 4-point elbow → fixedDagrePoints
    const isBackEdge   = tgt.x < src.x - 5; // 5px epsilon: same-rank same-X nodes must not false-match
    // Guards: tgt.x > src.x (strict) keeps step positive; !hasIntermediateRank defers multi-rank
    // displaced edges to fixedDagrePoints so dagre can route around intermediate nodes.
    const isTopExit    = !isBackEdge && tgt.x > src.x && !hasIntermediateRank && tgt.y < src.y - NODESEP;
    const isBottomExit = !isBackEdge && tgt.x > src.x && !hasIntermediateRank && tgt.y > src.y + NODESEP;

    let points: { x: number; y: number }[];

    if (isBackEdge) {
      // 3-point arc via bottom (or top) of both nodes — bypasses dagre entirely so arrowhead is visible.
      // curveMonotoneX requires monotone-decreasing X (src.x > tgt.x for back-edges) ✓
      // Parallel back-edges share the same arc (yOffset ignored) — acknowledged limitation, out of scope.
      const routeAbove = Math.min(src.y, tgt.y) > avgNodeY;
      const srcHalfH = src.height / 2;
      const tgtHalfH = tgt.height / 2;
      const rawMidX = (src.x + tgt.x) / 2;
      const spreadDir = avgNodeX < rawMidX ? 1 : -1;
      // Clamp midX to [tgt.x, src.x] to preserve monotone-decreasing X for curveMonotoneX.
      // When nodes are near-same-X the arc stays narrow but valid.
      const unclamped = Math.abs(src.x - tgt.x) < NODE_WIDTH
        ? rawMidX + spreadDir * BACK_EDGE_MIN_SPREAD
        : rawMidX;
      const midX = Math.min(src.x, Math.max(tgt.x, unclamped));
      // Clamped departure/approach control points give near-orthogonal tangents at node edges.
      // For narrow back-edges (|src.x - tgt.x| < 2*TOP_EXIT_STEP), clamps degrade to midX±1 — valid.
      const srcDepart   = Math.max(midX + 1, src.x - TOP_EXIT_STEP);
      const tgtApproach = Math.min(midX - 1, tgt.x + TOP_EXIT_STEP);
      if (routeAbove) {
        const arcY = Math.min(src.y - srcHalfH, tgt.y - tgtHalfH) - BACK_EDGE_MARGIN;
        points = [
          { x: src.x,       y: src.y - srcHalfH },
          { x: srcDepart,   y: src.y - srcHalfH - TOP_EXIT_STEP },
          { x: midX,        y: arcY },
          { x: tgtApproach, y: tgt.y - tgtHalfH - TOP_EXIT_STEP },
          { x: tgt.x,       y: tgt.y - tgtHalfH },
        ];
      } else {
        const arcY = Math.max(src.y + srcHalfH, tgt.y + tgtHalfH) + BACK_EDGE_MARGIN;
        points = [
          { x: src.x,       y: src.y + srcHalfH },
          { x: srcDepart,   y: src.y + srcHalfH + TOP_EXIT_STEP },
          { x: midX,        y: arcY },
          { x: tgtApproach, y: tgt.y + tgtHalfH + TOP_EXIT_STEP },
          { x: tgt.x,       y: tgt.y + tgtHalfH },
        ];
      }
    } else if (isTopExit) {
      // 4-point top-exit elbow: exits top of source ~vertically, arrives left of target horizontally.
      // Top exit keeps this edge ABOVE the horizontal right-exit bundle → avoids crossings.
      // yOffset repurposed as X-spread for top/bottom-exit branches (same magnitude, different axis).
      // p1x: floor at src.x prevents negative-yOffset edges from going left of origin (breaks monotone X);
      // ceiling at midpoint-1 prevents overshooting for large positive yOffset (±32px for 5 parallel edges).
      const exitY = src.y - src.height / 2;
      const p1x = Math.min(Math.max(src.x, src.x + yOffset + TOP_EXIT_STEP), (src.x + enterX) / 2 - 1);
      points = [
        { x: src.x,         y: exitY },
        { x: p1x,           y: exitY - TOP_EXIT_STEP },
        { x: enterX - step, y: tgt.y + yOffset },
        { x: enterX,        y: tgt.y },
      ];
    } else if (isBottomExit) {
      // 4-point bottom-exit elbow: mirror of top-exit. Keeps edge BELOW the horizontal bundle.
      const exitY = src.y + src.height / 2;
      const p1x = Math.min(Math.max(src.x, src.x + yOffset + TOP_EXIT_STEP), (src.x + enterX) / 2 - 1);
      points = [
        { x: src.x,         y: exitY },
        { x: p1x,           y: exitY + TOP_EXIT_STEP },
        { x: enterX - step, y: tgt.y + yOffset },
        { x: enterX,        y: tgt.y },
      ];
    } else if (tgt.x > src.x && !hasIntermediateRank) {
      // 4-point elbow: adjacent-rank forward edges (unchanged)
      points = [
        { x: exitX,         y: src.y },           // exits node center — stays pinned
        { x: exitX + step,  y: src.y + yOffset },  // fans out
        { x: enterX - step, y: tgt.y + yOffset },  // still fanned
        { x: enterX,        y: tgt.y },            // enters node center — stays pinned
      ];
    } else {
      // fixedDagrePoints: multi-rank forward edges — dagre interior waypoints for obstacle avoidance.
      // dagrePoints is still fetched above (line 209) and available here.
      points = dagrePoints.length >= 2 ? [
        { x: exitX, y: src.y + yOffset },
        ...dagrePoints.slice(1, -1),
        { x: enterX, y: tgt.y + yOffset },
      ] : dagrePoints;
    }
    layoutEdges.push({ source: edge.source, target: edge.target, label: edge.label,
                       status: edge.status, lineNumber: edge.lineNumber, points, parallelCount });
  }

  // Compute group bounding boxes
  const layoutGroups: ISLayoutGroup[] = [];

  // Collapsed groups: dagre placed them as regular nodes → normalize to top-left
  for (const group of originalGroups) {
    if (collapsedGroupLabels.has(group.label)) {
      const pos = g.node(group.label);
      if (!pos) continue;
      layoutGroups.push({
        label: group.label,
        status: collapsedGroupStatuses.get(group.label) ?? null,
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2,
        width: pos.width,
        height: pos.height,
        lineNumber: group.lineNumber,
        collapsed: true,
      });
    }
  }

  // Expanded groups: bounding box from member positions
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
        label: group.label,
        status: rollUpStatus(members),
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2,
        lineNumber: group.lineNumber,
        collapsed: false,
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
