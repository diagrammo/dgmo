// ============================================================
// Boxes and Lines Diagram — Layout Engine
// ============================================================
//
// Uses elkjs (layered algorithm) with a multi-trial scheme that runs
// several option variants and picks the best by:
//   1. crossings (with a forgiveness threshold for near-zero)
//   2. total area (prefer compact)
//   3. bend count (prefer fewer corners)

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ParsedBoxesAndLines, BLNode, BLGroup } from './types';

// ── Constants ──────────────────────────────────────────────
const MARGIN = 40;
const CONTAINER_PAD_X = 30;
const CONTAINER_PAD_TOP = 40;
const CONTAINER_PAD_BOTTOM = 24;
const MAX_PARALLEL_EDGES = 5;
const PARALLEL_SPACING = 22;

const PHI = 1.618;
const NODE_HEIGHT = 60;
const NODE_WIDTH = Math.round(NODE_HEIGHT * PHI);
const DESC_NODE_WIDTH = 140;
const DESC_FONT_SIZE = 10;
const DESC_LINE_HEIGHT = 1.4;
const DESC_PADDING = 8;
const SEPARATOR_GAP = 4;
const MAX_DESC_LINES = 6;
const MAX_LABEL_LINES = 3;
const LABEL_LINE_HEIGHT = 1.3;
const LABEL_PAD = 12;

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
  /** Marker for renderer: draw with linear curve, not curveBasis (ELK gives
   * us orthogonal polylines and curveBasis would smooth corners into waves) */
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

function splitCamelCase(word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < word.length; i++) {
    // In-bounds by loop guard (i >= 1 and i < word.length).
    const prev = word.charAt(i - 1);
    const curr = word.charAt(i);
    const next = i + 1 < word.length ? word.charAt(i + 1) : '';
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

function estimateLabelLines(label: string, nodeWidth = NODE_WIDTH): number {
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
  const labelLines = estimateLabelLines(node.label, w);
  const labelHeight = labelLines * 13 * LABEL_LINE_HEIGHT + LABEL_PAD;
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

// ── ELK types (minimal) ────────────────────────────────────

interface ElkPoint {
  x: number;
  y: number;
}
interface ElkEdgeSection {
  id?: string;
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
}
interface ElkLayoutEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: ElkEdgeSection[];
  /** ELK marks the container whose local frame the section coords are in */
  container?: string;
}
interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: ElkLayoutEdge[];
  labels?: { text: string; width?: number; height?: number }[];
  layoutOptions?: Record<string, string>;
}

let elkInstance: InstanceType<typeof ELK> | null = null;
function getElk(): InstanceType<typeof ELK> {
  if (!elkInstance) elkInstance = new ELK();
  return elkInstance;
}

// ── ELK option variants ────────────────────────────────────

interface Variant {
  name: string;
  options: Record<string, string>;
}

function baseOptions(): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    // INCLUDE_CHILDREN lets ELK route edges across container boundaries.
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.unnecessaryBendpoints': 'true',
    // Let edges leave from top/bottom of nodes (not just the flow-direction
    // sides) when it reduces crossings.
    'elk.layered.allowNonFlowPortsToSwitchSides': 'true',
  };
}

function bkBaseline(): Record<string, string> {
  return {
    ...baseOptions(),
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.nodePlacement.bk.edgeStraightening': 'IMPROVE_STRAIGHTNESS',
    'elk.layered.compaction.connectedComponents': 'true',
    'elk.layered.spacing.nodeNodeBetweenLayers': '90',
    'elk.spacing.nodeNode': '55',
    'elk.spacing.edgeNode': '55',
    'elk.spacing.edgeEdge': '18',
  };
}

function getVariants(): Variant[] {
  const bk = bkBaseline();
  return [
    {
      name: 'bk-baseline',
      options: {
        ...bk,
        'elk.layered.crossingMinimization.greedySwitch.type': 'ONE_SIDED',
      },
    },
    {
      name: 'bk-aggressive',
      options: {
        ...bk,
        'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
        'elk.layered.thoroughness': '50',
      },
    },
    {
      name: 'bk-wide',
      options: {
        ...bk,
        'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
        'elk.layered.thoroughness': '50',
        'elk.spacing.nodeNode': '70',
        'elk.spacing.edgeNode': '75',
        'elk.spacing.edgeEdge': '22',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      },
    },
    {
      name: 'longest-path',
      options: {
        ...bk,
        'elk.layered.layering.strategy': 'LONGEST_PATH',
        'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
        'elk.layered.thoroughness': '50',
      },
    },
    {
      name: 'bounded-width',
      options: {
        ...bk,
        'elk.layered.layering.strategy': 'COFFMAN_GRAHAM',
        'elk.layered.layering.coffmanGraham.layerBound': '3',
        'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
        'elk.layered.thoroughness': '50',
      },
    },
  ];
}

// ── Crossing / quality counters ────────────────────────────

/**
 * Count visible edge crossings in a layout. Each pair of edge segments is
 * checked for proper intersection (interior, not endpoint-touch).
 * O((E × P)²) where P = avg points per edge. For E~30, P~5, ~22k pairs ≈ 1-3ms.
 */
function countCrossings(edges: BLLayoutEdge[]): number {
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    // In-bounds by loop guard.
    const edgeI = edges[i]!;
    const a = edgeI.points;
    if (a.length < 2) continue;
    for (let j = i + 1; j < edges.length; j++) {
      // In-bounds by loop guard.
      const edgeJ = edges[j]!;
      const b = edgeJ.points;
      if (b.length < 2) continue;
      // Skip edges that share an endpoint — they meet at a node, not a crossing
      if (edgeI.source === edgeJ.source) continue;
      if (edgeI.source === edgeJ.target) continue;
      if (edgeI.target === edgeJ.source) continue;
      if (edgeI.target === edgeJ.target) continue;
      for (let ai = 0; ai < a.length - 1; ai++) {
        for (let bi = 0; bi < b.length - 1; bi++) {
          // In-bounds by loop guard (ai < a.length - 1, bi < b.length - 1).
          if (segmentsCross(a[ai]!, a[ai + 1]!, b[bi]!, b[bi + 1]!)) count++;
        }
      }
    }
  }
  return count;
}

function segmentsCross(
  p1: ElkPoint,
  p2: ElkPoint,
  p3: ElkPoint,
  p4: ElkPoint
): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const s = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  const EPS = 0.001;
  return t > EPS && t < 1 - EPS && s > EPS && s < 1 - EPS;
}

function countTotalBends(edges: BLLayoutEdge[]): number {
  let bends = 0;
  for (const e of edges) bends += Math.max(0, e.points.length - 2);
  return bends;
}

interface LayoutScore {
  crossings: number;
  bends: number;
  area: number;
}

/** Up to this many crossings count as equivalent — among near-zero results,
 *  compactness decides. Prevents the optimizer picking a sprawling 0-crossing
 *  layout over a compact 1-crossing one. */
const CROSSINGS_FORGIVENESS = 1;

function scoreLayout(layout: BLLayoutResult): LayoutScore {
  return {
    crossings: countCrossings(layout.edges),
    bends: countTotalBends(layout.edges),
    area: layout.width * layout.height,
  };
}

function cmpScore(a: LayoutScore, b: LayoutScore): number {
  const aBucket = a.crossings <= CROSSINGS_FORGIVENESS ? 0 : a.crossings;
  const bBucket = b.crossings <= CROSSINGS_FORGIVENESS ? 0 : b.crossings;
  if (aBucket !== bBucket) return aBucket - bBucket;
  if (a.area !== b.area) return a.area - b.area;
  return a.bends - b.bends;
}

// ── Main layout ────────────────────────────────────────────

export async function layoutBoxesAndLines(
  parsed: ParsedBoxesAndLines,
  collapseInfo?: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: BLGroup[];
  },
  layoutOptions?: { hideDescriptions?: boolean }
): Promise<BLLayoutResult> {
  const hideDescriptions = layoutOptions?.hideDescriptions ?? false;
  const direction = parsed.direction === 'TB' ? 'DOWN' : 'RIGHT';

  // Determine which groups are collapsed (shown as plain nodes)
  const collapsedGroupLabels = new Set<string>();
  if (collapseInfo) {
    const missingGroups = new Set<string>();
    for (const og of collapseInfo.originalGroups) {
      if (!parsed.groups.some((g) => g.label === og.label)) {
        missingGroups.add(og.label);
      }
    }
    for (const label of missingGroups) {
      const og = collapseInfo.originalGroups.find((g) => g.label === label);
      const parentLabel = og?.parentGroup;
      if (!parentLabel || !missingGroups.has(parentLabel)) {
        collapsedGroupLabels.add(label);
      }
    }
  }

  // Compute node sizes with uniform-height pass for described nodes
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
  if (maxDescHeight > 0) {
    for (const node of parsed.nodes) {
      if (node.description && node.description.length > 0) {
        const size = nodeSizes.get(node.label)!;
        nodeSizes.set(node.label, { width: size.width, height: maxDescHeight });
      }
    }
  }

  // Build a fresh ELK graph each variant call — elk.layout() mutates the tree
  // setting x/y/sections, so we can't reuse it across trials.
  const expandedGroupSet = new Set(parsed.groups.map((g) => g.label));
  const gid = (label: string) => `__group_${label}`;

  function buildGraph(): { roots: ElkNode[]; rootEdges: ElkLayoutEdge[] } {
    const nodeById = new Map<string, ElkNode>();
    const parentOf = new Map<string, string>();

    for (const node of parsed.nodes) {
      const size = nodeSizes.get(node.label)!;
      nodeById.set(node.label, {
        id: node.label,
        width: size.width,
        height: size.height,
        labels: [{ text: node.label }],
      });
    }

    for (const group of parsed.groups) {
      nodeById.set(gid(group.label), {
        id: gid(group.label),
        labels: [{ text: group.label }],
        layoutOptions: {
          'elk.padding': `[top=${CONTAINER_PAD_TOP},left=${CONTAINER_PAD_X},bottom=${CONTAINER_PAD_BOTTOM},right=${CONTAINER_PAD_X}]`,
          // Suggest square-ish containers — has limited effect with
          // INCLUDE_CHILDREN but doesn't hurt.
          'elk.aspectRatio': '1.4',
        },
        children: [],
        edges: [],
      });
    }

    for (const label of collapsedGroupLabels) {
      nodeById.set(gid(label), {
        id: gid(label),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        labels: [{ text: label }],
      });
    }

    for (const group of parsed.groups) {
      if (group.parentGroup && nodeById.has(gid(group.parentGroup))) {
        parentOf.set(gid(group.label), gid(group.parentGroup));
      }
    }
    if (collapseInfo) {
      for (const label of collapsedGroupLabels) {
        const og = collapseInfo.originalGroups.find((g) => g.label === label);
        if (
          og?.parentGroup &&
          !collapsedGroupLabels.has(og.parentGroup) &&
          nodeById.has(gid(og.parentGroup))
        ) {
          parentOf.set(gid(label), gid(og.parentGroup));
        }
      }
    }
    for (const group of parsed.groups) {
      for (const child of group.children) {
        if (expandedGroupSet.has(child)) continue;
        if (nodeById.has(child)) {
          parentOf.set(child, gid(group.label));
        }
      }
    }

    const roots: ElkNode[] = [];
    for (const [id, node] of nodeById) {
      const parentId = parentOf.get(id);
      if (parentId) {
        const parent = nodeById.get(parentId)!;
        parent.children = parent.children ?? [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const rootEdges: ElkLayoutEdge[] = [];
    for (let i = 0; i < parsed.edges.length; i++) {
      // In-bounds by loop guard.
      const edge = parsed.edges[i]!;
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
      rootEdges.push({
        id: `e${i}`,
        sources: [edge.source],
        targets: [edge.target],
      });
    }

    return { roots, rootEdges };
  }

  async function runVariant(variant: Variant): Promise<BLLayoutResult> {
    const { roots, rootEdges } = buildGraph();
    const elkRoot: ElkNode = {
      id: 'root',
      layoutOptions: {
        ...variant.options,
        'elk.direction': direction,
        'elk.padding': `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
      },
      children: roots,
      edges: rootEdges,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await getElk().layout(elkRoot as any)) as ElkNode;
    return extractLayout(result);
  }

  function extractLayout(result: ElkNode): BLLayoutResult {
    const layoutNodes: BLLayoutNode[] = [];
    const layoutGroups: BLLayoutGroup[] = [];
    const allEdges: ElkLayoutEdge[] = [];
    const containerAbs = new Map<string, { x: number; y: number }>();

    function walk(
      n: ElkNode,
      offsetX: number,
      offsetY: number,
      isRoot: boolean
    ): void {
      const nx = (n.x ?? 0) + offsetX;
      const ny = (n.y ?? 0) + offsetY;
      const nw = n.width ?? 0;
      const nh = n.height ?? 0;

      if (isRoot) {
        containerAbs.set('root', { x: nx, y: ny });
      } else {
        const isGroup = n.id.startsWith('__group_');
        if (isGroup) {
          const label = n.id.slice('__group_'.length);
          const collapsed = collapsedGroupLabels.has(label);
          const og = collapseInfo?.originalGroups.find(
            (g) => g.label === label
          );
          const pg = parsed.groups.find((g) => g.label === label);
          const childCount = collapsed
            ? (collapseInfo?.collapsedChildCounts.get(label) ?? 0)
            : undefined;
          layoutGroups.push({
            label,
            lineNumber: pg?.lineNumber ?? og?.lineNumber ?? 0,
            x: nx + nw / 2,
            y: ny + nh / 2,
            width: nw,
            height: nh,
            collapsed,
            ...(childCount !== undefined && { childCount }),
          });
          if (!collapsed) containerAbs.set(n.id, { x: nx, y: ny });
        } else {
          layoutNodes.push({
            label: n.id,
            x: nx + nw / 2,
            y: ny + nh / 2,
            width: nw,
            height: nh,
          });
        }
      }

      if (n.edges) for (const e of n.edges) allEdges.push(e);
      if (n.children) for (const c of n.children) walk(c, nx, ny, false);
    }
    walk(result, 0, 0, true);

    // Parallel edge offsets
    const edgeYOffsets: number[] = new Array(parsed.edges.length).fill(0);
    const edgeParallelCounts: number[] = new Array(parsed.edges.length).fill(1);
    const parallelGroups = new Map<string, number[]>();
    for (let i = 0; i < parsed.edges.length; i++) {
      // In-bounds by loop guard.
      const edge = parsed.edges[i]!;
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
      for (let j = 0; j < capped.length; j++) {
        // In-bounds by loop guard.
        const cappedJ = capped[j]!;
        edgeYOffsets[cappedJ] =
          (j - (capped.length - 1) / 2) * PARALLEL_SPACING;
        edgeParallelCounts[cappedJ] = capped.length;
      }
    }

    const edgeById = new Map<string, ElkLayoutEdge>();
    for (const e of allEdges) edgeById.set(e.id, e);

    const layoutEdges: BLLayoutEdge[] = [];
    for (let i = 0; i < parsed.edges.length; i++) {
      // In-bounds by loop guard.
      const edge = parsed.edges[i]!;
      if (edgeParallelCounts[i] === 0) continue;
      const elkEdge = edgeById.get(`e${i}`);
      if (!elkEdge?.sections || elkEdge.sections.length === 0) continue;
      const container = elkEdge.container ?? 'root';
      const off = containerAbs.get(container) ?? { x: 0, y: 0 };
      // In-bounds — length check above guarantees sections[0] exists.
      const s = elkEdge.sections[0]!;
      const points = [
        { x: s.startPoint.x + off.x, y: s.startPoint.y + off.y },
        ...(s.bendPoints ?? []).map((p) => ({
          x: p.x + off.x,
          y: p.y + off.y,
        })),
        { x: s.endPoint.x + off.x, y: s.endPoint.y + off.y },
      ];
      let labelX: number | undefined;
      let labelY: number | undefined;
      if (edge.label && points.length >= 2) {
        const mid = Math.floor(points.length / 2);
        // In-bounds — mid < points.length guaranteed by length >= 2 check.
        const midPoint = points[mid]!;
        labelX = midPoint.x;
        labelY = midPoint.y - 10;
      }
      layoutEdges.push({
        source: edge.source,
        target: edge.target,
        ...(edge.label !== undefined && { label: edge.label }),
        bidirectional: edge.bidirectional,
        lineNumber: edge.lineNumber,
        points,
        ...(labelX !== undefined && { labelX }),
        ...(labelY !== undefined && { labelY }),
        // In-bounds — i < parsed.edges.length, arrays sized to that length.
        yOffset: edgeYOffsets[i]!,
        parallelCount: edgeParallelCounts[i]!,
        metadata: edge.metadata,
        deferred: true,
      });
    }

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

  // Trivial graphs skip multi-trial — one variant is plenty.
  const N = parsed.nodes.length + parsed.groups.length;
  const E = parsed.edges.length;
  const trivial = N < 8 && E < 10;
  // In-bounds — getVariants() returns 5 variants, index 1 always exists.
  const variants = trivial ? [getVariants()[1]!] : getVariants();

  const results = await Promise.all(variants.map((v) => runVariant(v)));

  // In-bounds — variants is non-empty (trivial branch has 1, normal has 5).
  let best = results[0]!;
  let bestScore = scoreLayout(best);
  for (let i = 1; i < results.length; i++) {
    // In-bounds by loop guard.
    const resultI = results[i]!;
    const s = scoreLayout(resultI);
    if (cmpScore(s, bestScore) < 0) {
      best = resultI;
      bestScore = s;
    }
  }
  return best;
}
