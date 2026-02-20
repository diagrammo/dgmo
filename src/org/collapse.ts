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
    count += 1 + countDescendants(child);
  }
  return count;
}

function pruneCollapsed(
  node: OrgNode,
  collapsedIds: Set<string>,
  hiddenCounts: Map<string, number>
): void {
  // Process children first (depth-first) so nested collapses are handled
  for (const child of node.children) {
    pruneCollapsed(child, collapsedIds, hiddenCounts);
  }

  // If this node is collapsed and has children, prune them
  if (collapsedIds.has(node.id) && node.children.length > 0) {
    const count = countDescendants(node);
    hiddenCounts.set(node.id, count);
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

  // Deep-clone roots to avoid mutating the memoized parse result
  const clonedRoots = original.roots.map(cloneNode);

  for (const root of clonedRoots) {
    pruneCollapsed(root, collapsedIds, hiddenCounts);
  }

  return {
    parsed: {
      ...original,
      roots: clonedRoots,
    },
    hiddenCounts,
  };
}
