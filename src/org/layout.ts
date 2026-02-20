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
}

export interface OrgLayoutResult {
  nodes: OrgLayoutNode[];
  edges: OrgLayoutEdge[];
  containers: OrgContainerBounds[];
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

// ============================================================
// Card Sizing
// ============================================================

function computeCardWidth(node: OrgNode): number {
  let maxChars = node.label.length;

  for (const [key, value] of Object.entries(node.metadata)) {
    const lineChars = key.length + 2 + value.length; // "key: value"
    if (lineChars > maxChars) maxChars = lineChars;
  }

  return Math.max(MIN_CARD_WIDTH, Math.ceil(maxChars * CHAR_WIDTH) + CARD_H_PAD * 2);
}

function computeCardHeight(node: OrgNode): number {
  const metaCount = Object.keys(node.metadata).length;
  if (metaCount === 0) return HEADER_HEIGHT + CARD_V_PAD;
  return HEADER_HEIGHT + SEPARATOR_GAP + metaCount * META_LINE_HEIGHT + CARD_V_PAD;
}

// ============================================================
// Tag Group Color Resolution
// ============================================================

function resolveTagColor(
  node: OrgNode,
  tagGroups: OrgTagGroup[]
): string | undefined {
  // Explicit node color takes priority
  if (node.color) return node.color;

  // Search tag groups for first metadata match
  for (const group of tagGroups) {
    const groupKey = group.name.toLowerCase();
    const metaValue = node.metadata[groupKey];
    if (!metaValue) continue;

    for (const entry of group.entries) {
      if (entry.value.toLowerCase() === metaValue.toLowerCase()) {
        return entry.color;
      }
    }
  }

  return undefined;
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

function buildTreeNodes(nodes: OrgNode[]): TreeNode[] {
  return nodes.map((orgNode) => ({
    orgNode,
    children: buildTreeNodes(orgNode.children),
    width: computeCardWidth(orgNode),
    height: computeCardHeight(orgNode),
  }));
}

// ============================================================
// Layout
// ============================================================

export function layoutOrg(parsed: ParsedOrg): OrgLayoutResult {
  if (parsed.roots.length === 0) {
    return { nodes: [], edges: [], containers: [], width: 0, height: 0 };
  }

  // Build tree structure
  const treeNodes = buildTreeNodes(parsed.roots);

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

  // Build d3 hierarchy
  const h = hierarchy<TreeNode>(root, (d) => d.children);

  // Run Reingold-Tilford tree layout with nodeSize
  // x = horizontal spread, y = vertical (depth)
  const treeLayout = tree<TreeNode>().nodeSize([
    maxWidth + H_GAP,
    maxHeight + V_GAP,
  ]);
  treeLayout(h);

  // Post-layout: tighten vertical spacing inside containers.
  // Container-with-children nodes render as background boxes (not cards),
  // so their children can sit closer to the container header.
  const levelHeight = maxHeight + V_GAP;
  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;
    if (!d.data.orgNode.isContainer) continue;
    if (!d.children || d.children.length === 0) continue;

    const metaCount = Object.keys(d.data.orgNode.metadata).length;
    const headerHeight =
      CONTAINER_LABEL_HEIGHT + metaCount * CONTAINER_META_LINE_HEIGHT;
    const desiredGap = headerHeight + 15;
    const shiftUp = levelHeight - desiredGap;
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

  // Collect positioned nodes and edges
  const layoutNodes: OrgLayoutNode[] = [];
  const layoutEdges: OrgLayoutEdge[] = [];

  // Find bounding box and build outputs
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;

    const w = d.data.width;
    const ht = d.data.height;
    // d3 tree: x = horizontal, y = depth (vertical)
    const cx = d.x!;
    const cy = d.y!;

    if (cx - w / 2 < minX) minX = cx - w / 2;
    if (cx + w / 2 > maxX) maxX = cx + w / 2;
    if (cy < minY) minY = cy;
    if (cy + ht > maxY) maxY = cy + ht;
  }

  // Translate so all coordinates are positive, starting at MARGIN
  const offsetX = -minX + MARGIN;
  const offsetY = -minY + MARGIN;

  for (const d of h.descendants()) {
    if (d.data.orgNode.id === '__virtual_root__') continue;

    const orgNode = d.data.orgNode;
    const w = d.data.width;
    const ht = d.data.height;
    const x = d.x! + offsetX;
    const y = d.y! + offsetY;

    layoutNodes.push({
      id: orgNode.id,
      label: orgNode.label,
      metadata: orgNode.metadata,
      isContainer: orgNode.isContainer,
      lineNumber: orgNode.lineNumber,
      color: resolveTagColor(orgNode, parsed.tagGroups),
      x,
      y,
      width: w,
      height: ht,
    });

    // Elbow edges from parent to this node
    // Skip edges where the parent is a container with children — the
    // container background box already visually groups its contents
    const parentIsContainerBox =
      d.parent?.data.orgNode.isContainer &&
      d.parent.children &&
      d.parent.children.length > 0;
    if (
      d.parent &&
      d.parent.data.orgNode.id !== '__virtual_root__' &&
      !parentIsContainerBox
    ) {
      const px = d.parent.x! + offsetX;
      const py = d.parent.y! + offsetY;
      const parentH = d.parent.data.height;

      const parentBottomY = py + parentH;
      const childTopY = y;
      const midY = (parentBottomY + childTopY) / 2;

      layoutEdges.push({
        sourceId: d.parent.data.orgNode.id,
        targetId: orgNode.id,
        points: [
          { x: px, y: parentBottomY },
          { x: px, y: midY },
          { x: x, y: midY },
          { x: x, y: childTopY },
        ],
      });
    }
  }

  // Compute container bounds from d3 hierarchy (bottom-up so inner
  // container boxes are available when computing outer containers)
  const containerCandidates = h.descendants().filter(
    (d) =>
      d.data.orgNode.id !== '__virtual_root__' &&
      d.data.orgNode.isContainer &&
      d.children &&
      d.children.length > 0
  );
  // Sort deepest first so inner containers are computed before outer ones
  containerCandidates.sort((a, b) => b.depth - a.depth);

  // Map from node ID to computed visual bounds (offset-space)
  const containerBoundsMap = new Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number }
  >();

  const containers: OrgContainerBounds[] = [];
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

    // Ensure box is centered around container x position
    const containerCenterX = containerX;
    const halfWidth = Math.max(
      Math.abs(descMaxX + CONTAINER_PAD_X - containerCenterX),
      Math.abs(containerCenterX - descMinX + CONTAINER_PAD_X),
      d.data.width / 2
    );
    const finalBoxWidth = halfWidth * 2;
    const centeredBoxX = containerCenterX - halfWidth;

    // Store bounds for parent containers to reference
    containerBoundsMap.set(d.data.orgNode.id, {
      minX: centeredBoxX,
      maxX: centeredBoxX + finalBoxWidth,
      minY: boxY,
      maxY: boxY + boxHeight,
    });

    containers.push({
      nodeId: d.data.orgNode.id,
      label: d.data.orgNode.label,
      lineNumber: d.data.orgNode.lineNumber,
      color: resolveTagColor(d.data.orgNode, parsed.tagGroups),
      metadata: d.data.orgNode.metadata,
      x: centeredBoxX,
      y: boxY,
      width: finalBoxWidth,
      height: boxHeight,
      labelHeight,
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

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    containers,
    width: totalWidth,
    height: totalHeight,
  };
}
