// ============================================================
// Initiative Status — Tag-Based Filter
//
// Immutable graph transform: returns a new ParsedInitiativeStatus
// with hidden-value nodes removed, their edges dropped,
// and group.nodeLabels cleaned.
// ============================================================

import type { ParsedInitiativeStatus } from './types';

/**
 * Filter an initiative-status graph by hiding nodes whose tag metadata
 * matches any hidden value. Returns a new (immutable copy) ParsedInitiativeStatus.
 *
 * @param parsed  Fully-resolved parsed result (defaults already injected)
 * @param hiddenTagValues  Map<groupKey, Set<hiddenValues>> — all keys/values lowercase
 * @returns Filtered copy; original is not mutated
 */
export function filterInitiativeStatusByTags(
  parsed: ParsedInitiativeStatus,
  hiddenTagValues: Map<string, Set<string>>
): ParsedInitiativeStatus {
  // Fast path: no filtering
  if (hiddenTagValues.size === 0) return parsed;

  // Build set of hidden node labels
  const hiddenNodeLabels = new Set<string>();
  for (const node of parsed.nodes) {
    for (const [groupKey, hiddenValues] of hiddenTagValues) {
      const nodeValue = node.metadata[groupKey];
      if (nodeValue && hiddenValues.has(nodeValue.toLowerCase())) {
        hiddenNodeLabels.add(node.label);
        break;
      }
    }
  }

  // No nodes hidden — return input unchanged
  if (hiddenNodeLabels.size === 0) return parsed;

  // Filter nodes
  const nodes = parsed.nodes.filter((n) => !hiddenNodeLabels.has(n.label));

  // Filter edges: remove edges where source OR target is hidden
  const edges = parsed.edges.filter(
    (e) => !hiddenNodeLabels.has(e.source) && !hiddenNodeLabels.has(e.target)
  );

  // Clean group nodeLabels; remove empty groups
  const groups = parsed.groups
    .map((g) => ({
      ...g,
      nodeLabels: g.nodeLabels.filter((l) => !hiddenNodeLabels.has(l)),
    }))
    .filter((g) => g.nodeLabels.length > 0);

  return {
    ...parsed,
    nodes,
    edges,
    groups,
  };
}
