// ============================================================
// Sitemap Diagram Layout Engine (Dagre flat graph)
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import dagre from '@dagrejs/dagre';
import type { Writable } from '../utils/brand';
import type { ParsedSitemap, SitemapNode } from './types';
import type { TagGroup } from '../utils/tag-groups';
import { resolveTagColor, injectDefaultTagMetadata } from '../utils/tag-groups';
import {
  LEGEND_PILL_FONT_SIZE,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  LEGEND_EYE_SIZE,
  LEGEND_EYE_GAP,
  measureLegendText,
} from '../utils/legend-constants';
import { measureText } from '../utils/text-measure';

// Font sizes — must match the renderer (renderer.ts) so card sizing here
// agrees pixel-for-pixel with what gets drawn.
const LABEL_FONT_SIZE = 13;
const META_FONT_SIZE = 11;
const CONTAINER_LABEL_FONT_SIZE = 13;

// ============================================================
// Types
// ============================================================

export interface SitemapLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
  readonly tagMetadata: Readonly<Record<string, string>>;
  readonly description?: readonly string[];
  readonly isContainer: boolean;
  readonly lineNumber: number;
  readonly color?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Count of hidden descendants when collapsed */
  readonly hiddenCount?: number;
  /** True if node has children (expanded or collapsed) — drives toggle UI */
  readonly hasChildren?: boolean;
}

export interface SitemapLayoutEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly label?: string;
  readonly lineNumber: number;
  /** True for edges deferred from dagre (container endpoints) — use linear curve */
  readonly deferred?: boolean;
}

export interface SitemapContainerBounds {
  readonly nodeId: string;
  readonly label: string;
  readonly lineNumber: number;
  readonly color?: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
  readonly tagMetadata: Readonly<Record<string, string>>;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly labelHeight: number;
  /** Count of hidden descendants when collapsed */
  readonly hiddenCount?: number;
  /** True if container has children (expanded or collapsed) */
  readonly hasChildren?: boolean;
}

export interface SitemapLegendEntry {
  readonly value: string;
  readonly color: string;
}

export interface SitemapLegendGroup {
  readonly name: string;
  readonly alias?: string;
  readonly entries: readonly SitemapLegendEntry[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly minifiedWidth: number;
  readonly minifiedHeight: number;
}

export interface SitemapLayoutResult {
  readonly nodes: readonly SitemapLayoutNode[];
  readonly edges: readonly SitemapLayoutEdge[];
  readonly containers: readonly SitemapContainerBounds[];
  readonly legend: readonly SitemapLegendGroup[];
  readonly width: number;
  readonly height: number;
}

/**
 * Clip a point at (cx, cy) to the border of a rectangle centered at (cx, cy)
 * with given width/height, along the direction toward (tx, ty).
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
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

// ============================================================
// Constants
// ============================================================

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

// ============================================================
// Helpers
// ============================================================

function filterMetadata(
  metadata: Record<string, string>,
  hiddenAttributes?: Set<string>
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

function computeCardWidth(
  label: string,
  meta: Record<string, string>,
  descLines?: readonly string[]
): number {
  // Measure each text element in the font size AND face the renderer draws it
  // with so the card never under-sizes its content. The card label is bold
  // (utils/card.ts); meta rows and description lines are regular.
  let maxContentWidth = measureText(label, LABEL_FONT_SIZE, { bold: true });
  for (const [key, value] of Object.entries(meta)) {
    // Renderer draws meta as "key:" then the value, both at META_FONT_SIZE,
    // with a space separating them.
    const lineWidth = measureText(`${key}: ${value}`, META_FONT_SIZE);
    if (lineWidth > maxContentWidth) maxContentWidth = lineWidth;
  }
  if (descLines) {
    for (const dl of descLines) {
      const dlWidth = measureText(dl, META_FONT_SIZE);
      if (dlWidth > maxContentWidth) maxContentWidth = dlWidth;
    }
  }
  return Math.max(MIN_CARD_WIDTH, Math.ceil(maxContentWidth) + CARD_H_PAD * 2);
}

function computeCardHeight(
  meta: Record<string, string>,
  descLineCount = 0
): number {
  const metaCount = Object.keys(meta).length;
  const contentCount = metaCount + descLineCount;
  if (contentCount === 0) return HEADER_HEIGHT + CARD_V_PAD;
  return (
    HEADER_HEIGHT + SEPARATOR_GAP + contentCount * META_LINE_HEIGHT + CARD_V_PAD
  );
}

function resolveNodeColor(
  node: SitemapNode,
  tagGroups: readonly TagGroup[],
  activeGroupName: string | null
): string | undefined {
  if (node.color) return node.color;
  return resolveTagColor(
    node.metadata,
    [...tagGroups],
    activeGroupName,
    node.isContainer
  );
}

const OVERLAP_GAP = 20;

// ============================================================
// Legend
// ============================================================

function computeLegendGroups(
  tagGroups: readonly TagGroup[],
  usedValuesByGroup?: Map<string, Set<string>>
): Writable<SitemapLegendGroup>[] {
  const groups: Writable<SitemapLegendGroup>[] = [];

  for (const group of tagGroups) {
    if (group.entries.length === 0) continue;

    const usedValues = usedValuesByGroup?.get(tagAttrKey(group.name));
    const visibleEntries = usedValues
      ? group.entries.filter((e) => usedValues.has(e.value.toLowerCase()))
      : group.entries;
    if (visibleEntries.length === 0) continue;

    const pillWidth =
      measureLegendText(group.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    const minPillWidth = pillWidth;

    let entriesWidth = 0;
    for (const entry of visibleEntries) {
      entriesWidth +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) +
        LEGEND_ENTRY_TRAIL;
    }
    const eyeSpace = LEGEND_EYE_SIZE + LEGEND_EYE_GAP;
    const capsuleWidth =
      LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + eyeSpace + entriesWidth;

    groups.push({
      name: group.name,
      ...(group.alias !== undefined && { alias: group.alias }),
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
  nodes: readonly SitemapNode[],
  parentContainerId: string | null,
  parentPageId: string | null,
  hiddenCounts: Map<string, number> | undefined,
  hiddenAttributes: Set<string> | undefined,
  result: FlatNode[]
): void {
  for (const node of nodes) {
    const meta = filterMetadata(node.metadata, hiddenAttributes);
    if (node.isContainer) {
      // Container gets added as a flat entry (not added to dagre — bounds computed post-hoc)
      const metaCount = Object.keys(meta).length;
      const labelHeight =
        CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
      result.push({
        sitemapNode: node,
        parentContainerId,
        parentPageId,
        meta,
        fullMeta: { ...node.metadata },
        width: Math.max(
          MIN_CARD_WIDTH,
          // The renderer draws the container name bold.
          measureText(node.label, CONTAINER_LABEL_FONT_SIZE, { bold: true }) +
            CARD_H_PAD * 2
        ),
        height: labelHeight + CONTAINER_PAD_BOTTOM,
      });
      // Recurse into children — container becomes parent container, parentPageId stays the same
      flattenNodes(
        node.children,
        node.id,
        parentPageId,
        hiddenCounts,
        hiddenAttributes,
        result
      );
    } else {
      result.push({
        sitemapNode: node,
        parentContainerId,
        parentPageId,
        meta,
        fullMeta: { ...node.metadata },
        width: computeCardWidth(node.label, meta, node.description),
        height: computeCardHeight(meta, node.description?.length ?? 0),
      });
      // Pages can have children too (nested pages) — this page becomes the parentPageId
      if (node.children.length > 0) {
        flattenNodes(
          node.children,
          parentContainerId,
          node.id,
          hiddenCounts,
          hiddenAttributes,
          result
        );
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
  expandAllLegend?: boolean
): SitemapLayoutResult {
  if (parsed.roots.length === 0) {
    return {
      nodes: [],
      edges: [],
      containers: [],
      legend: [],
      width: 0,
      height: 0,
    };
  }

  // Inject default tag metadata
  const allNodes: SitemapNode[] = [];
  const collect = (node: SitemapNode) => {
    allNodes.push(node);
    for (const child of node.children) collect(child);
  };
  for (const root of parsed.roots) collect(root);
  injectDefaultTagMetadata(
    allNodes,
    parsed.tagGroups,
    (e) => (e as SitemapNode).isContainer
  );

  // Flatten hierarchy
  const flatNodes: FlatNode[] = [];
  flattenNodes(
    parsed.roots,
    null,
    null,
    hiddenCounts,
    hiddenAttributes,
    flatNodes
  );

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

  // Identify containers vs pages, and detect collapsed containers.
  // A container is collapsed iff hiddenCounts records it with a positive count
  // (meaning collapseSitemapTree pruned its descendants). Source-level empty
  // containers (never had children) are NOT treated as collapsed.
  for (const flat of flatNodes) {
    if (flat.sitemapNode.isContainer) {
      containerIds.add(flat.sitemapNode.id);
      const hidden = hiddenCounts?.get(flat.sitemapNode.id) ?? 0;
      if (hidden > 0) {
        collapsedContainerIds.add(flat.sitemapNode.id);
      }
    } else {
      pageNodeIds.add(flat.sitemapNode.id);
    }
  }

  // Sibling-page floor for collapsed containers — prevents collapsed containers
  // from rendering smaller than meta-rich page cards in the same layout.
  let pageMaxW = 0;
  let pageMaxH = 0;
  for (const f of flatNodes) {
    if (!f.sitemapNode.isContainer) {
      if (f.width > pageMaxW) pageMaxW = f.width;
      if (f.height > pageMaxH) pageMaxH = f.height;
    }
  }

  // Add nodes to dagre
  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    if (node.isContainer) {
      if (collapsedContainerIds.has(node.id)) {
        // Collapsed container — regular node with explicit dimensions.
        // Floor to max page-card dims so collapsed containers never look
        // smaller than sibling page cards.
        const flooredW = Math.max(flat.width, pageMaxW);
        const flooredH = Math.max(flat.height, pageMaxH);
        g.setNode(node.id, {
          label: node.label,
          width: flooredW,
          height: flooredH,
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
    if (
      flat.parentContainerId &&
      !collapsedContainerIds.has(flat.parentContainerId)
    ) {
      g.setParent(flat.sitemapNode.id, flat.parentContainerId);
    }
  }

  // Build set of expanded (non-collapsed) container IDs — dagre can't route
  // edges to compound parents (they have no rank of their own)
  const expandedContainerIds = new Set<string>();
  for (const cid of containerIds) {
    if (!collapsedContainerIds.has(cid)) {
      expandedContainerIds.add(cid);
    }
  }

  // Add user edges — defer edges touching expanded containers
  const deferredEdgeIndices: number[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    // In-bounds by loop guard.
    const edge = parsed.edges[i]!;
    if (!g.hasNode(edge.sourceId) || !g.hasNode(edge.targetId)) continue;
    if (
      expandedContainerIds.has(edge.sourceId) ||
      expandedContainerIds.has(edge.targetId)
    ) {
      deferredEdgeIndices.push(i);
      continue;
    }
    g.setEdge(
      edge.sourceId,
      edge.targetId,
      {
        label: edge.label ?? '',
        minlen: 1,
      },
      `e${i}`
    );
  }

  // Run dagre layout
  dagre.layout(g);

  // Extract layout results — all positions from dagre
  const layoutNodes: Writable<SitemapLayoutNode>[] = [];
  const layoutContainers: Writable<SitemapContainerBounds>[] = [];

  // Page nodes
  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    if (node.isContainer) continue;
    const pos = g.node(node.id);
    if (!pos) continue;

    const hc = hiddenCounts?.get(node.id);
    const resolvedColor = resolveNodeColor(
      node,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    layoutNodes.push({
      id: node.id,
      label: node.label,
      metadata: flat.meta,
      tagMetadata: flat.fullMeta,
      ...(node.description !== undefined && {
        description: [...node.description],
      }),
      isContainer: false,
      lineNumber: node.lineNumber,
      ...(resolvedColor !== undefined && { color: resolvedColor }),
      x: pos.x,
      y: pos.y - pos.height / 2,
      width: pos.width,
      height: pos.height,
      ...(hc !== undefined && { hiddenCount: hc }),
      ...((node.children.length > 0 || (hc != null && hc > 0)) && {
        hasChildren: true,
      }),
    });
  }

  // Containers — bounds from dagre compound layout
  for (const flat of flatNodes) {
    const node = flat.sitemapNode;
    if (!node.isContainer) continue;

    const pos = g.node(node.id);
    const hc = hiddenCounts?.get(node.id);
    const metaCount = Object.keys(flat.meta).length;
    const labelHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;

    const containerColor = resolveNodeColor(
      node,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    if (pos) {
      layoutContainers.push({
        nodeId: node.id,
        label: node.label,
        lineNumber: node.lineNumber,
        ...(containerColor !== undefined && { color: containerColor }),
        metadata: flat.meta,
        tagMetadata: flat.fullMeta,
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2,
        width: pos.width,
        height: pos.height,
        labelHeight,
        ...(hc !== undefined && { hiddenCount: hc }),
        ...((node.children.length > 0 || (hc != null && hc > 0)) && {
          hasChildren: true,
        }),
      });
    } else {
      // Fallback — still apply the floor for consistency
      const isCollapsed = collapsedContainerIds.has(node.id);
      const flooredW = isCollapsed
        ? Math.max(flat.width, pageMaxW)
        : flat.width;
      const fallbackH = isCollapsed
        ? flat.height
        : labelHeight + CONTAINER_PAD_BOTTOM;
      const flooredH = isCollapsed ? Math.max(fallbackH, pageMaxH) : fallbackH;
      layoutContainers.push({
        nodeId: node.id,
        label: node.label,
        lineNumber: node.lineNumber,
        ...(containerColor !== undefined && { color: containerColor }),
        metadata: flat.meta,
        tagMetadata: flat.fullMeta,
        x: MARGIN,
        y: MARGIN,
        width: flooredW,
        height: flooredH,
        labelHeight,
        ...(hc !== undefined && { hiddenCount: hc }),
        ...((node.children.length > 0 || (hc != null && hc > 0)) && {
          hasChildren: true,
        }),
      });
    }
  }

  // Edge waypoints from dagre (named edges for multigraph) + deferred edges
  const deferredSet = new Set(deferredEdgeIndices);
  const layoutEdges: Writable<SitemapLayoutEdge>[] = [];
  for (let i = 0; i < parsed.edges.length; i++) {
    // In-bounds by loop guard.
    const edge = parsed.edges[i]!;
    if (!g.hasNode(edge.sourceId) || !g.hasNode(edge.targetId)) continue;

    let points: { x: number; y: number }[];

    if (deferredSet.has(i)) {
      // Deferred edge (expanded container endpoint) — clip to border
      const srcNode = g.node(edge.sourceId);
      const tgtNode = g.node(edge.targetId);
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
      const edgeData = g.edge({
        v: edge.sourceId,
        w: edge.targetId,
        name: `e${i}`,
      });
      if (!edgeData) continue;
      points = edgeData.points ?? [];
    }

    layoutEdges.push({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      points,
      ...(edge.label !== undefined && { label: edge.label }),
      lineNumber: edge.lineNumber,
      ...(deferredSet.has(i) && { deferred: true }),
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
    const firstRootPage = flatNodes.find((f) => !f.sitemapNode.isContainer)
      ?.sitemapNode.id;
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
        (f) => !f.sitemapNode.isContainer && f.parentContainerId === cid
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
              for (const p of e.points as Writable<{
                x: number;
                y: number;
              }>[]) {
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
    const key = tagAttrKey(group.name);
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

  const visibleGroups =
    activeTagGroup != null
      ? legendGroups.filter(
          (g) => g.name.toLowerCase() === activeTagGroup.toLowerCase()
        )
      : legendGroups;
  const allExpanded = expandAllLegend && activeTagGroup == null;
  const effectiveW = (g: SitemapLegendGroup) =>
    activeTagGroup != null || allExpanded ? g.width : g.minifiedWidth;

  if (visibleGroups.length > 0) {
    // Bottom position: horizontal row below chart content
    const legendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP;

    const totalGroupsWidth =
      visibleGroups.reduce((s, g) => s + effectiveW(g), 0) +
      (visibleGroups.length - 1) * LEGEND_GROUP_GAP;

    // Center legend groups horizontally
    const neededWidth = totalGroupsWidth + MARGIN * 2;
    if (neededWidth > totalWidth) {
      // Re-centre the tree inside the wider box — renderers centre the BOX in
      // the canvas, so a tree left at its old x sits off-centre by half the
      // surplus. Same defect as `org/layout.ts`.
      const shift = (neededWidth - totalWidth) / 2;
      totalWidth = neededWidth;
      for (const n of layoutNodes) n.x += shift;
      for (const c of layoutContainers) c.x += shift;
      for (const e of layoutEdges) {
        for (const p of e.points as Writable<{ x: number; y: number }>[])
          p.x += shift;
      }
    }
    let cx = (totalWidth - totalGroupsWidth) / 2;
    const legendY = totalHeight + LEGEND_GROUP_GAP;
    for (const g of visibleGroups) {
      g.x = cx;
      g.y = legendY;
      cx += effectiveW(g) + LEGEND_GROUP_GAP;
    }

    totalHeight += legendShift;
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
