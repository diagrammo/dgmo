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
  // ── Universal date handling (§ BL-121) ───────────────────
  // Accepted in every date-bearing chart (gantt, pert, countdown, timeline,
  // event-line). Handled inline by each parser's prescan — no parser-Set
  // membership here — so they only contribute highlighting (DIRECTIVE_KEYWORDS).
  { token: 'year', category: 'directive' },
  { token: 'date-order', category: 'directive' },
  { token: 'no-current-year', category: 'directive' },

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
  { token: 'fill-tint', category: 'directive', gantt: ['boolean'] },
  { token: 'fill-solid', category: 'directive', gantt: ['boolean'] },
  { token: 'fill-outline', category: 'directive', gantt: ['boolean'] },
  // `chart` is a wireframe element keyword (CONTROL); gantt also accepts it as
  // an option. Highlight family is control.
  { token: 'chart', category: 'control', gantt: ['option'] },
  // `dependencies` is ON by default → almost never written bare (authors write
  // `no-dependencies`, which DOES highlight). Bare word collides with prose and
  // the specializer is context-free, so it stays plain. Present for parser
  // Set derivation only.
  { token: 'dependencies', noHighlight: true, gantt: ['option', 'boolean'] },

  // ── Map ──────────────────────────────────────────────────
  // Per-element value→channel ramps (decision #20): the directive names the
  // visual channel — `region-heat` (colour), `poi-size` (marker area),
  // `flow-width` (stroke). The per-element key mirrors it (`heat:`/`size:`/`width:`).
  { token: 'region-heat', category: 'directive', map: true },
  { token: 'poi-size', category: 'directive', map: true },
  { token: 'flow-width', category: 'directive', map: true },
  { token: 'locale', category: 'directive', map: true },
  { token: 'caption', category: 'directive', map: true },
  { token: 'no-legend', category: 'directive', map: true },
  { token: 'no-coastline', category: 'directive', map: true },
  { token: 'no-relief', category: 'directive', map: true },
  { token: 'no-context-labels', category: 'directive', map: true },
  { token: 'no-region-labels', category: 'directive', map: true },
  { token: 'no-region-heat-value', category: 'directive', map: true },
  { token: 'no-poi-labels', category: 'directive', map: true },
  { token: 'no-colorize', category: 'directive', map: true },
  { token: 'no-cities', category: 'directive', map: true },
  { token: 'no-cluster-pois', category: 'directive', map: true },
  // ── Clock channel (BL-122): live local-time cards on POIs flagged `clock` ──
  // Activation is the per-POI `clock` flag (peeled in the map parser, not a
  // directive). `hours 9-17` / `days mon-fri` are the global availability
  // window (reused verbatim from the clock chart type).
  { token: 'hours', category: 'directive', map: true },
  { token: 'days', category: 'directive', map: true },

  // ── Shared across types ──────────────────────────────────
  // `active-tag`: infra top-level option + gantt option + map directive.
  // Treemap also accepts it (§24C.6, decision #48) — validated inline in its
  // parser, so no chart-scoped Set is derived for it; highlighting comes from
  // the global directive category here.
  {
    token: 'active-tag',
    category: 'directive',
    infra: ['top-level'],
    gantt: ['option'],
    map: true,
  },
  // `title`: gantt option. (The data-chart `title` directive was removed in
  // decision #48 — it now raises E_TITLE_DIRECTIVE; the token stays here for
  // gantt.)
  { token: 'title', category: 'directive', gantt: ['option'] },
  // `sort`: gantt option (also general, hand-listed).
  { token: 'sort', category: 'directive', gantt: ['option'] },
  // `lane-by <group>`: swimlane axis (view-state). NB not `swimlane` — that's a
  // chart type. Kanban reads it via its own KNOWN_OPTIONS; gantt via the switch.
  { token: 'lane-by', category: 'directive', gantt: ['option'] },
  // `no-title`: gantt boolean + map directive (also general, hand-listed).
  { token: 'no-title', category: 'directive', gantt: ['boolean'], map: true },

  // ══════════════════════════════════════════════════════════
  // Highlight-only vocab (no extractable parser Set).
  // ══════════════════════════════════════════════════════════
  // These chart types validate their directives with inline checks rather than
  // a literal Set, so there is no parser literal to delete — the registry is
  // simply their single declaration site for highlighting. Grouped by chart
  // type. Categories route to the specializer-read sets in keywords.ts.

  // ── Gantt (extras beyond the option/boolean Sets) ────────
  { token: 'era', category: 'directive' },
  { token: 'marker', category: 'directive' },
  { token: 'holiday', category: 'directive' },
  // `workweek` is also the canonical weekday-window directive on clock and map
  // clock-cards (decision #48; `days` stays as the legacy alias).
  { token: 'workweek', category: 'directive', map: true },
  { token: 'no-dependencies', category: 'directive' },
  // ── Tech-radar ───────────────────────────────────────────
  { token: 'rings', category: 'directive' },
  // Blip listing is default-on everywhere (decision #48): `no-blip-legend`
  // suppresses it; `show-blip-legend` stays as the parse-accepted legacy no-op.
  { token: 'no-blip-legend', category: 'directive' },
  { token: 'show-blip-legend', category: 'directive' },
  { token: 'trend', category: 'directive' },
  // ── Tags / shared directives ─────────────────────────────
  { token: 'tags', category: 'directive' },
  { token: 'import', category: 'directive' },
  { token: 'hide', category: 'directive' },
  { token: 'direction', category: 'directive' },
  // ── Clock ────────────────────────────────────────────────
  // The board's flat directives — highlight-only (the parser validates them
  // inline, no extractable Set). `no-title` + `direction` are already listed
  // above (shared). Values (analog is a bare flag; color-by's
  // place|work|daylight|time|none) highlight as plain tokens.
  { token: 'analog', category: 'directive' },
  { token: 'hours', category: 'directive' },
  { token: 'days', category: 'directive' },
  { token: 'no-sun', category: 'directive' },
  { token: 'time-24', category: 'directive' },
  { token: 'color-by', category: 'directive' },
  // ── Boxes-and-lines ──────────────────────────────────────
  // `heat <Label> [low] [high]` is the value→colour ramp directive, but `heat`
  // is NOT registered as a directive keyword: it is dual-use with the `heat:`
  // metadata key (decision #20), and a token in DIRECTIVE_KEYWORDS would block the
  // ATTRIBUTE_KEYS colon-gate from reclassifying `heat:` as a propertyName. So
  // `heat` lives only in the reserved-key registry + ATTRIBUTE_KEYS and highlights
  // as a property in both positions — exactly the treemap `heat` precedent.
  // Box values render by default since decision #48; `show-values` stays as
  // the parse-accepted legacy no-op (suppress with the shared `no-value`).
  { token: 'show-values', category: 'directive' },
  // ── Swimlane ─────────────────────────────────────────────
  { token: 'lane', category: 'directive' },
  // ── ER ───────────────────────────────────────────────────
  { token: 'notation', category: 'directive' },
  // ── Class ────────────────────────────────────────────────
  { token: 'extends', category: 'directive' },
  { token: 'implements', category: 'directive' },
  { token: 'abstract', category: 'directive' },
  { token: 'interface', category: 'directive' },
  { token: 'enum', category: 'directive' },
  // ── C4 ───────────────────────────────────────────────────
  { token: 'containers', category: 'directive' },
  { token: 'components', category: 'directive' },
  { token: 'deployment', category: 'directive' },
  { token: 'technology', category: 'directive' },
  // ── Infra (directives beyond the option/behavior Sets) ───
  { token: 'sub-node-label', category: 'directive' },
  { token: 'show-sub-node-count', category: 'directive' },
  { token: 'animate', category: 'directive' },
  // ── Sequence ─────────────────────────────────────────────
  { token: 'activations', category: 'directive' },
  { token: 'no-activations', category: 'directive' },
  // ── Map element leaders (not in DIRECTIVE_SET) ───────────
  { token: 'poi', category: 'directive' },
  { token: 'route', category: 'directive' },
  // ── Data charts ──────────────────────────────────────────
  { token: 'stacked', category: 'directive' },
  { token: 'no-name', category: 'directive' },
  { token: 'no-value', category: 'directive' },
  { token: 'no-percent', category: 'directive' },
  { token: 'series', category: 'directive' },
  { token: 'orientation', category: 'directive' },
  { token: 'x-label', category: 'directive' },
  { token: 'y-label', category: 'directive' },
  { token: 'size-label', category: 'directive' },
  { token: 'columns', category: 'directive' },
  { token: 'rows', category: 'directive' },
  { token: 'labels', category: 'directive' },
  { token: 'rotate', category: 'directive' },
  { token: 'scale', category: 'directive' },
  { token: 'values', category: 'directive' },
  { token: 'orientation-horizontal', category: 'directive' },
  // ── Slope ────────────────────────────────────────────────
  { token: 'period', category: 'directive' },
  // ── Quadrant ─────────────────────────────────────────────
  { token: 'x-axis', category: 'directive' },
  { token: 'y-axis', category: 'directive' },
  { token: 'top-right', category: 'directive' },
  { token: 'top-left', category: 'directive' },
  { token: 'bottom-right', category: 'directive' },
  { token: 'bottom-left', category: 'directive' },
  // ── Layout (cross-chart) ─────────────────────────────────
  { token: 'direction-tb', category: 'directive' },
  { token: 'direction-lr', category: 'directive' },
  { token: 'orientation-vertical', category: 'directive' },
  // ── Pyramid ──────────────────────────────────────────────
  { token: 'inverted', category: 'directive' },
  // ── Color / notes (cross-chart) ──────────────────────────
  { token: 'color', category: 'directive' },
  { token: 'no-notes', category: 'directive' },
  // ── RACI ─────────────────────────────────────────────────
  { token: 'roles', category: 'directive' },
  // ── Cycle ────────────────────────────────────────────────
  { token: 'direction-counterclockwise', category: 'directive' },
  { token: 'circle-nodes', category: 'directive' },
  // ── Journey-map ──────────────────────────────────────────
  { token: 'persona', category: 'directive' },
  // ── Function ─────────────────────────────────────────────
  { token: 'x', category: 'directive' },
  { token: 'shade', category: 'directive' },
  // ── Wordcloud ────────────────────────────────────────────
  { token: 'max', category: 'directive' },
  { token: 'size', category: 'directive' },
  // ── Arc ──────────────────────────────────────────────────
  { token: 'order', category: 'directive' },
  // ── PERT ─────────────────────────────────────────────────
  { token: 'time-unit', category: 'directive' },
  { token: 'default-confidence', category: 'directive' },
  { token: 'node-detail', category: 'directive' },
  { token: 'trials', category: 'directive' },
  { token: 'seed', category: 'directive' },
  { token: 'scrubber-trials', category: 'directive' },
  // `start-date` is also gantt's canonical project-start option (decision #48;
  // bare `start` above stays as the legacy alias).
  { token: 'start-date', category: 'directive', gantt: ['option'] },
  { token: 'end-date', category: 'directive' },
  // ── Goal ─────────────────────────────────────────────────
  // Mode flags, value-key leaders, and opt-outs. `now`/`target` collide with
  // label prose ("start now", "on target"), but the arrow-label demotion pass
  // (see highlight-api LABEL_WORD_NODES) treats any keyword-bearing label as
  // text and demotes them, so they highlight only as line leaders.
  { token: 'thermometer', category: 'directive' },
  { token: 'gauge', category: 'directive' },
  { token: 'now', category: 'directive' },
  { token: 'target', category: 'directive' },
  { token: 'no-note', category: 'directive' },
  { token: 'no-auto-color', category: 'directive' },

  // ── Control-flow + wireframe element keywords (CONTROL) ──
  { token: 'if', category: 'control' },
  { token: 'else', category: 'control' },
  { token: 'loop', category: 'control' },
  { token: 'parallel', category: 'control' },
  { token: 'note', category: 'control' },
  { token: 'nav', category: 'control' },
  { token: 'tabs', category: 'control' },
  { token: 'table', category: 'control' },
  { token: 'image', category: 'control' },
  { token: 'modal', category: 'control' },
  { token: 'skeleton', category: 'control' },
  { token: 'alert', category: 'control' },
  { token: 'progress', category: 'control' },
  { token: 'mobile', category: 'control' },

  // ── Kanban status keywords (STATUS) ──────────────────────
  { token: 'na', category: 'status' },
  { token: 'todo', category: 'status' },
  { token: 'wip', category: 'status' },
  { token: 'done', category: 'status' },
  { token: 'blocked', category: 'status' },
  { token: 'in-progress', category: 'status' },
  { token: 'backlog', category: 'status' },
  { token: 'ready', category: 'status' },

  // ── Modifiers + ER column types/modifiers (MODIFIER) ─────
  { token: 'as', category: 'modifier' },
  { token: 'alias', category: 'modifier' },
  { token: 'aka', category: 'modifier' },
  { token: 'position', category: 'modifier' },
  { token: 'default', category: 'modifier' },
  { token: 'pk', category: 'modifier' },
  { token: 'fk', category: 'modifier' },
  { token: 'nullable', category: 'modifier' },
  { token: 'unique', category: 'modifier' },
  { token: 'int', category: 'modifier' },
  { token: 'varchar', category: 'modifier' },
  { token: 'text', category: 'modifier' },
  { token: 'boolean', category: 'modifier' },
  { token: 'date', category: 'modifier' },
  { token: 'timestamp', category: 'modifier' },
  { token: 'float', category: 'modifier' },
  { token: 'decimal', category: 'modifier' },

  // ── Bracket ──────────────────────────────────────────────
  // `beats` / `vs` are the infix match keywords; the rest are line directives.
  // (`seed` and `no-legend` already appear above — shared, not re-listed.)
  { token: 'beats', category: 'control' },
  { token: 'vs', category: 'control' },
  { token: 'rounds', category: 'directive' },
  { token: 'accent', category: 'directive' },
  { token: 'no-round', category: 'modifier' },
  { token: 'no-rounds', category: 'modifier' },
  { token: 'single-elim', category: 'modifier' },
  { token: 'double-elim', category: 'modifier' },
  { token: 'seeded', category: 'modifier' },
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
/** Bare tokens that highlight as a status keyword (→ STATUS_KEYWORDS). */
export const REGISTRY_STATUS_TOKENS = tokensWhere(
  (e) => e.category === 'status' && !e.colonKey && !e.noHighlight
);
/** Bare tokens that highlight as a modifier keyword (→ MODIFIER_KEYWORDS). */
export const REGISTRY_MODIFIER_TOKENS = tokensWhere(
  (e) => e.category === 'modifier' && !e.colonKey && !e.noHighlight
);
/** Colon `key: value` tokens that highlight as propertyName (→ ATTRIBUTE_KEYS). */
export const REGISTRY_COLON_KEY_TOKENS = tokensWhere((e) => !!e.colonKey);
/** Parser-accepted tokens deliberately excluded from every highlight set. */
export const REGISTRY_NON_HIGHLIGHT_TOKENS = tokensWhere(
  (e) => !!e.noHighlight
);
