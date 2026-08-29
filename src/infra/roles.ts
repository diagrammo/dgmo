// ============================================================
// Infra Chart Role Inference
// ============================================================
//
// Infers component roles from declared behavior properties.
// Each role maps to a specific color for badge rendering.

import type { InfraProperty } from './types';
import type { InfraLayoutEdge } from './layout';
import type { PaletteColors } from '../palettes';

/** Semantic palette slot a role's badge is painted from. */
export type RoleColorToken = keyof PaletteColors['colors'];

export interface InfraRole {
  name: string;
  /**
   * Palette slot, NOT a hex. These were eight raw Tailwind hues until
   * 2026-08-28, so a role dot kept its own colours under every palette and
   * in dark mode. The renderer resolves the token against the live palette.
   */
  colorToken: RoleColorToken;
}

/** All recognized roles with their trigger keys. */
const ROLE_RULES: { keys: string[]; role: InfraRole }[] = [
  { keys: ['cache-hit'], role: { name: 'Cache', colorToken: 'green' } },
  { keys: ['firewall-block'], role: { name: 'Firewall', colorToken: 'red' } },
  {
    keys: ['ratelimit-rps'],
    role: { name: 'Rate Limiter', colorToken: 'yellow' },
  },
  { keys: ['max-rps'], role: { name: 'Service', colorToken: 'blue' } },
  {
    keys: ['cb-error-threshold', 'cb-latency-threshold-ms'],
    role: { name: 'Circuit Breaker', colorToken: 'purple' },
  },
  { keys: ['concurrency'], role: { name: 'Serverless', colorToken: 'cyan' } },
  { keys: ['buffer'], role: { name: 'Queue', colorToken: 'teal' } },
];

/**
 * Infer roles from a component's properties.
 * A component can have multiple roles (e.g., Cache + Rate Limiter).
 */
export function inferRoles(properties: InfraProperty[]): InfraRole[] {
  const propKeys = new Set(properties.map((p) => p.key));
  const roles: InfraRole[] = [];

  for (const rule of ROLE_RULES) {
    if (rule.keys.some((k) => propKeys.has(k))) {
      roles.push(rule.role);
    }
  }

  return roles;
}

/** The Fan-Out role, assigned to nodes with at least one outgoing fanout edge. */
export const FANOUT_ROLE: InfraRole = { name: 'Fan-Out', colorToken: 'orange' };

/**
 * Return the set of sourceIds that have at least one outgoing edge with fanout.
 */
export function collectFanoutSourceIds(edges: InfraLayoutEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const e of edges) {
    if (e.fanout != null) ids.add(e.sourceId);
  }
  return ids;
}

/**
 * Collect all unique roles present in the diagram (for legend).
 */
export function collectDiagramRoles(
  allProperties: InfraProperty[][]
): InfraRole[] {
  const seen = new Set<string>();
  const roles: InfraRole[] = [];

  for (const props of allProperties) {
    for (const role of inferRoles(props)) {
      if (!seen.has(role.name)) {
        seen.add(role.name);
        roles.push(role);
      }
    }
  }

  return roles;
}
