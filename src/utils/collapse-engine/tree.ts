// ============================================================
// Collapse Engine — polymorphic tree projection (Story 110.1)
// ============================================================
//
// One engine owns the walk · filter · tally phases of collapse for the
// hierarchical chart types (org, mindmap, sitemap). Each chart type supplies a
// small `TreeCollapseShape` descriptor; the only genuine divergences across the
// three — the per-node tally rule and the per-type deep clone — live in the
// descriptor, not in copied algorithm bodies. Edge re-termination (sitemap)
// lives in ./tree-edges.

/** Per-chart-type descriptor that adapts a node shape to the collapse engine. */
export interface TreeCollapseShape<N> {
  /** Stable id matched against the collapsed-id set. */
  getId(node: N): string;
  /** A node's children (a readonly view of its live child array). */
  getChildren(node: N): readonly N[];
  /** Deep-clone a node into a mutable copy (children cloned recursively). */
  clone(node: N): N;
  /** Replace a (cloned, mutable) node's children. */
  setChildren(node: N, children: readonly N[]): void;
  /**
   * Whether this node contributes 1 to an ancestor's hidden-descendant tally.
   * org/sitemap exclude structural containers (`!isContainer`); mindmap counts
   * every node. This is the count-rule divergence, surfaced as one predicate.
   */
  countsAsHidden(node: N): boolean;
}

export interface TreeCollapseResult<N> {
  /** Deep-cloned roots with each collapsed node's subtree pruned. */
  roots: N[];
  /** nodeId → count of hidden descendants, computed from the ORIGINAL tree. */
  hiddenCounts: Map<string, number>;
}

function countDescendants<N>(node: N, shape: TreeCollapseShape<N>): number {
  let count = 0;
  for (const child of shape.getChildren(node)) {
    count +=
      (shape.countsAsHidden(child) ? 1 : 0) + countDescendants(child, shape);
  }
  return count;
}

/** Tally hidden descendants from the ORIGINAL (unpruned) tree so nested
 *  collapses don't lose ancestor totals. */
function computeHiddenCounts<N>(
  nodes: readonly N[],
  collapsedIds: Set<string>,
  hiddenCounts: Map<string, number>,
  shape: TreeCollapseShape<N>
): void {
  for (const node of nodes) {
    const children = shape.getChildren(node);
    if (collapsedIds.has(shape.getId(node)) && children.length > 0) {
      hiddenCounts.set(shape.getId(node), countDescendants(node, shape));
    }
    computeHiddenCounts(children, collapsedIds, hiddenCounts, shape);
  }
}

/** Drop the children of collapsed nodes on the cloned tree. */
function pruneCollapsed<N>(
  node: N,
  collapsedIds: Set<string>,
  shape: TreeCollapseShape<N>
): void {
  for (const child of shape.getChildren(node)) {
    pruneCollapsed(child, collapsedIds, shape);
  }
  if (
    collapsedIds.has(shape.getId(node)) &&
    shape.getChildren(node).length > 0
  ) {
    shape.setChildren(node, []);
  }
}

/**
 * Collapse a node tree: tally hidden-descendant counts from the original tree,
 * then return deep-cloned roots with each collapsed node's subtree pruned.
 * Never mutates the input.
 *
 * Callers that need reference identity with the original parsed object on an
 * empty collapse set should short-circuit before calling this.
 */
export function collapseTree<N>(
  roots: readonly N[],
  collapsedIds: Set<string>,
  shape: TreeCollapseShape<N>
): TreeCollapseResult<N> {
  const hiddenCounts = new Map<string, number>();
  computeHiddenCounts(roots, collapsedIds, hiddenCounts, shape);

  const clonedRoots = roots.map((root) => shape.clone(root));
  for (const root of clonedRoots) {
    pruneCollapsed(root, collapsedIds, shape);
  }
  return { roots: clonedRoots, hiddenCounts };
}

/** Collect every node id reachable from `roots`. */
export function collectTreeIds<N>(
  roots: readonly N[],
  shape: Pick<TreeCollapseShape<N>, 'getId' | 'getChildren'>
): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: readonly N[]): void => {
    for (const node of nodes) {
      ids.add(shape.getId(node));
      walk(shape.getChildren(node));
    }
  };
  walk(roots);
  return ids;
}
