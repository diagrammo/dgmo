/**
 * Diagram symbol extraction API + completion registry.
 *
 * Provides:
 * - DiagramSymbols interface + extractDiagramSymbols() dispatch
 * - COMPLETION_REGISTRY: chart-type → directives map (for editor autocomplete)
 * - CHART_TYPES: array of { name, description } for chart type completion
 * - METADATA_KEY_SET: derived set of all known directive keys
 *
 * Each diagram type registers its own extractor via registerExtractor().
 * All built-in extractors are registered at module init below.
 */

import { extractSymbols as extractErSymbols } from './er/parser';
import { extractSymbols as extractFlowchartSymbols } from './graph/flowchart-parser';
import { extractSymbols as extractInfraSymbols } from './infra/parser';
import { extractSymbols as extractClassSymbols } from './class/parser';
import { extractPertSymbols } from './pert/parser';
import { parseFirstLine, ALL_CHART_TYPES } from './utils/parsing';
import { CHART_TYPE_DESCRIPTIONS } from './dgmo-router';

// ============================================================
// Symbol extraction
// ============================================================

// ChartType is just a string — alias here for documentation clarity.
export type ChartType = string;

export interface DiagramSymbols {
  kind: ChartType;
  entities: string[]; // table names, node IDs, class names, etc.
  keywords: string[]; // diagram-specific reserved words
  /**
   * Map of alias-literal → canonical entity name, collected from
   * `Name as <alias>` declarations in the document. Editor surfaces
   * both forms in autocomplete; selecting an alias inserts the alias
   * literal (the alias is input convenience, not a display name).
   */
  aliases?: Record<string, string>;
}

export type ExtractFn = (docText: string) => DiagramSymbols;

const extractorRegistry = new Map<ChartType, ExtractFn>();

export function registerExtractor(kind: ChartType, fn: ExtractFn): void {
  extractorRegistry.set(kind, fn);
}

/**
 * Extract diagram symbols from document text.
 * Returns null if the chart type is unknown or has no registered extractor.
 */
export function extractDiagramSymbols(docText: string): DiagramSymbols | null {
  // Parse chartType from first line — bare type name.
  let chartType: string | null = null;
  for (const line of docText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const result = parseFirstLine(trimmed);
    if (result) {
      chartType = result.chartType;
    }
    break; // only check the first non-empty, non-comment line
  }
  if (!chartType) return null;
  const fn = extractorRegistry.get(chartType);
  if (!fn) return null;
  const result = fn(docText);
  // Populate `aliases` uniformly for every chart type so downstream
  // editor surfaces don't need per-extractor branches.
  const aliases = extractAliasDeclarations(docText);
  return Object.keys(aliases).length > 0 ? { ...result, aliases } : result;
}

// ============================================================
// Completion registry
// ============================================================

/** Specification for a single directive: description + optional enumerated values. */
export interface DirectiveValueSpec {
  description: string;
  values?: string[];
}

/** Specification for a chart type's directives. */
export interface DirectiveSpec {
  directives: Record<string, DirectiveValueSpec>;
}

// Global directives applied to every chart type
const GLOBAL_DIRECTIVES: Record<string, DirectiveValueSpec> = {
  palette: {
    description: 'Color palette name',
    values: [
      'nord',
      'solarized',
      'catppuccin',
      'rose-pine',
      'gruvbox',
      'tokyo-night',
      'one-dark',
      'bold',
      'dracula',
      'monokai',
    ],
  },
  theme: {
    description: 'Color theme',
    values: ['light', 'dark', 'transparent'],
  },
};

function withGlobals(
  directives: Record<string, DirectiveValueSpec> = {}
): DirectiveSpec {
  return { directives: { ...GLOBAL_DIRECTIVES, ...directives } };
}

/** Chart-type → directive specifications. Every chart type has at least palette + theme. */
export const COMPLETION_REGISTRY = new Map<string, DirectiveSpec>([
  // ── Data charts ──────────────────────────────────────────
  [
    'bar',
    withGlobals({
      series: { description: 'Series name(s)' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label' },
      'orientation-horizontal': { description: 'Switch to horizontal bars' },
      'no-value': { description: 'Hide value labels atop each bar' },
      color: { description: 'Bar color override' },
    }),
  ],
  [
    'line',
    withGlobals({
      series: { description: 'Series name(s)' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label' },
      'no-value': { description: 'Hide value labels at each point' },
    }),
  ],
  [
    'pie',
    withGlobals({
      'no-name': { description: 'Hide name from segment labels' },
      'no-value': { description: 'Hide value from segment labels' },
      'no-percent': { description: 'Hide percent from segment labels' },
    }),
  ],
  [
    'doughnut',
    withGlobals({
      'no-name': { description: 'Hide name from segment labels' },
      'no-value': { description: 'Hide value from segment labels' },
      'no-percent': { description: 'Hide percent from segment labels' },
    }),
  ],
  [
    'area',
    withGlobals({
      series: { description: 'Series name(s)' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label' },
      'no-value': { description: 'Hide value labels at each point' },
    }),
  ],
  [
    'multi-line',
    withGlobals({
      series: { description: 'Series name(s)' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label' },
      'no-value': { description: 'Hide value labels at each point' },
    }),
  ],
  [
    'polar-area',
    withGlobals({
      'no-name': { description: 'Hide name from segment labels' },
      'no-value': { description: 'Hide value from segment labels' },
      'no-percent': { description: 'Hide percent from segment labels' },
    }),
  ],
  [
    'radar',
    withGlobals({
      'no-value': { description: 'Hide value labels at each vertex' },
    }),
  ],
  [
    'bar-stacked',
    withGlobals({
      series: { description: 'Series name(s) (required)' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label' },
      'orientation-horizontal': { description: 'Switch to horizontal bars' },
      'no-value': { description: 'Hide per-segment values inside each stack' },
    }),
  ],

  // ── Extended charts ──────────────────────────────────────
  [
    'scatter',
    withGlobals({
      'no-name': { description: 'Hide point labels' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label' },
      'size-label': { description: 'Size axis label' },
    }),
  ],
  [
    'heatmap',
    withGlobals({
      columns: { description: 'Column labels (required)' },
      'no-value': { description: 'Hide cell value text' },
    }),
  ],
  ['sankey', withGlobals()],
  ['chord', withGlobals()],
  [
    'funnel',
    withGlobals({
      'no-name': { description: 'Hide left-side name labels' },
      'no-value': { description: 'Hide right-side value labels' },
    }),
  ],
  [
    'function',
    withGlobals({
      x: { description: 'X-axis range (start to end)' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label' },
      shade: { description: 'Fill area below curves with translucent color' },
    }),
  ],

  // ── Visualizations ───────────────────────────────────────
  ['slope', withGlobals()],
  [
    'wordcloud',
    withGlobals({
      rotate: {
        description: 'Word rotation',
        values: ['none', 'mixed', 'angled'],
      },
      max: { description: 'Maximum word count' },
      size: { description: 'Font size range (min, max)' },
    }),
  ],
  [
    'arc',
    withGlobals({
      order: {
        description: 'Node ordering',
        values: ['appearance', 'name', 'group', 'degree'],
      },
    }),
  ],
  ['timeline', withGlobals()],
  ['venn', withGlobals()],
  [
    'quadrant',
    withGlobals({
      'x-label': { description: 'X-axis labels (low, high)' },
      'y-label': { description: 'Y-axis labels (low, high)' },
    }),
  ],

  // ── Diagrams ─────────────────────────────────────────────
  [
    'sequence',
    withGlobals({
      activations: {
        description: 'Show activation bars',
        values: ['on', 'off'],
      },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'flowchart',
    // Spec §5 §4.6: direction-lr, orientation-vertical, no-color, solid-fill
    withGlobals({
      'direction-lr': { description: 'Switch to left-to-right layout' },
      'orientation-vertical': {
        description: 'Use vertical orientation for ranks',
      },
      'no-color': {
        description: 'Resolve all nodes to muted neutral fill',
      },
    }),
  ],
  [
    'class',
    withGlobals({
      'no-auto-color': {
        description: 'Disable automatic modifier-based coloring',
      },
    }),
  ],
  [
    'er',
    // Spec §9 §8.5: notation (chen/crow), active-tag.
    withGlobals({
      notation: {
        description: 'ER notation style',
        values: ['chen', 'crow'],
      },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'org',
    // Spec §7 §6.5: direction-tb, sub-node-label, show-sub-node-count,
    // hide, active-tag. solid-fill via SOLID_FILL_CAPABLE.
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'sub-node-label': { description: 'Label for sub-nodes' },
      'show-sub-node-count': { description: 'Show sub-node counts' },
      hide: { description: 'Hide tag:value pairs' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'kanban',
    // Spec §11 §10.4: no-auto-color, hide, active-tag.
    withGlobals({
      'no-auto-color': { description: 'Disable automatic card coloring' },
      hide: { description: 'Hide tag:value pairs' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  // RACI / RASCI / DACI — one chart type (`raci`), variant inferred from
  // markers or locked via `variant-*` bare directive. `rasci`/`daci` are
  // not first-line keywords so they get no separate registry entry.
  [
    'raci',
    withGlobals({
      'variant-raci': {
        description: 'Lock chart to RACI variant (R / A / C / I markers)',
      },
      'variant-rasci': {
        description:
          'Lock chart to RASCI variant (adds Support — R / A / S / C / I)',
      },
      'variant-daci': {
        description:
          'Lock chart to DACI variant (Driver / Approver / Contributor / Informed)',
      },
      roles: {
        description:
          'Declare role column order (inline `roles A, B, C` or indented block with per-role pipe metadata)',
      },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'c4',
    // Spec §8 §7.7: direction-tb, active-tag.
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'state',
    // Spec §6 §5.5: direction-tb, no-color, solid-fill.
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'no-color': {
        description: 'Resolve all states to muted neutral fill',
      },
    }),
  ],
  [
    'sitemap',
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'infra',
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      animate: { description: 'Enable traffic animation' },
      'no-animate': { description: 'Disable traffic animation' },
      'default-latency-ms': { description: 'Default latency for all nodes' },
      'default-uptime': { description: 'Default uptime for all nodes' },
      'default-rps': { description: 'Default RPS capacity for all nodes' },
      'slo-availability': { description: 'SLO availability target (0-1)' },
      'slo-p90-latency-ms': { description: 'SLO p90 latency target in ms' },
      'slo-warning-margin': { description: 'SLO warning margin percentage' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'pert',
    withGlobals({
      'time-unit': {
        description: 'Time unit for activity durations',
        values: ['min', 'h', 'd', 'bd', 'w', 'm', 'q', 'y'],
      },
      confidence: {
        description: 'Confidence factor for M-only durations',
        values: ['high', 'medium', 'low'],
      },
      direction: { description: 'Layout direction', values: ['LR', 'TB'] },
      'node-detail': {
        description: 'Node visual density',
        values: ['compact', 'full'],
      },
      analysis: {
        description: 'Analysis mode beyond analytical PERT',
        values: ['monte-carlo'],
      },
      trials: { description: 'Monte Carlo trial count (default 10000)' },
      seed: { description: 'Monte Carlo PRNG seed (deterministic)' },
      'scrubber-trials': {
        description: 'Fast-MC trials for the duration scrubber (default 300)',
      },
      milestone: { description: 'Zero-duration named event (diamond shape)' },
    }),
  ],
  [
    'gantt',
    // Spec §13 §12.2 Options.
    withGlobals({
      start: { description: 'Project start date (YYYY-MM-DD)' },
      'today-marker': {
        description: 'Today marker (bare = on, or YYYY-MM-DD date)',
      },
      sort: { description: 'Sort order', values: ['time', 'group', 'tag'] },
      'critical-path': { description: 'Show critical path' },
      'no-dependencies': { description: 'Hide dependency arrows' },
      'sprint-length': { description: 'Sprint duration (e.g. 2w)' },
      'sprint-number': { description: 'Starting sprint number' },
      'sprint-start': { description: 'Sprint start date (YYYY-MM-DD)' },
      'active-tag': { description: 'Active tag group name' },
      // Legacy positive form `dependencies` — kept for back-compat. Use
      // `no-dependencies` to suppress dependency arrows in new code.
      dependencies: { description: 'Show dependencies (legacy form)' },
    }),
  ],
  [
    'boxes-and-lines',
    withGlobals({
      direction: { description: 'Layout direction', values: ['LR', 'TB'] },
      'active-tag': { description: 'Active tag group name' },
      hide: { description: 'Hide tag:value pairs' },
    }),
  ],
  [
    'mindmap',
    withGlobals({
      'no-descriptions': { description: 'Hide node descriptions' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'wireframe',
    withGlobals({
      mobile: { description: 'Use mobile (narrow vertical) layout' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'tech-radar',
    // Spec §20 documents one directive: `show-blip-legend`. `rings` is a
    // structural block keyword; quadrant/ring/trend/color are pipe metadata
    // that live in PIPE_METADATA.
    withGlobals({
      'show-blip-legend': {
        description: 'Render the four-column blip listing alongside the radar',
      },
    }),
  ],
  [
    'cycle',
    withGlobals({
      'direction-counterclockwise': {
        description: 'Reverse cycle direction to counterclockwise',
      },
      'no-descriptions': { description: 'Hide node and edge descriptions' },
      'circle-nodes': {
        description: 'Render nodes as circles instead of rectangles',
      },
    }),
  ],
  [
    'journey-map',
    // Spec §22 directives: `no-legend`, `active-tag`. `persona` is a
    // structural keyword (like `tag` / `roles`), not a directive.
    // `solid-fill` is added via SOLID_FILL_CAPABLE below.
    withGlobals({
      'no-legend': { description: 'Hide the score legend' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'pyramid',
    // Spec §23.5 documents `inverted`; `solid-fill` is added via
    // SOLID_FILL_CAPABLE below (working but not yet in spec §23.5).
    // `color`/`description` are layer pipe-metadata, not directives.
    withGlobals({
      inverted: { description: 'Flip apex to the bottom (funnel orientation)' },
    }),
  ],
  [
    'ring',
    // Per spec §24.5 the only chart-specific directive is `solid-fill`,
    // applied via SOLID_FILL_CAPABLE below. `color`/`description` are
    // layer pipe-metadata, not directives — they live in PIPE_METADATA.
    withGlobals({}),
  ],
]);

// `rasci` and `daci` accept the same directives as `raci` (they're variants of
// the same chart type, just locked at the chart-type-id level). Mirror the
// registry entry so completion works identically on all three.
{
  const raciSpec = COMPLETION_REGISTRY.get('raci');
  if (raciSpec) {
    COMPLETION_REGISTRY.set('rasci', raciSpec);
    COMPLETION_REGISTRY.set('daci', raciSpec);
  }
}

// ── Cross-chart-type bare-keyword option: `solid-fill` ──────────
// Adds the directive to every chart type whose renderer actually responds to
// it (i.e. uses `shapeFill()` and is not opted out). Chart types where the
// keyword is a no-op (gantt/infra/heatmap/tech-radar opt-outs; venn/quadrant
// don't use shapeFill; line/area/wordcloud have no shape fills) intentionally
// don't list it — keeps the completion popup honest.
const SOLID_FILL_CAPABLE = new Set([
  'flowchart',
  'state',
  'sequence',
  'c4',
  'org',
  'kanban',
  'journey-map',
  'mindmap',
  'cycle',
  'pyramid',
  'ring',
  'funnel',
  'class',
  'er',
  'sitemap',
  'boxes-and-lines',
  'wireframe',
  'bar',
  'bar-stacked',
  'pie',
  'doughnut',
  'polar-area',
  'radar',
  'scatter',
  'chord',
]);
for (const [type, spec] of COMPLETION_REGISTRY) {
  if (SOLID_FILL_CAPABLE.has(type)) {
    spec.directives['solid-fill'] = {
      description:
        'Render shapes with full intent color instead of the default 25% tint',
    };
  }
}

// ============================================================
// Chart types array (for chart type completion popup)
// ============================================================

/** All chart types with descriptions, for chart type autocomplete. Excludes `multi-line` alias. */
export const CHART_TYPES: ReadonlyArray<{ name: string; description: string }> =
  [...ALL_CHART_TYPES]
    .filter((t) => t !== 'multi-line')
    .map((name) => ({
      name,
      description: CHART_TYPE_DESCRIPTIONS[name] ?? name,
    }));

// ============================================================
// Entity types for `is a` declarations
// ============================================================

/**
 * Entity types for `Name is a <type>` declarations, keyed by chart type.
 * Values are sourced from parser constants (VALID_PARTICIPANT_TYPES,
 * C4_IS_A_RE).
 */
export const ENTITY_TYPES = new Map<string, string[]>([
  [
    'sequence',
    [
      'service',
      'database',
      'actor',
      'queue',
      'cache',
      'gateway',
      'external',
      'networking',
      'frontend',
    ],
  ],
  [
    'c4',
    ['person', 'system', 'container', 'component', 'external', 'database'],
  ],
]);

// ============================================================
// Pipe metadata for inline `| key value` on data lines
// ============================================================

/** Specification for a single pipe metadata key. */
export interface PipeKeySpec {
  description: string;
  values?: string[];
}

/**
 * Pipe metadata keys for inline `| key value` on data lines.
 * Keyed by chart type → { context-name: keys }.
 *
 * Contexts are open-ended. The two universal ones are:
 *   - `node` — the default for any non-arrow line
 *   - `edge` — lines containing an arrow (`->`, `--`)
 *
 * Charts with richer line types declare additional contexts:
 *   - raci: `role`, `phase`, `assignment`
 *   - ring / pyramid: `layer`
 *   - tech-radar: `quadrant`, `blip`
 *   - journey-map: `step`
 *
 * Consumers that don't classify lines beyond node/edge can fall back to
 * the union of all contexts via `unionPipeKeys(spec)` below.
 *
 * IMPORTANT: NEVER add 'sequence' here. The `|` character in sequence
 * diagrams separates display names from identifiers and tag metadata.
 * Adding sequence would trigger false pipe-metadata completions on every `|`.
 */
export type PipeContextMap = Record<string, Record<string, PipeKeySpec>>;

export const PIPE_METADATA = new Map<string, PipeContextMap>([
  [
    'infra',
    {
      node: {
        description: { description: 'Node description text' },
        instances: {
          description: 'Instance count or auto-scaling range (N-M)',
        },
        'latency-ms': { description: 'Per-request latency in milliseconds' },
        'max-rps': { description: 'Max requests per second per instance' },
        'cache-hit': { description: 'Cache hit percentage (0-100)' },
        'firewall-block': { description: 'Traffic blocked percentage' },
        'ratelimit-rps': { description: 'Max RPS allowed through' },
        'cb-error-threshold': {
          description: 'Circuit breaker error threshold %',
        },
        'cb-latency-threshold-ms': {
          description: 'Circuit breaker latency threshold',
        },
        uptime: { description: 'Component availability (0-1)' },
        concurrency: { description: 'Concurrent request limit' },
        'duration-ms': { description: 'Processing duration' },
        'cold-start-ms': { description: 'Function cold-start time' },
        buffer: { description: 'Queue/buffer capacity' },
        'drain-rate': { description: 'Queue drain rate' },
        'retention-hours': { description: 'Data retention period' },
        partitions: { description: 'Queue/stream partition count' },
        'slo-availability': { description: 'Node availability target (0-1)' },
        'slo-p90-latency-ms': { description: 'Node p90 latency target' },
        'slo-warning-margin': { description: 'Node SLO warning margin' },
      },
      edge: {
        split: { description: 'Traffic split percentage (e.g., 60%)' },
        fanout: { description: 'Fanout multiplier (integer >= 1)' },
      },
    },
  ],
  [
    'c4',
    {
      node: {
        description: { description: 'Element description' },
        tech: { description: 'Technology stack' },
        technology: { description: 'Technology stack (alias for tech)' },
      },
      edge: {},
    },
  ],
  [
    'gantt',
    {
      node: {},
      edge: {
        // Gantt "edge" = dependency arrow (TaskA -> TaskB | offset 2bd)
        offset: { description: 'Dependency offset (e.g., 2bd, -1w)' },
      },
    },
  ],
  [
    'boxes-and-lines',
    {
      node: {
        description: { description: 'Node description text' },
      },
      edge: {},
    },
  ],
  [
    'mindmap',
    {
      node: {
        description: { description: 'Node description text' },
        collapsed: { description: 'Collapse node subtree by default' },
      },
      edge: {},
    },
  ],
  [
    // Tech-radar pipe metadata (spec §20). Two contexts:
    //   - quadrant: top-level quadrant headers (`Tools | quadrant: top-left, color: blue`)
    //   - blip: indented blip lines (`  Vite | ring: Adopt, trend: up`)
    'tech-radar',
    {
      quadrant: {
        quadrant: {
          description: 'Quadrant position',
          values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        },
        color: { description: 'Override quadrant color' },
      },
      blip: {
        ring: { description: 'Ring assignment (must match a declared ring)' },
        trend: {
          description: 'Blip trend indicator',
          values: ['new', 'up', 'down', 'stable'],
        },
      },
    },
  ],
  [
    'cycle',
    {
      node: {
        color: { description: 'Node fill color (palette name)' },
        span: { description: 'Relative arc distance to next node' },
        description: { description: 'Node description text' },
      },
      edge: {
        color: { description: 'Edge stroke color (palette name)' },
        width: { description: 'Edge stroke width in pixels' },
      },
    },
  ],
  [
    // RACI pipe metadata (spec §24A). Two contexts:
    //   - role: declarations inside the `roles` block (`Cap | color: red`)
    //   - phase: bracketed phase headers (`[Departure] | color: teal`)
    'raci',
    {
      role: {
        color: { description: 'Role column tint (palette name)' },
      },
      phase: {
        color: { description: 'Phase bar tint (palette name)' },
      },
    },
  ],
  [
    // Ring layer pipe metadata (spec §24.4). One context: `layer`.
    'ring',
    {
      layer: {
        color: { description: 'Ring color (palette name)' },
        description: { description: 'Layer description (one-liner shorthand)' },
      },
    },
  ],
  [
    // Pyramid layer pipe metadata (spec §23.4). Identical surface to ring.
    'pyramid',
    {
      layer: {
        color: { description: 'Layer color (palette name)' },
        description: { description: 'Layer description (one-liner shorthand)' },
      },
    },
  ],
  [
    // Journey-map step pipe metadata (spec §22). One static key: `score`.
    // Tag aliases (e.g. `ch: Web`) are user-defined via the `tag` block
    // and resolved dynamically — not part of the static map.
    'journey-map',
    {
      step: {
        score: { description: 'Step score (1–5 integer; high = good)' },
      },
    },
  ],
]);

/**
 * Union of all pipe-metadata keys across every context for a chart.
 * Use this when a consumer can't precisely classify which line context
 * the cursor is on (e.g. raci role vs phase) and wants to surface every
 * potentially-valid key. Returns an empty record for unknown chart types.
 */
export function unionPipeKeys(chartType: string): Record<string, PipeKeySpec> {
  const spec = PIPE_METADATA.get(chartType);
  if (!spec) return {};
  const merged: Record<string, PipeKeySpec> = {};
  for (const ctx of Object.values(spec)) {
    Object.assign(merged, ctx);
  }
  return merged;
}

// ============================================================
// Derived metadata key set
// ============================================================

/** All known directive keys, derived from COMPLETION_REGISTRY. Includes implicit keys. */
export const METADATA_KEY_SET: ReadonlySet<string> = new Set([
  'chart',
  'title', // implicit directives recognized as metadata
  ...[...COMPLETION_REGISTRY.values()].flatMap((spec) =>
    Object.keys(spec.directives)
  ),
]);

// ============================================================
// Sequence extractor
// ============================================================

// Universal Name Handling: source/target accept multi-word + "quoted" names.
// `[^|]+?` captures greedy-to-pipe-or-arrow; the arrow alternation acts as
// the boundary. Caller strips quotes via stripQuotes().
const SEQ_ARROW_RE =
  /^(?:"([^"]+)"|([^|"]+?))\s+(->|-.*->|~>|~.*~>)\s+(?:"([^"]+)"|([^|"]+?))(?:\s|\|.*)?$/;
const SEQ_IS_A_RE = /^(?:"([^"]+)"|([^|":]+?))\s+is\s+an?\s+/i;
const SEQ_SECTION_RE = /^==/;
const SEQ_STRUCTURAL_RE = /^(if|else|loop|parallel|end)\b/i;

function extractSequenceSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Skip first line (chart type)
    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip metadata lines
    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Skip sections, structural keywords
    if (SEQ_SECTION_RE.test(trimmed)) continue;
    if (SEQ_STRUCTURAL_RE.test(trimmed)) continue;

    // Arrow lines: A -> B, A -label-> B, A ~> B
    const arrowMatch = trimmed.match(SEQ_ARROW_RE);
    if (arrowMatch) {
      const src = (arrowMatch[1] ?? arrowMatch[2] ?? '').trim();
      const dst = (arrowMatch[4] ?? arrowMatch[5] ?? '').trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }

    // Type declarations: A is a person, A is an actor
    const isAMatch = trimmed.match(SEQ_IS_A_RE);
    if (isAMatch) {
      const name = (isAMatch[1] ?? isAMatch[2] ?? '').trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }
  }

  return {
    kind: 'sequence',
    entities,
    keywords: ['if', 'else', 'loop', 'parallel', 'note'],
  };
}

// ============================================================
// State extractor
// ============================================================

const STATE_ARROW_RE = /^(\S+)\s+->\s+(\S+)/;

function extractStateSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip metadata lines
    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    const arrowMatch = trimmed.match(STATE_ARROW_RE);
    if (arrowMatch) {
      const src = arrowMatch[1].split('|')[0].trim();
      const dst = arrowMatch[2].split('|')[0].trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
    }
  }

  return { kind: 'state', entities, keywords: [] };
}

// ============================================================
// Tag declaration extraction
// ============================================================

// Matches tag declarations in both forms:
// - `tag Name alias x` (explicit alias keyword)
// - `tag Name x` (shorthand: 1-4 lowercase chars = alias, matching parser's isAliasToken)
const TAG_DECL_EXPLICIT_RE = /^tag\s+(\S+)\s+alias\s+(\S+)/i;
const TAG_DECL_SHORT_RE = /^tag\s+(\S+)\s+([a-z]{1,4})(?:\s|$)/;

/**
 * Extract tag declarations from document text.
 * Returns a map of alias (or full name) → array of tag values.
 * Keys preserve original case for display; use case-insensitive lookup.
 */
export function extractTagDeclarations(docText: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const lines = docText.split('\n');
  let currentAlias: string | null = null;
  let currentValues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Check for tag declaration — try explicit `alias` keyword first, then shorthand
    const tagMatch =
      trimmed.match(TAG_DECL_EXPLICIT_RE) ?? trimmed.match(TAG_DECL_SHORT_RE);
    if (tagMatch) {
      // Save previous tag group
      if (currentAlias !== null) {
        result.set(currentAlias, currentValues);
      }
      const name = tagMatch[1];
      const alias = tagMatch[2] ?? name;
      currentAlias = alias;
      currentValues = [];
      continue;
    }
    // Also match bare `tag Name` (no alias) — fall through with name as key
    if (/^tag\s+(\S+)\s*$/i.test(trimmed)) {
      if (currentAlias !== null) {
        result.set(currentAlias, currentValues);
      }
      currentAlias = trimmed.match(/^tag\s+(\S+)/i)![1];
      currentValues = [];
      continue;
    }

    // Collect indented tag values
    if (
      currentAlias !== null &&
      raw.length > 0 &&
      (raw[0] === ' ' || raw[0] === '\t')
    ) {
      if (trimmed && !trimmed.startsWith('//')) {
        // Strip color annotation: Frontend(blue) → Frontend
        const colorIdx = trimmed.indexOf('(');
        const value =
          colorIdx > 0 ? trimmed.substring(0, colorIdx).trim() : trimmed;
        if (value) currentValues.push(value);
      }
      continue;
    }

    // Non-indented non-tag line ends the current tag block
    if (currentAlias !== null && trimmed) {
      result.set(currentAlias, currentValues);
      currentAlias = null;
      currentValues = [];
    }
  }

  // Save last tag group
  if (currentAlias !== null) {
    result.set(currentAlias, currentValues);
  }

  return result;
}

// ============================================================
// Universal alias extractor (`Name as <alias>` postfix)
// ============================================================

// Postfix-alias form on any name-slot line. Caller-agnostic — runs
// over the full document so every chart-type extractor can populate
// `DiagramSymbols.aliases` consistently.
const ALIAS_POSTFIX_DECL_RE =
  /(?:^|[^|/])\s*(.+?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*(?:\|.*)?$/;

/**
 * Scan document text for `Name as <alias>` declarations.
 *
 * Returns `Record<alias, canonical-fragment>`. The canonical may
 * still carry color/type modifiers (the per-parser logic peels
 * those off at parse time); for autocomplete display purposes the
 * raw fragment is good enough.
 *
 * Pure helper — does NOT enforce strict-ordering, collisions, or
 * other semantic rules. Those are parser-side checks.
 */
export function extractAliasDeclarations(
  docText: string
): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const raw of docText.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const match = trimmed.match(ALIAS_POSTFIX_DECL_RE);
    if (!match) continue;
    const canonical = match[1].trim();
    const alias = match[2];
    // Skip if canonical itself looks structural (arrow / pipe-only / brackets-only)
    if (!canonical || canonical === '[' || canonical === ']') continue;
    if (!(alias in aliases)) {
      aliases[alias] = canonical;
    }
  }
  return aliases;
}

// ============================================================
// Sitemap extractor
// ============================================================

const SITEMAP_CONTAINER_RE = /^\[([^\]]+)\]/;
const SITEMAP_ARROW_RE = /^-.*->\s*(.+)$/;
const SITEMAP_BARE_ARROW_RE = /^->\s*(.+)$/;
const SITEMAP_METADATA_RE = /^([^:]+):\s*(.+)$/;

function extractSitemapSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;
  let lastNodeIndent = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip metadata lines
    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Track tag blocks
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Containers: [GroupName]
    const containerMatch = trimmed.match(SITEMAP_CONTAINER_RE);
    if (containerMatch) {
      const name = containerMatch[1].split('|')[0].trim();
      if (name && !entities.includes(name)) entities.push(name);
      lastNodeIndent = indent;
      continue;
    }

    // Arrows: -> Target or -label-> Target
    const bareArrow = trimmed.match(SITEMAP_BARE_ARROW_RE);
    const labeledArrow = !bareArrow ? trimmed.match(SITEMAP_ARROW_RE) : null;
    if (bareArrow || labeledArrow) {
      const target = (bareArrow?.[1] ?? labeledArrow?.[1] ?? '')
        .split('|')[0]
        .trim();
      if (target && !entities.includes(target)) entities.push(target);
      continue;
    }

    // Indented metadata under a node (key: value) — skip
    if (
      indent > 0 &&
      lastNodeIndent >= 0 &&
      indent > lastNodeIndent &&
      SITEMAP_METADATA_RE.test(trimmed)
    ) {
      continue;
    }

    // Page label (anything else that's not special)
    const label = trimmed.split('|')[0].trim();
    if (label) {
      if (!entities.includes(label)) entities.push(label);
      lastNodeIndent = indent;
    }
  }

  return { kind: 'sitemap', entities, keywords: [] };
}

// ============================================================
// C4 extractor
// ============================================================

const C4_ELEMENT_RE = /^(person|system|container|component)\s+(.+)$/i;
const C4_IS_A_RE =
  /^(.+?)\s+is\s+an?\s+(person|system|container|component|external|database)\b/i;
const C4_ARROW_RE =
  /^(\S+)\s+(?:->|-.*->|~>|~.*~>|<->|<-.*->|<~>|<~.*~>)\s+(\S+)/;
const C4_SECTION_RE = /^(containers|components|deployment)\s*$/i;

function extractC4Symbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Skip section headers
    if (C4_SECTION_RE.test(trimmed)) continue;

    // Element declaration: person Name, system Name, etc.
    const elemMatch = trimmed.match(C4_ELEMENT_RE);
    if (elemMatch) {
      const name = elemMatch[2].split('|')[0].trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Is-a declaration: Name is a person
    const isAMatch = trimmed.match(C4_IS_A_RE);
    if (isAMatch) {
      const name = isAMatch[1].split('|')[0].trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Arrow lines: Source -> Target, Source ~> Target, etc.
    const arrowMatch = trimmed.match(C4_ARROW_RE);
    if (arrowMatch) {
      const src = arrowMatch[1].split('|')[0].trim();
      const dst = arrowMatch[2].split('|')[0].trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }
  }

  return {
    kind: 'c4',
    entities,
    keywords: ['containers', 'components', 'deployment'],
  };
}

// ============================================================
// Gantt extractor
// ============================================================

const GANTT_DURATION_RE = /^(\d+(?:\.\d+)?)(min|bd|d|w|m|q|y|h)\??\s+(.+)$/;
const GANTT_DATE_RE = /^(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+(.+)$/;
const GANTT_GROUP_RE = /^\[(.+?)\]/;
const GANTT_STRUCTURAL_RE = /^(era|marker|holiday|workweek|parallel)\b/i;

function extractGanttSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Skip structural keywords
    if (GANTT_STRUCTURAL_RE.test(trimmed)) continue;

    // Groups: [GroupName]
    const groupMatch = trimmed.match(GANTT_GROUP_RE);
    if (groupMatch) {
      const name = groupMatch[1].trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Tasks by duration: 30d Task Name | metadata
    const durMatch = trimmed.match(GANTT_DURATION_RE);
    if (durMatch) {
      // Strip pipe metadata and dependency arrows from task name
      let taskName = durMatch[3].split('|')[0].trim();
      // Remove trailing dependency: "Task Name -> Other" → "Task Name"
      const arrowIdx = taskName.indexOf('->');
      if (arrowIdx > 0)
        taskName = taskName
          .substring(0, arrowIdx)
          .replace(/-[^>]*$/, '')
          .trim();
      if (taskName && !entities.includes(taskName)) entities.push(taskName);
      continue;
    }

    // Tasks by date: 2024-01-15 Task Name
    const dateMatch = trimmed.match(GANTT_DATE_RE);
    if (dateMatch) {
      let taskName = dateMatch[2].split('|')[0].trim();
      const arrowIdx = taskName.indexOf('->');
      if (arrowIdx > 0)
        taskName = taskName
          .substring(0, arrowIdx)
          .replace(/-[^>]*$/, '')
          .trim();
      if (taskName && !entities.includes(taskName)) entities.push(taskName);
      continue;
    }
  }

  return { kind: 'gantt', entities, keywords: [] };
}

// ============================================================
// Boxes-and-lines extractor
// ============================================================

const BL_ARROW_RE = /^(\S+)\s+(?:-.*)?(?:->|<->)\s+(\S+)/;

function extractBoxesAndLinesSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Skip groups
    if (/^\[.+?\]/.test(trimmed)) continue;

    // Edge lines
    const arrowMatch = trimmed.match(BL_ARROW_RE);
    if (arrowMatch) {
      const src = arrowMatch[1].split('|')[0].trim();
      const dst = arrowMatch[2].split('|')[0].trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }

    // Node lines
    const label = trimmed.split('|')[0].split('[')[0].trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'boxes-and-lines', entities, keywords: [] };
}

// ============================================================
// Register built-in extractors
// ============================================================

registerExtractor('er', extractErSymbols);
registerExtractor('flowchart', extractFlowchartSymbols);
registerExtractor('infra', extractInfraSymbols);
registerExtractor('class', extractClassSymbols);
registerExtractor('sequence', extractSequenceSymbols);
registerExtractor('state', extractStateSymbols);
registerExtractor('sitemap', extractSitemapSymbols);
registerExtractor('c4', extractC4Symbols);
registerExtractor('gantt', extractGanttSymbols);
registerExtractor('pert', extractPertSymbols);
registerExtractor('boxes-and-lines', extractBoxesAndLinesSymbols);
registerExtractor('tech-radar', extractTechRadarSymbols);
registerExtractor('cycle', extractCycleSymbols);
registerExtractor('journey-map', extractJourneyMapSymbols);
registerExtractor('raci', extractRaciSymbols);
registerExtractor('rasci', extractRaciSymbols);
registerExtractor('daci', extractRaciSymbols);

function extractTechRadarSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];
  const keywords: string[] = [
    'rings',
    'quadrant',
    'ring',
    'trend',
    'new',
    'up',
    'down',
    'stable',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'alias',
    'aka',
    'color',
  ];

  // Extract ring names and aliases from the rings block
  const lines = docText.split('\n');
  let inRings = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'rings') {
      inRings = true;
      continue;
    }
    if (inRings) {
      if (!trimmed || (line[0] !== ' ' && line[0] !== '\t')) {
        inRings = false;
        continue;
      }
      // Parse ring name (and alias)
      const aliasMatch = trimmed.match(/^(.+?)\s+(?:alias|aka)\s+(\S+)\s*$/i);
      if (aliasMatch) {
        entities.push(aliasMatch[1].trim());
        entities.push(aliasMatch[2].trim());
      } else {
        entities.push(trimmed);
      }
    }
  }

  return { kind: 'tech-radar', entities, keywords };
}

// ============================================================
// Cycle extractor
// ============================================================

function extractCycleSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip directives/metadata
    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'direction-counterclockwise' ||
      firstToken === 'circle-nodes' ||
      firstToken === 'no-descriptions'
    )
      continue;

    // Skip indented lines (descriptions, edges)
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Node label (strip pipe metadata)
    const label = trimmed.split('|')[0].trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return {
    kind: 'cycle',
    entities,
    keywords: ['direction-counterclockwise', 'no-descriptions', 'circle-nodes'],
  };
}

// ============================================================
// RACI / RASCI / DACI extractor
// ============================================================
//
// Extract role names, task names, and phase labels for editor
// autocomplete. Mirrors the lightweight per-line scan pattern used
// by other extractors (cycle / journey-map) — does NOT rebuild the
// full AST.

const RACI_PHASE_RE = /^\[(.+)\]\s*$/;
const RACI_ROLES_DIRECTIVE_RE = /^roles\s+(.+)$/i;
const RACI_VARIANT_DIRECTIVE_RE = /^variant\s+(.+)$/i;
const RACI_ROLE_ASSIGNMENT_RE = /^([^:]+):\s*(.*)$/;

function extractRaciSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let chartType = 'raci';
  let pastFirstLine = false;
  let underTask = false;

  const push = (s: string): void => {
    const trimmed = s.trim();
    if (trimmed && !entities.includes(trimmed)) entities.push(trimmed);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
      if (
        firstToken === 'raci' ||
        firstToken === 'rasci' ||
        firstToken === 'daci'
      ) {
        chartType = firstToken;
      }
      continue;
    }

    const indent = line.length - line.trimStart().length;

    // Header directives
    if (indent === 0) {
      const rolesMatch = trimmed.match(RACI_ROLES_DIRECTIVE_RE);
      if (rolesMatch) {
        for (const r of rolesMatch[1].split(',')) push(r);
        continue;
      }
      if (RACI_VARIANT_DIRECTIVE_RE.test(trimmed)) continue;
      if (METADATA_KEY_SET.has(trimmed.split(/\s+/)[0].toLowerCase())) continue;
      if (
        trimmed.toLowerCase() === 'draft' ||
        trimmed.toLowerCase() === 'solid-fill'
      )
        continue;
    }

    // [Phase Label]
    const phaseMatch = trimmed.match(RACI_PHASE_RE);
    if (phaseMatch && indent === 0) {
      push(phaseMatch[1]);
      underTask = false;
      continue;
    }

    // Role assignment (Role: markers) — only valid under a task
    const roleMatch = trimmed.match(RACI_ROLE_ASSIGNMENT_RE);
    if (underTask && roleMatch) {
      // Strip a possible trailing `# annotation`
      const rolePart = roleMatch[1].trim();
      push(rolePart);
      continue;
    }

    // Otherwise: treat the line as a task name. `#` is NOT a comment
    // character in DGMO (`//` is) — task names are used verbatim.
    push(trimmed);
    underTask = true;
  }

  return {
    kind: chartType,
    entities,
    keywords: ['variant', 'roles', 'no-rule-enforcement'],
  };
}

function extractJourneyMapSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    // Skip directives/metadata at indent 0
    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'persona' ||
      firstToken === 'tag' ||
      firstToken === 'no-legend'
    )
      continue;

    const isIndented = line[0] === ' ' || line[0] === '\t';

    // Skip deep-indented lines (annotations, descriptions under steps)
    // but keep singly-indented lines (steps within phases)
    if (isIndented) {
      // Annotation/description keywords — skip
      if (/^(pain|opportunity|thought|description)\s*:/i.test(trimmed))
        continue;
      // Tag group entries — skip
      if (/^\S+\([^)]+\)/.test(trimmed)) continue;
    }

    // Phase header
    const phaseMatch = trimmed.match(/^\[(.+?)\]$/);
    if (phaseMatch) {
      entities.push(phaseMatch[1].trim());
      continue;
    }

    // Step label (strip pipe metadata) — works for both indent 0 and indented steps
    const label = trimmed.split('|')[0].trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return {
    kind: 'journey-map',
    entities,
    keywords: [
      'persona',
      'no-legend',
      'pain',
      'opportunity',
      'thought',
      'description',
    ],
  };
}
