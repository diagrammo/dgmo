// ============================================================
// Sitemap Diagram Layout Engine (Dagre compound graph)
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
  meta: Record<string, string>;
  /** Original (unfiltered) metadata — used for tag coloring/hover even when hidden */
  fullMeta: Record<string, string>;
  width: number;
  height: number;
}

function flattenNodes(
  nodes: SitemapNode[],
  parentContainerId: string | null,
  hiddenCounts: Map<string, number> | undefined,
  hiddenAttributes: Set<string> | undefined,
  result: FlatNode[],
): void {
  for (const node of nodes) {
    const meta = filterMetadata(node.metadata, hiddenAttributes);
    if (node.isContainer) {
      // Container gets added as a flat entry with minimal dims (dagre compound handles sizing)
      const metaCount = Object.keys(meta).length;
      const labelHeight = CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
      result.push({
        sitemapNode: node,
        parentContainerId,
        meta,
        fullMeta: { ...node.metadata },
        width: Math.max(MIN_CARD_WIDTH, node.label.length * CHAR_WIDTH + CARD_H_PAD * 2),
        height: labelHeight + CONTAINER_PAD_BOTTOM,
      });
      // Recurse into children with this container as parent
      flattenNodes(node.children, node.id, hiddenCounts, hiddenAttributes, result);
    } else {
      result.push({
        sitemapNode: node,
        parentContainerId,
        meta,
        fullMeta: { ...node.metadata },
        width: computeCardWidth(node.label, meta),
        height: computeCardHeight(meta),
      });
      // Pages can have children too (nested pages)
      if (node.children.length > 0) {
        flattenNodes(node.children, parentContainerId, hiddenCounts, hiddenAttributes, result);
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
  flattenNodes(parsed.roots, null, hiddenCounts, hiddenAttributes, flatNodes);

  // Build dagre compound graph
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: parsed.direction,
    nodesep: 40,
    ranksep: 60,
    edgesep: 20,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Separate containers from page nodes
  const containerIds = new Set<string>();
  const pageNodeIds = new Set<string>();

  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    if (node.isContainer) {
      containerIds.add(node.id);
      // Container: set as dagre node with padding for children
      g.setNode(node.id, {
        label: node.label,
        width: flat.width,
        height: flat.height,
        clusterLabelPos: 'top',
        paddingTop: CONTAINER_PAD_TOP,
        paddingBottom: CONTAINER_PAD_BOTTOM,
        paddingLeft: CONTAINER_PAD_X,
        paddingRight: CONTAINER_PAD_X,
      });
      if (flat.parentContainerId && containerIds.has(flat.parentContainerId)) {
        g.setParent(node.id, flat.parentContainerId);
      }
    } else {
      pageNodeIds.add(node.id);
      g.setNode(node.id, {
        label: node.label,
        width: flat.width,
        height: flat.height,
      });
      if (flat.parentContainerId && containerIds.has(flat.parentContainerId)) {
        g.setParent(node.id, flat.parentContainerId);
      }
    }
  }

  // Add edges
  for (const edge of parsed.edges) {
    // Only add edges for nodes that exist in the graph
    if (g.hasNode(edge.sourceId) && g.hasNode(edge.targetId)) {
      g.setEdge(edge.sourceId, edge.targetId, {
        label: edge.label ?? '',
        minlen: 1,
      });
    }
  }

  // Run dagre layout
  dagre.layout(g);

  // Extract layout results
  const layoutNodes: SitemapLayoutNode[] = [];
  const layoutContainers: SitemapContainerBounds[] = [];
  const nodeMap = new Map<string, FlatNode>();
  for (const flat of flatNodes) {
    nodeMap.set(flat.sitemapNode.id, flat);
  }

  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    const pos = g.node(node.id);
    if (!pos) continue;

    // dagre positions are center-based
    const x = pos.x;
    const y = pos.y;
    const w = pos.width;
    const h = pos.height;
    const hc = hiddenCounts?.get(node.id);

    if (node.isContainer) {
      const metaCount = Object.keys(flat.meta).length;
      const labelHeight = CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
      layoutContainers.push({
        nodeId: node.id,
        label: node.label,
        lineNumber: node.lineNumber,
        color: resolveNodeColor(node, parsed.tagGroups, activeTagGroup ?? null),
        metadata: flat.meta,
        tagMetadata: flat.fullMeta,
        x: x - w / 2,
        y: y - h / 2,
        width: w,
        height: h,
        labelHeight,
        hiddenCount: hc,
        hasChildren:
          (node.children.length > 0 || (hc != null && hc > 0)) || undefined,
      });
    } else {
      layoutNodes.push({
        id: node.id,
        label: node.label,
        metadata: flat.meta,
        tagMetadata: flat.fullMeta,
        isContainer: false,
        lineNumber: node.lineNumber,
        color: resolveNodeColor(node, parsed.tagGroups, activeTagGroup ?? null),
        x,
        y: y - h / 2,
        width: w,
        height: h,
        hiddenCount: hc,
        hasChildren:
          (node.children.length > 0 || (hc != null && hc > 0)) || undefined,
      });
    }
  }

  // Extract edge waypoints
  const layoutEdges: SitemapLayoutEdge[] = [];
  for (const edge of parsed.edges) {
    if (!g.hasNode(edge.sourceId) || !g.hasNode(edge.targetId)) continue;
    const edgeData = g.edge(edge.sourceId, edge.targetId);
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
