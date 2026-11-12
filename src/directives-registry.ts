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

import type { ChartTypeId } from './chart-types';
import { GLYPH_NAMES } from './glyphs/registry';

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
  /**
   * The chart types in which the bare form highlights as a keyword (#1734).
   * `'all'` means every chart type. The editor's context tracker
   * (`editor/tokens.ts`) reads the chart type off the document's first line
   * and leaves a token as plain text in a chart type this list does not
   * name. A document whose first line names no chart type highlights every
   * token, as before. Derived 2026-11-06 from `COMPLETION_REGISTRY`,
   * `STRUCTURAL_KEYWORDS`, `ENTITY_TYPES`, `PIPE_METADATA`, the infra / gantt
   * / map fields above, and the section comments; `'all'` where none of
   * those named a type. Highlighting only — no parser reads it.
   */
  readonly chartTypes: readonly ChartTypeId[] | 'all';
}

// ============================================================
// The registry
// ============================================================

export const DIRECTIVES_REGISTRY: readonly RegistryEntry[] = [
  // ── Universal date handling (§ BL-121) ───────────────────
  // Accepted in every date-bearing chart (gantt, pert, countdown, timeline,
  // event-line). Handled inline by each parser's prescan — no parser-Set
  // membership here — so they only contribute highlighting (DIRECTIVE_KEYWORDS).
  {
    token: 'year',
    category: 'directive',
    chartTypes: ['countdown', 'event-line', 'gantt', 'pert', 'timeline'],
  },
  {
    token: 'date-order',
    category: 'directive',
    chartTypes: ['countdown', 'event-line', 'gantt', 'pert', 'timeline'],
  },
  {
    token: 'no-current-year',
    category: 'directive',
    chartTypes: ['countdown', 'event-line', 'gantt', 'pert', 'timeline'],
  },

  // ── Infra ────────────────────────────────────────────────
  // Top-level SLO options that are ALSO accepted as node colon-properties
  // (dual membership). Highlight bare (kept in DIRECTIVE_KEYWORDS) — their
  // rarer colon form stays keyword, an accepted minor false-positive.
  {
    token: 'slo-availability',
    category: 'directive',
    infra: ['top-level', 'behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'slo-p90-latency-ms',
    category: 'directive',
    infra: ['top-level', 'behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'slo-warning-margin',
    category: 'directive',
    infra: ['top-level', 'behavior'],
    chartTypes: ['infra'],
  },
  // Top-level-only options (space-separated, bare).
  {
    token: 'default-latency-ms',
    category: 'directive',
    infra: ['top-level'],
    chartTypes: ['infra'],
  },
  {
    token: 'default-uptime',
    category: 'directive',
    infra: ['top-level'],
    chartTypes: ['infra'],
  },
  {
    token: 'default-rps',
    category: 'directive',
    infra: ['top-level'],
    chartTypes: ['infra'],
  },
  // `active-tag` is shared with gantt + map (see below).
  // Node behavior colon-keys — highlight as propertyName.
  {
    token: 'latency-ms',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'uptime',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'instances',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'max-rps',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'cache-hit',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'firewall-block',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'ratelimit-rps',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'buffer',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'drain-rate',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'retention-hours',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'partitions',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'concurrency',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'duration-ms',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'cold-start-ms',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'cb-error-threshold',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  {
    token: 'cb-latency-threshold-ms',
    colonKey: true,
    infra: ['behavior'],
    chartTypes: ['infra'],
  },
  // Edge-only colon-key.
  { token: 'rps', colonKey: true, infra: ['edge'], chartTypes: ['infra'] },

  // ── Gantt ────────────────────────────────────────────────
  {
    token: 'start',
    category: 'directive',
    gantt: ['option'],
    chartTypes: ['gantt'],
  },
  {
    token: 'today-marker',
    category: 'directive',
    gantt: ['option', 'boolean'],
    chartTypes: ['gantt'],
  },
  {
    token: 'critical-path',
    category: 'directive',
    gantt: ['option', 'boolean'],
    chartTypes: ['gantt'],
  },
  {
    token: 'sprint-length',
    category: 'directive',
    gantt: ['option'],
    chartTypes: ['gantt', 'pert'],
  },
  {
    token: 'sprint-number',
    category: 'directive',
    gantt: ['option'],
    chartTypes: ['gantt', 'pert'],
  },
  {
    token: 'sprint-start',
    category: 'directive',
    gantt: ['option'],
    chartTypes: ['gantt', 'pert'],
  },
  {
    token: 'fill-tint',
    category: 'directive',
    gantt: ['boolean'],
    chartTypes: [
      'arc',
      'bar',
      'block',
      'body',
      'boxes-and-lines',
      'bracket',
      'c4',
      'class',
      'clock',
      'countdown',
      'cycle',
      'er',
      'event-line',
      'family',
      'flowchart',
      'funnel',
      'gantt',
      'goal',
      'heatmap',
      'journey-map',
      'kanban',
      'line',
      'mindmap',
      'org',
      'pert',
      'pie',
      'polar-area',
      'pyramid',
      'quadrant',
      'raci',
      'radar',
      'ring',
      'scatter',
      'sequence',
      'sitemap',
      'state',
      'swimlane',
      'timeline',
      'treemap',
      'venn',
      'wireframe',
    ],
  },
  {
    token: 'fill-solid',
    category: 'directive',
    gantt: ['boolean'],
    chartTypes: [
      'arc',
      'bar',
      'block',
      'body',
      'boxes-and-lines',
      'bracket',
      'c4',
      'class',
      'clock',
      'countdown',
      'cycle',
      'er',
      'event-line',
      'family',
      'flowchart',
      'funnel',
      'gantt',
      'goal',
      'heatmap',
      'journey-map',
      'kanban',
      'line',
      'mindmap',
      'org',
      'pert',
      'pie',
      'polar-area',
      'pyramid',
      'quadrant',
      'raci',
      'radar',
      'ring',
      'scatter',
      'sequence',
      'sitemap',
      'state',
      'swimlane',
      'timeline',
      'treemap',
      'venn',
      'wireframe',
    ],
  },
  {
    token: 'fill-outline',
    category: 'directive',
    gantt: ['boolean'],
    chartTypes: [
      'arc',
      'bar',
      'block',
      'body',
      'boxes-and-lines',
      'bracket',
      'c4',
      'class',
      'clock',
      'countdown',
      'cycle',
      'er',
      'event-line',
      'family',
      'flowchart',
      'funnel',
      'gantt',
      'goal',
      'heatmap',
      'journey-map',
      'kanban',
      'line',
      'mindmap',
      'org',
      'pert',
      'pie',
      'polar-area',
      'pyramid',
      'quadrant',
      'raci',
      'radar',
      'ring',
      'scatter',
      'sequence',
      'sitemap',
      'state',
      'swimlane',
      'timeline',
      'treemap',
      'venn',
      'wireframe',
    ],
  },
  // `chart` is a wireframe element keyword (CONTROL); gantt also accepts it as
  // an option. Highlight family is control.
  {
    token: 'chart',
    category: 'control',
    gantt: ['option'],
    chartTypes: ['gantt', 'wireframe'],
  },
  // `dependencies` is ON by default → almost never written bare (authors write
  // `no-dependencies`, which DOES highlight). Bare word collides with prose and
  // it would colour in every gantt task name, so it stays plain. Present for
  // parser Set derivation only.
  {
    token: 'dependencies',
    noHighlight: true,
    gantt: ['option', 'boolean'],
    chartTypes: ['gantt'],
  },

  // ── Map ──────────────────────────────────────────────────
  // Per-element value→channel ramps (decision #20): the directive names the
  // visual channel — `region-heat` (colour), `poi-size` (marker area),
  // `flow-width` (stroke). The per-element key mirrors it (`heat:`/`size:`/`width:`).
  {
    token: 'region-heat',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  { token: 'poi-size', category: 'directive', map: true, chartTypes: ['map'] },
  {
    token: 'flow-width',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  { token: 'locale', category: 'directive', map: true, chartTypes: ['map'] },
  // ── Chart frame (#1827): every chart type draws it ──
  { token: 'subtitle', category: 'directive', chartTypes: 'all' },
  { token: 'source', category: 'directive', chartTypes: 'all' },
  { token: 'footnote', category: 'directive', chartTypes: 'all' },
  { token: 'byline', category: 'directive', chartTypes: 'all' },
  {
    token: 'no-coastline',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  { token: 'no-relief', category: 'directive', map: true, chartTypes: ['map'] },
  {
    token: 'no-context-labels',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  {
    token: 'no-region-labels',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  {
    token: 'no-region-heat-value',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  {
    token: 'no-poi-labels',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  {
    token: 'no-colorize',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  { token: 'no-cities', category: 'directive', map: true, chartTypes: ['map'] },
  {
    token: 'no-cluster-pois',
    category: 'directive',
    map: true,
    chartTypes: ['map'],
  },
  // ── Clock channel (BL-122): live local-time cards on POIs flagged `clock` ──
  // Activation is the per-POI `clock` flag (peeled in the map parser, not a
  // directive). `hours 9-17` / `days mon-fri` are the global availability
  // window (reused verbatim from the clock chart type).
  {
    token: 'hours',
    category: 'directive',
    map: true,
    chartTypes: ['clock', 'map'],
  },
  { token: 'days', category: 'directive', map: true, chartTypes: ['map'] },

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
    chartTypes: [
      'body',
      'boxes-and-lines',
      'c4',
      'er',
      'event-line',
      'family',
      'gantt',
      'infra',
      'journey-map',
      'kanban',
      'map',
      'mindmap',
      'org',
      'pert',
      'sequence',
      'sitemap',
      'state',
      'swimlane',
      'timeline',
      'treemap',
      'wireframe',
    ],
  },
  // `title`: gantt option. (The data-chart `title` directive was removed in
  // decision #48 — it now raises E_TITLE_DIRECTIVE; the token stays here for
  // gantt.)
  {
    token: 'title',
    category: 'directive',
    gantt: ['option'],
    chartTypes: ['gantt'],
  },
  // `sort`: gantt option (also general, hand-listed).
  {
    token: 'sort',
    category: 'directive',
    gantt: ['option'],
    chartTypes: 'all',
  },
  // `lane-by <group>`: swimlane axis (view-state). NB not `swimlane` — that's a
  // chart type. Kanban reads it via its own KNOWN_OPTIONS; gantt via the switch.
  {
    token: 'lane-by',
    category: 'directive',
    gantt: ['option'],
    chartTypes: 'all',
  },
  // `no-title`: gantt boolean + map directive (also general, hand-listed).
  {
    token: 'no-title',
    category: 'directive',
    gantt: ['boolean'],
    map: true,
    chartTypes: 'all',
  },
  // `no-legend`: universal (decision #48) — every chart that renders a legend
  // accepts it, and charts without one take it as a harmless no-op. Parsed for
  // most types via GLOBAL_BOOLEANS in utils/parsing; gantt derives its boolean
  // Set from here, and map from `map: true`.
  {
    token: 'no-legend',
    category: 'directive',
    gantt: ['boolean'],
    map: true,
    chartTypes: 'all',
  },
  // `legend-inline`: universal §1.9 boolean (decision #50) — the top-center-
  // legend data charts (bar/line/radar/scatter/function) render the title and
  // legend on one line; every other chart accepts it as a harmless no-op.
  {
    token: 'legend-inline',
    category: 'directive',
    gantt: ['boolean'],
    map: true,
    chartTypes: 'all',
  },

  // ══════════════════════════════════════════════════════════
  // Highlight-only vocab (no extractable parser Set).
  // ══════════════════════════════════════════════════════════
  // These chart types validate their directives with inline checks rather than
  // a literal Set, so there is no parser literal to delete — the registry is
  // simply their single declaration site for highlighting. Grouped by chart
  // type. Categories route to the specializer-read sets in keywords.ts.

  // ── Gantt (extras beyond the option/boolean Sets) ────────
  {
    token: 'era',
    category: 'directive',
    chartTypes: [
      'bar',
      'gantt',
      'line',
      'pie',
      'polar-area',
      'radar',
      'timeline',
    ],
  },
  { token: 'marker', category: 'directive', chartTypes: ['gantt', 'timeline'] },
  { token: 'holiday', category: 'directive', chartTypes: ['gantt'] },
  // `workweek` is also the canonical weekday-window directive on clock and map
  // clock-cards (decision #48; `days` stays as the legacy alias).
  {
    token: 'workweek',
    category: 'directive',
    map: true,
    chartTypes: ['clock', 'gantt', 'map'],
  },
  { token: 'no-dependencies', category: 'directive', chartTypes: ['gantt'] },
  // ── Tech-radar ───────────────────────────────────────────
  { token: 'rings', category: 'directive', chartTypes: ['tech-radar'] },
  // Blip listing is default-on everywhere (decision #48): `no-blip-legend`
  // suppresses it; `show-blip-legend` stays as the parse-accepted legacy no-op.
  {
    token: 'no-blip-legend',
    category: 'directive',
    chartTypes: ['tech-radar'],
  },
  {
    token: 'show-blip-legend',
    category: 'directive',
    chartTypes: ['tech-radar'],
  },
  { token: 'trend', category: 'directive', chartTypes: ['tech-radar'] },
  // ── Tags / shared directives ─────────────────────────────
  { token: 'tags', category: 'directive', chartTypes: 'all' },
  { token: 'import', category: 'directive', chartTypes: 'all' },
  {
    token: 'hide',
    category: 'directive',
    chartTypes: ['boxes-and-lines', 'kanban', 'org'],
  },
  // `focus <name>`: org subtree drill-down (view-state, source-backed) — the
  // export re-roots to that person/team with the ancestor breadcrumb trail.
  // Org reads it via its own KNOWN_OPTIONS; registered here for highlighting.
  { token: 'focus', category: 'directive', chartTypes: ['org'] },
  { token: 'direction', category: 'directive', chartTypes: 'all' },
  // ── Clock ────────────────────────────────────────────────
  // The board's flat directives — highlight-only (the parser validates them
  // inline, no extractable Set). `no-title` + `direction` are already listed
  // above (shared). Values (analog is a bare flag; color-by's
  // place|work|daylight|time|none) highlight as plain tokens.
  { token: 'analog', category: 'directive', chartTypes: ['clock'] },
  { token: 'hours', category: 'directive', chartTypes: ['clock'] },
  { token: 'days', category: 'directive', chartTypes: ['clock'] },
  { token: 'no-sun', category: 'directive', chartTypes: ['clock'] },
  { token: 'time-24', category: 'directive', chartTypes: ['clock'] },
  { token: 'color-by', category: 'directive', chartTypes: ['clock'] },
  // ── Boxes-and-lines ──────────────────────────────────────
  // `heat <Label> [low] [high]` is the value→colour ramp directive, but `heat`
  // is NOT registered as a directive keyword: it is dual-use with the `heat:`
  // metadata key (decision #20), and a token in DIRECTIVE_KEYWORDS would block the
  // ATTRIBUTE_KEYS colon-gate from reclassifying `heat:` as a propertyName. So
  // `heat` lives only in the reserved-key registry + ATTRIBUTE_KEYS and highlights
  // as a property in both positions — exactly the treemap `heat` precedent.
  // Box values render by default since decision #48; `show-values` stays as
  // the parse-accepted legacy no-op (suppress with the shared `no-value`).
  {
    token: 'show-values',
    category: 'directive',
    chartTypes: ['boxes-and-lines'],
  },
  // Treemap's legacy plural spelling of the same suppression (decision #48
  // made the shared singular `no-value` canonical). Registered so a legacy
  // document still highlights it as a directive rather than plain text.
  { token: 'no-values', category: 'directive', chartTypes: ['treemap'] },
  // ── Swimlane ─────────────────────────────────────────────
  { token: 'lane', category: 'directive', chartTypes: ['swimlane'] },
  // ── ER ───────────────────────────────────────────────────
  { token: 'notation', category: 'directive', chartTypes: ['er'] },
  // ── Class ────────────────────────────────────────────────
  { token: 'extends', category: 'directive', chartTypes: ['class'] },
  { token: 'implements', category: 'directive', chartTypes: ['class'] },
  { token: 'abstract', category: 'directive', chartTypes: ['class'] },
  { token: 'interface', category: 'directive', chartTypes: ['class'] },
  { token: 'enum', category: 'directive', chartTypes: ['class'] },
  // ── C4 ───────────────────────────────────────────────────
  { token: 'containers', category: 'directive', chartTypes: ['c4'] },
  { token: 'components', category: 'directive', chartTypes: ['c4'] },
  { token: 'deployment', category: 'directive', chartTypes: ['c4'] },
  { token: 'technology', category: 'directive', chartTypes: ['c4'] },
  // ── Infra (directives beyond the option/behavior Sets) ───
  { token: 'sub-node-label', category: 'directive', chartTypes: ['org'] },
  { token: 'show-sub-node-count', category: 'directive', chartTypes: ['org'] },
  { token: 'animate', category: 'directive', chartTypes: ['infra'] },
  // ── Sequence ─────────────────────────────────────────────
  { token: 'activations', category: 'directive', chartTypes: ['sequence'] },
  { token: 'no-activations', category: 'directive', chartTypes: ['sequence'] },
  {
    token: 'autonumber',
    category: 'directive',
    chartTypes: ['sequence', 'cycle'],
  },
  // ── Map element leaders (not in DIRECTIVE_SET) ───────────
  { token: 'poi', category: 'directive', chartTypes: ['map'] },
  { token: 'route', category: 'directive', chartTypes: ['map'] },
  // ── Data charts ──────────────────────────────────────────
  { token: 'stacked', category: 'directive', chartTypes: 'all' },
  {
    token: 'no-name',
    category: 'directive',
    chartTypes: ['funnel', 'pie', 'polar-area', 'scatter'],
  },
  {
    token: 'no-value',
    category: 'directive',
    chartTypes: [
      'bar',
      'boxes-and-lines',
      'funnel',
      'goal',
      'heatmap',
      'line',
      'pie',
      'polar-area',
      'radar',
      'treemap',
    ],
  },
  {
    token: 'no-percent',
    category: 'directive',
    chartTypes: ['funnel', 'goal', 'pie', 'polar-area', 'treemap'],
  },
  {
    token: 'series',
    category: 'directive',
    chartTypes: [
      'bar',
      'function',
      'funnel',
      'heatmap',
      'line',
      'pie',
      'polar-area',
      'radar',
      'sankey',
      'scatter',
    ],
  },
  { token: 'orientation', category: 'directive', chartTypes: 'all' },
  {
    token: 'x-label',
    category: 'directive',
    chartTypes: ['bar', 'function', 'line', 'quadrant', 'scatter'],
  },
  {
    token: 'y-label',
    category: 'directive',
    chartTypes: ['bar', 'function', 'line', 'quadrant', 'scatter'],
  },
  { token: 'size-label', category: 'directive', chartTypes: ['scatter'] },
  { token: 'columns', category: 'directive', chartTypes: ['block', 'heatmap'] },
  { token: 'rows', category: 'directive', chartTypes: 'all' },
  { token: 'labels', category: 'directive', chartTypes: 'all' },
  { token: 'rotate', category: 'directive', chartTypes: ['wordcloud'] },
  { token: 'scale', category: 'directive', chartTypes: 'all' },
  {
    token: 'values',
    category: 'directive',
    chartTypes: ['pert', 'tech-radar'],
  },
  {
    token: 'orientation-horizontal',
    category: 'directive',
    chartTypes: ['bar'],
  },
  // ── Slope ────────────────────────────────────────────────
  { token: 'period', category: 'directive', chartTypes: 'all' },
  // ── Quadrant ─────────────────────────────────────────────
  { token: 'x-axis', category: 'directive', chartTypes: 'all' },
  { token: 'y-axis', category: 'directive', chartTypes: 'all' },
  {
    token: 'top-right',
    category: 'directive',
    chartTypes: ['quadrant', 'tech-radar'],
  },
  {
    token: 'top-left',
    category: 'directive',
    chartTypes: ['quadrant', 'tech-radar'],
  },
  {
    token: 'bottom-right',
    category: 'directive',
    chartTypes: ['quadrant', 'tech-radar'],
  },
  {
    token: 'bottom-left',
    category: 'directive',
    chartTypes: ['quadrant', 'tech-radar'],
  },
  // ── Layout (cross-chart) ─────────────────────────────────
  {
    token: 'direction-tb',
    category: 'directive',
    chartTypes: [
      'boxes-and-lines',
      'c4',
      'clock',
      'flowchart',
      'infra',
      'org',
      'pert',
      'sitemap',
      'state',
      'swimlane',
      'version-control',
    ],
  },
  {
    token: 'direction-lr',
    category: 'directive',
    chartTypes: [
      'boxes-and-lines',
      'c4',
      'clock',
      'flowchart',
      'infra',
      'org',
      'pert',
      'sitemap',
      'state',
      'swimlane',
      'version-control',
    ],
  },
  { token: 'orientation-vertical', category: 'directive', chartTypes: 'all' },
  // ── Pyramid ──────────────────────────────────────────────
  { token: 'inverted', category: 'directive', chartTypes: ['pyramid'] },
  // ── Color / notes (cross-chart) ──────────────────────────
  {
    token: 'color',
    category: 'directive',
    chartTypes: 'all',
  },
  {
    token: 'no-notes',
    category: 'directive',
    chartTypes: ['flowchart', 'goal', 'state', 'whiteboard'],
  },
  // ── Emphasis family (§1.11, decision #49) ────────────────
  // `highlight <Name>…` / `dim <Name>…` — the figure/ground axis, orthogonal
  // to color (§1.5) and to the chart-wide `fill-*` family (§1.9). Both are
  // chart-level directives taking a name list, validated inline by each
  // adopting parser (no extractable Set), so the registry is their single
  // declaration site for highlighting.
  //
  // `highlight` shipped on `family` long before this entry existed and was
  // never registered — it had completions but highlighted as plain text. Both
  // tokens are registered together so the whole family lights up at once.
  //
  // Supported on `sankey` and `family` today; every further chart type is a
  // separate decision, made by adding it to `chartTypes` below (#1734).
  {
    token: 'highlight',
    category: 'directive',
    chartTypes: ['family', 'sankey'],
  },
  { token: 'dim', category: 'directive', chartTypes: ['family', 'sankey'] },
  // ── RACI ─────────────────────────────────────────────────
  { token: 'roles', category: 'directive', chartTypes: ['raci'] },
  // ── Cycle ────────────────────────────────────────────────
  {
    token: 'direction-counterclockwise',
    category: 'directive',
    chartTypes: ['cycle'],
  },
  { token: 'circle-nodes', category: 'directive', chartTypes: ['cycle'] },
  { token: 'center', category: 'directive', chartTypes: ['cycle'] },
  // ── Journey-map ──────────────────────────────────────────
  { token: 'persona', category: 'directive', chartTypes: ['journey-map'] },
  // ── Function ─────────────────────────────────────────────
  { token: 'x', category: 'directive', chartTypes: ['function'] },
  {
    token: 'fill',
    category: 'directive',
    chartTypes: ['function', 'line', 'whiteboard'],
  },
  // ── Wordcloud ────────────────────────────────────────────
  { token: 'max', category: 'directive', chartTypes: ['wordcloud'] },
  {
    token: 'size',
    category: 'directive',
    chartTypes: ['whiteboard', 'wordcloud'],
  },
  // ── Arc ──────────────────────────────────────────────────
  { token: 'order', category: 'directive', chartTypes: ['arc'] },
  // ── PERT ─────────────────────────────────────────────────
  { token: 'time-unit', category: 'directive', chartTypes: ['pert'] },
  { token: 'default-confidence', category: 'directive', chartTypes: ['pert'] },
  { token: 'node-detail', category: 'directive', chartTypes: ['pert'] },
  { token: 'trials', category: 'directive', chartTypes: ['pert'] },
  { token: 'seed', category: 'directive', chartTypes: ['bracket', 'pert'] },
  { token: 'scrubber-trials', category: 'directive', chartTypes: ['pert'] },
  // `start-date` is also gantt's canonical project-start option (decision #48;
  // bare `start` above stays as the legacy alias).
  {
    token: 'start-date',
    category: 'directive',
    gantt: ['option'],
    chartTypes: ['gantt', 'pert'],
  },
  { token: 'end-date', category: 'directive', chartTypes: ['pert'] },
  // ── Goal ─────────────────────────────────────────────────
  // Mode flags, value-key leaders, and opt-outs. `now`/`target` collide with
  // label prose ("start now", "on target"), but the arrow-label demotion pass
  // (see highlight-api LABEL_WORD_NODES) treats any keyword-bearing label as
  // text and demotes them, so they highlight only as line leaders.
  { token: 'thermometer', category: 'directive', chartTypes: ['goal'] },
  { token: 'gauge', category: 'directive', chartTypes: ['goal'] },
  {
    token: 'now',
    category: 'directive',
    chartTypes: ['event-line', 'goal', 'pert'],
  },
  { token: 'target', category: 'directive', chartTypes: ['countdown', 'goal'] },
  { token: 'no-note', category: 'directive', chartTypes: ['goal'] },
  { token: 'no-auto-color', category: 'directive', chartTypes: ['goal'] },

  // ── Control-flow + wireframe element keywords (CONTROL) ──
  { token: 'if', category: 'control', chartTypes: ['sequence'] },
  { token: 'else', category: 'control', chartTypes: ['sequence'] },
  { token: 'loop', category: 'control', chartTypes: ['sequence'] },
  { token: 'parallel', category: 'control', chartTypes: ['gantt', 'sequence'] },
  {
    token: 'note',
    category: 'control',
    // The note-card element. The chart frame's footer line is `footnote`,
    // in every chart type (#1827).
    chartTypes: [
      'boxes-and-lines',
      'class',
      'countdown',
      'er',
      'flowchart',
      'goal',
      'sequence',
      'state',
      'swimlane',
      'version-control',
      'whiteboard',
    ],
  },
  { token: 'nav', category: 'control', chartTypes: ['wireframe'] },
  { token: 'tabs', category: 'control', chartTypes: ['wireframe'] },
  { token: 'table', category: 'control', chartTypes: ['wireframe'] },
  {
    token: 'image',
    category: 'control',
    chartTypes: ['whiteboard', 'wireframe'],
  },
  { token: 'modal', category: 'control', chartTypes: ['wireframe'] },
  { token: 'skeleton', category: 'control', chartTypes: ['wireframe'] },
  { token: 'alert', category: 'control', chartTypes: ['wireframe'] },
  {
    token: 'progress',
    category: 'control',
    chartTypes: ['gantt', 'wireframe'],
  },
  { token: 'mobile', category: 'control', chartTypes: ['wireframe'] },
  // Whiteboard element leaders (§39). `image` is shared with wireframe above
  // and `text` stays an ER modifier; `database` / `queue` are left plain
  // because sequence uses them as values, not line leaders.
  { token: 'rectangle', category: 'control', chartTypes: ['whiteboard'] },
  { token: 'ellipse', category: 'control', chartTypes: ['whiteboard'] },
  { token: 'arrow', category: 'control', chartTypes: ['whiteboard'] },
  { token: 'ink', category: 'control', chartTypes: ['whiteboard'] },
  // `shapes network` turns a glyph set on, and each glyph keyword leads a line
  // like `rectangle` does (#1845). Derived from the glyph registry, so a new
  // glyph highlights with no edit here. `mobile` is wireframe's too; the
  // chart-type lists take the union.
  { token: 'shapes', category: 'directive', chartTypes: ['whiteboard'] },
  ...GLYPH_NAMES.map(
    (token): RegistryEntry => ({
      token,
      category: 'control',
      chartTypes: ['whiteboard'],
    })
  ),

  // ── SWOT section keywords (CONTROL) ──────────────────────
  { token: 'strengths', category: 'control', chartTypes: ['swot'] },
  { token: 'weaknesses', category: 'control', chartTypes: ['swot'] },
  { token: 'opportunities', category: 'control', chartTypes: ['swot'] },
  { token: 'threats', category: 'control', chartTypes: ['swot'] },
  { token: 'no-axes', category: 'directive', chartTypes: ['swot'] },
  { token: 'no-tint-items', category: 'directive', chartTypes: ['swot'] },

  // ── Kanban status keywords (STATUS) ──────────────────────
  { token: 'na', category: 'status', chartTypes: ['kanban'] },
  { token: 'todo', category: 'status', chartTypes: ['kanban'] },
  { token: 'wip', category: 'status', chartTypes: ['kanban'] },
  { token: 'done', category: 'status', chartTypes: ['kanban'] },
  { token: 'blocked', category: 'status', chartTypes: ['kanban'] },
  { token: 'in-progress', category: 'status', chartTypes: ['kanban'] },
  { token: 'backlog', category: 'status', chartTypes: ['kanban'] },
  { token: 'ready', category: 'status', chartTypes: ['kanban'] },

  // ── Modifiers + ER column types/modifiers (MODIFIER) ─────
  // `collapsed` is the bare trailing group-line flag made canonical by
  // decision #48 (`[Fulfillment] collapsed`). It is deliberately a bare
  // MODIFIER rather than a colon key: the legacy `collapsed: true` form still
  // parses and still highlights (as `modifier` instead of `propertyName`),
  // whereas leaving it colon-only left the canonical bare form as plain text.
  { token: 'collapsed', category: 'modifier', chartTypes: 'all' },
  { token: 'as', category: 'modifier', chartTypes: 'all' },
  { token: 'alias', category: 'modifier', chartTypes: 'all' },
  { token: 'aka', category: 'modifier', chartTypes: 'all' },
  { token: 'position', category: 'modifier', chartTypes: 'all' },
  { token: 'default', category: 'modifier', chartTypes: 'all' },
  { token: 'pk', category: 'modifier', chartTypes: ['er'] },
  { token: 'fk', category: 'modifier', chartTypes: ['er'] },
  { token: 'nullable', category: 'modifier', chartTypes: ['er'] },
  { token: 'unique', category: 'modifier', chartTypes: ['er'] },
  { token: 'int', category: 'modifier', chartTypes: ['class', 'er'] },
  { token: 'varchar', category: 'modifier', chartTypes: ['class', 'er'] },
  {
    token: 'text',
    category: 'modifier',
    chartTypes: ['class', 'er', 'whiteboard'],
  },
  { token: 'boolean', category: 'modifier', chartTypes: ['class', 'er'] },
  { token: 'date', category: 'modifier', chartTypes: ['class', 'er'] },
  { token: 'timestamp', category: 'modifier', chartTypes: ['class', 'er'] },
  { token: 'float', category: 'modifier', chartTypes: ['class', 'er'] },
  { token: 'decimal', category: 'modifier', chartTypes: ['class', 'er'] },

  // ── Bracket ──────────────────────────────────────────────
  // `beats` / `vs` are the infix match keywords; the rest are line directives.
  // (`seed` and `no-legend` already appear above — shared, not re-listed.)
  { token: 'beats', category: 'control', chartTypes: ['bracket'] },
  { token: 'vs', category: 'control', chartTypes: ['bracket'] },
  { token: 'rounds', category: 'directive', chartTypes: ['bracket'] },
  { token: 'accent', category: 'directive', chartTypes: 'all' },
  { token: 'no-round', category: 'modifier', chartTypes: ['bracket'] },
  { token: 'no-rounds', category: 'modifier', chartTypes: ['bracket'] },
  { token: 'single-elim', category: 'modifier', chartTypes: ['bracket'] },
  { token: 'double-elim', category: 'modifier', chartTypes: ['bracket'] },
  { token: 'seeded', category: 'modifier', chartTypes: ['bracket'] },

  // ── Live link (§38) ──────────────────────────────────────
  // The pointer type's one directive. Registered so it highlights and
  // autocompletes like `palette` does — §38 justifies the shape by calling it
  // "the ordinary DGMO directive shape", and an unregistered `url` would make
  // that sentence false in the editor: `editor/tokens.ts` specializes only
  // against the keyword registries, so it would render as plain identifier text.
  { token: 'url', category: 'directive', chartTypes: ['live-link'] },
];

// ============================================================
// Derivations
// ============================================================

function tokensWhere(pred: (e: RegistryEntry) => boolean): Set<string> {
  const out = new Set<string>();
  for (const e of DIRECTIVES_REGISTRY) if (pred(e)) out.add(e.token);
  return out;
}

// A whiteboard-only `shapes` / glyph keyword (`server`, `cloud`, `user`, …).
// These are everyday words, so they must not suppress the bad-chart-type
// warning on a first line like `server Production` (#1845). A token another
// chart type also registers (`mobile`) still counts through that entry.
function isWhiteboardGlyphEntry(e: RegistryEntry): boolean {
  return (
    Array.isArray(e.chartTypes) &&
    e.chartTypes.length === 1 &&
    e.chartTypes[0] === 'whiteboard' &&
    (e.token === 'shapes' ||
      (GLYPH_NAMES as readonly string[]).includes(e.token))
  );
}

// ── Parser-facing Sets (replace the deleted local literals) ──

/**
 * Every token the registry knows, regardless of category or scope. Used as a
 * negative filter: a line leading with one of these is an option/directive
 * line, never a chart-type declaration.
 */
export const ALL_REGISTRY_TOKENS: ReadonlySet<string> = tokensWhere(
  (e) => !isWhiteboardGlyphEntry(e)
);

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
/**
 * Token → the chart types it highlights in as a bare keyword, or `'all'`
 * (#1734). A token listed in several entries takes the union; one `'all'`
 * entry makes it global. Read by the editor's keyword specializer.
 */
export const REGISTRY_TOKEN_CHART_TYPES: ReadonlyMap<
  string,
  ReadonlySet<string> | 'all'
> = (() => {
  const out = new Map<string, Set<string> | 'all'>();
  for (const e of DIRECTIVES_REGISTRY) {
    const prev = out.get(e.token);
    if (prev === 'all') continue;
    if (e.chartTypes === 'all') {
      out.set(e.token, 'all');
      continue;
    }
    const set = prev ?? new Set<string>();
    for (const t of e.chartTypes) set.add(t);
    out.set(e.token, set);
  }
  return out;
})();

/** Colon `key: value` tokens that highlight as propertyName (→ ATTRIBUTE_KEYS). */
export const REGISTRY_COLON_KEY_TOKENS = tokensWhere((e) => !!e.colonKey);
/** Parser-accepted tokens deliberately excluded from every highlight set. */
export const REGISTRY_NON_HIGHLIGHT_TOKENS = tokensWhere(
  (e) => !!e.noHighlight
);
