// ============================================================
// Boxes and Lines Diagram — Layout Engine
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedBoxesAndLines, BLNode, BLGroup } from './types';

/**
 * Clip a point at (cx, cy) to the border of a rectangle centered at (cx, cy)
 * with given width/height, along the direction toward (tx, ty).
 * Returns the intersection point on the rectangle border.
 */
function clipToRectBorder(
  cx: number,
  cy: number,
  w: number,
  h: number,
  tx: number,
  ty: number
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = w / 2;
  const hh = h / 2;
  // Scale factor to reach the border along the direction (dx, dy)
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

// ── Constants ──────────────────────────────────────────────
const NODESEP = 60;
const RANKSEP = 100;
const MARGIN = 40;
const CONTAINER_PAD_X = 30;
const CONTAINER_PAD_TOP = 40;
const CONTAINER_PAD_BOTTOM = 24;
const MAX_PARALLEL_EDGES = 5;
const PARALLEL_SPACING = 22;

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
  lineNumber: number;
  points: { x: number; y: number }[];
  labelX?: number;
  labelY?: number;
  yOffset: number;
  parallelCount: number;
  metadata: Record<string, string>;
  /** True for edges deferred from dagre (group endpoints) — use linear curve */
  deferred?: boolean;
}

export interface BLLayoutGroup {
  label: string;
  lineNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
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

const PHI = 1.618;
const NODE_HEIGHT = 60;
const NODE_WIDTH = Math.round(NODE_HEIGHT * PHI); // ≈ 97
const DESC_NODE_WIDTH = 140; // wider nodes when descriptions are shown
const DESC_FONT_SIZE = 10; // matches infra META_FONT_SIZE
const DESC_LINE_HEIGHT = 1.4; // 14px row height at 10px (matches infra META_LINE_HEIGHT)
const DESC_PADDING = 8;
const SEPARATOR_GAP = 4; // matches infra NODE_SEPARATOR_GAP
const MAX_DESC_LINES = 6;
const MAX_LABEL_LINES = 3;
const LABEL_LINE_HEIGHT = 1.3;
const LABEL_PAD = 12; // top + bottom padding around label area

/** Split on camelCase boundaries */
function splitCamelCase(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    const prev = word[i - 1];
    const curr = word[i];
    const next = i + 1 < word.length ? word[i + 1] : '';
    const lowerToUpper =
      prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z';
    const upperRunEnd =
      prev >= 'A' &&
      prev <= 'Z' &&
      curr >= 'A' &&
      curr <= 'Z' &&
      next >= 'a' &&
      next <= 'z';
    if (lowerToUpper || upperRunEnd) {
      parts.push(word.slice(start, i));
      start = i;
    }
  }
  parts.push(word.slice(start));
  return parts.length > 1 ? parts : [word];
}

/** Estimate how many lines a label needs (split on spaces/dashes/camelCase, font shrink 13→9) */
function estimateLabelLines(label: string, nodeWidth = NODE_WIDTH): number {
  // Split on spaces and dashes, then camelCase
  const rawParts = label.split(/[\s-]+/);
  const words: string[] = [];
  for (const part of rawParts) {
    if (!part) continue;
    words.push(...splitCamelCase(part));
  }

  for (let fontSize = 13; fontSize >= 9; fontSize--) {
    const charWidth = fontSize * 0.6;
    const maxChars = Math.floor((nodeWidth - 24) / charWidth);
    if (maxChars < 2) continue;

    let lines = 1;
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length <= maxChars) {
        current = test;
      } else {
        lines++;
        current = word;
      }
    }
    if (lines <= MAX_LABEL_LINES) return Math.min(lines, MAX_LABEL_LINES);
  }
  return MAX_LABEL_LINES;
}

function computeNodeSize(node: BLNode): { width: number; height: number } {
  if (!node.description || node.description.length === 0) {
    return { width: NODE_WIDTH, height: NODE_HEIGHT };
  }

  const w = DESC_NODE_WIDTH;

  // Estimate label height (up to 3 lines)
  const labelLines = estimateLabelLines(node.label, w);
  const labelHeight = labelLines * 13 * LABEL_LINE_HEIGHT + LABEL_PAD;

  // Estimate wrapped line count using word-boundary wrapping (matches renderer)
  const charsPerLine = Math.floor((w - 24) / (DESC_FONT_SIZE * 0.6));
  let totalRenderedLines = 0;
  for (const line of node.description) {
    if (line.length <= charsPerLine) {
      totalRenderedLines += 1;
    } else {
      const words = line.split(/\s+/);
      let current = '';
      let lineCount = 0;
      for (const word of words) {
        // Words wider than line get truncated with "…" in renderer (1 line)
        const fitted =
          word.length > charsPerLine ? word.slice(0, charsPerLine) : word;
        const test = current ? `${current} ${fitted}` : fitted;
        if (test.length <= charsPerLine) {
          current = test;
        } else {
          if (current) lineCount++;
          current = fitted;
        }
      }
      if (current) lineCount++;
      totalRenderedLines += lineCount;
    }
  }
  totalRenderedLines = Math.min(totalRenderedLines, MAX_DESC_LINES);

  const descriptionHeight =
    totalRenderedLines * DESC_FONT_SIZE * DESC_LINE_HEIGHT;
  const totalHeight =
    labelHeight +
    SEPARATOR_GAP +
    DESC_PADDING +
    descriptionHeight +
    DESC_PADDING;

  return { width: w, height: Math.max(NODE_HEIGHT, totalHeight) };
}

// ── Main layout ────────────────────────────────────────────

export function layoutBoxesAndLines(
  parsed: ParsedBoxesAndLines,
  collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: import('./types').BLGroup[];
  },
  layoutOptions?: { hideDescriptions?: boolean }
): BLLayoutResult {
  const hideDescriptions = layoutOptions?.hideDescriptions ?? false;
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: parsed.direction,
    nodesep: NODESEP,
    ranksep: RANKSEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Determine which groups are collapsed (but not hidden inside a collapsed parent)
  const collapsedGroupLabels = new Set<string>();
  if (collapseInfo) {
    // Build set of all groups that are missing from parsed (collapsed or hidden)
    const missingGroups = new Set<string>();
    for (const og of collapseInfo.originalGroups) {
      if (!parsed.groups.some((g) => g.label === og.label)) {
        missingGroups.add(og.label);
      }
    }
    // Only show a collapsed group as a node if its parent is NOT also missing
    // (i.e., it's a directly collapsed group, not one hidden inside a collapsed parent)
    for (const label of missingGroups) {
      const og = collapseInfo.originalGroups.find((g) => g.label === label);
      const parentLabel = og?.parentGroup;
      if (!parentLabel || !missingGroups.has(parentLabel)) {
        collapsedGroupLabels.add(label);
      }
    }
  }

  // Add collapsed groups as regular nodes — same golden-ratio dimensions
  for (const label of collapsedGroupLabels) {
    const gid = `__group_${label}`;
    g.setNode(gid, { label, width: NODE_WIDTH, height: NODE_HEIGHT });
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
  }

  // Re-establish parent relationships for collapsed groups
  // (must run AFTER expanded groups are added to the graph)
  const originalGroupByLabel = new Map<string, BLGroup>();
  if (collapseInfo) {
    for (const og of collapseInfo.originalGroups) {
      originalGroupByLabel.set(og.label, og);
    }
  }
  for (const label of collapsedGroupLabels) {
    const og = originalGroupByLabel.get(label);
    if (og?.parentGroup && !collapsedGroupLabels.has(og.parentGroup)) {
      const gid = `__group_${label}`;
      const parentGid = `__group_${og.parentGroup}`;
      if (g.hasNode(parentGid)) {
        g.setParent(gid, parentGid);
      }
    }
  }

  // Compute node sizes — described nodes share uniform height (unless hidden)
  const nodeSizes = new Map<string, { width: number; height: number }>();
  let maxDescHeight = 0;
  for (const node of parsed.nodes) {
    const size = hideDescriptions
      ? { width: NODE_WIDTH, height: NODE_HEIGHT }
      : computeNodeSize(node);
    nodeSizes.set(node.label, size);
    if (!hideDescriptions && node.description && node.description.length > 0) {
      maxDescHeight = Math.max(maxDescHeight, size.height);
    }
  }
  // Apply uniform height to all described nodes
  if (maxDescHeight > 0) {
    for (const node of parsed.nodes) {
      if (node.description && node.description.length > 0) {
        const size = nodeSizes.get(node.label)!;
        nodeSizes.set(node.label, { width: size.width, height: maxDescHeight });
      }
    }
  }

  // Add nodes
  for (const node of parsed.nodes) {
    const size = nodeSizes.get(node.label)!;
    g.setNode(node.label, {
      label: node.label,
      width: size.width,
      height: size.height,
    });
  }

  // Set parent relationships for nested groups
  for (const group of parsed.groups) {
    if (group.parentGroup) {
      const childGid = `__group_${group.label}`;
      const parentGid = `__group_${group.parentGroup}`;
      if (g.hasNode(childGid) && g.hasNode(parentGid)) {
        g.setParent(childGid, parentGid);
      }
    }
  }

  // Build set of group labels for skip-check below
  const groupLabelSet = new Set(parsed.groups.map((gr) => gr.label));

  // Set parent relationships for nodes in groups
  for (const group of parsed.groups) {
    const gid = `__group_${group.label}`;
    for (const child of group.children) {
      // Skip children that are sub-groups — their parent is set above
      if (groupLabelSet.has(child)) continue;
      if (g.hasNode(child)) {
        g.setParent(child, gid);
      }
    }
  }

  // Build set of expanded compound parent IDs (dagre can't handle edges
  // directly on compound parents — they have no rank of their own)
  const expandedGroupIds = new Set<string>();
  for (const group of parsed.groups) {
    expandedGroupIds.add(`__group_${group.label}`);
  }

  // Add edges — skip edges where either endpoint is an expanded compound parent
  const deferredEdgeIndices: number[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    const src = edge.source;
    const tgt = edge.target;
    if (!g.hasNode(src) || !g.hasNode(tgt)) continue;
    if (expandedGroupIds.has(src) || expandedGroupIds.has(tgt)) {
      deferredEdgeIndices.push(i);
      continue;
    }
    g.setEdge(src, tgt, { label: edge.label ?? '', minlen: 1 }, `e${i}`);
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
    layoutGroups.push({
      label: group.label,
      lineNumber: group.lineNumber,
      x: dagreNode.x,
      y: dagreNode.y,
      width: dagreNode.width,
      height: dagreNode.height,
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
      lineNumber: og?.lineNumber ?? 0,
      x: dagreNode.x,
      y: dagreNode.y,
      width: dagreNode.width,
      height: dagreNode.height,
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
    const effectiveSpacing = PARALLEL_SPACING;
    for (let j = 0; j < capped.length; j++) {
      edgeYOffsets[capped[j]] =
        (j - (capped.length - 1) / 2) * effectiveSpacing;
      edgeParallelCounts[capped[j]] = capped.length;
    }
  }

  // Extract edge points
  const deferredSet = new Set(deferredEdgeIndices);
  const layoutEdges: BLLayoutEdge[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    if (edgeParallelCounts[i] === 0) continue;

    let points: { x: number; y: number }[];

    if (deferredSet.has(i)) {
      // Deferred edge (compound parent endpoint) — compute points clipped to border
      const srcNode = g.node(edge.source);
      const tgtNode = g.node(edge.target);
      if (!srcNode || !tgtNode) continue;
      const srcPt = clipToRectBorder(
        srcNode.x,
        srcNode.y,
        srcNode.width,
        srcNode.height,
        tgtNode.x,
        tgtNode.y
      );
      const tgtPt = clipToRectBorder(
        tgtNode.x,
        tgtNode.y,
        tgtNode.width,
        tgtNode.height,
        srcNode.x,
        srcNode.y
      );
      const midX = (srcPt.x + tgtPt.x) / 2;
      const midY = (srcPt.y + tgtPt.y) / 2;
      points = [srcPt, { x: midX, y: midY }, tgtPt];
    } else {
      const dagreEdge = g.edge(edge.source, edge.target, `e${i}`);
      points = dagreEdge?.points ?? [];
    }

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
      lineNumber: edge.lineNumber,
      points,
      labelX,
      labelY,
      yOffset: edgeYOffsets[i],
      parallelCount: edgeParallelCounts[i],
      metadata: edge.metadata,
      deferred: deferredSet.has(i) || undefined,
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
