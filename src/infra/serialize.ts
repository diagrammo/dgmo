// ============================================================
// Infra Scenario Serializer
// ============================================================
//
// Converts interactive overrides into a `scenario:` DSL block.
// Only includes properties that differ from the base diagram.

import type { ParsedInfra, InfraComputeParams } from './types';

/**
 * Serialize interactive overrides as a DSL `scenario:` block.
 * Returns an empty string if nothing differs from the base diagram.
 */
export function serializeScenario(name: string, parsed: ParsedInfra, overrides: InfraComputeParams): string {
  const lines: string[] = [];

  // Edge RPS override
  const edgeNode = parsed.nodes.find((n) => n.isEdge);
  if (edgeNode && overrides.rps != null) {
    const baseRps = edgeNode.properties.find((p) => p.key === 'rps');
    const baseVal = baseRps ? (typeof baseRps.value === 'number' ? baseRps.value : parseFloat(String(baseRps.value)) || 0) : 0;
    if (overrides.rps !== baseVal) {
      lines.push(`  ${edgeNode.id}`);
      lines.push(`    rps: ${overrides.rps}`);
    }
  }

  // Instance overrides and property overrides per node
  const instanceOv = overrides.instanceOverrides ?? {};
  const propOv = overrides.propertyOverrides ?? {};

  for (const node of parsed.nodes) {
    if (node.isEdge) continue;

    const nodeLines: string[] = [];

    // Instance override
    if (instanceOv[node.id] != null) {
      const baseProp = node.properties.find((p) => p.key === 'instances');
      const baseVal = baseProp ? (typeof baseProp.value === 'number' ? baseProp.value : parseFloat(String(baseProp.value)) || 1) : 1;
      if (instanceOv[node.id] !== baseVal) {
        nodeLines.push(`    instances: ${instanceOv[node.id]}`);
      }
    }

    // Property overrides
    const nodePropOv = propOv[node.id];
    if (nodePropOv) {
      for (const [key, val] of Object.entries(nodePropOv)) {
        const baseProp = node.properties.find((p) => p.key === key);
        const baseVal = baseProp ? (typeof baseProp.value === 'number' ? baseProp.value : parseFloat(String(baseProp.value)) || 0) : 0;
        if (val !== baseVal) {
          nodeLines.push(`    ${key}: ${val}`);
        }
      }
    }

    if (nodeLines.length > 0) {
      lines.push(`  ${node.id}`);
      lines.push(...nodeLines);
    }
  }

  if (lines.length === 0) return '';

  return `scenario: ${name}\n${lines.join('\n')}\n`;
}
