// ============================================================
// State Diagram — Collapse/Expand Transform
// ============================================================

import type { ParsedGraph, GraphGroup } from './types';

export interface StateCollapseResult {
  parsed: ParsedGraph;
  collapsedChildCounts: Map<string, number>;
  originalGroups: GraphGroup[];
}

/**
 * Pure transform: returns a new ParsedGraph with collapsed groups
 * removed from the diagram content.
 *
 * - Children of collapsed groups removed from nodes
 * - Edges redirected: endpoints in collapsed groups → group ID
 * - Internal edges (both in same collapsed group) dropped
 * - Duplicate edges (same source, target, label) deduplicated
 * - Collapsed groups removed from groups[] (layout handles as nodes)
 */
export function collapseStateGroups(
  parsed: ParsedGraph,
  collapsedGroups: Set<string>
): StateCollapseResult {
  const originalGroups = parsed.groups ?? [];

  if (collapsedGroups.size === 0 || originalGroups.length === 0) {
    return { parsed, collapsedChildCounts: new Map(), originalGroups };
  }

  // Build group lookup by ID
  const groupById = new Map<string, GraphGroup>();
  for (const group of originalGroups) {
    groupById.set(group.id, group);
  }

  // Build node → collapsed group lookup
  const nodeToGroup = new Map<string, string>();
  const collapsedChildCounts = new Map<string, number>();

  for (const groupId of collapsedGroups) {
    const group = groupById.get(groupId);
    if (!group) continue;

    for (const nodeId of group.nodeIds) {
      nodeToGroup.set(nodeId, groupId);
    }
    collapsedChildCounts.set(groupId, group.nodeIds.length);
  }

  // Filter nodes: remove children of collapsed groups
  const nodes = parsed.nodes.filter((n) => !nodeToGroup.has(n.id));

  // Remap and deduplicate edges
  const edgeKeys = new Set<string>();
  const edges: typeof parsed.edges = [];
  for (const edge of parsed.edges) {
    const src = nodeToGroup.get(edge.source) ?? edge.source;
    const tgt = nodeToGroup.get(edge.target) ?? edge.target;
    // Drop internal edges (both endpoints in same collapsed group)
    if (src === tgt && src !== edge.source) continue;
    const key = `${src}|${tgt}|${edge.label ?? ''}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ ...edge, source: src, target: tgt });
  }

  // Keep only groups that are not collapsed
  const groups = originalGroups.filter((g) => !collapsedGroups.has(g.id));

  return {
    parsed: { ...parsed, nodes, edges, groups },
    collapsedChildCounts,
    originalGroups,
  };
}
