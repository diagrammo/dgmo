// ============================================================
// Boxes and Lines Diagram — Layout Engine
// ============================================================

import dagre from '@dagrejs/dagre';
import type {
  ParsedBoxesAndLines,
  BLNode,
  BLGroup,
  BLRenderMode,
} from './types';

// ── Constants ──────────────────────────────────────────────
const NODESEP = 60;
const RANKSEP = 100;
const MARGIN = 40;
const CONTAINER_PAD_X = 24;
const CONTAINER_PAD_TOP = 36;
const CONTAINER_PAD_BOTTOM = 20;
const CHAR_WIDTH_RATIO = 0.6;
const NODE_FONT_SIZE = 13;
const MIN_NODE_WIDTH = 100;
const SHAPE_NODE_HEIGHT = 60;
const MAX_PARALLEL_EDGES = 5;
const PARALLEL_SPACING = 12;
const PARALLEL_EDGE_MARGIN = 10;

// ── Result types ───────────────────────────────────────────

export interface BLLayoutNode {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BLLayoutEdge {
  source: string;
  target: string;
  label?: string;
  bidirectional: boolean;
  points: { x: number; y: number }[];
  labelX?: number;
  labelY?: number;
  yOffset: number;
  parallelCount: number;
  metadata: Record<string, string>;
}

export interface BLLayoutGroup {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parentGroup?: string;
  collapsed: boolean;
  childCount?: number;
}

export interface BLLayoutResult {
  nodes: BLLayoutNode[];
  edges: BLLayoutEdge[];
  groups: BLLayoutGroup[];
  width: number;
  height: number;
}

// ── Node sizing ────────────────────────────────────────────

function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_RATIO;
}

function computeNodeSize(
  node: BLNode,
  renderMode: BLRenderMode
): { width: number; height: number } {
  if (renderMode === 'shapes') {
    const w = Math.max(
      MIN_NODE_WIDTH,
      textWidth(node.label, NODE_FONT_SIZE) + 24
    );
    return { width: w, height: SHAPE_NODE_HEIGHT };
  }

  // Rectangle mode — infra-style card: header (28px) + optional body
  const NODE_HEADER_H = 28;
  const META_FONT = 10;
  const META_LINE_H = 14;
  const NODE_PAD_BOT = 10;
  const SEPARATOR_GAP = 4;

  const labelW = textWidth(node.label, NODE_FONT_SIZE) + 40; // badge space
  let maxTextW = labelW;
  let bodyH = 0;

  if (node.description) {
    const descW = textWidth(node.description.slice(0, 40), META_FONT) + 24;
    maxTextW = Math.max(maxTextW, descW);
    bodyH = SEPARATOR_GAP + META_LINE_H;
  }

  const width = Math.max(MIN_NODE_WIDTH, maxTextW);
  const height =
    NODE_HEADER_H + (bodyH > 0 ? bodyH + NODE_PAD_BOT : NODE_PAD_BOT);
  return { width, height };
}

// ── Main layout ────────────────────────────────────────────

export function layoutBoxesAndLines(
  parsed: ParsedBoxesAndLines,
  renderModeOverride?: 'rectangles' | 'shapes',
  collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: import('./types').BLGroup[];
  }
): BLLayoutResult {
  const effectiveRenderMode = renderModeOverride ?? parsed.renderMode;
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: parsed.direction,
    nodesep: NODESEP,
    ranksep: RANKSEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Build group lookup
  const groupMap = new Map<string, { depth: number; parentGroup?: string }>();
  for (const group of parsed.groups) {
    const depth = group.parentGroup
      ? (groupMap.get(group.parentGroup)?.depth ?? 0) + 1
      : 0;
    groupMap.set(group.label, { depth, parentGroup: group.parentGroup });
  }

  // Determine which groups are collapsed — but only top-level ones.
  // Sub-groups absorbed by a collapsed parent don't get their own node.
  const allRemovedLabels = new Set<string>();
  if (collapseInfo) {
    for (const og of collapseInfo.originalGroups) {
      if (!parsed.groups.some((g) => g.label === og.label)) {
        allRemovedLabels.add(og.label);
      }
    }
  }
  // A collapsed group is "top-level" if none of its ancestors are also collapsed
  const originalGroupMap = new Map<string, BLGroup>();
  if (collapseInfo) {
    for (const og of collapseInfo.originalGroups) {
      originalGroupMap.set(og.label, og);
    }
  }
  const collapsedGroupLabels = new Set<string>();
  for (const label of allRemovedLabels) {
    let absorbed = false;
    let current = originalGroupMap.get(label);
    while (current?.parentGroup) {
      if (allRemovedLabels.has(current.parentGroup)) {
        absorbed = true;
        break;
      }
      current = originalGroupMap.get(current.parentGroup);
    }
    if (!absorbed) collapsedGroupLabels.add(label);
  }

  // Add collapsed groups as regular nodes (they act as edge endpoints)
  for (const label of collapsedGroupLabels) {
    const gid = `__group_${label}`;
    const childCount = collapseInfo?.collapsedChildCounts.get(label) ?? 0;
    const labelW = textWidth(label, NODE_FONT_SIZE) + 24;
    const countW = textWidth(`${childCount} items`, 11) + 16;
    const w = Math.max(MIN_NODE_WIDTH, Math.max(labelW, countW));
    g.setNode(gid, { label, width: w, height: 50 });
  }

  // Add expanded group nodes as compound parents
  for (const group of parsed.groups) {
    const gid = `__group_${group.label}`;
    g.setNode(gid, {
      label: group.label,
      paddingLeft: CONTAINER_PAD_X,
      paddingRight: CONTAINER_PAD_X,
      paddingTop: CONTAINER_PAD_TOP,
      paddingBottom: CONTAINER_PAD_BOTTOM,
    });
    // Set parent for nested groups
    if (group.parentGroup) {
      g.setParent(gid, `__group_${group.parentGroup}`);
    }
  }

  // Add nodes
  for (const node of parsed.nodes) {
    const size = computeNodeSize(node, effectiveRenderMode);
    g.setNode(node.label, {
      label: node.label,
      width: size.width,
      height: size.height,
    });
  }

  // Set parent relationships for nodes in groups
  for (const group of parsed.groups) {
    const gid = `__group_${group.label}`;
    for (const child of group.children) {
      if (g.hasNode(child)) {
        g.setParent(child, gid);
      }
    }
  }

  // Add edges
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    const src = edge.source;
    const tgt = edge.target;
    if (g.hasNode(src) && g.hasNode(tgt)) {
      g.setEdge(src, tgt, { label: edge.label ?? '', minlen: 1 }, `e${i}`);
    }
  }

  // Run dagre layout
  dagre.layout(g);

  // Extract node positions
  const layoutNodes: BLLayoutNode[] = [];
  for (const node of parsed.nodes) {
    const dagreNode = g.node(node.label);
    if (!dagreNode) continue;
    layoutNodes.push({
      label: node.label,
      x: dagreNode.x,
      y: dagreNode.y,
      width: dagreNode.width,
      height: dagreNode.height,
    });
  }

  // Extract group positions (expanded)
  const layoutGroups: BLLayoutGroup[] = [];
  for (const group of parsed.groups) {
    const gid = `__group_${group.label}`;
    const dagreNode = g.node(gid);
    if (!dagreNode) continue;
    const gm = groupMap.get(group.label);
    layoutGroups.push({
      label: group.label,
      x: dagreNode.x,
      y: dagreNode.y,
      width: dagreNode.width,
      height: dagreNode.height,
      depth: gm?.depth ?? 0,
      parentGroup: group.parentGroup,
      collapsed: false,
    });
  }

  // Extract collapsed group positions
  for (const label of collapsedGroupLabels) {
    const gid = `__group_${label}`;
    const dagreNode = g.node(gid);
    if (!dagreNode) continue;
    const og = collapseInfo?.originalGroups.find((g) => g.label === label);
    layoutGroups.push({
      label,
      x: dagreNode.x,
      y: dagreNode.y,
      width: dagreNode.width,
      height: dagreNode.height,
      depth: 0,
      parentGroup: og?.parentGroup,
      collapsed: true,
      childCount: collapseInfo?.collapsedChildCounts.get(label) ?? 0,
    });
  }

  // Compute parallel edge offsets
  const edgeYOffsets: number[] = new Array(parsed.edges.length).fill(0);
  const edgeParallelCounts: number[] = new Array(parsed.edges.length).fill(1);
  const parallelGroups = new Map<string, number[]>();

  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    // Normalize key so A→B and B→A are in the same parallel group
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
    const effectiveSpacing = Math.min(
      PARALLEL_SPACING,
      (SHAPE_NODE_HEIGHT - PARALLEL_EDGE_MARGIN) / (capped.length - 1)
    );
    for (let j = 0; j < capped.length; j++) {
      edgeYOffsets[capped[j]] =
        (j - (capped.length - 1) / 2) * effectiveSpacing;
      edgeParallelCounts[capped[j]] = capped.length;
    }
  }

  // Extract edge points
  const layoutEdges: BLLayoutEdge[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    if (edgeParallelCounts[i] === 0) continue;

    const dagreEdge = g.edge(edge.source, edge.target, `e${i}`);
    const points: { x: number; y: number }[] = dagreEdge?.points ?? [];

    // Compute label position at midpoint
    let labelX: number | undefined;
    let labelY: number | undefined;
    if (edge.label && points.length >= 2) {
      const mid = Math.floor(points.length / 2);
      labelX = points[mid].x;
      labelY = points[mid].y - 10;
    }

    layoutEdges.push({
      source: edge.source,
      target: edge.target,
      label: edge.label,
      bidirectional: edge.bidirectional,
      points,
      labelX,
      labelY,
      yOffset: edgeYOffsets[i],
      parallelCount: edgeParallelCounts[i],
      metadata: edge.metadata,
    });
  }

  // Compute total dimensions
  let maxX = 0;
  let maxY = 0;
  for (const node of layoutNodes) {
    maxX = Math.max(maxX, node.x + node.width / 2);
    maxY = Math.max(maxY, node.y + node.height / 2);
  }
  for (const group of layoutGroups) {
    maxX = Math.max(maxX, group.x + group.width / 2);
    maxY = Math.max(maxY, group.y + group.height / 2);
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    groups: layoutGroups,
    width: maxX + MARGIN,
    height: maxY + MARGIN,
  };
}
