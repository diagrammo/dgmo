// ============================================================
// Org Chart Collapse/Expand — prune subtrees of collapsed nodes
// ============================================================

import type { OrgNode, ParsedOrg } from './parser';

// ============================================================
// Types
// ============================================================

export interface CollapsedOrgResult {
  /** ParsedOrg with collapsed subtrees pruned (deep-cloned, never mutates original) */
  parsed: ParsedOrg;
  /** nodeId → count of hidden descendants */
  hiddenCounts: Map<string, number>;
}

export interface AncestorInfo {
  id: string;
  label: string;
  lineNumber: number;
  color?: string;
  metadata: Record<string, string>;
  isContainer: boolean;
}

export interface FocusOrgResult {
  /** ParsedOrg with only the focused subtree as the single root */
  parsed: ParsedOrg;
  /** Ancestor path from original root → parent of focused node (top-down order) */
  ancestorPath: AncestorInfo[];
}

// ============================================================
// Helpers
// ============================================================

function cloneNode(node: OrgNode): OrgNode {
  return {
    id: node.id,
    label: node.label,
    metadata: { ...node.metadata },
    children: node.children.map(cloneNode),
    parentId: node.parentId,
    isContainer: node.isContainer,
    lineNumber: node.lineNumber,
    color: node.color,
  };
}

function countDescendants(node: OrgNode): number {
  let count = 0;
  for (const child of node.children) {
    count += (child.isContainer ? 0 : 1) + countDescendants(child);
  }
  return count;
}

/** Compute hidden counts from the ORIGINAL (unpruned) tree so nested
 *  collapses don't lose ancestor descendant totals. */
function computeHiddenCounts(
  nodes: OrgNode[],
  collapsedIds: Set<string>,
  hiddenCounts: Map<string, number>
): void {
  for (const node of nodes) {
    if (collapsedIds.has(node.id) && node.children.length > 0) {
      hiddenCounts.set(node.id, countDescendants(node));
    }
    computeHiddenCounts(node.children, collapsedIds, hiddenCounts);
  }
}

/** Remove children of collapsed nodes on the cloned tree. */
function pruneCollapsed(node: OrgNode, collapsedIds: Set<string>): void {
  for (const child of node.children) {
    pruneCollapsed(child, collapsedIds);
  }
  if (collapsedIds.has(node.id) && node.children.length > 0) {
    node.children = [];
  }
}

// ============================================================
// Main
// ============================================================

export function collapseOrgTree(
  original: ParsedOrg,
  collapsedIds: Set<string>
): CollapsedOrgResult {
  const hiddenCounts = new Map<string, number>();

  if (collapsedIds.size === 0) {
    return { parsed: original, hiddenCounts };
  }

  // Compute counts from the ORIGINAL tree before any pruning
  computeHiddenCounts(original.roots, collapsedIds, hiddenCounts);

  // Deep-clone roots and prune collapsed subtrees
  const clonedRoots = original.roots.map(cloneNode);
  for (const root of clonedRoots) {
    pruneCollapsed(root, collapsedIds);
  }

  return {
    parsed: {
      ...original,
      roots: clonedRoots,
    },
    hiddenCounts,
  };
}

// ============================================================
// Focus (subtree drill-down)
// ============================================================

/** Find a node by ID and collect the ancestor path leading to it. */
function findNodeWithPath(
  nodes: OrgNode[],
  targetId: string,
  path: AncestorInfo[]
): { node: OrgNode; path: AncestorInfo[] } | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return { node, path };
    }
    const result = findNodeWithPath(node.children, targetId, [
      ...path,
      {
        id: node.id,
        label: node.label,
        lineNumber: node.lineNumber,
        color: node.color,
        metadata: { ...node.metadata },
        isContainer: node.isContainer,
      },
    ]);
    if (result) return result;
  }
  return null;
}

/**
 * Extract a subtree rooted at `focusNodeId`, returning the focused tree
 * and the ancestor breadcrumb path. Returns null if the node is not found.
 */
export function focusOrgTree(
  original: ParsedOrg,
  focusNodeId: string
): FocusOrgResult | null {
  const found = findNodeWithPath(original.roots, focusNodeId, []);
  if (!found) return null;

  // If it's already a root, return as-is with empty ancestor path
  const isRoot = original.roots.some((r) => r.id === focusNodeId);
  if (isRoot) {
    return {
      parsed: {
        ...original,
        roots: [cloneNode(found.node)],
      },
      ancestorPath: [],
    };
  }

  const cloned = cloneNode(found.node);
  cloned.parentId = null;

  return {
    parsed: {
      ...original,
      roots: [cloned],
    },
    ancestorPath: found.path,
  };
}
