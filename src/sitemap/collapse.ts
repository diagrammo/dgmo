// ============================================================
// Sitemap Collapse/Expand — prune subtrees + re-terminate arrows
// ============================================================

import type { SitemapNode, SitemapEdge, ParsedSitemap } from './types';
import type { Writable } from '../utils/brand';
import {
  collapseTree,
  type TreeCollapseShape,
} from '../utils/collapse-engine/tree';
import {
  reterminateEdges,
  type EdgeEndpointShape,
} from '../utils/collapse-engine/tree-edges';

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

function cloneNode(node: SitemapNode): Writable<SitemapNode> {
  return {
    id: node.id,
    label: node.label,
    metadata: { ...node.metadata },
    children: node.children.map(cloneNode),
    parentId: node.parentId,
    isContainer: node.isContainer,
    lineNumber: node.lineNumber,
    ...(node.color !== undefined && { color: node.color }),
  };
}

/** Sitemap shape: containers don't count toward an ancestor's hidden tally. */
const SITEMAP_SHAPE: TreeCollapseShape<SitemapNode> = {
  getId: (node) => node.id,
  getChildren: (node) => node.children,
  clone: cloneNode,
  setChildren: (node, children) => {
    (node as Writable<SitemapNode>).children = children as SitemapNode[];
  },
  countsAsHidden: (node) => !node.isContainer,
};

const SITEMAP_EDGE_SHAPE: EdgeEndpointShape<SitemapEdge> = {
  getSource: (edge) => edge.sourceId,
  getTarget: (edge) => edge.targetId,
  withEndpoints: (edge, sourceId, targetId) => ({
    ...edge,
    sourceId,
    targetId,
  }),
};

// ============================================================
// Main
// ============================================================

export function collapseSitemapTree(
  original: ParsedSitemap,
  collapsedIds: Set<string>
): CollapsedSitemapResult {
  if (collapsedIds.size === 0) {
    return { parsed: original, hiddenCounts: new Map() };
  }

  // Walk · filter · tally via the shared engine.
  const { roots, hiddenCounts } = collapseTree(
    original.roots,
    collapsedIds,
    SITEMAP_SHAPE
  );

  // Remap: re-terminate edges that reference pruned nodes to their visible
  // collapsed-container ancestor (parent-walk; no dedup — parallel edges keep
  // distinct labels for dagre multigraph routing).
  const edges = reterminateEdges(
    original.roots,
    roots,
    original.edges,
    collapsedIds,
    SITEMAP_SHAPE,
    SITEMAP_EDGE_SHAPE
  );

  return {
    parsed: { ...original, roots, edges },
    hiddenCounts,
  };
}
