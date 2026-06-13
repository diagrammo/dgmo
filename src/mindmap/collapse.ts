// ============================================================
// Mindmap Collapse/Expand — prune subtrees of collapsed nodes
// ============================================================

import type { MindmapNode } from './types';
import type { Writable } from '../utils/brand';
import {
  collapseTree,
  type TreeCollapseShape,
} from '../utils/collapse-engine/tree';

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

function cloneNode(node: MindmapNode): Writable<MindmapNode> {
  return {
    id: node.id,
    label: node.label,
    ...(node.description !== undefined && {
      description: [...node.description],
    }),
    metadata: { ...node.metadata },
    children: node.children.map(cloneNode),
    parentId: node.parentId,
    lineNumber: node.lineNumber,
    ...(node.color !== undefined && { color: node.color }),
    ...(node.collapsed !== undefined && { collapsed: node.collapsed }),
  };
}

/** Mindmap shape: every node counts toward the hidden tally (no containers). */
const MINDMAP_SHAPE: TreeCollapseShape<MindmapNode> = {
  getId: (node) => node.id,
  getChildren: (node) => node.children,
  clone: cloneNode,
  setChildren: (node, children) => {
    (node as Writable<MindmapNode>).children = children as MindmapNode[];
  },
  countsAsHidden: () => true,
};

// ============================================================
// Main
// ============================================================

export function collapseMindmapTree(
  roots: readonly MindmapNode[],
  collapsedIds: Set<string>
): CollapsedMindmapResult {
  if (collapsedIds.size === 0) {
    return { roots: [...roots], hiddenCounts: new Map() };
  }

  return collapseTree(roots, collapsedIds, MINDMAP_SHAPE);
}
