// ============================================================
// Mindmap Collapse/Expand — prune subtrees of collapsed nodes
// ============================================================

import type { MindmapNode } from './types';

// ============================================================
// Types
// ============================================================

export interface CollapsedMindmapResult {
  /** Roots with collapsed subtrees pruned (deep-cloned, never mutates original) */
  roots: MindmapNode[];
  /** nodeId → count of hidden descendants */
  hiddenCounts: Map<string, number>;
}

// ============================================================
// Helpers
// ============================================================

function cloneNode(node: MindmapNode): MindmapNode {
  return {
    id: node.id,
    label: node.label,
    ...(node.description !== undefined && { description: node.description }),
    metadata: { ...node.metadata },
    children: node.children.map(cloneNode),
    parentId: node.parentId,
    lineNumber: node.lineNumber,
    ...(node.color !== undefined && { color: node.color }),
    ...(node.collapsed !== undefined && { collapsed: node.collapsed }),
  };
}

function countDescendants(node: MindmapNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

function computeHiddenCounts(
  nodes: MindmapNode[],
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

function pruneCollapsed(node: MindmapNode, collapsedIds: Set<string>): void {
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

export function collapseMindmapTree(
  roots: MindmapNode[],
  collapsedIds: Set<string>
): CollapsedMindmapResult {
  const hiddenCounts = new Map<string, number>();

  if (collapsedIds.size === 0) {
    return { roots, hiddenCounts };
  }

  computeHiddenCounts(roots, collapsedIds, hiddenCounts);

  const clonedRoots = roots.map(cloneNode);
  for (const root of clonedRoots) {
    pruneCollapsed(root, collapsedIds);
  }

  return { roots: clonedRoots, hiddenCounts };
}
