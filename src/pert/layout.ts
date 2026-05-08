// ============================================================
// PERT Layout — dagre wrapper
// ============================================================
//
// Pure functions; no UI state. The diagrammo-app holds expansion state
// in its own store and feeds an override map into `relayoutPert`.

import dagre from '@dagrejs/dagre';
import type { ResolvedPert, LayoutResult, PertLayoutNode } from './types';
import type { LayoutOverrides } from './internal';

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 64;
const MILESTONE_SIZE = 56;
const DIAGRAM_PADDING = 20;
const GROUP_PADDING = 18;

function nodeDimensions(
  resolved: ResolvedPert,
  id: string,
  overrides?: LayoutOverrides
): { width: number; height: number } {
  if (overrides && overrides[id]) {
    return { width: overrides[id].width, height: overrides[id].height };
  }
  const activity = resolved.activities.find((r) => r.activity.id === id);
  if (activity?.activity.isMilestone) {
    return { width: MILESTONE_SIZE, height: MILESTONE_SIZE };
  }
  return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

export function layoutPert(resolved: ResolvedPert): LayoutResult {
  return relayoutPert(resolved, {});
}

export function relayoutPert(
  resolved: ResolvedPert,
  overrides: LayoutOverrides
): LayoutResult {
  if (resolved.activities.length === 0) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: resolved.options.direction,
    nodesep: 50,
    ranksep: 60,
    edgesep: 18,
    marginx: DIAGRAM_PADDING,
    marginy: DIAGRAM_PADDING,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const r of resolved.activities) {
    const { width, height } = nodeDimensions(
      resolved,
      r.activity.id,
      overrides
    );
    g.setNode(r.activity.id, { width, height });
  }
  for (const e of resolved.edges) {
    g.setEdge(e.source, e.target, {});
  }

  dagre.layout(g);

  const nodes: PertLayoutNode[] = resolved.activities.map((r) => {
    const pos = g.node(r.activity.id);
    return {
      id: r.activity.id,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    };
  });

  const edges = resolved.edges.map((e) => {
    const data = g.edge(e.source, e.target);
    return {
      source: e.source,
      target: e.target,
      points: data?.points ?? [],
    };
  });

  // Group bounding boxes from member positions.
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const groups = resolved.groups.map((rg) => {
    const members = rg.group.activityIds
      .map((id) => nodeMap.get(id))
      .filter((n): n is PertLayoutNode => n !== undefined);

    if (members.length === 0) {
      return {
        id: rg.group.id,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        classification: rg.group.classification ?? 'cluster',
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      const left = m.x - m.width / 2;
      const right = m.x + m.width / 2;
      const top = m.y - m.height / 2;
      const bottom = m.y + m.height / 2;
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    }
    return {
      id: rg.group.id,
      x: minX - GROUP_PADDING,
      y: minY - GROUP_PADDING,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2,
      classification: rg.group.classification ?? 'cluster',
    };
  });

  // Diagram bounds — include groups too for cluster overlap.
  let totalW = 0;
  let totalH = 0;
  for (const n of nodes) {
    const right = n.x + n.width / 2;
    const bottom = n.y + n.height / 2;
    if (right > totalW) totalW = right;
    if (bottom > totalH) totalH = bottom;
  }
  for (const grp of groups) {
    if (grp.x + grp.width > totalW) totalW = grp.x + grp.width;
    if (grp.y + grp.height > totalH) totalH = grp.y + grp.height;
  }

  return {
    nodes,
    edges,
    groups,
    width: totalW + DIAGRAM_PADDING,
    height: totalH + DIAGRAM_PADDING,
  };
}
