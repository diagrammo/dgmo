// ============================================================
// Initiative Status Diagram — Layout (dagre-based)
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedInitiativeStatus, ISEdge, InitiativeStatus } from './types';

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

// Roll up child statuses: worst (least-progressed) wins
// Priority: todo > wip > done > na > null
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

// Golden ratio fixed-size nodes — all boxes are identical dimensions
const PHI = 1.618;
const NODE_HEIGHT = 60;
const NODE_WIDTH = Math.round(NODE_HEIGHT * PHI); // ~97
const GROUP_PADDING = 20;

export function layoutInitiativeStatus(parsed: ParsedInitiativeStatus): ISLayoutResult {
  if (parsed.nodes.length === 0) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  const hasGroups = parsed.groups.length > 0;
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: hasGroups });
  g.setGraph({
    rankdir: 'LR',
    nodesep: 80,
    ranksep: 160,
    edgesep: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add group parent nodes
  for (const group of parsed.groups) {
    const groupId = `__group_${group.label}`;
    g.setNode(groupId, { label: group.label, clusterLabelPos: 'top' });
  }

  // Add nodes — all same size (golden ratio)
  for (const node of parsed.nodes) {
    g.setNode(node.label, { label: node.label, width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Assign children to group parents
  for (const group of parsed.groups) {
    const groupId = `__group_${group.label}`;
    for (const nodeLabel of group.nodeLabels) {
      if (g.hasNode(nodeLabel)) {
        g.setParent(nodeLabel, groupId);
      }
    }
  }

  // Add edges — use multigraph names to allow duplicates between same pair
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    g.setEdge(edge.source, edge.target, { label: edge.label ?? '' }, `e${i}`);
  }

  // Compute layout
  dagre.layout(g);

  // Extract positioned nodes — dagre owns within-rank ordering
  // (crossing minimization). We don't reorder post-layout because
  // that would desync edge waypoints from node positions.
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

  // Compute group bounding boxes from member positions
  const layoutGroups: ISLayoutGroup[] = [];
  if (parsed.groups.length > 0) {
    const nodeMap = new Map(layoutNodes.map((n) => [n.label, n]));
    for (const group of parsed.groups) {
      const members = group.nodeLabels
        .map((label) => nodeMap.get(label))
        .filter((n): n is ISLayoutNode => n !== undefined);

      if (members.length === 0) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

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
  // Also consider group bounds
  for (const group of layoutGroups) {
    const right = group.x + group.width;
    const bottom = group.y + group.height;
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
    groups: layoutGroups,
    width: totalWidth,
    height: totalHeight,
  };
}
