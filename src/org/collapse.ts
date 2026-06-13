// ============================================================
// Org Chart Collapse/Expand — prune subtrees of collapsed nodes
// ============================================================

import type { Writable } from '../utils/brand';
import type { OrgNode, ParsedOrg } from './parser';
import {
  collapseTree,
  type TreeCollapseShape,
} from '../utils/collapse-engine/tree';

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

function cloneNode(node: OrgNode): Writable<OrgNode> {
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

/** Org shape: containers don't count toward an ancestor's hidden tally. */
const ORG_SHAPE: TreeCollapseShape<OrgNode> = {
  getId: (node) => node.id,
  getChildren: (node) => node.children,
  clone: cloneNode,
  setChildren: (node, children) => {
    (node as Writable<OrgNode>).children = children as OrgNode[];
  },
  countsAsHidden: (node) => !node.isContainer,
};

// ============================================================
// Main
// ============================================================

export function collapseOrgTree(
  original: ParsedOrg,
  collapsedIds: Set<string>
): CollapsedOrgResult {
  if (collapsedIds.size === 0) {
    return { parsed: original, hiddenCounts: new Map() };
  }

  const { roots, hiddenCounts } = collapseTree(
    original.roots,
    collapsedIds,
    ORG_SHAPE
  );

  return { parsed: { ...original, roots }, hiddenCounts };
}

// ============================================================
// Focus (subtree drill-down)
// ============================================================

/** Find a node by ID and collect the ancestor path leading to it. */
function findNodeWithPath(
  nodes: readonly OrgNode[],
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
        ...(node.color !== undefined && { color: node.color }),
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
