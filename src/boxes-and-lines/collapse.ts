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
 * - Children of collapsed groups removed from nodes (recursively through sub-groups)
 * - Sub-groups inside a collapsed parent are also removed
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

  // Recursively collect all descendant node labels for a group
  function collectDescendantNodes(groupLabel: string): string[] {
    const group = groupByLabel.get(groupLabel);
    if (!group) return [];
    const nodes: string[] = [];
    for (const child of group.children) {
      if (child.startsWith('__group_')) {
        // Sub-group — recurse into it
        const subLabel = child.slice('__group_'.length);
        nodes.push(...collectDescendantNodes(subLabel));
      } else {
        nodes.push(child);
      }
    }
    return nodes;
  }

  // Recursively collect all descendant sub-group labels
  function collectDescendantGroups(groupLabel: string): string[] {
    const group = groupByLabel.get(groupLabel);
    if (!group) return [];
    const subGroups: string[] = [];
    for (const child of group.children) {
      if (child.startsWith('__group_')) {
        const subLabel = child.slice('__group_'.length);
        subGroups.push(subLabel);
        subGroups.push(...collectDescendantGroups(subLabel));
      }
    }
    return subGroups;
  }

  // Build node → collapsed group lookup (maps to the top-level collapsed group ID)
  const nodeToGroup = new Map<string, string>();
  const collapsedChildCounts = new Map<string, number>();
  const allRemovedGroups = new Set<string>();

  for (const groupLabel of collapsedGroups) {
    if (!groupByLabel.has(groupLabel)) continue;
    const groupId = `__group_${groupLabel}`;

    // Collect all descendant nodes
    const descendantNodes = collectDescendantNodes(groupLabel);
    for (const nodeLabel of descendantNodes) {
      nodeToGroup.set(nodeLabel, groupId);
    }
    collapsedChildCounts.set(groupLabel, descendantNodes.length);

    // Track this group and all its sub-groups for removal
    allRemovedGroups.add(groupLabel);
    for (const subLabel of collectDescendantGroups(groupLabel)) {
      allRemovedGroups.add(subLabel);
    }
  }

  // Also map sub-group IDs to their collapsed parent's group ID
  // (edges may reference __group_Compute which should redirect to __group_AWS)
  for (const groupLabel of collapsedGroups) {
    const groupId = `__group_${groupLabel}`;
    for (const subLabel of collectDescendantGroups(groupLabel)) {
      nodeToGroup.set(`__group_${subLabel}`, groupId);
    }
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

  // Keep only groups that are not collapsed or inside a collapsed parent
  const groups = parsed.groups.filter((g) => !allRemovedGroups.has(g.label));

  return {
    parsed: { ...parsed, nodes, edges, groups },
    collapsedChildCounts,
    originalGroups,
  };
}
