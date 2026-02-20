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

export interface OrgLayoutResult {
  nodes: OrgLayoutNode[];
  edges: OrgLayoutEdge[];
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
    return { nodes: [], edges: [], width: 0, height: 0 };
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
    if (d.parent && d.parent.data.orgNode.id !== '__virtual_root__') {
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

  // Bounding box
  const totalWidth = maxX - minX + MARGIN * 2;
  const totalHeight = maxY - minY + MARGIN * 2;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: totalWidth,
    height: totalHeight,
  };
}
