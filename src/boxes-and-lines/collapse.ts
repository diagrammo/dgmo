// ============================================================
// Boxes and Lines — Collapse/Expand Transform
// ============================================================

import type { ParsedBoxesAndLines, BLGroup } from './types';

export interface BLCollapseResult {
  parsed: ParsedBoxesAndLines;
  collapsedChildCounts: Map<string, number>;
  originalGroups: BLGroup[];
}

/**
 * Pure transform: returns a new ParsedBoxesAndLines with collapsed groups
 * removed from the diagram content.
 *
 * - Children of collapsed groups removed from nodes
 * - Edges redirected: endpoints in collapsed groups → group ID
 * - Internal edges (both in same collapsed group) dropped
 * - Duplicate edges (same source, target, label) deduplicated
 * - Collapsed groups removed from groups[] (layout handles as nodes)
 */
export function collapseBoxesAndLines(
  parsed: ParsedBoxesAndLines,
  collapsedGroups: Set<string>
): BLCollapseResult {
  const originalGroups = parsed.groups;

  if (collapsedGroups.size === 0) {
    return { parsed, collapsedChildCounts: new Map(), originalGroups };
  }

  // Build group lookup by label
  const groupByLabel = new Map<string, BLGroup>();
  for (const group of parsed.groups) {
    groupByLabel.set(group.label, group);
  }

  // Build node → collapsed group lookup
  const nodeToGroup = new Map<string, string>();
  const collapsedChildCounts = new Map<string, number>();

  for (const groupLabel of collapsedGroups) {
    const group = groupByLabel.get(groupLabel);
    if (!group) continue;
    const groupId = `__group_${groupLabel}`;

    for (const child of group.children) {
      nodeToGroup.set(child, groupId);
    }
    collapsedChildCounts.set(groupLabel, group.children.length);
  }

  // Filter nodes: remove children of collapsed groups
  const nodes = parsed.nodes.filter((n) => !nodeToGroup.has(n.label));

  // Remap and deduplicate edges
  const edgeKeys = new Set<string>();
  const edges: typeof parsed.edges = [];
  for (const edge of parsed.edges) {
    const src = nodeToGroup.get(edge.source) ?? edge.source;
    const tgt = nodeToGroup.get(edge.target) ?? edge.target;
    if (src === tgt) continue;
    const key = `${src}|${tgt}|${edge.label ?? ''}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ ...edge, source: src, target: tgt });
  }

  // Keep only groups that are not collapsed
  const groups = parsed.groups.filter((g) => !collapsedGroups.has(g.label));

  return {
    parsed: { ...parsed, nodes, edges, groups },
    collapsedChildCounts,
    originalGroups,
  };
}
