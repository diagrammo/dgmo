// ============================================================
// Collapse Engine — edge re-termination for trees (Story 110.1)
// ============================================================
//
// The remap phase for hierarchical chart types with cross-links (sitemap). An
// edge whose endpoint was pruned is walked up the ORIGINAL tree to the
// outermost visible collapsed-container ancestor and re-terminated there.
// Matches sitemap semantics exactly: no dedup (parallel edges keep distinct
// labels for multigraph routing), self-loops dropped, unreachable edges dropped.

import type { TreeCollapseShape } from './tree';
import { collectTreeIds } from './tree';

type NodeShape<N> = Pick<TreeCollapseShape<N>, 'getId' | 'getChildren'>;

export interface EdgeEndpointShape<E> {
  getSource(edge: E): string;
  getTarget(edge: E): string;
  /** Return a copy of `edge` with re-terminated endpoints. */
  withEndpoints(edge: E, source: string, target: string): E;
}

function buildParentMap<N>(
  roots: readonly N[],
  shape: NodeShape<N>
): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: readonly N[]): void => {
    for (const node of nodes) {
      for (const child of shape.getChildren(node)) {
        map.set(shape.getId(child), shape.getId(node));
        walk([child]);
      }
    }
  };
  walk(roots);
  return map;
}

/**
 * Walk up the original tree to the outermost visible ancestor that is itself a
 * collapsed container — the node that should absorb the edge endpoint.
 */
function findVisibleAncestor(
  nodeId: string,
  parentMap: Map<string, string>,
  visibleIds: Set<string>,
  collapsedIds: Set<string>
): string | null {
  let current = nodeId;
  while (true) {
    const parentId = parentMap.get(current);
    if (!parentId) return null;
    if (visibleIds.has(parentId) && collapsedIds.has(parentId)) {
      return parentId;
    }
    current = parentId;
  }
}

/**
 * Re-terminate edges that reference pruned nodes. Both-visible edges pass
 * through (shallow-copied via `withEndpoints`); a hidden endpoint re-terminates
 * to its visible collapsed-container ancestor, or the edge is dropped if there
 * is none; resulting self-loops are dropped.
 */
export function reterminateEdges<N, E>(
  originalRoots: readonly N[],
  prunedRoots: readonly N[],
  edges: readonly E[],
  collapsedIds: Set<string>,
  nodeShape: NodeShape<N>,
  edgeShape: EdgeEndpointShape<E>
): E[] {
  const visibleIds = collectTreeIds(prunedRoots, nodeShape);
  const parentMap = buildParentMap(originalRoots, nodeShape);
  const result: E[] = [];

  for (const edge of edges) {
    let sourceId = edgeShape.getSource(edge);
    let targetId = edgeShape.getTarget(edge);
    const sourceVisible = visibleIds.has(sourceId);
    const targetVisible = visibleIds.has(targetId);

    if (sourceVisible && targetVisible) {
      result.push(edgeShape.withEndpoints(edge, sourceId, targetId));
      continue;
    }

    if (!sourceVisible) {
      const ancestor = findVisibleAncestor(
        sourceId,
        parentMap,
        visibleIds,
        collapsedIds
      );
      if (!ancestor) continue;
      sourceId = ancestor;
    }
    if (!targetVisible) {
      const ancestor = findVisibleAncestor(
        targetId,
        parentMap,
        visibleIds,
        collapsedIds
      );
      if (!ancestor) continue;
      targetId = ancestor;
    }

    if (sourceId === targetId) continue;
    result.push(edgeShape.withEndpoints(edge, sourceId, targetId));
  }
  return result;
}
