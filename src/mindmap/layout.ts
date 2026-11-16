// ============================================================
// Mindmap Layout — two-sided horizontal tree, or radial
// ============================================================
//
// Classic mindmap layout: root centered, children branch left and right.
// Each side is a recursive vertical stacking — no D3 tree layout needed.
// Nodes at the same depth share the same X column. Hierarchy reads
// left→right (right branches) or right→left (left branches).
//
// The bare `radial` flag swaps in `layoutRadial` (below): the root at the
// centre, one ring per depth.

import { HEADER_HEIGHT } from '../utils/visual-conventions';
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
import { isTitleRoot } from './title-root';
import { ScaleContext } from '../utils/scaling';

// ============================================================
// Constants
// ============================================================

const ROOT_WIDTH = 180;
const DEPTH1_WIDTH = 150;
const LEAF_WIDTH = 120;

const LABEL_LINE_HEIGHT = 18; // per line when multi-line
const DESC_LINE_HEIGHT = 14; // per description line
const NODE_V_PAD = 10;

const H_GAP = 40; // horizontal gap between parent edge and child edge
const V_GAP = 12; // vertical gap between sibling nodes
export const MARGIN = 40;
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
  const layoutRoot =
    parsed.options['radial'] === 'on' ? layoutRadial : layoutSingleRoot;

  const result =
    roots.length === 1
      ? layoutRoot(
          roots[0]!,
          hiddenCounts,
          hideDescriptions,
          tagGroups,
          activeTagGroup,
          sc
        )
      : layoutMultiRoot(
          roots,
          layoutRoot,
          hiddenCounts,
          hideDescriptions,
          tagGroups,
          activeTagGroup,
          sc
        );

  // The title-derived root draws no collapse toggle (#1571). Its source line
  // is the `mindmap <title>` declaration, which carries no `collapsed` marker,
  // so a collapse saved there became title text and expanding found nothing
  // to remove. A root inferred from a real node line keeps its toggle.
  const titleRootId = roots.find(isTitleRoot)?.id;
  if (titleRootId === undefined) return result;
  return {
    ...result,
    nodes: result.nodes.map((n) =>
      n.id === titleRootId ? { ...n, hasChildren: false } : n
    ),
  };
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

type RootLayout = typeof layoutSingleRoot;

function layoutMultiRoot(
  roots: readonly MindmapNode[],
  layoutRoot: RootLayout,
  hiddenCounts: Map<string, number>,
  hideDescriptions: boolean,
  tagGroups: readonly TagGroup[],
  activeTagGroup: string | null,
  sc: ScaledConstants
): MindmapLayoutResult {
  const subResults: MindmapLayoutResult[] = [];
  for (const r of roots) {
    subResults.push(
      layoutRoot(
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
// Radial — the root at the centre, one ring per depth (#1843)
// ============================================================
//
// The bare `radial` flag. Every node owns an angular span in proportion to
// its leaf count, and sits at the middle of it; its children share that span
// out the same way. So a dominant trunk spreads its children around the root
// instead of stacking them in one tall column.
//
// Depth d sits on ring d. Between ring d-1 and ring d runs a band no node
// enters (the bus ring, `busRadius[d]`): each ring's radius is the smallest
// that keeps its nodes clear of that band and of one another. An edge runs
// out from the parent along its own angle to the band, along the band to the
// child's angle, then out to the child, so no edge cuts through a node of
// another branch.

/** Polyline step when an edge follows the bus ring (5°). */
const RADIAL_ARC_STEP = Math.PI / 36;
/** Smallest radius step when a ring grows to clear its nodes. */
const RADIAL_RING_STEP = 4;
/** Growth per step as a share of the radius, so big rings converge fast. */
const RADIAL_RING_GROWTH = 0.02;
/** Bound on ring-growth steps; a ring that fits sooner stops sooner. */
const RADIAL_MAX_STEPS = 2000;
/** Turns of the whole picture tried for the most compact one (15° apart). */
const RADIAL_TURNS = 24;

interface RadialNode {
  node: MindmapNode;
  depth: number;
  width: number;
  height: number;
  /** Middle of the node's angular span, radians, clockwise from +x. */
  angle: number;
  radius: number;
  cx: number;
  cy: number;
  children: RadialNode[];
}

type Point = readonly [number, number];

function layoutRadial(
  root: MindmapNode,
  hiddenCounts: Map<string, number>,
  hideDescriptions: boolean,
  tagGroups: readonly TagGroup[] = [],
  activeTagGroup: string | null = null,
  sc: ScaledConstants
): MindmapLayoutResult {
  // 1. Spans: leaf count shares out each parent's span among its children.
  const leaves = new Map<string, number>();
  const countLeaves = (n: MindmapNode): number => {
    let c = 0;
    for (const child of n.children) c += countLeaves(child);
    const total = Math.max(c, 1);
    leaves.set(n.id, total);
    return total;
  };
  const rootLeaves = countLeaves(root);
  const firstShare =
    root.children.length > 0
      ? (2 * Math.PI * leaves.get(root.children[0]!.id)!) / rootLeaves
      : 0;
  // Before the turn in step 2, the first branch is centred straight above
  // the root; the rest follow clockwise in source order.
  const start = -Math.PI / 2 - firstShare / 2;

  const rings: RadialNode[][] = [];
  const all: RadialNode[] = [];
  const place = (
    n: MindmapNode,
    depth: number,
    from: number,
    to: number
  ): RadialNode => {
    const r: RadialNode = {
      node: n,
      depth,
      width: nodeWidthS(depth, sc),
      height: nodeHeightS(n, hideDescriptions, sc),
      angle: (from + to) / 2,
      radius: 0,
      cx: 0,
      cy: 0,
      children: [],
    };
    all.push(r);
    (rings[depth] ??= []).push(r);
    const total = leaves.get(n.id)!;
    let s = from;
    for (const child of n.children) {
      const e = s + ((to - from) * leaves.get(child.id)!) / total;
      r.children.push(place(child, depth + 1, s, e));
      s = e;
    }
    return r;
  };
  place(root, 0, start, start + 2 * Math.PI);
  const baseAngles = all.map((p) => p.angle);

  // 2. Rings, at the most compact turn of the whole picture. A wide box
  // needs more of a ring at the top and bottom than at the sides, so where
  // the small branches land changes the size; the first turn wins a tie.
  let best = { area: Infinity, turn: 0 };
  for (let k = 0; k < RADIAL_TURNS; k++) {
    const turn = (2 * Math.PI * k) / RADIAL_TURNS;
    all.forEach((p, i) => (p.angle = baseAngles[i]! + turn));
    placeRings(rings, sc.vGap);
    const area = boxBounds(all).area;
    if (area < best.area - 1e-6) best = { area, turn };
  }
  all.forEach((p, i) => (p.angle = baseAngles[i]! + best.turn));
  const busRadius = placeRings(rings, sc.vGap);

  // 3. Edges, as point lists (offset once the bounds are known).
  const lines: { sourceId: string; targetId: string; points: Point[] }[] = [];
  for (const p of all) {
    if (p.children.length === 0) continue;
    const id = p.node.id;
    if (p.depth === 0) {
      // Spokes straight out of the centre never cross one another.
      for (const c of p.children) {
        lines.push({
          sourceId: id,
          targetId: c.node.id,
          points: [
            [p.cx, p.cy],
            [c.cx, c.cy],
          ],
        });
      }
      continue;
    }
    const bus = busRadius[p.depth + 1]!;
    const out = polarPoint(bus, p.angle);
    if (p.children.length === 1) {
      const c = p.children[0]!;
      lines.push({
        sourceId: id,
        targetId: c.node.id,
        points: [
          [p.cx, p.cy],
          out,
          ...arcPoints(bus, p.angle, c.angle),
          [c.cx, c.cy],
        ],
      });
      continue;
    }
    // Bus pattern, as the two-sided layout draws it: trunk, ring, drops —
    // so no stretch is stroked twice under the edges' opacity.
    const angles = p.children.map((c) => c.angle);
    const lo = Math.min(p.angle, ...angles);
    const hi = Math.max(p.angle, ...angles);
    lines.push({ sourceId: id, targetId: id, points: [[p.cx, p.cy], out] });
    lines.push({
      sourceId: id,
      targetId: id,
      points: [polarPoint(bus, lo), ...arcPoints(bus, lo, hi)],
    });
    for (const c of p.children) {
      lines.push({
        sourceId: id,
        targetId: c.node.id,
        points: [polarPoint(bus, c.angle), [c.cx, c.cy]],
      });
    }
  }

  // 4. Normalise to the margin.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.cx - p.width / 2);
    minY = Math.min(minY, p.cy - p.height / 2);
    maxX = Math.max(maxX, p.cx + p.width / 2);
    maxY = Math.max(maxY, p.cy + p.height / 2);
  }
  for (const l of lines) {
    for (const [x, y] of l.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const dx = -minX + sc.margin;
  const dy = -minY + sc.margin;

  const nodes = all.map((p) =>
    toLayoutNode(
      p.node,
      {
        x: p.cx - p.width / 2 + dx,
        y: p.cy - p.height / 2 + dy,
        width: p.width,
        height: p.height,
      },
      p.depth,
      { angle: p.angle, radius: p.radius },
      hiddenCounts,
      tagGroups,
      activeTagGroup
    )
  );
  const edges: MindmapLayoutEdge[] = lines.map((l) => ({
    sourceId: l.sourceId,
    targetId: l.targetId,
    path: l.points
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x + dx} ${y + dy}`)
      .join(' '),
  }));

  return {
    nodes,
    edges,
    width: maxX - minX + sc.margin * 2,
    height: maxY - minY + sc.margin * 2,
  };
}

/**
 * Set each ring's radius, inside out, from the nodes' angles: the smallest
 * that keeps a ring's boxes clear of one another and of a free band of
 * `band` on each side of its bus ring. Returns the bus ring radii by depth.
 */
function placeRings(rings: readonly RadialNode[][], band: number): number[] {
  const root = rings[0]![0]!;
  setPolar(root, 0);
  const busRadius: number[] = [0];
  let outer = farthestFromCentre(root);
  for (let d = 1; d < rings.length; d++) {
    const ring = rings[d]!;
    const bus = outer + band;
    busRadius[d] = bus;
    let radius =
      bus +
      band +
      Math.min(...ring.map((p) => Math.min(p.width, p.height) / 2));
    for (let step = 0; step < RADIAL_MAX_STEPS; step++) {
      for (const p of ring) setPolar(p, radius);
      if (
        ring.every((p) => nearestToCentre(p) >= bus + band) &&
        !ringOverlaps(ring, band)
      ) {
        break;
      }
      radius += Math.max(RADIAL_RING_STEP, radius * RADIAL_RING_GROWTH);
    }
    outer = Math.max(...ring.map(farthestFromCentre));
  }
  return busRadius;
}

function boxBounds(all: readonly RadialNode[]): { area: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.cx - p.width / 2);
    minY = Math.min(minY, p.cy - p.height / 2);
    maxX = Math.max(maxX, p.cx + p.width / 2);
    maxY = Math.max(maxY, p.cy + p.height / 2);
  }
  return { area: (maxX - minX) * (maxY - minY) };
}

function setPolar(p: RadialNode, radius: number): void {
  p.radius = radius;
  p.cx = radius * Math.cos(p.angle);
  p.cy = radius * Math.sin(p.angle);
}

function polarPoint(radius: number, angle: number): Point {
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/** Points along the circle of `radius` from angle `a` to `b`, `a` excluded. */
function arcPoints(radius: number, a: number, b: number): Point[] {
  const n = Math.max(1, Math.ceil(Math.abs(b - a) / RADIAL_ARC_STEP));
  const pts: Point[] = [];
  for (let i = 1; i <= n; i++)
    pts.push(polarPoint(radius, a + ((b - a) * i) / n));
  return pts;
}

/** Distance from the centre to the nearest point of the node's box. */
function nearestToCentre(p: RadialNode): number {
  const gx = Math.max(0, Math.abs(p.cx) - p.width / 2);
  const gy = Math.max(0, Math.abs(p.cy) - p.height / 2);
  return Math.hypot(gx, gy);
}

/** Distance from the centre to the farthest corner of the node's box. */
function farthestFromCentre(p: RadialNode): number {
  return Math.hypot(
    Math.abs(p.cx) + p.width / 2,
    Math.abs(p.cy) + p.height / 2
  );
}

/** True when two boxes on one ring come within `gap` of each other. */
function ringOverlaps(ring: readonly RadialNode[], gap: number): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    for (let j = i + 1; j < ring.length; j++) {
      const b = ring[j]!;
      if (
        Math.abs(a.cx - b.cx) < (a.width + b.width) / 2 + gap &&
        Math.abs(a.cy - b.cy) < (a.height + b.height) / 2 + gap
      ) {
        return true;
      }
    }
  }
  return false;
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

function toLayoutNode(
  node: MindmapNode,
  box: { x: number; y: number; width: number; height: number },
  depth: number,
  polar: { angle: number; radius: number },
  hiddenCounts: Map<string, number>,
  tagGroups: readonly TagGroup[],
  activeTagGroup: string | null
): MindmapLayoutNode {
  const resolvedColor = resolveNodeColor(node, tagGroups, activeTagGroup);
  const hiddenCount = hiddenCounts.get(node.id);
  return {
    id: node.id,
    label: node.label,
    ...(node.description !== undefined && {
      description: [...node.description],
    }),
    metadata: { ...node.metadata },
    lineNumber: node.lineNumber,
    ...(resolvedColor !== undefined && { color: resolvedColor }),
    ...box,
    depth,
    ...polar,
    ...(hiddenCount !== undefined && { hiddenCount }),
    hasChildren: hiddenCounts.has(node.id) || node.children.length > 0,
  };
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
    nodes.push(
      toLayoutNode(
        p.node,
        {
          x: p.x + offsetX,
          y: p.y + offsetY,
          width: p.width,
          height: p.height,
        },
        p.depth,
        { angle: 0, radius: 0 },
        hiddenCounts,
        tagGroups,
        activeTagGroup
      )
    );
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
    (_, cmd: string, x: string, y: string) =>
      `${cmd} ${parseFloat(x) + dx} ${parseFloat(y) + dy}`
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
    labelLineCount <= 1 ? HEADER_HEIGHT : LABEL_LINE_HEIGHT * labelLineCount;
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
