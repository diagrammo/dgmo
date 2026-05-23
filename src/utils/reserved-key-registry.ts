/**
 * Reserved-Key Registry — per-chart-type sets of attribute keys that
 * trigger metadata dispatch in the unified §1.4 metadata grammar.
 *
 * See `docs/dgmo-language-spec.md` §1.4.3 for the canonical table.
 *
 * Two roles:
 * - **Same-line dispatch (§1.4.1):** the parser flips into metadata
 *   mode the first time it encounters a `<key>:` token where `key`
 *   is in the registry. Everything left is the name region.
 * - **Indented dispatch (§1.4.2):** an indented `key: value` line
 *   attaches as attribute metadata to the parent ONLY when `key`
 *   is in the registry. Other indented lines fall through to the
 *   chart's structural-child grammar.
 *
 * Tag aliases declared via `tag <Group> as <x>` are added to the
 * effective registry for the duration of the parse — they are not
 * baked into these static sets.
 */

export interface ReservedKeyRegistry {
  /** Reserved attribute keys for this chart type (static). */
  readonly keys: ReadonlySet<string>;
  /** Tag aliases declared during this parse (dynamic). */
  readonly tagAliases: ReadonlySet<string>;
}

/**
 * Helper to build a registry with empty tag aliases. Parsers should
 * call `withTagAliases()` once they've collected declared aliases.
 */
function staticRegistry(keys: readonly string[]): ReservedKeyRegistry {
  return { keys: new Set(keys), tagAliases: new Set() };
}

/**
 * Return a new registry with the given tag-alias set merged in.
 * Static `keys` are unchanged; aliases overlay the registry for
 * the current parse.
 */
export function withTagAliases(
  base: ReservedKeyRegistry,
  aliases: ReadonlySet<string>
): ReservedKeyRegistry {
  return { keys: base.keys, tagAliases: aliases };
}

/**
 * Test whether `key` is recognized by this registry (either static
 * reserved key or active tag alias).
 */
export function isReservedKey(
  registry: ReservedKeyRegistry,
  key: string
): boolean {
  return registry.keys.has(key) || registry.tagAliases.has(key);
}

// ── Per-chart-type registries (matches spec §1.4.3) ──────────

export const SEQUENCE_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'role',
  'collapsed',
]);

export const INFRA_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'collapsed',
  'icon',
]);

export const ORG_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'role',
  'location',
  'email',
  'phone',
]);

export const C4_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'tech',
  'type',
  'collapsed',
]);

export const ER_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'domain',
]);

export const CLASS_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
]);

export const KANBAN_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'wip',
  'assignee',
  'due',
]);

export const SITEMAP_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'status',
]);

export const GANTT_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'progress',
  'offset',
]);

export const PERT_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'confidence',
  'collapsed',
]);

export const BOXES_AND_LINES_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'width',
  'split',
  'fanout',
]);

export const TIMELINE_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
]);

export const MINDMAP_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'collapsed',
]);

export const TECH_RADAR_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'quadrant',
  'ring',
  'trend',
]);

export const CYCLE_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'width',
  'span',
]);

/**
 * Journey-map: `score` and `emotion` replace the legacy bare-prefix
 * positional shape. Annotation keys (`pain`, `opportunity`, `thought`)
 * are also reserved so indented annotations dispatch correctly.
 */
export const JOURNEY_MAP_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'score',
  'emotion',
  'pain',
  'opportunity',
  'thought',
]);

export const PYRAMID_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
]);

export const RING_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
]);

/**
 * RACI/RASCI/DACI: only `color` and `description` are reserved as
 * attribute keys. Role names declared via `roles` block are
 * registered via a SEPARATE role-dispatch path (not through this
 * registry), because `Cap: A R` is a role assignment, not generic
 * metadata.
 */
export const RACI_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
]);

/**
 * Wireframe uses a trailing-keyword flag list (§19.5), not key-value
 * metadata. This empty registry exists so callers can still pass a
 * registry to shared helpers without a special-case.
 */
export const WIREFRAME_REGISTRY: ReservedKeyRegistry = staticRegistry([]);
