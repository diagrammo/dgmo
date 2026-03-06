// ============================================================
// Infra Chart Role Inference
// ============================================================
//
// Infers component roles from declared behavior properties.
// Each role maps to a specific color for badge rendering.

import type { InfraProperty } from './types';

export interface InfraRole {
  name: string;
  color: string; // hex color for badge
}

/** All recognized roles with their trigger keys. */
const ROLE_RULES: { keys: string[]; role: InfraRole }[] = [
  { keys: ['cache-hit'], role: { name: 'Cache', color: '#22c55e' } },
  { keys: ['firewall-block'], role: { name: 'Firewall', color: '#ef4444' } },
  { keys: ['bot-filter'], role: { name: 'Bot Filter', color: '#f97316' } },
  { keys: ['ratelimit-rps'], role: { name: 'Rate Limiter', color: '#eab308' } },
  { keys: ['max-rps'], role: { name: 'Service', color: '#3b82f6' } },
  { keys: ['cb-error-threshold', 'cb-latency-threshold-ms'], role: { name: 'Circuit Breaker', color: '#a855f7' } },
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

/**
 * Collect all unique roles present in the diagram (for legend).
 */
export function collectDiagramRoles(allProperties: InfraProperty[][]): InfraRole[] {
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
