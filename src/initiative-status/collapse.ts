import type { ParsedInitiativeStatus, InitiativeStatus, ISGroup } from './types';
import { rollUpStatus } from './layout';

// ============================================================
// CollapseResult — returned by collapseInitiativeStatus
// ============================================================

export interface CollapseResult {
  parsed: ParsedInitiativeStatus;
  collapsedGroupStatuses: Map<string, InitiativeStatus>;
  originalGroups: ISGroup[];
}

// ============================================================
// collapseInitiativeStatus — pure transform
//
// Returns a new ParsedInitiativeStatus with:
//   - Children of collapsed groups removed from nodes
//   - Edges redirected: source/target pointing to hidden nodes
//     → point to the group label
//   - Internal edges (both endpoints in same collapsed group) dropped
//   - Duplicate edges (same source, target, label) deduplicated
//     (first occurrence kept)
//   - Collapsed groups removed from groups[] (layout handles them
//     as regular nodes)
//   - collapsedGroupStatuses: worst-case status per collapsed group
// ============================================================

export function collapseInitiativeStatus(
  parsed: ParsedInitiativeStatus,
  collapsedGroups: Set<string>
): CollapseResult {
  const originalGroups = parsed.groups;

  if (collapsedGroups.size === 0) {
    return { parsed, collapsedGroupStatuses: new Map(), originalGroups };
  }

  // Build node → collapsed group lookup
  const nodeToGroup = new Map<string, string>();
  const collapsedGroupStatuses = new Map<string, InitiativeStatus>();

  for (const group of parsed.groups) {
    if (!collapsedGroups.has(group.label)) continue;
    const children = group.nodeLabels
      .map((l) => parsed.nodes.find((n) => n.label === l))
      .filter((n): n is (typeof parsed.nodes)[0] => n !== undefined);
    for (const node of children) nodeToGroup.set(node.label, group.label);
    collapsedGroupStatuses.set(group.label, rollUpStatus(children));
  }

  // Filter nodes: remove children of collapsed groups
  const nodes = parsed.nodes.filter((n) => !nodeToGroup.has(n.label));

  // Remap and deduplicate edges
  const edgeKeys = new Set<string>();
  const edges: typeof parsed.edges = [];
  for (const edge of parsed.edges) {
    const src = nodeToGroup.get(edge.source) ?? edge.source;
    const tgt = nodeToGroup.get(edge.target) ?? edge.target;
    if (src === tgt) continue; // internal edge → drop
    const key = `${src}|${tgt}|${edge.label ?? ''}`;
    if (edgeKeys.has(key)) continue; // duplicate → drop
    edgeKeys.add(key);
    edges.push({ ...edge, source: src, target: tgt });
  }

  // Keep only expanded groups in groups[]
  const groups = parsed.groups.filter((g) => !collapsedGroups.has(g.label));

  return {
    parsed: { ...parsed, nodes, edges, groups },
    collapsedGroupStatuses,
    originalGroups,
  };
}
