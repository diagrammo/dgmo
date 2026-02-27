// ============================================================
// Initiative Status Diagram — Layout (dagre-based)
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedInitiativeStatus, ISEdge } from './types';

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

export interface ISLayoutResult {
  nodes: ISLayoutNode[];
  edges: ISLayoutEdge[];
  width: number;
  height: number;
}

// Golden ratio fixed-size nodes — all boxes are identical dimensions
const PHI = 1.618;
const NODE_HEIGHT = 60;
const NODE_WIDTH = Math.round(NODE_HEIGHT * PHI); // ~97

export function layoutInitiativeStatus(parsed: ParsedInitiativeStatus): ISLayoutResult {
  if (parsed.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: 'LR',
    nodesep: 80,
    ranksep: 160,
    edgesep: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes — all same size (golden ratio)
  for (const node of parsed.nodes) {
    g.setNode(node.label, { label: node.label, width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Add edges — use multigraph names to allow duplicates between same pair
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    g.setEdge(edge.source, edge.target, { label: edge.label ?? '' }, `e${i}`);
  }

  // Compute layout
  dagre.layout(g);

  // Build declaration-order index (lower = declared earlier in DSL)
  const declOrder = new Map<string, number>();
  for (let i = 0; i < parsed.nodes.length; i++) {
    declOrder.set(parsed.nodes[i].label, i);
  }

  // Extract positioned nodes
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

  // Reorder nodes within each rank to match DSL declaration order.
  // Dagre optimizes for crossing minimization which can scramble the
  // author's intended ordering — here we restore it.
  const RANK_TOLERANCE = 1; // nodes within 1px are in the same rank
  const rankGroups = new Map<number, ISLayoutNode[]>();
  for (const node of layoutNodes) {
    // Quantize x to group nodes in the same rank
    const rx = Math.round(node.x / RANK_TOLERANCE) * RANK_TOLERANCE;
    let group = rankGroups.get(rx);
    if (!group) {
      group = [];
      rankGroups.set(rx, group);
    }
    group.push(node);
  }

  for (const group of rankGroups.values()) {
    if (group.length < 2) continue;

    // Capture the y-slots dagre assigned (sorted ascending)
    const ySlots = group.map((n) => n.y).sort((a, b) => a - b);

    // Sort nodes by DSL declaration order
    group.sort((a, b) => (declOrder.get(a.label) ?? 0) - (declOrder.get(b.label) ?? 0));

    // Reassign y positions: declaration-first gets the top slot
    for (let i = 0; i < group.length; i++) {
      group[i].y = ySlots[i];
    }
  }

  // Extract edge waypoints
  const layoutEdges: ISLayoutEdge[] = parsed.edges.map((edge, i) => {
    const edgeData = g.edge(edge.source, edge.target, `e${i}`);
    return {
      source: edge.source,
      target: edge.target,
      label: edge.label,
      status: edge.status,
      lineNumber: edge.lineNumber,
      points: edgeData?.points ?? [],
    };
  });

  // Compute total dimensions
  let totalWidth = 0;
  let totalHeight = 0;
  for (const node of layoutNodes) {
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  // Also consider edge control points
  for (const edge of layoutEdges) {
    for (const pt of edge.points) {
      if (pt.x > totalWidth) totalWidth = pt.x;
      if (pt.y > totalHeight) totalHeight = pt.y;
    }
  }
  // Add margin
  totalWidth += 40;
  totalHeight += 40;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: totalWidth,
    height: totalHeight,
  };
}
