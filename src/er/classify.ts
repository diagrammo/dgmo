// ============================================================
// ER Diagram Entity Classification
// ============================================================
//
// Classifies each ER entity into a structural role using heuristics
// derived from column constraints, FK patterns, relationship in-degree,
// and naming conventions.
//
// Only used when no explicit colors or tag groups are defined.

import type { ERTable, ERRelationship } from './types';
import type { PaletteColors } from '../palettes/types';

export type EntityRole =
  | 'core'
  | 'dependent'
  | 'junction'
  | 'ambiguous'
  | 'lookup'
  | 'hub'
  | 'self-referential'
  | 'unclassified';

/** Maps each role to a key in PaletteColors['colors'] */
export const ROLE_COLORS: Record<EntityRole, keyof PaletteColors['colors']> = {
  core: 'green',
  dependent: 'blue',
  junction: 'red',
  ambiguous: 'purple',
  lookup: 'yellow',
  hub: 'orange',
  'self-referential': 'teal',
  unclassified: 'gray',
};

/** Human-readable legend labels per role */
export const ROLE_LABELS: Record<EntityRole, string> = {
  core: 'Core entity',
  dependent: 'Dependent',
  junction: 'Junction / M:M',
  ambiguous: 'Bridge',
  lookup: 'Lookup / Reference',
  hub: 'Hub',
  'self-referential': 'Self-referential',
  unclassified: 'Unclassified',
};

/** Stable display order for the semantic legend */
export const ROLE_ORDER: EntityRole[] = [
  'core',
  'dependent',
  'junction',
  'ambiguous',
  'lookup',
  'hub',
  'self-referential',
  'unclassified',
];

const LOOKUP_NAME_SUFFIXES = ['_type', '_status', '_code', '_category'];

/**
 * Classify each ER entity into a structural role.
 *
 * Returns a Map of tableId → EntityRole.
 * Pure logic — no palette or DOM dependencies.
 */
export function classifyEREntities(
  tables: ERTable[],
  relationships: ERRelationship[]
): Map<string, EntityRole> {
  const result = new Map<string, EntityRole>();
  if (tables.length === 0) return result;

  // ── Pre-compute graph metrics ─────────────────────────────────────────────

  // indegreeMap: how many other tables have FK references pointing to this table.
  // A table's indegree increments when it is on the exclusive '1' side of a 1:* or 1:?
  // relationship. 1:1 relationships are skipped on both sides to avoid double-counting.
  const indegreeMap: Record<string, number> = {};
  for (const t of tables) indegreeMap[t.id] = 0;
  for (const rel of relationships) {
    if (rel.source === rel.target) continue; // skip self-loops
    if (rel.cardinality.from === '1' && rel.cardinality.to !== '1') {
      indegreeMap[rel.source] = (indegreeMap[rel.source] ?? 0) + 1;
    }
    if (rel.cardinality.to === '1' && rel.cardinality.from !== '1') {
      indegreeMap[rel.target] = (indegreeMap[rel.target] ?? 0) + 1;
    }
  }

  // mmParticipants: tables with '*' cardinality connecting to 2+ distinct other tables.
  // Catches wide junction tables (e.g. with surrogate PKs) that the FK-ratio alone misses.
  const tableStarNeighbors = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (rel.source === rel.target) continue;
    if (rel.cardinality.from === '*') {
      if (!tableStarNeighbors.has(rel.source)) tableStarNeighbors.set(rel.source, new Set());
      tableStarNeighbors.get(rel.source)!.add(rel.target);
    }
    if (rel.cardinality.to === '*') {
      if (!tableStarNeighbors.has(rel.target)) tableStarNeighbors.set(rel.target, new Set());
      tableStarNeighbors.get(rel.target)!.add(rel.source);
    }
  }
  const mmParticipants = new Set<string>();
  for (const [id, neighbors] of tableStarNeighbors) {
    if (neighbors.size >= 2) mmParticipants.add(id);
  }

  // Hub outlier statistics
  const indegreeValues = Object.values(indegreeMap);
  const mean = indegreeValues.reduce((a, b) => a + b, 0) / indegreeValues.length;
  const variance = indegreeValues.reduce((a, b) => a + (b - mean) ** 2, 0) / indegreeValues.length;
  const stddev = Math.sqrt(variance);

  // Median indegree (for lookup detection: table must be referenced above-median)
  const sorted = [...indegreeValues].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  // ── Per-table classification ──────────────────────────────────────────────

  for (const table of tables) {
    const id = table.id;
    const cols = table.columns;
    const fkCols = cols.filter((c) => c.constraints.includes('fk'));
    const pkFkCols = cols.filter(
      (c) => c.constraints.includes('pk') && c.constraints.includes('fk')
    );
    const fkCount = fkCols.length;
    const fkRatio = cols.length === 0 ? 0 : fkCount / cols.length;
    const indegree = indegreeMap[id] ?? 0;
    const nameLower = table.name.toLowerCase();

    // External relationships (exclude self-loops)
    const externalRels = relationships.filter(
      (r) => (r.source === id || r.target === id) && r.source !== r.target
    );
    const hasSelfRef = relationships.some((r) => r.source === id && r.target === id);

    // Distinct external tables this table relates to
    const externalTargets = new Set<string>();
    for (const rel of externalRels) {
      externalTargets.add(rel.source === id ? rel.target : rel.source);
    }

    // ── Decision tree (priority order) ─────────────────────────────────────

    // 1. Self-referential: has a self-loop relationship AND no external relationships
    if (hasSelfRef && externalRels.length === 0) {
      result.set(id, 'self-referential');
      continue;
    }

    // 2. Junction: any one of three signals qualifies.
    //    Inheritance exception: composite PK FKs all pointing to a single parent → skip ratio signal.
    const isInheritancePattern = pkFkCols.length >= 2 && externalTargets.size === 1;
    const junctionByRatio = fkRatio >= 0.6 && !isInheritancePattern;
    const junctionByCompositePk = pkFkCols.length >= 2 && externalTargets.size >= 2;
    const junctionByMm = mmParticipants.has(id);
    if (junctionByRatio || junctionByCompositePk || junctionByMm) {
      result.set(id, 'junction');
      continue;
    }

    // 3. Ambiguous: FK ratio 0.4–0.59, no composite PK FKs, not M:M participant
    if (fkRatio >= 0.4 && fkRatio < 0.6 && pkFkCols.length < 2 && !mmParticipants.has(id)) {
      result.set(id, 'ambiguous');
      continue;
    }

    // 4. Lookup: naming convention match + structural guards
    //    Naming only applies when cols ≤ 6 AND fkCount ≤ 1; structure overrides for larger tables.
    const nameMatchesLookup = LOOKUP_NAME_SUFFIXES.some((s) => nameLower.endsWith(s));
    if (nameMatchesLookup && cols.length <= 6 && fkCount <= 1 && indegree > median) {
      result.set(id, 'lookup');
      continue;
    }

    // 5. Hub: in-degree outlier in a schema of ≥ 6 tables.
    //    Dual condition: > mean + 1.5σ AND ≥ 2× mean (guards against near-zero mean edge cases).
    if (
      tables.length >= 6 &&
      indegree > 0 &&
      indegree > mean + 1.5 * stddev &&
      indegree >= 2 * mean
    ) {
      result.set(id, 'hub');
      continue;
    }

    // 6. Dependent: has FK columns
    if (fkCount > 0) {
      result.set(id, 'dependent');
      continue;
    }

    // 7. Core: no FK columns (always true at this point)
    result.set(id, 'core');
  }

  return result;
}
