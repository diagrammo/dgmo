// ============================================================
// Infra Chart Validation
// ============================================================
//
// Validates structural correctness of the parsed infra model:
// - Split sums (FR19)
// - DAG validation — no cycles (FR20)
// - Orphan detection

import type {
  ParsedInfra,
  InfraDiagnostic,
  ComputedInfraModel,
  InfraEdge,
} from './types';

// ============================================================
// Cycle Detection
// ============================================================

function detectCycles(parsed: ParsedInfra): InfraDiagnostic[] {
  const diagnostics: InfraDiagnostic[] = [];

  // Build adjacency list
  const adj = new Map<string, string[]>();
  const edgeLines = new Map<string, number>(); // edge key -> lineNumber
  for (const edge of parsed.edges) {
    const list = adj.get(edge.sourceId) ?? [];
    list.push(edge.targetId);
    adj.set(edge.sourceId, list);
    edgeLines.set(`${edge.sourceId}->${edge.targetId}`, edge.lineNumber);
  }

  // DFS with coloring: 0=white, 1=grey, 2=black
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  function dfs(nodeId: string): boolean {
    color.set(nodeId, 1); // grey
    const neighbors = adj.get(nodeId) ?? [];
    for (const next of neighbors) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        // Back edge — cycle found
        const lineKey = `${nodeId}->${next}`;
        diagnostics.push({
          type: 'CYCLE',
          line: edgeLines.get(lineKey) ?? 0,
          message: `Cycle detected: ${nodeId} -> ${next} creates a circular reference.`,
        });
        return true;
      }
      if (c === 0) {
        parent.set(next, nodeId);
        if (dfs(next)) return true;
      }
    }
    color.set(nodeId, 2); // black
    return false;
  }

  for (const node of parsed.nodes) {
    if ((color.get(node.id) ?? 0) === 0) {
      dfs(node.id);
    }
  }

  return diagnostics;
}

// ============================================================
// Split Validation
// ============================================================

function validateSplits(parsed: ParsedInfra): InfraDiagnostic[] {
  const diagnostics: InfraDiagnostic[] = [];

  // Group edges by source. Async edges are derived streams, not a share of
  // the source's request traffic, so they are outside the split denominator
  // (see resolveSplits in compute.ts) and outside this sum rule.
  const outbound = new Map<string, InfraEdge[]>();
  for (const edge of parsed.edges) {
    if (edge.async) continue;
    const list = outbound.get(edge.sourceId) ?? [];
    list.push(edge);
    outbound.set(edge.sourceId, list);
  }

  for (const [sourceId, edges] of outbound) {
    if (edges.length <= 1) continue;

    const declared = edges.filter((e) => e.split !== null);
    if (declared.length === edges.length) {
      // All declared — validate sum
      const sum = declared.reduce((s, e) => s + (e.split ?? 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        diagnostics.push({
          type: 'SPLIT_SUM',
          // In-bounds: declared.length === edges.length > 1 here.
          line: declared[0]!.lineNumber,
          message: `Splits from '${sourceId}' sum to ${sum}%, expected 100%.`,
        });
      }
    } else if (declared.length > 0) {
      // Some declared — validate declared sum doesn't exceed 100
      const declaredSum = declared.reduce((s, e) => s + (e.split ?? 0), 0);
      if (declaredSum > 100) {
        diagnostics.push({
          type: 'SPLIT_SUM',
          // In-bounds: declared.length > 0 here.
          line: declared[0]!.lineNumber,
          message: `Declared splits from '${sourceId}' sum to ${declaredSum}%, exceeding 100%.`,
        });
      }
    }
  }

  return diagnostics;
}

// ============================================================
// Orphan Detection
// ============================================================

function detectOrphans(parsed: ParsedInfra): InfraDiagnostic[] {
  const diagnostics: InfraDiagnostic[] = [];

  // Nodes reachable from edge
  const edgeNode = parsed.nodes.find((n) => n.isEdge);
  if (!edgeNode) return diagnostics;

  const reachable = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const edge of parsed.edges) {
    const list = adj.get(edge.sourceId) ?? [];
    list.push(edge.targetId);
    adj.set(edge.sourceId, list);
  }

  const queue = [edgeNode.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adj.get(id) ?? []) {
      queue.push(next);
    }
  }

  // Also mark group children as reachable if their group is reachable
  for (const group of parsed.groups) {
    if (reachable.has(group.id)) {
      for (const node of parsed.nodes) {
        if (node.groupId === group.id) reachable.add(node.id);
      }
    }
  }

  for (const node of parsed.nodes) {
    if (!node.isEdge && !reachable.has(node.id)) {
      diagnostics.push({
        type: 'ORPHAN',
        line: node.lineNumber,
        message: `Component '${node.label}' is not reachable from the edge entry point.`,
      });
    }
  }

  return diagnostics;
}

// ============================================================
// Main Validation
// ============================================================

export function validateInfra(parsed: ParsedInfra): InfraDiagnostic[] {
  return [
    ...detectCycles(parsed),
    ...validateSplits(parsed),
    ...detectOrphans(parsed),
  ];
}

/**
 * Validate computed model (post-computation warnings).
 * Call after computeInfra() to get uptime/SLA warnings.
 */
export function validateComputed(
  computed: ComputedInfraModel
): InfraDiagnostic[] {
  const diagnostics: InfraDiagnostic[] = [];

  // Uptime warning: if system uptime is below 99%
  if (computed.systemUptime > 0 && computed.systemUptime < 0.99) {
    const pct = (computed.systemUptime * 100).toFixed(2);
    diagnostics.push({
      type: 'UPTIME',
      line: 1,
      message: `System uptime is ${pct}%, below 99% SLA threshold.`,
    });
  }

  return diagnostics;
}
