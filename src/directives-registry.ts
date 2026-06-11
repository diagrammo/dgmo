// ============================================================
// Directives Registry — single source of truth for the scattered
// per-parser vocabulary that was previously hand-duplicated between
// each parser's local literal Sets and the editor's `keywords.ts`.
// ============================================================
//
// Background (the drift this file cures): accepted vocabulary historically
// lived as un-exported literal arrays inside each parser (gantt
// `KNOWN_OPTIONS`/`KNOWN_BOOLEANS`, infra `TOP_LEVEL_OPTIONS` +
// `INFRA_BEHAVIOR_KEYS`/`EDGE_ONLY_KEYS`, map `DIRECTIVE_SET`), AND was
// re-typed by hand into `editor/keywords.ts` for highlighting. Two hand-lists
// for the same vocabulary drift apart silently.
//
// This registry is the ONE place those tokens are declared. Both sides consume
// it:
//   - the parsers derive their membership Sets from it (their local literals
//     are deleted — see gantt/map/infra parsers);
//   - `editor/keywords.ts` and `editor/highlight-api.ts` spread its highlight
//     contributions into the specializer / ATTRIBUTE_KEYS sets.
// The anti-drift guard (tests/highlight-coverage.test.ts) additionally asserts
// every registry token routes to the correct highlight set, so the three
// representations cannot diverge.
//
// SCOPE: this registry currently owns the infra / gantt / map vocab — the
// scattered-literal cases. Other chart types whose parsers use inline checks
// (no extractable Set) remain hand-declared in `keywords.ts`; folding them in
// is mechanical follow-up work, not a correctness gap (the Phase 1b guard
// covers them via rendered-role assertions).

/** Highlight role family for a bare (non-colon) token. */
export type HighlightCategory = 'directive' | 'control' | 'modifier' | 'status';

/** Which infra parser Set(s) a token belongs to. Sets overlap (slo-* are both). */
export type InfraScope = 'top-level' | 'behavior' | 'edge';

/** Which gantt parser Set(s) a token belongs to. Sets overlap (critical-path is both). */
export type GanttScope = 'option' | 'boolean';

export interface RegistryEntry {
  readonly token: string;
  /**
   * Highlight family for the bare form. Omitted when the token highlights
   * ONLY as a colon key (`colonKey`) or is intentionally not highlighted
   * (`noHighlight`).
   */
  readonly category?: HighlightCategory;
  /** Colon `key: value` property → highlights as `propertyName` (ATTRIBUTE_KEYS). */
  readonly colonKey?: boolean;
  /**
   * Parser-accepted but intentionally NOT highlighted (e.g. a default-on
   * boolean whose bare word collides with common prose). Present here so the
   * parser Set can be derived, excluded from every highlight set.
   */
  readonly noHighlight?: boolean;
  /** Infra parser Set membership (may be several). */
  readonly infra?: readonly InfraScope[];
  /** Gantt parser Set membership (may be several). */
  readonly gantt?: readonly GanttScope[];
  /** Map `DIRECTIVE_SET` membership. */
  readonly map?: boolean;
}

// ============================================================
// The registry
// ============================================================

export const DIRECTIVES_REGISTRY: readonly RegistryEntry[] = [
  // ── Infra ────────────────────────────────────────────────
  // Top-level SLO options that are ALSO accepted as node colon-properties
  // (dual membership). Highlight bare (kept in DIRECTIVE_KEYWORDS) — their
  // rarer colon form stays keyword, an accepted minor false-positive.
  {
    token: 'slo-availability',
    category: 'directive',
    infra: ['top-level', 'behavior'],
  },
  {
    token: 'slo-p90-latency-ms',
    category: 'directive',
    infra: ['top-level', 'behavior'],
  },
  {
    token: 'slo-warning-margin',
    category: 'directive',
    infra: ['top-level', 'behavior'],
  },
  // Top-level-only options (space-separated, bare).
  { token: 'default-latency-ms', category: 'directive', infra: ['top-level'] },
  { token: 'default-uptime', category: 'directive', infra: ['top-level'] },
  { token: 'default-rps', category: 'directive', infra: ['top-level'] },
  // `active-tag` is shared with gantt + map (see below).
  // Node behavior colon-keys — highlight as propertyName.
  { token: 'latency-ms', colonKey: true, infra: ['behavior'] },
  { token: 'uptime', colonKey: true, infra: ['behavior'] },
  { token: 'instances', colonKey: true, infra: ['behavior'] },
  { token: 'max-rps', colonKey: true, infra: ['behavior'] },
  { token: 'cache-hit', colonKey: true, infra: ['behavior'] },
  { token: 'firewall-block', colonKey: true, infra: ['behavior'] },
  { token: 'ratelimit-rps', colonKey: true, infra: ['behavior'] },
  { token: 'buffer', colonKey: true, infra: ['behavior'] },
  { token: 'drain-rate', colonKey: true, infra: ['behavior'] },
  { token: 'retention-hours', colonKey: true, infra: ['behavior'] },
  { token: 'partitions', colonKey: true, infra: ['behavior'] },
  { token: 'concurrency', colonKey: true, infra: ['behavior'] },
  { token: 'duration-ms', colonKey: true, infra: ['behavior'] },
  { token: 'cold-start-ms', colonKey: true, infra: ['behavior'] },
  { token: 'cb-error-threshold', colonKey: true, infra: ['behavior'] },
  { token: 'cb-latency-threshold-ms', colonKey: true, infra: ['behavior'] },
  // Edge-only colon-key.
  { token: 'rps', colonKey: true, infra: ['edge'] },

  // ── Gantt ────────────────────────────────────────────────
  { token: 'start', category: 'directive', gantt: ['option'] },
  {
    token: 'today-marker',
    category: 'directive',
    gantt: ['option', 'boolean'],
  },
  {
    token: 'critical-path',
    category: 'directive',
    gantt: ['option', 'boolean'],
  },
  { token: 'sprint-length', category: 'directive', gantt: ['option'] },
  { token: 'sprint-number', category: 'directive', gantt: ['option'] },
  { token: 'sprint-start', category: 'directive', gantt: ['option'] },
  { token: 'solid-fill', category: 'directive', gantt: ['boolean'] },
  // `chart` is a wireframe element keyword (CONTROL); gantt also accepts it as
  // an option. Highlight family is control.
  { token: 'chart', category: 'control', gantt: ['option'] },
  // `dependencies` is ON by default → almost never written bare (authors write
  // `no-dependencies`, which DOES highlight). Bare word collides with prose and
  // the specializer is context-free, so it stays plain. Present for parser
  // Set derivation only.
  { token: 'dependencies', noHighlight: true, gantt: ['option', 'boolean'] },

  // ── Map ──────────────────────────────────────────────────
  { token: 'region-metric', category: 'directive', map: true },
  { token: 'poi-metric', category: 'directive', map: true },
  { token: 'flow-metric', category: 'directive', map: true },
  { token: 'locale', category: 'directive', map: true },
  { token: 'caption', category: 'directive', map: true },
  { token: 'no-legend', category: 'directive', map: true },
  { token: 'no-coastline', category: 'directive', map: true },
  { token: 'no-relief', category: 'directive', map: true },
  { token: 'no-context-labels', category: 'directive', map: true },
  { token: 'no-region-labels', category: 'directive', map: true },
  { token: 'no-region-value', category: 'directive', map: true },
  { token: 'no-poi-labels', category: 'directive', map: true },
  { token: 'no-colorize', category: 'directive', map: true },
  { token: 'no-cities', category: 'directive', map: true },
  { token: 'no-cluster-pois', category: 'directive', map: true },

  // ── Shared across types ──────────────────────────────────
  // `active-tag`: infra top-level option + gantt option + map directive.
  {
    token: 'active-tag',
    category: 'directive',
    infra: ['top-level'],
    gantt: ['option'],
    map: true,
  },
  // `title`: gantt option (also a general data-chart directive, hand-listed).
  { token: 'title', category: 'directive', gantt: ['option'] },
  // `sort`: gantt option (also general, hand-listed).
  { token: 'sort', category: 'directive', gantt: ['option'] },
  // `no-title`: gantt boolean + map directive (also general, hand-listed).
  { token: 'no-title', category: 'directive', gantt: ['boolean'], map: true },
];

// ============================================================
// Derivations
// ============================================================

function tokensWhere(pred: (e: RegistryEntry) => boolean): Set<string> {
  const out = new Set<string>();
  for (const e of DIRECTIVES_REGISTRY) if (pred(e)) out.add(e.token);
  return out;
}

// ── Parser-facing Sets (replace the deleted local literals) ──

/** Infra top-level option keys (space-separated). */
export const INFRA_TOP_LEVEL_OPTION_SET = tokensWhere(
  (e) => !!e.infra?.includes('top-level')
);
/** Infra node behavior property keys (colon `key: value`). */
export const INFRA_BEHAVIOR_KEY_SET = tokensWhere(
  (e) => !!e.infra?.includes('behavior')
);
/** Infra edge-only property keys (colon `key: value`). */
export const INFRA_EDGE_ONLY_KEY_SET = tokensWhere(
  (e) => !!e.infra?.includes('edge')
);
/** Gantt option keys (space-separated). */
export const GANTT_OPTION_SET = tokensWhere(
  (e) => !!e.gantt?.includes('option')
);
/** Gantt boolean keys (bare or `no-` prefixed). */
export const GANTT_BOOLEAN_SET = tokensWhere(
  (e) => !!e.gantt?.includes('boolean')
);
/** Map directive keys. */
export const MAP_DIRECTIVE_KEY_SET = tokensWhere((e) => e.map === true);

// ── Highlight-facing contributions ──────────────────────────

/** Bare tokens that highlight as a keyword/directive (→ DIRECTIVE_KEYWORDS). */
export const REGISTRY_DIRECTIVE_TOKENS = tokensWhere(
  (e) => e.category === 'directive' && !e.colonKey && !e.noHighlight
);
/** Bare tokens that highlight as a control keyword (→ CONTROL_KEYWORDS). */
export const REGISTRY_CONTROL_TOKENS = tokensWhere(
  (e) => e.category === 'control' && !e.colonKey && !e.noHighlight
);
/** Colon `key: value` tokens that highlight as propertyName (→ ATTRIBUTE_KEYS). */
export const REGISTRY_COLON_KEY_TOKENS = tokensWhere((e) => !!e.colonKey);
/** Parser-accepted tokens deliberately excluded from every highlight set. */
export const REGISTRY_NON_HIGHLIGHT_TOKENS = tokensWhere(
  (e) => !!e.noHighlight
);
