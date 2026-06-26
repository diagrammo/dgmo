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
  // Participant layout-order override (§2.2). Colon-keyed `position: N`
  // replaced the legacy bare-keyword `position N` form — a stray bare
  // `position N` now raises E_SEQUENCE_BARE_POSITION_REMOVED.
  'position',
]);

export const INFRA_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'collapsed',
  'icon',
]);

// NOTE: `color` is deliberately OMITTED (unlike sibling registries) — per
// §24B.9 the map chart type carries color as a trailing token (peeled by
// `peelTrailingColorName`) / via the tag system, not a `color:` metadata key.
// The numeric data channel is PER-ELEMENT (decision #20): `heat:` (region
// choropleth shade), `size:` (POI marker radius), `width:` (edge/leg thickness)
// — each mirrors its directive (`region-heat`/`poi-size`/`flow-width`). All three
// are reserved so a wrong-channel key (e.g. `size:` on a region) lands in meta and
// the parser can reject it (§24B.10) instead of silently becoming a tag. `style`
// is the route/edge shape key. `description`/`date` had no v1 surface (they raise
// an unknown-key error rather than silently no-op).
export const MAP_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'heat',
  'size',
  'width',
  'label',
  'style',
  // `surface:` was removed in the 2026-06-02 defaults-on review — it is no longer
  // a recognized metadata key (the route/edge surface feature was cut; §24B.7).
  // A stray `surface: water` is no longer captured as a reserved key.
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

// event-line carries the date as a §15-style line-prefix (not a key) and the
// description as a pyramid/ring-style bare indented body (not a key), so the
// only static reserved key is `color`; tag aliases are added per-parse via
// withTagAliases. See spec §28 / decision #16.
export const EVENT_LINE_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
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
  'duration',
  'offset',
  'progress',
  'start',
]);

export const PERT_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'confidence',
  'collapsed',
]);

// `width`/`split`/`fanout` were copy-pasted from an infra-flavored template
// during the §1.4 metadata migration but boxes-and-lines never read them
// (split/fanout are infra-only edge-flow keys, consumed in src/infra/*). Removed
// 2026-06-03. The numeric ramp is `heat:` (decision #20 — value→colour ramp,
// same channel word as treemap + map `region-heat`; was `value:`).
export const BOXES_AND_LINES_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'heat',
]);

export const TIMELINE_REGISTRY: ReservedKeyRegistry = staticRegistry([
  'color',
  'description',
  'duration',
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

// Treemap: only `heat` (the color-by-value metric) is a reserved attribute key.
// Node SIZE is the bare trailing number (not a `value:` key — §1.5 idiom), and
// tag application uses declared tag aliases (added dynamically via withTagAliases).
export const TREEMAP_REGISTRY: ReservedKeyRegistry = staticRegistry(['heat']);

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
