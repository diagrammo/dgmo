// ============================================================
// Mindmap Two-Sided Horizontal Tree Layout
// ============================================================
//
// Classic mindmap layout: root centered, children branch left and right.
// Each side is a recursive vertical stacking — no D3 tree layout needed.
// Nodes at the same depth share the same X column. Hierarchy reads
// left→right (right branches) or right→left (left branches).

import type { MindmapNode } from './types';
import type {
  MindmapLayoutNode,
  MindmapLayoutEdge,
  MindmapLayoutResult,
} from './types';
import type { ParsedMindmap } from './types';
import type { PaletteColors } from '../palettes';
import type { TagGroup } from '../utils/tag-groups';
import { resolveTagColor, injectDefaultTagMetadata } from '../utils/tag-groups';
import { computeNodeText } from './text-wrap';
import { ScaleContext } from '../utils/scaling';

// ============================================================
// Constants
// ============================================================

const ROOT_WIDTH = 180;
const DEPTH1_WIDTH = 150;
const LEAF_WIDTH = 120;

const SINGLE_LABEL_HEIGHT = 28;
const LABEL_LINE_HEIGHT = 18; // per line when multi-line
const DESC_LINE_HEIGHT = 14; // per description line
const NODE_V_PAD = 10;

const H_GAP = 40; // horizontal gap between parent edge and child edge
const V_GAP = 12; // vertical gap between sibling nodes
const MARGIN = 40;
const MULTI_ROOT_GAP = 60; // horizontal gap between independent root trees

interface ScaledConstants {
  rootWidth: number;
  depth1Width: number;
  leafWidth: number;
  hGap: number;
  vGap: number;
  margin: number;
  multiRootGap: number;
}

// ============================================================
// Direction — which side a subtree grows toward
// ============================================================

type Direction = 'right' | 'left';

// ============================================================
// Internal positioned node (intermediate before final output)
// ============================================================

interface PositionedNode {
  node: MindmapNode;
  x: number; // top-left x
  y: number; // top-left y
  width: number;
  height: number;
  depth: number;
  direction: Direction;
  subtreeHeight: number; // total height of this node's subtree
}

// ============================================================
// Main entry point
// ============================================================

export function layoutMindmap(
  parsed: ParsedMindmap,
  _palette: PaletteColors,
  options?: {
    interactive?: boolean;
    hiddenCounts?: Map<string, number>;
    activeTagGroup?: string | null;
    hideDescriptions?: boolean;
    ctx?: ScaleContext;
  }
): MindmapLayoutResult {
  const roots = parsed.roots;
  if (roots.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const hiddenCounts = options?.hiddenCounts ?? new Map<string, number>();
  const activeTagGroup = options?.activeTagGroup ?? null;
  const hideDescriptions = options?.hideDescriptions ?? false;
  const ctx = options?.ctx ?? ScaleContext.identity();

  const sc: ScaledConstants = {
    rootWidth: ctx.structural(ROOT_WIDTH),
    depth1Width: ctx.structural(DEPTH1_WIDTH),
    leafWidth: ctx.structural(LEAF_WIDTH),
    hGap: ctx.aesthetic(H_GAP),
    vGap: ctx.aesthetic(V_GAP),
    margin: ctx.aesthetic(MARGIN),
    multiRootGap: ctx.aesthetic(MULTI_ROOT_GAP),
  };

  populateDepthCache(roots);

  const allNodes: MindmapNode[] = [];
  const collectAll = (nodes: readonly MindmapNode[]) => {
    for (const n of nodes) {
      allNodes.push(n);
      collectAll(n.children);
    }
  };
  collectAll(roots);
  injectDefaultTagMetadata(allNodes, parsed.tagGroups);

  const tagGroups = parsed.tagGroups;

  if (roots.length === 1) {
    return layoutSingleRoot(
      roots[0]!,
      hiddenCounts,
      hideDescriptions,
      tagGroups,
      activeTagGroup,
      sc
    );
  }
  return layoutMultiRoot(
    roots,
    parsed,
    hiddenCounts,
    hideDescriptions,
    tagGroups,
    activeTagGroup,
    sc
  );
}

// ============================================================
// Single root — two-sided horizontal tree
// ============================================================

function layoutSingleRoot(
  root: MindmapNode,
  hiddenCounts: Map<string, number>,
  hideDescriptions: boolean,
  tagGroups: readonly TagGroup[] = [],
  activeTagGroup: string | null = null,
  sc: ScaledConstants
): MindmapLayoutResult {
  const positioned: PositionedNode[] = [];
  const rootW = nodeWidthS(0, sc);
  const rootH = nodeHeightS(root, hideDescriptions, sc);

  const children = root.children;
  const { right: rightChildren, left: leftChildren } = balancedSplitS(
    children,
    hideDescriptions,
    sc
  );

  const rightHeight = computeGroupHeightS(
    rightChildren,
    1,
    hideDescriptions,
    sc
  );
  const leftHeight = computeGroupHeightS(leftChildren, 1, hideDescriptions, sc);
  const maxSideHeight = Math.max(rightHeight, leftHeight, rootH);

  const rootX = 0;
  const rootY = maxSideHeight / 2 - rootH / 2;

  positioned.push({
    node: root,
    x: rootX,
    y: rootY,
    width: rootW,
    height: rootH,
    depth: 0,
    direction: 'right',
    subtreeHeight: maxSideHeight,
  });

  const rootCenterY = rootY + rootH / 2;
  const rightStartX = rootX + rootW + sc.hGap;
  layoutSideS(
    rightChildren,
    rightStartX,
    rootCenterY,
    1,
    'right',
    hideDescriptions,
    positioned,
    sc
  );

  const leftStartX = rootX - sc.hGap;
  layoutSideS(
    leftChildren,
    leftStartX,
    rootCenterY,
    1,
    'left',
    hideDescriptions,
    positioned,
    sc
  );

  return finalizeS(
    positioned,
    hiddenCounts,
    hideDescriptions,
    root,
    tagGroups,
    activeTagGroup,
    sc
  );
}

// ============================================================
// Multi-root — each root gets its own two-sided tree, arranged horizontally
// ============================================================

function layoutMultiRoot(
  roots: readonly MindmapNode[],
  _parsed: ParsedMindmap,
  hiddenCounts: Map<string, number>,
  hideDescriptions: boolean,
  tagGroups: readonly TagGroup[],
  activeTagGroup: string | null,
  sc: ScaledConstants
): MindmapLayoutResult {
  const subResults: MindmapLayoutResult[] = [];
  for (const r of roots) {
    subResults.push(
      layoutSingleRoot(
        r,
        hiddenCounts,
        hideDescriptions,
        tagGroups,
        activeTagGroup,
        sc
      )
    );
  }

  const totalWidth =
    subResults.reduce((sum, r) => sum + r.width, 0) +
    sc.multiRootGap * (subResults.length - 1);
  const maxHeight = Math.max(...subResults.map((r) => r.height));

  const allNodes: MindmapLayoutNode[] = [];
  const allEdges: MindmapLayoutEdge[] = [];
  let xOffset = 0;

  for (const sub of subResults) {
    const yOffset = (maxHeight - sub.height) / 2;
    for (const n of sub.nodes) {
      allNodes.push({ ...n, x: n.x + xOffset, y: n.y + yOffset });
    }
    for (const e of sub.edges) {
      allEdges.push({
        sourceId: e.sourceId,
        targetId: e.targetId,
        path: offsetPath(e.path, xOffset, yOffset),
      });
    }
    xOffset += sub.width + sc.multiRootGap;
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    width: totalWidth,
    height: maxHeight,
  };
}

// ============================================================
// Recursive side layout
// ============================================================

function layoutSideS(
  children: readonly MindmapNode[],
  startX: number,
  parentCenterY: number,
  depth: number,
  direction: Direction,
  hideDescriptions: boolean,
  positioned: PositionedNode[],
  sc: ScaledConstants
): void {
  if (children.length === 0) return;

  const groupHeight = computeGroupHeightS(
    children,
    depth,
    hideDescriptions,
    sc
  );
  let currentY = parentCenterY - groupHeight / 2;

  for (const child of children) {
    const w = nodeWidthS(depth, sc);
    const h = nodeHeightS(child, hideDescriptions, sc);
    const subtreeH = computeSubtreeHeightS(child, depth, hideDescriptions, sc);

    const nodeY = currentY + subtreeH / 2 - h / 2;
    const nodeX = direction === 'right' ? startX : startX - w;

    positioned.push({
      node: child,
      x: nodeX,
      y: nodeY,
      width: w,
      height: h,
      depth,
      direction,
      subtreeHeight: subtreeH,
    });

    if (child.children.length > 0) {
      const childCenterY = nodeY + h / 2;
      const nextX =
        direction === 'right' ? nodeX + w + sc.hGap : nodeX - sc.hGap;
      layoutSideS(
        child.children,
        nextX,
        childCenterY,
        depth + 1,
        direction,
        hideDescriptions,
        positioned,
        sc
      );
    }

    currentY += subtreeH + sc.vGap;
  }
}

// ============================================================
// Height computation
// ============================================================

function computeGroupHeightS(
  children: readonly MindmapNode[],
  depth: number,
  hideDescriptions: boolean,
  sc: ScaledConstants
): number {
  if (children.length === 0) return 0;
  let total = 0;
  for (const child of children) {
    total += computeSubtreeHeightS(child, depth, hideDescriptions, sc);
  }
  total += sc.vGap * (children.length - 1);
  return total;
}

function computeSubtreeHeightS(
  node: MindmapNode,
  depth: number,
  hideDescriptions: boolean,
  sc: ScaledConstants
): number {
  const h = nodeHeightS(node, hideDescriptions, sc);
  if (node.children.length === 0) return h;
  const childrenHeight = computeGroupHeightS(
    node.children,
    depth + 1,
    hideDescriptions,
    sc
  );
  return Math.max(h, childrenHeight);
}

// ============================================================
// Finalization — normalize coordinates, generate output
// ============================================================

function resolveNodeColor(
  node: MindmapNode,
  tagGroups: readonly TagGroup[],
  activeGroupName: string | null
): string | undefined {
  // Explicit inline (color) always wins
  if (node.color) return node.color;
  return resolveTagColor(node.metadata, [...tagGroups], activeGroupName);
}

function finalizeS(
  positioned: PositionedNode[],
  hiddenCounts: Map<string, number>,
  _hideDescriptions: boolean,
  _rootMindmapNode: MindmapNode,
  tagGroups: readonly TagGroup[] = [],
  activeTagGroup: string | null = null,
  sc: ScaledConstants
): MindmapLayoutResult {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of positioned) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }

  const offsetX = -minX + sc.margin;
  const offsetY = -minY + sc.margin;
  const totalWidth = maxX - minX + sc.margin * 2;
  const totalHeight = maxY - minY + sc.margin * 2;

  // Build node index for edge generation
  const nodeMap = new Map<string, PositionedNode>();
  for (const p of positioned) {
    nodeMap.set(p.node.id, p);
  }

  const nodes: MindmapLayoutNode[] = [];
  const edges: MindmapLayoutEdge[] = [];

  for (const p of positioned) {
    const resolvedColor = resolveNodeColor(p.node, tagGroups, activeTagGroup);
    const hiddenCount = hiddenCounts.get(p.node.id);
    nodes.push({
      id: p.node.id,
      label: p.node.label,
      ...(p.node.description !== undefined && {
        description: [...p.node.description],
      }),
      metadata: { ...p.node.metadata },
      lineNumber: p.node.lineNumber,
      ...(resolvedColor !== undefined && { color: resolvedColor }),
      x: p.x + offsetX,
      y: p.y + offsetY,
      width: p.width,
      height: p.height,
      depth: p.depth,
      angle: 0,
      radius: 0,
      ...(hiddenCount !== undefined && { hiddenCount }),
      hasChildren: hiddenCounts.has(p.node.id) || p.node.children.length > 0,
    });
  }

  // Generate bus-style edges: one trunk + vertical bar + individual drops per parent.
  // This prevents overlapping semi-transparent segments.
  const childrenByParent = new Map<string, PositionedNode[]>();
  for (const p of positioned) {
    if (p.node.parentId) {
      const arr = childrenByParent.get(p.node.parentId) ?? [];
      arr.push(p);
      childrenByParent.set(p.node.parentId, arr);
    }
  }

  // Split children by direction so left and right get separate bus edges
  const groupedEdges: [string, PositionedNode[]][] = [];
  for (const [parentId, children] of childrenByParent) {
    const rightKids = children.filter((c) => c.direction === 'right');
    const leftKids = children.filter((c) => c.direction === 'left');
    if (rightKids.length > 0) groupedEdges.push([parentId, rightKids]);
    if (leftKids.length > 0) groupedEdges.push([parentId, leftKids]);
  }

  for (const [parentId, children] of groupedEdges) {
    const parent = nodeMap.get(parentId)!;
    const px = parent.x + offsetX;
    const py = parent.y + offsetY;
    // In-bounds: groupedEdges only contains non-empty children arrays.
    const isLeft = children[0]!.direction === 'left';

    // Parent connection point
    const srcX = isLeft ? px : px + parent.width;
    const srcY = py + parent.height / 2;

    // Midpoint X between parent edge and children column
    // In-bounds: children is non-empty (see above).
    const firstChild = children[0]!;
    const childEdgeX = isLeft
      ? firstChild.x + offsetX + firstChild.width
      : firstChild.x + offsetX;
    const midX = (srcX + childEdgeX) / 2;

    if (children.length === 1) {
      // Single child — simple elbow, no bus needed
      // In-bounds: children.length === 1.
      const c = children[0]!;
      const tgtX = isLeft ? c.x + offsetX + c.width : c.x + offsetX;
      const tgtY = c.y + offsetY + c.height / 2;
      edges.push({
        sourceId: parentId,
        targetId: c.node.id,
        path: `M ${srcX} ${srcY} L ${midX} ${srcY} L ${midX} ${tgtY} L ${tgtX} ${tgtY}`,
      });
    } else {
      // Bus pattern: trunk → vertical bar → drops
      // 1. Trunk: parent edge → midX
      edges.push({
        sourceId: parentId,
        targetId: parentId, // self-ref = trunk
        path: `M ${srcX} ${srcY} L ${midX} ${srcY}`,
      });

      // 2. Vertical bar from topmost child to bottommost child at midX
      const childYs = children.map((c) => c.y + offsetY + c.height / 2);
      const minChildY = Math.min(...childYs);
      const maxChildY = Math.max(...childYs);
      edges.push({
        sourceId: parentId,
        targetId: parentId, // self-ref = bar
        path: `M ${midX} ${minChildY} L ${midX} ${maxChildY}`,
      });

      // 3. Individual horizontal drops from midX to each child
      for (let i = 0; i < children.length; i++) {
        // In-bounds by loop guard (i < children.length); childYs derived from children.
        const c = children[i]!;
        const tgtX = isLeft ? c.x + offsetX + c.width : c.x + offsetX;
        const tgtY = childYs[i]!;
        edges.push({
          sourceId: parentId,
          targetId: c.node.id,
          path: `M ${midX} ${tgtY} L ${tgtX} ${tgtY}`,
        });
      }
    }
  }

  return { nodes, edges, width: totalWidth, height: totalHeight };
}

/**
 * Split children into right and left groups, balancing by subtree height.
 * Preserves source order on each side. Alternating assignment to the
 * lighter side keeps both sides visually balanced.
 */
function balancedSplitS(
  children: readonly MindmapNode[],
  hideDescriptions: boolean,
  sc: ScaledConstants
): { right: MindmapNode[]; left: MindmapNode[] } {
  if (children.length <= 1) {
    return { right: [...children], left: [] };
  }
  if (children.length === 2) {
    return { right: [children[0]!], left: [children[1]!] };
  }

  const weights = children.map((c, i) => ({
    index: i,
    node: c,
    height: computeSubtreeHeightS(c, 1, hideDescriptions, sc),
  }));

  const right: MindmapNode[] = [];
  const left: MindmapNode[] = [];
  let rightWeight = 0;
  let leftWeight = 0;

  for (const w of weights) {
    if (rightWeight <= leftWeight) {
      right.push(w.node);
      rightWeight += w.height;
    } else {
      left.push(w.node);
      leftWeight += w.height;
    }
  }

  return { right, left };
}

/** Offset all coordinates in an SVG path by (dx, dy) */
function offsetPath(path: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return path;
  return path.replace(
    /([ML])\s*([\d.e+-]+)\s+([\d.e+-]+)/g,
    (_, cmd, x, y) => `${cmd} ${parseFloat(x) + dx} ${parseFloat(y) + dy}`
  );
}

// ============================================================
// Node sizing
// ============================================================

function nodeWidthS(depth: number, sc: ScaledConstants): number {
  if (depth === 0) return sc.rootWidth;
  if (depth === 1) return sc.depth1Width;
  return sc.leafWidth;
}

function nodeHeightS(
  node: MindmapNode,
  hideDescriptions: boolean,
  sc: ScaledConstants
): number {
  const depth = getNodeDepth(node);
  const w = nodeWidthS(depth, sc);
  const text = computeNodeText(
    node.label,
    node.description ? [...node.description] : undefined,
    depth,
    w,
    hideDescriptions
  );
  const labelLineCount = text.labelLines.length;
  const labelH =
    labelLineCount <= 1
      ? SINGLE_LABEL_HEIGHT
      : LABEL_LINE_HEIGHT * labelLineCount;
  let h = labelH + NODE_V_PAD;
  if (text.descLines.length > 0) {
    h += DESC_LINE_HEIGHT * text.descLines.length + 4;
  }
  return h;
}

/** Walk parentId chain to compute depth. Cached via roots traversal isn't needed — trees are small. */
function getNodeDepth(node: MindmapNode): number {
  // The node structure doesn't carry depth directly, but we can
  // infer from the layout context. For nodeHeight we need depth
  // for font sizing. Use a simple heuristic: walk up parentId.
  // Since MindmapNode doesn't have a parent reference (only parentId),
  // and we don't have the node map here, we use a depth cache.
  return nodeDepthCache.get(node.id) ?? 0;
}

const nodeDepthCache = new Map<string, number>();

/** Populate depth cache by walking the tree. Call before layout. */
function populateDepthCache(roots: readonly MindmapNode[]): void {
  nodeDepthCache.clear();
  const walk = (nodes: readonly MindmapNode[], depth: number) => {
    for (const n of nodes) {
      nodeDepthCache.set(n.id, depth);
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
}
