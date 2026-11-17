// ============================================================
// Effective ownership — every ultimate owner's stake, summed across paths
// ============================================================
//
// Acme GmbH is 90% Acme BV and 10% Acme Inc, and both are 100% Acme Holdings:
// Holdings holds 90% via BV + 10% via Inc = 100%. A path multiplies the stakes
// along it; an owner's total adds its paths. A path ends at an entity with no
// owners, or where going further would revisit an entity already on it (a
// cycle stops there).

import type { OwnershipLink, ParsedOwnership } from './types';

export interface OwnershipPath {
  /** Entity ids from the ultimate owner down to the owned entity. */
  readonly chain: readonly string[];
  /** The product of the stakes along the path, in percent. */
  readonly pct: number;
}

export interface UltimateOwner {
  readonly id: string;
  readonly total: number;
  readonly paths: readonly OwnershipPath[];
}

export interface EffectiveOwnership {
  readonly owners: readonly UltimateOwner[];
  /** The direct stakes written into the entity, summed. */
  readonly directTotal: number;
}

export function effectiveOwnership(
  parsed: ParsedOwnership,
  entityId: string
): EffectiveOwnership {
  const into = new Map<string, OwnershipLink[]>();
  for (const link of parsed.links) {
    const list = into.get(link.ownedId) ?? [];
    list.push(link);
    into.set(link.ownedId, list);
  }
  const direct = into.get(entityId) ?? [];
  const byOwner = new Map<string, OwnershipPath[]>();
  const walk = (id: string, chain: string[], pct: number): void => {
    const next = (into.get(id) ?? []).filter((l) => !chain.includes(l.ownerId));
    if (next.length === 0) {
      if (chain.length === 1) return; // the entity itself
      const list = byOwner.get(id) ?? [];
      list.push({ chain: [...chain].reverse(), pct });
      byOwner.set(id, list);
      return;
    }
    for (const l of next)
      walk(l.ownerId, [...chain, l.ownerId], (pct * l.pct) / 100);
  };
  walk(entityId, [entityId], 100);
  const order = new Map(parsed.entities.map((e, i) => [e.id, i]));
  const owners = [...byOwner.entries()]
    .map(([id, paths]) => ({
      id,
      total: paths.reduce((s, p) => s + p.pct, 0),
      paths: [...paths].sort((a, b) => b.pct - a.pct),
    }))
    .sort((a, b) => b.total - a.total || order.get(a.id)! - order.get(b.id)!);
  return {
    owners,
    directTotal: direct.reduce((s, l) => s + l.pct, 0),
  };
}

/** Every entity on a path from `entityId` up to the top, itself included. */
export function ownerChain(
  parsed: ParsedOwnership,
  entityId: string
): { entities: Set<string>; links: Set<string> } {
  const entities = new Set<string>([entityId]);
  const links = new Set<string>();
  const queue = [entityId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const link of parsed.links) {
      if (link.ownedId !== id) continue;
      links.add(link.id);
      if (!entities.has(link.ownerId)) {
        entities.add(link.ownerId);
        queue.push(link.ownerId);
      }
    }
  }
  return { entities, links };
}
