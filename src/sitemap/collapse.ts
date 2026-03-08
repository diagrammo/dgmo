// ============================================================
// Sitemap Collapse/Expand — prune subtrees + re-terminate arrows
// ============================================================

import type { SitemapNode, SitemapEdge, ParsedSitemap } from './types';

// ============================================================
// Types
// ============================================================

export interface CollapsedSitemapResult {
  /** ParsedSitemap with collapsed subtrees pruned (deep-cloned, never mutates original) */
  parsed: ParsedSitemap;
  /** nodeId → count of hidden descendants */
  hiddenCounts: Map<string, number>;
}

// ============================================================
// Helpers
// ============================================================

function cloneNode(node: SitemapNode): SitemapNode {
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

function countDescendants(node: SitemapNode): number {
  let count = 0;
  for (const child of node.children) {
    count += (child.isContainer ? 0 : 1) + countDescendants(child);
  }
  return count;
}

/** Compute hidden counts from the ORIGINAL (unpruned) tree. */
function computeHiddenCounts(
  nodes: SitemapNode[],
  collapsedIds: Set<string>,
  hiddenCounts: Map<string, number>,
): void {
  for (const node of nodes) {
    if (collapsedIds.has(node.id) && node.children.length > 0) {
      hiddenCounts.set(node.id, countDescendants(node));
    }
    computeHiddenCounts(node.children, collapsedIds, hiddenCounts);
  }
}

/** Remove children of collapsed nodes on the cloned tree. */
function pruneCollapsed(node: SitemapNode, collapsedIds: Set<string>): void {
  for (const child of node.children) {
    pruneCollapsed(child, collapsedIds);
  }
  if (collapsedIds.has(node.id) && node.children.length > 0) {
    node.children = [];
  }
}

/** Collect all node IDs reachable in a tree. */
function collectNodeIds(nodes: SitemapNode[], ids: Set<string>): void {
  for (const node of nodes) {
    ids.add(node.id);
    collectNodeIds(node.children, ids);
  }
}

/**
 * Find the outermost visible ancestor for a hidden node.
 * Walk up the original tree to find which collapsed container should absorb the arrow.
 */
function findVisibleAncestor(
  nodeId: string,
  parentMap: Map<string, string>,
  visibleIds: Set<string>,
  collapsedIds: Set<string>,
): string | null {
  let current = nodeId;
  while (true) {
    const parentId = parentMap.get(current);
    if (!parentId) return null;
    // If the parent is visible and is a collapsed container, re-terminate here
    if (visibleIds.has(parentId) && collapsedIds.has(parentId)) {
      return parentId;
    }
    current = parentId;
  }
}

/** Build nodeId → parentId map from the original tree. */
function buildParentMap(nodes: SitemapNode[], map: Map<string, string>): void {
  for (const node of nodes) {
    for (const child of node.children) {
      map.set(child.id, node.id);
      buildParentMap([child], map);
    }
  }
}

// ============================================================
// Main
// ============================================================

export function collapseSitemapTree(
  original: ParsedSitemap,
  collapsedIds: Set<string>,
): CollapsedSitemapResult {
  const hiddenCounts = new Map<string, number>();

  if (collapsedIds.size === 0) {
    return { parsed: original, hiddenCounts };
  }

  // Compute counts from the ORIGINAL tree before pruning
  computeHiddenCounts(original.roots, collapsedIds, hiddenCounts);

  // Deep-clone roots and prune collapsed subtrees
  const clonedRoots = original.roots.map(cloneNode);
  for (const root of clonedRoots) {
    pruneCollapsed(root, collapsedIds);
  }

  // Collect visible node IDs after pruning
  const visibleIds = new Set<string>();
  collectNodeIds(clonedRoots, visibleIds);

  // Build parent map from the ORIGINAL tree for ancestor lookup
  const parentMap = new Map<string, string>();
  buildParentMap(original.roots, parentMap);

  // Re-terminate edges that reference hidden nodes.
  // No deduplication — multiple edges between the same collapsed pair are kept
  // so each retains its own label (e.g. "settings" and "billing" both show).
  // Layout uses dagre multigraph to route each edge separately.
  const newEdges: SitemapEdge[] = [];

  for (const edge of original.edges) {
    let sourceId = edge.sourceId;
    let targetId = edge.targetId;

    const sourceVisible = visibleIds.has(sourceId);
    const targetVisible = visibleIds.has(targetId);

    if (sourceVisible && targetVisible) {
      // Both visible — keep as-is
      newEdges.push({ ...edge });
      continue;
    }

    // Re-terminate hidden endpoints
    if (!sourceVisible) {
      const ancestor = findVisibleAncestor(sourceId, parentMap, visibleIds, collapsedIds);
      if (!ancestor) continue; // both endpoints hidden with no visible ancestor
      sourceId = ancestor;
    }
    if (!targetVisible) {
      const ancestor = findVisibleAncestor(targetId, parentMap, visibleIds, collapsedIds);
      if (!ancestor) continue;
      targetId = ancestor;
    }

    // Remove self-loops (both endpoints re-terminated to same collapsed group)
    if (sourceId === targetId) continue;

    newEdges.push({
      ...edge,
      sourceId,
      targetId,
    });
  }

  return {
    parsed: {
      ...original,
      roots: clonedRoots,
      edges: newEdges,
    },
    hiddenCounts,
  };
}
