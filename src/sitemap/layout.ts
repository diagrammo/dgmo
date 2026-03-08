// ============================================================
// Sitemap Diagram Layout Engine (Dagre flat graph)
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedSitemap, SitemapNode, SitemapEdge } from './types';
import type { TagGroup } from '../utils/tag-groups';
import { resolveTagColor, injectDefaultTagMetadata } from '../utils/tag-groups';

// ============================================================
// Types
// ============================================================

export interface SitemapLayoutNode {
  id: string;
  label: string;
  metadata: Record<string, string>;
  /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
  tagMetadata: Record<string, string>;
  isContainer: boolean;
  lineNumber: number;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Count of hidden descendants when collapsed */
  hiddenCount?: number;
  /** True if node has children (expanded or collapsed) — drives toggle UI */
  hasChildren?: boolean;
}

export interface SitemapLayoutEdge {
  sourceId: string;
  targetId: string;
  points: { x: number; y: number }[];
  label?: string;
  color?: string;
  lineNumber: number;
}

export interface SitemapContainerBounds {
  nodeId: string;
  label: string;
  lineNumber: number;
  color?: string;
  metadata: Record<string, string>;
  /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
  tagMetadata: Record<string, string>;
  x: number;
  y: number;
  width: number;
  height: number;
  labelHeight: number;
  /** Count of hidden descendants when collapsed */
  hiddenCount?: number;
  /** True if container has children (expanded or collapsed) */
  hasChildren?: boolean;
}

export interface SitemapLegendEntry {
  value: string;
  color: string;
}

export interface SitemapLegendGroup {
  name: string;
  alias?: string;
  entries: SitemapLegendEntry[];
  x: number;
  y: number;
  width: number;
  height: number;
  minifiedWidth: number;
  minifiedHeight: number;
}

export interface SitemapLayoutResult {
  nodes: SitemapLayoutNode[];
  edges: SitemapLayoutEdge[];
  containers: SitemapContainerBounds[];
  legend: SitemapLegendGroup[];
  width: number;
  height: number;
}

// ============================================================
// Constants
// ============================================================

const CHAR_WIDTH = 7.5;
const LABEL_FONT_SIZE = 13;
const META_FONT_SIZE = 11;
const META_LINE_HEIGHT = 16;
const HEADER_HEIGHT = 28;
const SEPARATOR_GAP = 6;
const CARD_H_PAD = 20;
const CARD_V_PAD = 10;
const MIN_CARD_WIDTH = 140;
const MARGIN = 40;
const CONTAINER_PAD_X = 24;
const CONTAINER_PAD_TOP = 40;
const CONTAINER_PAD_BOTTOM = 24;
const CONTAINER_LABEL_HEIGHT = 28;
const CONTAINER_META_LINE_HEIGHT = 16;

// Legend (kanban-style pills)
const LEGEND_GAP = 30;
const LEGEND_HEIGHT = 28;
const LEGEND_PILL_PAD = 16;
const LEGEND_PILL_FONT_W = 11 * 0.6;
const LEGEND_CAPSULE_PAD = 4;
const LEGEND_DOT_R = 4;
const LEGEND_ENTRY_FONT_W = 10 * 0.6;
const LEGEND_ENTRY_DOT_GAP = 4;
const LEGEND_ENTRY_TRAIL = 8;
const LEGEND_GROUP_GAP = 12;
const LEGEND_EYE_SIZE = 14;
const LEGEND_EYE_GAP = 6;

// ============================================================
// Helpers
// ============================================================

function filterMetadata(
  metadata: Record<string, string>,
  hiddenAttributes?: Set<string>,
): Record<string, string> {
  if (!hiddenAttributes || hiddenAttributes.size === 0) return metadata;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!hiddenAttributes.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function computeCardWidth(label: string, meta: Record<string, string>): number {
  let maxChars = label.length;
  for (const [key, value] of Object.entries(meta)) {
    const lineChars = key.length + 2 + value.length;
    if (lineChars > maxChars) maxChars = lineChars;
  }
  return Math.max(MIN_CARD_WIDTH, Math.ceil(maxChars * CHAR_WIDTH) + CARD_H_PAD * 2);
}

function computeCardHeight(meta: Record<string, string>): number {
  const metaCount = Object.keys(meta).length;
  if (metaCount === 0) return HEADER_HEIGHT + CARD_V_PAD;
  return HEADER_HEIGHT + SEPARATOR_GAP + metaCount * META_LINE_HEIGHT + CARD_V_PAD;
}

function resolveNodeColor(
  node: SitemapNode,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
): string | undefined {
  if (node.color) return node.color;
  return resolveTagColor(node.metadata, tagGroups, activeGroupName, node.isContainer);
}

const OVERLAP_GAP = 20;

function countDescendantNodes(node: SitemapNode, hiddenCounts?: Map<string, number>): number {
  let count = 0;
  for (const child of node.children) {
    count += (child.isContainer ? 0 : 1) + countDescendantNodes(child, hiddenCounts);
    const hc = hiddenCounts?.get(child.id);
    if (hc) count += hc;
  }
  return count;
}

// ============================================================
// Legend
// ============================================================

function computeLegendGroups(
  tagGroups: TagGroup[],
  usedValuesByGroup?: Map<string, Set<string>>,
): SitemapLegendGroup[] {
  const groups: SitemapLegendGroup[] = [];

  for (const group of tagGroups) {
    if (group.entries.length === 0) continue;

    const usedValues = usedValuesByGroup?.get(group.name.toLowerCase());
    const visibleEntries = usedValues
      ? group.entries.filter((e) => usedValues.has(e.value.toLowerCase()))
      : group.entries;
    if (visibleEntries.length === 0) continue;

    const pillWidth = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
    const minPillWidth = pillWidth;

    let entriesWidth = 0;
    for (const entry of visibleEntries) {
      entriesWidth +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        entry.value.length * LEGEND_ENTRY_FONT_W +
        LEGEND_ENTRY_TRAIL;
    }
    const eyeSpace = LEGEND_EYE_SIZE + LEGEND_EYE_GAP;
    const capsuleWidth = LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + eyeSpace + entriesWidth;

    groups.push({
      name: group.name,
      alias: group.alias,
      entries: visibleEntries.map((e) => ({ value: e.value, color: e.color })),
      x: 0,
      y: 0,
      width: capsuleWidth,
      height: LEGEND_HEIGHT,
      minifiedWidth: minPillWidth,
      minifiedHeight: LEGEND_HEIGHT,
    });
  }

  return groups;
}

// ============================================================
// Flatten tree into page-node and container lists
// ============================================================

interface FlatNode {
  sitemapNode: SitemapNode;
  parentContainerId: string | null;
  /** Nearest ancestor that is a page (not container) — used for invisible hierarchy edges */
  parentPageId: string | null;
  meta: Record<string, string>;
  /** Original (unfiltered) metadata — used for tag coloring/hover even when hidden */
  fullMeta: Record<string, string>;
  width: number;
  height: number;
}

function flattenNodes(
  nodes: SitemapNode[],
  parentContainerId: string | null,
  parentPageId: string | null,
  hiddenCounts: Map<string, number> | undefined,
  hiddenAttributes: Set<string> | undefined,
  result: FlatNode[],
): void {
  for (const node of nodes) {
    const meta = filterMetadata(node.metadata, hiddenAttributes);
    if (node.isContainer) {
      // Container gets added as a flat entry (not added to dagre — bounds computed post-hoc)
      const metaCount = Object.keys(meta).length;
      const labelHeight = CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
      result.push({
        sitemapNode: node,
        parentContainerId,
        parentPageId,
        meta,
        fullMeta: { ...node.metadata },
        width: Math.max(MIN_CARD_WIDTH, node.label.length * CHAR_WIDTH + CARD_H_PAD * 2),
        height: labelHeight + CONTAINER_PAD_BOTTOM,
      });
      // Recurse into children — container becomes parent container, parentPageId stays the same
      flattenNodes(node.children, node.id, parentPageId, hiddenCounts, hiddenAttributes, result);
    } else {
      result.push({
        sitemapNode: node,
        parentContainerId,
        parentPageId,
        meta,
        fullMeta: { ...node.metadata },
        width: computeCardWidth(node.label, meta),
        height: computeCardHeight(meta),
      });
      // Pages can have children too (nested pages) — this page becomes the parentPageId
      if (node.children.length > 0) {
        flattenNodes(node.children, parentContainerId, node.id, hiddenCounts, hiddenAttributes, result);
      }
    }
  }
}

// ============================================================
// Layout
// ============================================================

export function layoutSitemap(
  parsed: ParsedSitemap,
  hiddenCounts?: Map<string, number>,
  activeTagGroup?: string | null,
  hiddenAttributes?: Set<string>,
  expandAllLegend?: boolean,
): SitemapLayoutResult {
  if (parsed.roots.length === 0) {
    return { nodes: [], edges: [], containers: [], legend: [], width: 0, height: 0 };
  }

  // Inject default tag metadata
  const allNodes: SitemapNode[] = [];
  const collect = (node: SitemapNode) => {
    allNodes.push(node);
    for (const child of node.children) collect(child);
  };
  for (const root of parsed.roots) collect(root);
  injectDefaultTagMetadata(allNodes, parsed.tagGroups, (e) => (e as SitemapNode).isContainer);

  // Flatten hierarchy
  const flatNodes: FlatNode[] = [];
  flattenNodes(parsed.roots, null, null, hiddenCounts, hiddenAttributes, flatNodes);

  // Build nodeMap for lookups
  const nodeMap = new Map<string, FlatNode>();
  for (const flat of flatNodes) {
    nodeMap.set(flat.sitemapNode.id, flat);
  }

  // Build compound dagre graph — containers use setParent() for clean grouping.
  // Collapsed containers (no children) are added as regular nodes.
  // Multigraph: collapsed edges can produce multiple edges between the same pair
  // (e.g. Dashboard→Account for both "settings" and "billing").
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: parsed.direction,
    nodesep: 50,
    ranksep: 60,
    edgesep: 30,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const containerIds = new Set<string>();
  const pageNodeIds = new Set<string>();
  const collapsedContainerIds = new Set<string>();

  // Identify containers vs pages, and detect collapsed (empty) containers
  for (const flat of flatNodes) {
    if (flat.sitemapNode.isContainer) {
      containerIds.add(flat.sitemapNode.id);
      // A container is "collapsed" if it has no children at all in the flat list
      const hasAnyChild = flatNodes.some(
        (f) => f.parentContainerId === flat.sitemapNode.id,
      );
      if (!hasAnyChild) {
        collapsedContainerIds.add(flat.sitemapNode.id);
      }
    } else {
      pageNodeIds.add(flat.sitemapNode.id);
    }
  }

  // Add nodes to dagre
  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    if (node.isContainer) {
      if (collapsedContainerIds.has(node.id)) {
        // Collapsed container — regular node with explicit dimensions
        g.setNode(node.id, {
          label: node.label,
          width: flat.width,
          height: flat.height,
        });
      } else {
        // Regular container — compound node with padding for child layout
        g.setNode(node.id, {
          label: node.label,
          paddingLeft: CONTAINER_PAD_X,
          paddingRight: CONTAINER_PAD_X,
          paddingTop: CONTAINER_PAD_TOP,
          paddingBottom: CONTAINER_PAD_BOTTOM,
        });
      }
    } else {
      g.setNode(node.id, {
        label: node.label,
        width: flat.width,
        height: flat.height,
      });
    }
  }

  // Set parent relationships — dagre compound nesting keeps nodes grouped
  for (const flat of flatNodes) {
    if (flat.parentContainerId && !collapsedContainerIds.has(flat.parentContainerId)) {
      g.setParent(flat.sitemapNode.id, flat.parentContainerId);
    }
  }

  // Add user edges (named for multigraph — each edge gets unique routing)
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    if (g.hasNode(edge.sourceId) && g.hasNode(edge.targetId)) {
      g.setEdge(edge.sourceId, edge.targetId, {
        label: edge.label ?? '',
        minlen: 1,
      }, `e${i}`);
    }
  }

  // Run dagre layout
  dagre.layout(g);

  // Extract layout results — all positions from dagre
  const layoutNodes: SitemapLayoutNode[] = [];
  const layoutContainers: SitemapContainerBounds[] = [];

  // Page nodes
  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    if (node.isContainer) continue;
    const pos = g.node(node.id);
    if (!pos) continue;

    const hc = hiddenCounts?.get(node.id);
    layoutNodes.push({
      id: node.id,
      label: node.label,
      metadata: flat.meta,
      tagMetadata: flat.fullMeta,
      isContainer: false,
      lineNumber: node.lineNumber,
      color: resolveNodeColor(node, parsed.tagGroups, activeTagGroup ?? null),
      x: pos.x,
      y: pos.y - pos.height / 2,
      width: pos.width,
      height: pos.height,
      hiddenCount: hc,
      hasChildren:
        (node.children.length > 0 || (hc != null && hc > 0)) || undefined,
    });
  }

  // Containers — bounds from dagre compound layout
  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    if (!node.isContainer) continue;

    const pos = g.node(node.id);
    const hc = hiddenCounts?.get(node.id);
    const metaCount = Object.keys(flat.meta).length;
    const labelHeight = CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;

    if (pos) {
      layoutContainers.push({
        nodeId: node.id,
        label: node.label,
        lineNumber: node.lineNumber,
        color: resolveNodeColor(node, parsed.tagGroups, activeTagGroup ?? null),
        metadata: flat.meta,
        tagMetadata: flat.fullMeta,
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2,
        width: pos.width,
        height: pos.height,
        labelHeight,
        hiddenCount: hc,
        hasChildren:
          (node.children.length > 0 || (hc != null && hc > 0)) || undefined,
      });
    } else {
      // Fallback
      layoutContainers.push({
        nodeId: node.id,
        label: node.label,
        lineNumber: node.lineNumber,
        color: resolveNodeColor(node, parsed.tagGroups, activeTagGroup ?? null),
        metadata: flat.meta,
        tagMetadata: flat.fullMeta,
        x: MARGIN,
        y: MARGIN,
        width: flat.width,
        height: labelHeight + CONTAINER_PAD_BOTTOM,
        labelHeight,
        hiddenCount: hc,
        hasChildren:
          (node.children.length > 0 || (hc != null && hc > 0)) || undefined,
      });
    }
  }

  // Edge waypoints from dagre (named edges for multigraph)
  const layoutEdges: SitemapLayoutEdge[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    const edge = parsed.edges[i];
    if (!g.hasNode(edge.sourceId) || !g.hasNode(edge.targetId)) continue;
    const edgeData = g.edge({ v: edge.sourceId, w: edge.targetId, name: `e${i}` });
    if (!edgeData) continue;

    layoutEdges.push({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      points: edgeData.points ?? [],
      label: edge.label,
      color: edge.color,
      lineNumber: edge.lineNumber,
    });
  }

  // === Isolated subgraph separation ===
  // Disconnected subgraphs (like Admin with no edges to main content) get pushed
  // below the main content so they don't compete for top-level positioning.
  {
    // Union-find on page nodes + collapsed containers using user edges
    const allNodeIds = new Set([...pageNodeIds, ...collapsedContainerIds]);
    const ufParent = new Map<string, string>();
    for (const id of allNodeIds) ufParent.set(id, id);
    const ufFind = (x: string): string => {
      while (ufParent.get(x) !== x) {
        ufParent.set(x, ufParent.get(ufParent.get(x)!)!);
        x = ufParent.get(x)!;
      }
      return x;
    };
    const ufUnion = (a: string, b: string): void => {
      const ra = ufFind(a);
      const rb = ufFind(b);
      if (ra !== rb) ufParent.set(ra, rb);
    };
    for (const edge of parsed.edges) {
      if (allNodeIds.has(edge.sourceId) && allNodeIds.has(edge.targetId)) {
        ufUnion(edge.sourceId, edge.targetId);
      }
    }

    // Main component = component containing the first root page
    const firstRootPage = flatNodes.find((f) => !f.sitemapNode.isContainer)?.sitemapNode.id;
    const mainRoot = firstRootPage ? ufFind(firstRootPage) : null;

    // Collect isolated node IDs (not in main component)
    const isolatedNodeIds = new Set<string>();
    for (const id of allNodeIds) {
      if (mainRoot && ufFind(id) !== mainRoot) {
        isolatedNodeIds.add(id);
      }
    }

    // Identify isolated containers (all page descendants are isolated)
    const isolatedContainerIds = new Set<string>();
    for (const cid of containerIds) {
      if (collapsedContainerIds.has(cid)) {
        if (isolatedNodeIds.has(cid)) isolatedContainerIds.add(cid);
        continue;
      }
      const members = flatNodes.filter(
        (f) => !f.sitemapNode.isContainer && f.parentContainerId === cid,
      );
      if (
        members.length > 0 &&
        members.every((m) => isolatedNodeIds.has(m.sitemapNode.id))
      ) {
        isolatedContainerIds.add(cid);
      }
    }

    if (isolatedNodeIds.size > 0) {
      const isVertical = parsed.direction === 'TB';

      // Place isolated subgraphs BESIDE the main content (right for TB, below for LR)
      // instead of extending the diagram in the primary axis. This keeps the diagram
      // compact and allows better zoom.

      // Main content bounding box
      let mainRight = 0;
      let mainBottom = 0;
      let mainTop = Infinity;
      let mainLeft = Infinity;
      for (const n of layoutNodes) {
        if (!isolatedNodeIds.has(n.id)) {
          mainRight = Math.max(mainRight, n.x + n.width / 2);
          mainBottom = Math.max(mainBottom, n.y + n.height);
          mainTop = Math.min(mainTop, n.y);
          mainLeft = Math.min(mainLeft, n.x - n.width / 2);
        }
      }
      for (const c of layoutContainers) {
        if (!isolatedContainerIds.has(c.nodeId)) {
          mainRight = Math.max(mainRight, c.x + c.width);
          mainBottom = Math.max(mainBottom, c.y + c.height);
          mainTop = Math.min(mainTop, c.y);
          mainLeft = Math.min(mainLeft, c.x);
        }
      }

      // Isolated content bounding box
      let isoLeft = Infinity;
      let isoTop = Infinity;
      let isoRight = 0;
      let isoBottom = 0;
      for (const n of layoutNodes) {
        if (isolatedNodeIds.has(n.id)) {
          isoLeft = Math.min(isoLeft, n.x - n.width / 2);
          isoTop = Math.min(isoTop, n.y);
          isoRight = Math.max(isoRight, n.x + n.width / 2);
          isoBottom = Math.max(isoBottom, n.y + n.height);
        }
      }
      for (const c of layoutContainers) {
        if (isolatedContainerIds.has(c.nodeId)) {
          isoLeft = Math.min(isoLeft, c.x);
          isoTop = Math.min(isoTop, c.y);
          isoRight = Math.max(isoRight, c.x + c.width);
          isoBottom = Math.max(isoBottom, c.y + c.height);
        }
      }

      if (isoLeft !== Infinity) {
        // TB: place isolated to the RIGHT, aligned to top of main content
        // LR: place isolated BELOW, aligned to left of main content
        const gap = OVERLAP_GAP * 2;
        let shiftX: number;
        let shiftY: number;

        if (isVertical) {
          shiftX = mainRight + gap - isoLeft;
          shiftY = (mainTop === Infinity ? 0 : mainTop) - isoTop;
        } else {
          shiftX = (mainLeft === Infinity ? 0 : mainLeft) - isoLeft;
          shiftY = mainBottom + gap - isoTop;
        }

        if (shiftX !== 0 || shiftY !== 0) {
          for (const n of layoutNodes) {
            if (isolatedNodeIds.has(n.id)) {
              n.x += shiftX;
              n.y += shiftY;
            }
          }
          for (const c of layoutContainers) {
            if (isolatedContainerIds.has(c.nodeId)) {
              c.x += shiftX;
              c.y += shiftY;
            }
          }
          for (const e of layoutEdges) {
            const srcIsolated = isolatedNodeIds.has(e.sourceId);
            const tgtIsolated = isolatedNodeIds.has(e.targetId);
            if (srcIsolated || tgtIsolated) {
              for (const p of e.points) {
                p.x += shiftX;
                p.y += shiftY;
              }
            }
          }
        }
      }
    }
  }

  // Compute bounding box
  let totalWidth = 0;
  let totalHeight = 0;

  for (const node of layoutNodes) {
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  for (const c of layoutContainers) {
    const right = c.x + c.width;
    const bottom = c.y + c.height;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  // Include edge points in bounding box
  for (const edge of layoutEdges) {
    for (const p of edge.points) {
      if (p.x > totalWidth) totalWidth = p.x;
      if (p.y > totalHeight) totalHeight = p.y;
    }
  }

  totalWidth += MARGIN;
  totalHeight += MARGIN;

  // Collect used tag values
  const usedValuesByGroup = new Map<string, Set<string>>();
  for (const group of parsed.tagGroups) {
    const key = group.name.toLowerCase();
    const used = new Set<string>();
    const walk = (node: SitemapNode) => {
      if (!node.isContainer && node.metadata[key]) {
        used.add(node.metadata[key].toLowerCase());
      }
      for (const child of node.children) walk(child);
    };
    for (const root of parsed.roots) walk(root);
    usedValuesByGroup.set(key, used);
  }

  // Legend
  const legendGroups = computeLegendGroups(parsed.tagGroups, usedValuesByGroup);

  const visibleGroups = activeTagGroup != null
    ? legendGroups.filter((g) => g.name.toLowerCase() === activeTagGroup.toLowerCase())
    : legendGroups;
  const allExpanded = expandAllLegend && activeTagGroup == null;
  const effectiveW = (g: SitemapLegendGroup) =>
    activeTagGroup != null || allExpanded ? g.width : g.minifiedWidth;

  if (visibleGroups.length > 0) {
    // Top position: horizontal row above chart
    const legendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP;

    // Push chart content down
    for (const n of layoutNodes) n.y += legendShift;
    for (const c of layoutContainers) c.y += legendShift;
    for (const e of layoutEdges) {
      for (const p of e.points) p.y += legendShift;
    }

    const totalGroupsWidth =
      visibleGroups.reduce((s, g) => s + effectiveW(g), 0) +
      (visibleGroups.length - 1) * LEGEND_GROUP_GAP;

    let cx = MARGIN;
    for (const g of visibleGroups) {
      g.x = cx;
      g.y = MARGIN;
      cx += effectiveW(g) + LEGEND_GROUP_GAP;
    }

    totalHeight += legendShift;
    const neededWidth = totalGroupsWidth + MARGIN * 2;
    if (neededWidth > totalWidth) {
      totalWidth = neededWidth;
    }
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    containers: layoutContainers,
    legend: legendGroups,
    width: totalWidth,
    height: totalHeight,
  };
}
