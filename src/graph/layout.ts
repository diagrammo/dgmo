import dagre from '@dagrejs/dagre';
import type {
  ParsedGraph,
  GraphNode,
  GraphEdge,
  GraphShape,
} from './types';

export interface LayoutNode {
  id: string;
  label: string;
  shape: GraphShape;
  color?: string;
  group?: string;
  lineNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
  points: { x: number; y: number }[];
  label?: string;
  color?: string;
  lineNumber: number;
}

export interface LayoutGroup {
  id: string;
  label: string;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  groups: LayoutGroup[];
  width: number;
  height: number;
}

const GROUP_PADDING = 20;

function computeNodeWidth(label: string, shape: GraphShape): number {
  const base = Math.max(120, label.length * 9 + 40);
  if (shape === 'subroutine') return base + 10;
  return base;
}

function computeNodeHeight(shape: GraphShape): number {
  return shape === 'decision' ? 60 : 50;
}

export function layoutGraph(graph: ParsedGraph): LayoutResult {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: graph.direction,
    nodesep: 50,
    ranksep: 60,
    edgesep: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Build a lookup for original node data
  const nodeDataMap = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    nodeDataMap.set(node.id, node);
  }

  // Add group parent nodes
  if (graph.groups) {
    for (const group of graph.groups) {
      g.setNode(group.id, {
        label: group.label,
        clusterLabelPos: 'top',
      });
    }
  }

  // Add nodes with computed dimensions
  for (const node of graph.nodes) {
    const width = computeNodeWidth(node.label, node.shape);
    const height = computeNodeHeight(node.shape);
    g.setNode(node.id, { label: node.label, width, height });

    // Set parent for grouped nodes
    if (node.group && graph.groups?.some((gr) => gr.id === node.group)) {
      g.setParent(node.id, node.group);
    }
  }

  // Build edge lookup for original data
  const edgeDataMap = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    const key = `${edge.source}->${edge.target}`;
    edgeDataMap.set(key, edge);
    g.setEdge(edge.source, edge.target, {
      label: edge.label ?? '',
    });
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const layoutNodes: LayoutNode[] = graph.nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      id: node.id,
      label: node.label,
      shape: node.shape,
      color: node.color,
      group: node.group,
      lineNumber: node.lineNumber,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    };
  });

  // Extract edge waypoints
  const layoutEdges: LayoutEdge[] = graph.edges.map((edge) => {
    const edgeData = g.edge(edge.source, edge.target);
    return {
      source: edge.source,
      target: edge.target,
      points: edgeData?.points ?? [],
      label: edge.label,
      color: edge.color,
      lineNumber: edge.lineNumber,
    };
  });

  // Compute group bounding boxes from member node positions
  const layoutGroups: LayoutGroup[] = [];
  if (graph.groups) {
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));
    for (const group of graph.groups) {
      const members = group.nodeIds
        .map((id) => nodeMap.get(id))
        .filter((n): n is LayoutNode => n !== undefined);

      if (members.length === 0) {
        layoutGroups.push({
          id: group.id,
          label: group.label,
          color: group.color,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });
        continue;
      }

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
        id: group.id,
        label: group.label,
        color: group.color,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2,
      });
    }
  }

  // Compute total diagram dimensions
  let totalWidth = 0;
  let totalHeight = 0;
  for (const node of layoutNodes) {
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  for (const group of layoutGroups) {
    const right = group.x + group.width;
    const bottom = group.y + group.height;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
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
