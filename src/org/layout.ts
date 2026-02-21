// ============================================================
// Org Chart Tree Layout Engine (d3-hierarchy)
// ============================================================

import { hierarchy, tree } from 'd3-hierarchy';
import type { ParsedOrg, OrgNode, OrgTagGroup } from './parser';

// ============================================================
// Types
// ============================================================

export interface OrgLayoutNode {
  id: string;
  label: string;
  metadata: Record<string, string>;
  isContainer: boolean;
  lineNumber: number;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Count of hidden descendants when this node is collapsed */
  hiddenCount?: number;
  /** True if node has children (expanded or collapsed) — drives toggle UI */
  hasChildren?: boolean;
}

export interface OrgLayoutEdge {
  sourceId: string;
  targetId: string;
  points: { x: number; y: number }[];
}

export interface OrgContainerBounds {
  nodeId: string;
  label: string;
  lineNumber: number;
  color?: string;
  metadata: Record<string, string>;
  x: number;
  y: number;
  width: number;
  height: number;
  labelHeight: number;
  /** Count of hidden descendants when this container is collapsed */
  hiddenCount?: number;
  /** True if container has children (expanded or collapsed) — drives toggle UI */
  hasChildren?: boolean;
}

export interface OrgLegendEntry {
  value: string;
  color: string;
}

export interface OrgLegendGroup {
  name: string;
  entries: OrgLegendEntry[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrgLayoutResult {
  nodes: OrgLayoutNode[];
  edges: OrgLayoutEdge[];
  containers: OrgContainerBounds[];
  legend: OrgLegendGroup[];
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
const H_GAP = 30;
const V_GAP = 50;
const MARGIN = 40;
const CONTAINER_PAD_X = 24;
const CONTAINER_PAD_BOTTOM = 24;
const CONTAINER_LABEL_HEIGHT = 28;
const CONTAINER_META_LINE_HEIGHT = 16;
const STACK_V_GAP = 20;
const BADGE_ROW_HEIGHT = 18;

// Legend
const LEGEND_GAP = 30;
const LEGEND_DOT_R = 5;
const LEGEND_DOT_TEXT_GAP = 6;
const LEGEND_ENTRY_GAP = 12;
const LEGEND_PAD = 10;
const LEGEND_HEADER_H = 20;
const LEGEND_ENTRY_H = 18;
const LEGEND_MAX_PER_ROW = 3;
const LEGEND_V_GAP = 12;
const EYE_ICON_WIDTH = 16;
const EYE_ICON_GAP = 6;

// ============================================================
// Card Sizing
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

function computeCardWidth(node: OrgNode, hiddenAttributes?: Set<string>): number {
  let maxChars = node.label.length;

  const meta = filterMetadata(node.metadata, hiddenAttributes);
  for (const [key, value] of Object.entries(meta)) {
    const lineChars = key.length + 2 + value.length; // "key: value"
    if (lineChars > maxChars) maxChars = lineChars;
  }

  return Math.max(MIN_CARD_WIDTH, Math.ceil(maxChars * CHAR_WIDTH) + CARD_H_PAD * 2);
}

function computeCardHeight(node: OrgNode, hiddenAttributes?: Set<string>): number {
  const meta = filterMetadata(node.metadata, hiddenAttributes);
  const metaCount = Object.keys(meta).length;
  if (metaCount === 0) return HEADER_HEIGHT + CARD_V_PAD;
  return HEADER_HEIGHT + SEPARATOR_GAP + metaCount * META_LINE_HEIGHT + CARD_V_PAD;
}

// ============================================================
// Tag Group Color Resolution
// ============================================================

function resolveNodeColor(
  node: OrgNode,
  tagGroups: OrgTagGroup[],
  activeGroupName: string | null
): string | undefined {
  if (node.color) return node.color;
  if (!activeGroupName) return undefined;

  const group = tagGroups.find(
    (g) => g.name.toLowerCase() === activeGroupName.toLowerCase()
  );
  if (!group) return undefined;
  const metaValue =
    node.metadata[group.name.toLowerCase()] ??
    (node.isContainer ? undefined : group.defaultValue);
  if (!metaValue) return '#999999';
  return group.entries.find(
    (e) => e.value.toLowerCase() === metaValue.toLowerCase()
  )?.color ?? '#999999';
}

// ============================================================
// Hierarchy Helpers
// ============================================================

interface TreeNode {
  orgNode: OrgNode;
  children: TreeNode[];
  width: number;
  height: number;
}

function buildTreeNodes(
  nodes: OrgNode[],
  hiddenCounts?: Map<string, number>,
  hiddenAttributes?: Set<string>
): TreeNode[] {
  return nodes.map((orgNode) => {
    const baseHeight = computeCardHeight(orgNode, hiddenAttributes);
    const hasBadge = hiddenCounts?.has(orgNode.id) ?? false;
    return {
      orgNode,
      children: buildTreeNodes(orgNode.children, hiddenCounts, hiddenAttributes),
      width: computeCardWidth(orgNode, hiddenAttributes),
      height: hasBadge ? baseHeight + BADGE_ROW_HEIGHT : baseHeight,
    };
  });
}

// ============================================================
// Layout
// ============================================================

function computeLegendGroups(tagGroups: OrgTagGroup[], showEyeIcons: boolean): OrgLegendGroup[] {
  const groups: OrgLegendGroup[] = [];

  for (const group of tagGroups) {
    if (group.entries.length === 0) continue;

    const entryWidths = group.entries.map(
      (e) =>
        LEGEND_DOT_R * 2 + LEGEND_DOT_TEXT_GAP + e.value.length * CHAR_WIDTH
    );

    // Pack into rows of up to LEGEND_MAX_PER_ROW
    const rows: number[][] = [];
    for (let i = 0; i < entryWidths.length; i += LEGEND_MAX_PER_ROW) {
      rows.push(entryWidths.slice(i, i + LEGEND_MAX_PER_ROW));
    }

    const eyeExtra = showEyeIcons ? EYE_ICON_GAP + EYE_ICON_WIDTH : 0;
    const headerWidth = group.name.length * CHAR_WIDTH + eyeExtra;
    let maxRowWidth = headerWidth;
    for (const row of rows) {
      const rowWidth =
        row.reduce((s, w) => s + w, 0) + (row.length - 1) * LEGEND_ENTRY_GAP;
      if (rowWidth > maxRowWidth) maxRowWidth = rowWidth;
    }

    groups.push({
      name: group.name,
      entries: group.entries.map((e) => ({ value: e.value, color: e.color })),
      x: 0,
      y: 0,
      width: maxRowWidth + LEGEND_PAD * 2,
      height: LEGEND_HEADER_H + rows.length * LEGEND_ENTRY_H + LEGEND_PAD,
    });
  }

  return groups;
}

/**
 * Inject default tag group values into non-container node metadata.
 * Idempotent — only sets keys not already present.
 */
function injectDefaultMetadata(
  roots: OrgNode[],
  tagGroups: OrgTagGroup[]
): void {
  const defaults: { key: string; value: string }[] = [];
  for (const group of tagGroups) {
    if (group.defaultValue) {
      defaults.push({ key: group.name.toLowerCase(), value: group.defaultValue });
    }
  }
  if (defaults.length === 0) return;

  const walk = (node: OrgNode) => {
    if (!node.isContainer) {
      for (const { key, value } of defaults) {
        if (!(key in node.metadata)) {
          node.metadata[key] = value;
        }
      }
    }
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
}

export function layoutOrg(
  parsed: ParsedOrg,
  hiddenCounts?: Map<string, number>,
  activeTagGroup?: string | null,
  hiddenAttributes?: Set<string>
): OrgLayoutResult {
  if (parsed.roots.length === 0) {
    return { nodes: [], edges: [], containers: [], legend: [], width: 0, height: 0 };
  }

  // Inject default tag group values into node metadata for display.
  // Must happen before buildTreeNodes so card sizing accounts for extra rows.
  injectDefaultMetadata(parsed.roots, parsed.tagGroups);

  // Build tree structure
  const treeNodes = buildTreeNodes(parsed.roots, hiddenCounts, hiddenAttributes);

  // Single root or virtual root for multiple roots
  let root: TreeNode;
  if (treeNodes.length === 1) {
    root = treeNodes[0];
  } else {
    root = {
      orgNode: {
        id: '__virtual_root__',
        label: '',
        metadata: {},
        children: parsed.roots,
        parentId: null,
        isContainer: false,
        lineNumber: 0,
      },
      children: treeNodes,
      width: 0,
      height: 0,
    };
  }

  // Pre-compute max card dimensions for node separation
  let maxWidth = 0;
  let maxHeight = 0;
  const allTreeNodes: TreeNode[] = [];
  const collectNodes = (tn: TreeNode) => {
    if (tn.orgNode.id !== '__virtual_root__') {
      allTreeNodes.push(tn);
      if (tn.width > maxWidth) maxWidth = tn.width;
      if (tn.height > maxHeight) maxHeight = tn.height;
    }
    for (const child of tn.children) collectNodes(child);
  };
  collectNodes(root);

  // Collapse leaf containers: when a container's children are ALL leaves
  // (no grandchildren), replace them with a single virtual stack node so
  // the d3 tree allocates a narrow column instead of a wide row.
  const leafStacks = new Map<
    string,
    { children: TreeNode[]; placeholderId: string }
  >();

  const collapseLeafContainers = (tn: TreeNode): void => {
    for (const child of tn.children) collapseLeafContainers(child);

    if (
      tn.orgNode.isContainer &&
      tn.children.length > 0 &&
      tn.children.every((c) => c.children.length === 0)
    ) {
      const placeholderId = `__stack_${tn.orgNode.id}`;
      leafStacks.set(tn.orgNode.id, {
        children: [...tn.children],
        placeholderId,
      });

      const maxW = Math.max(...tn.children.map((c) => c.width));
      // Standardize all children to the widest card width
      for (const child of tn.children) {
        child.width = maxW;
      }
      const totalH =
        tn.children.reduce((s, c) => s + c.height, 0) +
        (tn.children.length - 1) * STACK_V_GAP;

      tn.children = [
        {
          orgNode: {
            id: placeholderId,
            label: '',
            metadata: {},
            children: [],
            parentId: tn.orgNode.id,
            isContainer: false,
            lineNumber: 0,
          },
          children: [],
          width: maxW,
          height: totalH,
        },
      ];
    }
  };
  collapseLeafContainers(root);

  // Build d3 hierarchy
  const h = hierarchy<TreeNode>(root, (d) => d.children);

  // Run Reingold-Tilford tree layout with nodeSize
  // x = horizontal spread, y = vertical (depth)
  const treeLayout = tree<TreeNode>().nodeSize([
    maxWidth + H_GAP,
    maxHeight + V_GAP,
  ]);
  treeLayout(h);

  // Post-layout: compact vertical spacing per depth level.
  // D3 tree uses uniform nodeSize (maxHeight + V_GAP) for every level, which
  // creates disproportionate gaps when short nodes (no metadata) are placed at
  // the same level-spacing as tall nodes (multiple metadata rows). Recompute
  // Y positions so each level's gap is based on the actual max height at that
  // level rather than the global max.
  {
    const descendants = h.descendants().filter(
      (d) => d.data.orgNode.id !== '__virtual_root__'
    );

    // Collect max actual card height per depth level
    const levelMaxHeight = new Map<number, number>();
    for (const d of descendants) {
      const cur = levelMaxHeight.get(d.depth) ?? 0;
      if (d.data.height > cur) levelMaxHeight.set(d.depth, d.data.height);
    }

    // Compute compacted Y position for each depth level
    const maxDepth = Math.max(...levelMaxHeight.keys(), 0);
    const compactedY = new Map<number, number>();
    // Virtual root (depth 0 in hierarchy) stays at y=0
    // First real level starts at depth 1 for multi-root or depth 0 for single root.
    // We compute based on the d3 hierarchy's depth numbering.
    const rootDepth = treeNodes.length === 1 ? 0 : 1;
    compactedY.set(rootDepth, 0);
    for (let d = rootDepth + 1; d <= maxDepth; d++) {
      const parentH = levelMaxHeight.get(d - 1) ?? maxHeight;
      const prevY = compactedY.get(d - 1) ?? 0;
      compactedY.set(d, prevY + parentH + V_GAP);
    }

    // Shift each node from uniform Y to compacted Y (top-aligned).
    // Siblings share the same Y so connecting edges align cleanly.
    for (const d of h.descendants()) {
      if (d.data.orgNode.id === '__virtual_root__') continue;
      d.y = compactedY.get(d.depth) ?? d.y!;
    }
  }

  // Post-layout: tighten vertical spacing inside containers.
  // Container-with-children nodes render as background boxes (not cards),
  // so their children can sit closer to the container header.
  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (!d.data.orgNode.isContainer) continue;
    if (!d.children || d.children.length === 0) continue;

    // Actual gap between this container and its direct children
    const childY = d.children[0].y!;
    const actualLevelGap = childY - d.y!;

    const metaCount = Object.keys(d.data.orgNode.metadata).length;
    const headerHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
    const desiredGap = headerHeight + 15;
    const shiftUp = actualLevelGap - desiredGap;
    if (shiftUp <= 0) continue;

    // Shift all descendants upward
    const shift = (node: typeof d) => {
      if (node.children) {
        for (const child of node.children) {
          child.y! -= shiftUp;
          shift(child);
        }
      }
    };
    shift(d);
  }

  // Post-layout: compact sibling spacing based on actual subtree widths.
  // D3 uses uniform nodeSize so narrow stacks get the same gap as wide
  // subtrees. Process bottom-up so inner subtrees are compact first.
  {
    type HNode = (typeof h);
    const subtreeExtent = (node: HNode): { minX: number; maxX: number } => {
      let min = Infinity;
      let max = -Infinity;
      const walk = (n: HNode) => {
        // Container boxes extend beyond card bounds by padding
        const pad = n.data.orgNode.isContainer ? CONTAINER_PAD_X : 0;
        const l = n.x! - n.data.width / 2 - pad;
        const r = n.x! + n.data.width / 2 + pad;
        if (l < min) min = l;
        if (r > max) max = r;
        if (n.children) n.children.forEach(walk);
      };
      walk(node);
      return { minX: min, maxX: max };
    };

    const shiftX = (node: HNode, dx: number) => {
      node.x! += dx;
      if (node.children) node.children.forEach((c) => shiftX(c, dx));
    };

    const internalNodes = h
      .descendants()
      .filter((d) => d.children && d.children.length >= 2)
      .sort((a, b) => b.depth - a.depth);

    for (const parent of internalNodes) {
      const children = parent.children!;

      const extents = children.map((child) => {
        const ext = subtreeExtent(child);
        return {
          relLeft: ext.minX - child.x!,
          relRight: ext.maxX - child.x!,
        };
      });

      const currentCenter =
        (children[0].x! + children[children.length - 1].x!) / 2;

      const positions: number[] = [0];
      for (let i = 1; i < children.length; i++) {
        const prevRight = positions[i - 1] + extents[i - 1].relRight;
        positions[i] = prevRight + H_GAP - extents[i].relLeft;
      }

      const newCenter =
        (positions[0] + positions[positions.length - 1]) / 2;
      const centerShift = currentCenter - newCenter;

      for (let i = 0; i < children.length; i++) {
        const newX = positions[i] + centerShift;
        const dx = newX - children[i].x!;
        if (Math.abs(dx) > 0.001) {
          shiftX(children[i], dx);
        }
      }
    }
  }

  // Post-layout: center each parent exactly over its direct children.
  // d3-hierarchy centers over the subtree centroid, which drifts when
  // grandchildren have asymmetric widths. Process bottom-up so parents
  // see already-adjusted child positions.
  {
    const parentNodes = h
      .descendants()
      .filter(
        (d) =>
          d.children &&
          d.children.length >= 1 &&
          d.data.orgNode.id !== '__virtual_root__'
      )
      .sort((a, b) => b.depth - a.depth);

    for (const parent of parentNodes) {
      const childXs = parent.children!.map((c) => c.x!);
      const desiredX = (Math.min(...childXs) + Math.max(...childXs)) / 2;
      parent.x = desiredX;
    }
  }

  // Collect positioned nodes and edges
  const layoutNodes: OrgLayoutNode[] = [];
  const layoutEdges: OrgLayoutEdge[] = [];

  // Find bounding box and build outputs
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Expand leaf container stacks: compute individual child positions
  // in d3 coordinate space (before offset) so bounding box is correct
  interface ExpandedChild {
    orgNode: OrgNode;
    width: number;
    height: number;
    cx: number;
    cy: number;
  }
  const expandedChildren: ExpandedChild[] = [];

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (!d.data.orgNode.id.startsWith('__stack_')) continue;

    const containerId = d.data.orgNode.id.replace('__stack_', '');
    const stack = leafStacks.get(containerId);
    if (!stack) continue;

    let currentY = d.y!;
    for (const child of stack.children) {
      expandedChildren.push({
        orgNode: child.orgNode,
        width: child.width,
        height: child.height,
        cx: d.x!,
        cy: currentY,
      });
      currentY += child.height + STACK_V_GAP;
    }
  }

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (d.data.orgNode.id.startsWith('__stack_')) continue;

    const w = d.data.width;
    const ht = d.data.height;
    const cx = d.x!;
    const cy = d.y!;

    if (cx - w / 2 < minX) minX = cx - w / 2;
    if (cx + w / 2 > maxX) maxX = cx + w / 2;
    if (cy < minY) minY = cy;
    if (cy + ht > maxY) maxY = cy + ht;
  }

  for (const ec of expandedChildren) {
    if (ec.cx - ec.width / 2 < minX) minX = ec.cx - ec.width / 2;
    if (ec.cx + ec.width / 2 > maxX) maxX = ec.cx + ec.width / 2;
    if (ec.cy < minY) minY = ec.cy;
    if (ec.cy + ec.height > maxY) maxY = ec.cy + ec.height;
  }

  // Translate so all coordinates are positive, starting at MARGIN
  const offsetX = -minX + MARGIN;
  const offsetY = -minY + MARGIN;

  // Add expanded stack children as layout nodes
  for (const ec of expandedChildren) {
    const hc = hiddenCounts?.get(ec.orgNode.id);
    layoutNodes.push({
      id: ec.orgNode.id,
      label: ec.orgNode.label,
      metadata: filterMetadata(ec.orgNode.metadata, hiddenAttributes),
      isContainer: ec.orgNode.isContainer,
      lineNumber: ec.orgNode.lineNumber,
      color: resolveNodeColor(ec.orgNode, parsed.tagGroups, activeTagGroup ?? null),
      x: ec.cx + offsetX,
      y: ec.cy + offsetY,
      width: ec.width,
      height: ec.height,
      hiddenCount: hc,
      hasChildren: (ec.orgNode.children.length > 0 || (hc != null && hc > 0)) || undefined,
    });
  }

  // Map parent ID → { parentX, parentBottomY, children[] } for bus-style edges
  const busGroups = new Map<
    string,
    {
      parentX: number;
      parentBottomY: number;
      children: { id: string; x: number; topY: number }[];
    }
  >();

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (d.data.orgNode.id.startsWith('__stack_')) continue;

    const orgNode = d.data.orgNode;
    const w = d.data.width;
    const ht = d.data.height;
    const x = d.x! + offsetX;
    const y = d.y! + offsetY;

    const hc = hiddenCounts?.get(orgNode.id);
    layoutNodes.push({
      id: orgNode.id,
      label: orgNode.label,
      metadata: filterMetadata(orgNode.metadata, hiddenAttributes),
      isContainer: orgNode.isContainer,
      lineNumber: orgNode.lineNumber,
      color: resolveNodeColor(orgNode, parsed.tagGroups, activeTagGroup ?? null),
      x,
      y,
      width: w,
      height: ht,
      hiddenCount: hc,
      hasChildren: (d.children != null && d.children.length > 0) || (hc != null && hc > 0) || undefined,
    });

    // Collect children per parent for bus-style edge generation
    const parentIsContainerBox =
      d.parent?.data.orgNode.isContainer &&
      d.parent.children &&
      d.parent.children.length > 0;
    if (
      d.parent &&
      d.parent.data.orgNode.id !== '__virtual_root__' &&
      !parentIsContainerBox
    ) {
      const parentId = d.parent.data.orgNode.id;
      if (!busGroups.has(parentId)) {
        const px = d.parent.x! + offsetX;
        const py = d.parent.y! + offsetY;
        const parentH = d.parent.data.height;
        busGroups.set(parentId, {
          parentX: px,
          parentBottomY: py + parentH,
          children: [],
        });
      }
      busGroups.get(parentId)!.children.push({
        id: orgNode.id,
        x,
        topY: y,
      });
    }
  }

  // Generate non-overlapping edges using bus pattern
  for (const [parentId, group] of busGroups) {
    const { parentX, parentBottomY, children } = group;

    if (children.length === 1) {
      // Single child: simple elbow (no overlap possible)
      const child = children[0];
      const midY = (parentBottomY + child.topY) / 2;
      layoutEdges.push({
        sourceId: parentId,
        targetId: child.id,
        points: [
          { x: parentX, y: parentBottomY },
          { x: parentX, y: midY },
          { x: child.x, y: midY },
          { x: child.x, y: child.topY },
        ],
      });
    } else {
      // Bus pattern: trunk + horizontal bar + per-child drops
      const midY = (parentBottomY + children[0].topY) / 2;
      const childXs = children.map((c) => c.x);
      const leftX = Math.min(...childXs);
      const rightX = Math.max(...childXs);

      // Trunk: parent bottom → midY
      layoutEdges.push({
        sourceId: parentId,
        targetId: parentId,
        points: [
          { x: parentX, y: parentBottomY },
          { x: parentX, y: midY },
        ],
      });

      // Horizontal bus: leftmost child → rightmost child at midY
      layoutEdges.push({
        sourceId: parentId,
        targetId: parentId,
        points: [
          { x: leftX, y: midY },
          { x: rightX, y: midY },
        ],
      });

      // Drops: midY → child top for each child
      for (const child of children) {
        layoutEdges.push({
          sourceId: parentId,
          targetId: child.id,
          points: [
            { x: child.x, y: midY },
            { x: child.x, y: child.topY },
          ],
        });
      }
    }
  }

  // Compute container bounds from d3 hierarchy (bottom-up so inner
  // container boxes are available when computing outer containers)
  const allContainerNodes = h.descendants().filter(
    (d) =>
      d.data.orgNode.id !== '__virtual_root__' &&
      d.data.orgNode.isContainer
  );

  // Map from node ID to computed visual bounds (offset-space)
  const containerBoundsMap = new Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number }
  >();

  const containers: OrgContainerBounds[] = [];

  // First pass: childless containers — simple boxes at their own position.
  // Must be computed before parent containers so their bounds are available.
  const EMPTY_CONTAINER_MIN_HEIGHT = 60;
  for (const d of allContainerNodes) {
    if (d.children && d.children.length > 0) continue;

    const cx = d.x! + offsetX;
    const cy = d.y! + offsetY;
    const metaCount = Object.keys(d.data.orgNode.metadata).length;
    const labelHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
    const boxWidth = d.data.width + CONTAINER_PAD_X * 2;
    const boxHeight = Math.max(labelHeight + CONTAINER_PAD_BOTTOM, EMPTY_CONTAINER_MIN_HEIGHT);
    const boxX = cx - boxWidth / 2;
    const boxY = cy;

    containerBoundsMap.set(d.data.orgNode.id, {
      minX: boxX,
      maxX: boxX + boxWidth,
      minY: boxY,
      maxY: boxY + boxHeight,
    });

    const chc = hiddenCounts?.get(d.data.orgNode.id);
    containers.push({
      nodeId: d.data.orgNode.id,
      label: d.data.orgNode.label,
      lineNumber: d.data.orgNode.lineNumber,
      color: resolveNodeColor(d.data.orgNode, parsed.tagGroups, activeTagGroup ?? null),
      metadata: filterMetadata(d.data.orgNode.metadata, hiddenAttributes),
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      labelHeight,
      hiddenCount: chc,
      hasChildren: (chc != null && chc > 0) || undefined,
    });
  }

  // Second pass: containers with children, deepest first
  const containerCandidates = allContainerNodes.filter(
    (d) => d.children && d.children.length > 0
  );
  containerCandidates.sort((a, b) => b.depth - a.depth);

  for (const d of containerCandidates) {
    // Collect all descendants (not just direct children)
    const allDesc: typeof d[] = [];
    const collectDesc = (node: typeof d) => {
      if (node.children) {
        for (const child of node.children) {
          allDesc.push(child);
          collectDesc(child);
        }
      }
    };
    collectDesc(d);

    if (allDesc.length === 0) continue;

    // Compute bounding box from all descendants, using inner container
    // bounds when available (so nested boxes don't overlap)
    let descMinX = Infinity;
    let descMaxX = -Infinity;
    let descMaxY = -Infinity;

    for (const desc of allDesc) {
      const innerBounds = containerBoundsMap.get(desc.data.orgNode.id);
      if (innerBounds) {
        // Use the inner container's expanded box
        if (innerBounds.minX < descMinX) descMinX = innerBounds.minX;
        if (innerBounds.maxX > descMaxX) descMaxX = innerBounds.maxX;
        if (innerBounds.maxY > descMaxY) descMaxY = innerBounds.maxY;
      } else if (desc.data.orgNode.id.startsWith('__stack_')) {
        // Use expanded children positions for stack placeholders
        const cid = desc.data.orgNode.id.replace('__stack_', '');
        const stack = leafStacks.get(cid);
        if (stack) {
          for (const ec of expandedChildren) {
            if (ec.orgNode.parentId !== cid) continue;
            const ex = ec.cx + offsetX;
            const ey = ec.cy + offsetY;
            if (ex - ec.width / 2 < descMinX) descMinX = ex - ec.width / 2;
            if (ex + ec.width / 2 > descMaxX) descMaxX = ex + ec.width / 2;
            if (ey + ec.height > descMaxY) descMaxY = ey + ec.height;
          }
        }
      } else {
        // Use card dimensions
        const dw = desc.data.width;
        const dh = desc.data.height;
        const dx = desc.x! + offsetX;
        const dy = desc.y! + offsetY;

        if (dx - dw / 2 < descMinX) descMinX = dx - dw / 2;
        if (dx + dw / 2 > descMaxX) descMaxX = dx + dw / 2;
        if (dy + dh > descMaxY) descMaxY = dy + dh;
      }
    }

    const containerX = d.x! + offsetX;
    const containerY = d.y! + offsetY;
    const metaCount = Object.keys(d.data.orgNode.metadata).length;
    const labelHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;

    // Box top = container's own y, extends to cover all children
    const boxY = containerY;
    const boxHeight = descMaxY - containerY + CONTAINER_PAD_BOTTOM;

    // Tight-fit box around content with padding
    const boxX = descMinX - CONTAINER_PAD_X;
    const contentWidth = descMaxX - descMinX + CONTAINER_PAD_X * 2;
    const finalBoxWidth = Math.max(contentWidth, d.data.width);
    // Center the box if the label is wider than the content
    const centeredBoxX =
      finalBoxWidth > contentWidth
        ? containerX - finalBoxWidth / 2
        : boxX;

    // Store bounds for parent containers to reference
    containerBoundsMap.set(d.data.orgNode.id, {
      minX: centeredBoxX,
      maxX: centeredBoxX + finalBoxWidth,
      minY: boxY,
      maxY: boxY + boxHeight,
    });

    const chc2 = hiddenCounts?.get(d.data.orgNode.id);
    containers.push({
      nodeId: d.data.orgNode.id,
      label: d.data.orgNode.label,
      lineNumber: d.data.orgNode.lineNumber,
      color: resolveNodeColor(d.data.orgNode, parsed.tagGroups, activeTagGroup ?? null),
      metadata: filterMetadata(d.data.orgNode.metadata, hiddenAttributes),
      x: centeredBoxX,
      y: boxY,
      width: finalBoxWidth,
      height: boxHeight,
      labelHeight,
      hiddenCount: chc2,
      hasChildren: true,
    });
  }

  // Reverse so outer containers render first (behind inner containers)
  containers.reverse();

  // Bounding box — expand for container backgrounds that may extend beyond nodes
  // Convert container coords (offset space) back to pre-offset space for comparison
  let finalMinX = minX;
  let finalMaxX = maxX;
  let finalMaxY = maxY;
  for (const c of containers) {
    const cLeft = c.x - offsetX;
    const cRight = cLeft + c.width;
    const cBottom = c.y - offsetY + c.height;
    if (cLeft < finalMinX) finalMinX = cLeft;
    if (cRight > finalMaxX) finalMaxX = cRight;
    if (cBottom > finalMaxY) finalMaxY = cBottom;
  }

  const totalWidth = finalMaxX - finalMinX + MARGIN * 2;
  const totalHeight = finalMaxY - minY + MARGIN * 2;

  // Compute legend for tag groups
  const showEyeIcons = hiddenAttributes !== undefined;
  const legendGroups = computeLegendGroups(parsed.tagGroups, showEyeIcons);
  let finalWidth = totalWidth;
  let finalHeight = totalHeight;

  const legendPosition = parsed.options?.['legend-position'] ?? 'top';

  if (legendGroups.length > 0) {
    if (legendPosition === 'bottom') {
      // Bottom: center legend groups horizontally below diagram content
      const totalGroupsWidth =
        legendGroups.reduce((s, g) => s + g.width, 0) +
        (legendGroups.length - 1) * H_GAP;
      const neededWidth = totalGroupsWidth + MARGIN * 2;

      if (neededWidth > totalWidth) {
        finalWidth = neededWidth;
        const shift = (finalWidth - totalWidth) / 2;
        for (const n of layoutNodes) n.x += shift;
        for (const c of containers) c.x += shift;
      }

      const contentBottom = totalHeight - MARGIN;
      const legendY = contentBottom + LEGEND_GAP;
      const startX = (finalWidth - totalGroupsWidth) / 2;

      let cx = startX;
      let maxH = 0;
      for (const g of legendGroups) {
        g.x = cx;
        g.y = legendY;
        cx += g.width + H_GAP;
        if (g.height > maxH) maxH = g.height;
      }

      finalHeight = totalHeight + LEGEND_GAP + maxH;
    } else {
      // Top (default): stack legend groups vertically at top-right
      const maxLegendWidth = Math.max(...legendGroups.map((g) => g.width));
      const legendStartX = totalWidth - MARGIN + LEGEND_GAP;
      let legendY = MARGIN;

      for (const g of legendGroups) {
        g.x = legendStartX;
        g.y = legendY;
        legendY += g.height + LEGEND_V_GAP;
      }

      const legendRight = legendStartX + maxLegendWidth + MARGIN;
      if (legendRight > finalWidth) {
        finalWidth = legendRight;
      }

      const legendBottom = legendY - LEGEND_V_GAP + MARGIN;
      if (legendBottom > finalHeight) {
        finalHeight = legendBottom;
      }
    }
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    containers,
    legend: legendGroups,
    width: finalWidth,
    height: finalHeight,
  };
}
