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

import { extractSymbols as extractBodySymbols } from './body/parser';
import { extractSymbols as extractErSymbols } from './er/parser';
import { extractSymbols as extractFlowchartSymbols } from './graph/flowchart-parser';
import { extractSymbols as extractInfraSymbols } from './infra/parser';
import { extractSymbols as extractClassSymbols } from './class/parser';
import { extractPertSymbols } from './pert/parser';
import {
  parseFirstLine,
  ALL_CHART_TYPES,
  measureIndent,
} from './utils/parsing';
import { RECOGNIZED_COLOR_NAMES } from './colors';
// Closed enum sets owned by their respective parsers — imported (never
// hand-copied) so completion can't drift from the grammar (one-oracle rule).
import { ALL_MARKERS } from './raci/variants';
import { STATE_KEYWORDS as WIREFRAME_STATE_KEYWORDS } from './wireframe/parser';

const RECOGNIZED_COLOR_SET: ReadonlySet<string> = new Set(
  RECOGNIZED_COLOR_NAMES
);
// Read chart-type descriptions directly from the source-of-truth data
// module instead of via dgmo-router.ts. dgmo-router imports every
// parser, and the parsers (Class/ER/Infra/Pert/Flowchart) type-only
// import DiagramSymbols back from this file — creating a hub of cycles
// through completion ↔ dgmo-router. Going through chart-types.ts (a
// leaf module with zero imports) breaks 7 of the 10 known cycles.
import { chartTypes } from './chart-types';

// ============================================================
// Symbol extraction
// ============================================================

// Types live in ./completion-types so the chart-type parsers can
// import them without taking a cycle through this file.
import type { ChartType, DiagramSymbols, ExtractFn } from './completion-types';
export type { ChartType, DiagramSymbols, ExtractFn };

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
      'catppuccin',
      'tokyo-night',
      'atlas',
      'blueprint',
      'slate',
      'tidewater',
    ],
  },
  theme: {
    description: 'Color theme',
    values: ['light', 'dark', 'transparent'],
  },
  'no-title': {
    description: 'Hide the diagram title',
  },
};

function withGlobals(
  directives: Record<string, DirectiveValueSpec> = {}
): DirectiveSpec {
  return { directives: { ...GLOBAL_DIRECTIVES, ...directives } };
}

// Universal date directives (§ BL-121) — offered by every date-bearing chart
// type (gantt, pert, countdown, timeline, event-line). Spread into each below.
const DATE_DIRECTIVES: Record<string, DirectiveValueSpec> = {
  year: {
    description:
      'Base year for bare month-day dates (e.g. `year 2026`); makes the diagram reproducible',
  },
  'date-order': {
    description:
      'How numeric slash/dash dates read: mdy (US, default) or dmy (day-first)',
    values: ['mdy', 'dmy'],
  },
  'no-current-year': {
    description:
      'Treat a fully-bare date (no year anywhere) as an error instead of assuming the current year',
  },
};

/** Chart-type → directive specifications. Every chart type has at least palette + theme. */
export const COMPLETION_REGISTRY = new Map<string, DirectiveSpec>([
  // ── Data charts ──────────────────────────────────────────
  [
    'bar',
    withGlobals({
      stack: {
        description:
          'Multi-series block header → stacked bars (one bar/category)',
      },
      group: {
        description:
          'Multi-series block header → clustered (side-by-side) bars',
      },
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
      fill: { description: 'Fill under the line (area chart)' },
      'x-label': { description: 'X-axis label' },
      'y-label': { description: 'Y-axis label (left axis)' },
      'y-right-label': {
        description: 'Right y-axis label (dual-axis; group series beneath it)',
      },
      'no-value': { description: 'Hide value labels at each point' },
    }),
  ],
  [
    'pie',
    withGlobals({
      hole: {
        description:
          'Doughnut ring (optional ratio 0–0.9); shows the total in center',
      },
      'no-center-total': {
        description: 'Hide the center total on a doughnut/hole pie',
      },
      'no-name': { description: 'Hide name from segment labels' },
      'no-value': { description: 'Hide value from segment labels' },
      'no-percent': { description: 'Hide percent from segment labels' },
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
  [
    'funnel',
    withGlobals({
      'no-name': { description: 'Hide left-side stage names' },
      'no-value': { description: 'Hide in-band values' },
      'no-percent': { description: 'Hide right-side conversion percentages' },
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
  [
    'timeline',
    withGlobals({
      ...DATE_DIRECTIVES,
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'event-line',
    withGlobals({
      ...DATE_DIRECTIVES,
      'no-scale': { description: 'Space events evenly instead of by date' },
      side: {
        description: 'Card placement: side above | below (default alternate)',
      },
      'no-box': {
        description: 'Card-less label/rule/description style (slides)',
      },
      'no-legend': { description: 'Hide the tag legend' },
      TBD: {
        description:
          'Date prefix for a not-yet-scheduled future event (e.g. "TBD Console Port")',
      },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  ['venn', withGlobals()],
  [
    'body',
    withGlobals({
      muscle: { description: 'Muscle form (default)' },
      skin: { description: 'Skin silhouette form' },
      male: { description: 'Male figure (default)' },
      front: { description: 'Front view (default)' },
      'no-legend': { description: 'Hide the tag legend' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
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
    // Spec §5 §4.6: direction-lr, fill family, no-notes. The phantom
    // `orientation-vertical` (never implemented) was deleted in decision #48.
    withGlobals({
      'direction-lr': { description: 'Switch to left-to-right layout' },
      'direction-tb': { description: 'Top-to-bottom layout (the default)' },
      'no-notes': { description: 'Suppress all node note boxes' },
    }),
  ],
  ['class', withGlobals({})],
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
    // hide, active-tag. fill family via FILL_FAMILY_CAPABLE.
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'sub-node-label': { description: 'Label for sub-nodes' },
      'show-sub-node-count': { description: 'Show sub-node counts' },
      hide: { description: 'Hide tag:value pairs' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'family',
    // Spec §32: sex-as-color + tag legend; active-tag. Fill family via
    // FILL_FAMILY_CAPABLE.
    withGlobals({
      'active-tag': { description: 'Active tag group name' },
      highlight: {
        description:
          'Dim everyone outside a person’s bloodline (highlight Name)',
      },
      generations: {
        description: 'Show Roman-numeral generation labels in a left gutter',
      },
      'no-daggers': {
        description: 'Hide the deceased dagger (†) marker',
      },
    }),
  ],
  [
    'kanban',
    // Spec §11 §10.4: hide, active-tag.
    withGlobals({
      hide: { description: 'Hide tag:value pairs' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  // RACI / RASCI / DACI — one chart type (`raci`); the variant (RACI, RASCI,
  // or DACI) is inferred from the markers used (D → DACI, S → RASCI).
  [
    'raci',
    withGlobals({
      roles: {
        description:
          'Declare role column order (inline `roles A, B, C` or indented block with per-role pipe metadata)',
      },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'c4',
    // Spec §8 §7.7: direction booleans, active-tag.
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'state',
    // Spec §6 §5.6: direction booleans, fill family, no-notes.
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'no-notes': { description: 'Suppress all state note boxes' },
    }),
  ],
  [
    'sitemap',
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'infra',
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      animate: { description: 'Enable traffic animation' },
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
      ...DATE_DIRECTIVES,
      'time-unit': {
        description: 'Time unit for activity durations (sp = sprints)',
        values: ['min', 'h', 'd', 'bd', 'w', 'm', 'q', 'y', 'sp'],
      },
      confidence: {
        description: 'Confidence factor for M-only durations',
        values: ['high', 'medium', 'low'],
      },
      // Canonical direction booleans (§1.9); key+value `direction LR|TB`
      // parses as legacy but is no longer offered.
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'node-detail': {
        description: 'Node visual density',
        values: ['compact', 'full'],
      },
      trials: {
        description:
          'Monte Carlo trial count (auto-derived from activity count)',
      },
      seed: { description: 'Monte Carlo PRNG seed (auto-derived from title)' },
      'scrubber-trials': {
        description: 'Fast-MC trials for the duration scrubber (default 300)',
      },
      'start-date': { description: 'Project start date (YYYY-MM-DD or now)' },
      'end-date': { description: 'Project end date (YYYY-MM-DD)' },
      'sprint-length': { description: 'Sprint duration (e.g. 2w)' },
      'sprint-number': { description: 'Starting sprint number' },
      'sprint-start': { description: 'Sprint start date (YYYY-MM-DD)' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'gantt',
    // Spec §13 §12.2 Options.
    withGlobals({
      ...DATE_DIRECTIVES,
      // Canonical since decision #48; bare `start` parses as a legacy alias
      // but is no longer offered.
      'start-date': { description: 'Project start date (ISO, 7/4, or Jul 4)' },
      'today-marker': {
        description: 'Today marker (bare = on, or a date)',
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
      // Canonical direction booleans (§1.9); key+value `direction LR|TB`
      // parses as legacy but is no longer offered.
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'active-tag': { description: 'Active tag group name' },
      hide: { description: 'Hide tag:value pairs' },
      heat: {
        description:
          'Label for the value→colour ramp, with an optional trailing [low] [high] color pair (pairs with the `heat:` key)',
      },
      // Values render by default (decision #48); legacy `show-values` is a
      // parse-accepted no-op.
      'no-value': { description: 'Hide the per-box numeric value labels' },
    }),
  ],
  [
    'swimlane',
    withGlobals({
      // Canonical direction booleans (§1.9); key+value `direction LR|TB`
      // parses as legacy but is no longer offered.
      'direction-tb': { description: 'Switch to vertical column lanes' },
      'direction-lr': { description: 'Horizontal band lanes (the default)' },
      lane: { description: 'Declare a lane (row) with an optional color' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'version-control',
    withGlobals({
      // Canonical direction booleans (§1.9); key+value `direction LR|TB`
      // parses as legacy but is no longer offered.
      'direction-tb': {
        description: 'Column lanes, newest down (the git-log view)',
      },
      'direction-lr': {
        description: 'Horizontal lanes, newest right (the default)',
      },
      merge: { description: 'Merge a branch into the active branch' },
      'cherry-pick': { description: 'Copy a commit onto the active branch' },
      rebase: { description: 'Replay a branch onto another (rebase X onto Y)' },
      reset: { description: 'Move a branch pointer back (reset X to commit)' },
      revert: { description: 'Add an inverse commit undoing a commit' },
      ref: {
        description:
          'Pointer at a commit (ref origin/main at commit) — remotes / HEAD',
      },
      note: { description: 'Numbered step annotation on the current commit' },
      'no-labels': { description: 'Hide commit messages' },
      'no-lanes': { description: 'Hide branch lanes' },
      'no-head': { description: 'Hide the HEAD marker' },
    }),
  ],
  [
    'mindmap',
    withGlobals({
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
    // Spec §20 documents one directive: `no-blip-legend` (the listing is
    // default-on everywhere per decision #48; legacy `show-blip-legend` is a
    // parse-accepted no-op). `rings` is a structural block keyword;
    // quadrant/ring/trend/color are pipe metadata that live in PIPE_METADATA.
    withGlobals({
      'no-blip-legend': {
        description: 'Hide the four-column blip listing beside the radar',
      },
    }),
  ],
  [
    'cycle',
    withGlobals({
      'direction-counterclockwise': {
        description: 'Reverse cycle direction to counterclockwise',
      },
      'circle-nodes': {
        description: 'Render nodes as circles instead of rectangles',
      },
    }),
  ],
  [
    'journey-map',
    // Spec §22 directives: `active-tag`. `persona` is a
    // structural keyword (like `tag` / `roles`), not a directive.
    // the fill family is added via FILL_FAMILY_CAPABLE below.
    withGlobals({
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'pyramid',
    // Spec §23.5 documents `inverted`; the fill family is added via
    // FILL_FAMILY_CAPABLE below (working but not yet in spec §23.5).
    // `color`/`description` are layer pipe-metadata, not directives.
    withGlobals({
      inverted: { description: 'Flip apex to the bottom (funnel orientation)' },
    }),
  ],
  [
    'ring',
    // Per spec §24.5 the only chart-specific directive family is `fill-*`,
    // applied via FILL_FAMILY_CAPABLE below. `color`/`description` are
    // layer pipe-metadata, not directives — they live in PIPE_METADATA.
    withGlobals({}),
  ],
  [
    'treemap',
    // Hierarchy sized by a bare trailing number; color modes + opt-outs.
    withGlobals({
      heat: {
        description:
          'Name the color-by-value ramp (`heat <Label> [low] [high]`); pairs with the per-node `heat:` key',
      },
      depth: {
        description:
          'Render N levels; deeper subtrees collapse to a drillable block',
      },
      // Decision #48: source-level pre-selection of the resting color
      // dimension (tag group name, heat label, or `none` = branch mode).
      'active-tag': {
        description:
          'Resting color dimension: a tag group name, the heat label, or none (branch)',
      },
      // Canonical since decision #48; plural `no-values` parses as a legacy
      // alias but is no longer offered.
      'no-value': { description: 'Hide value labels' },
      'no-percent': { description: 'Hide percentage labels' },
      'no-headers': { description: 'Hide parent header bars' },
      'no-legend': { description: 'Hide the legend' },
      radial: {
        description:
          'Render as a sunburst / hierarchical pie (concentric rings)',
      },
    }),
  ],
  [
    'block',
    // Author-controlled grid; columns are inferred from placement, so the only
    // directives are an explicit `columns` override and `no-legend`.
    withGlobals({
      columns: {
        description:
          'Grid width (columns); inferred from the widest row if omitted',
      },
      'no-legend': { description: 'Hide the tag legend' },
    }),
  ],
  [
    'goal',
    // Single now/target value. Mode is a bare flag (thermometer/gauge; the
    // progress bar is the default). Fill family/`no-title` come via globals.
    withGlobals({
      thermometer: { description: 'Render as a vertical thermometer' },
      gauge: { description: 'Render as a semicircular gauge dial' },
      now: { description: 'Current value (key value; no colon)' },
      target: { description: 'Goal value (must be > 0)' },
      note: {
        description: 'Free-text caption block (indented body, simple markdown)',
      },
      'no-percent': { description: 'Hide the % label' },
      'no-value': { description: 'Hide the raw now / target label' },
      // Canonical since decision #48; singular `no-note` parses as a legacy
      // alias but is no longer offered.
      'no-notes': { description: 'Suppress the note block even if present' },
      'no-auto-color': {
        description: 'Disable traffic-light coloring; use the palette color',
      },
    }),
  ],
  [
    'countdown',
    // Live "N until X". One-shot `target` OR a recurring `every … on … at …`
    // rule (never both). `units`/`round`/`fields` shape the display; `since*`
    // number the ordinal. All space-separated key value (no colon).
    withGlobals({
      ...DATE_DIRECTIVES,
      target: {
        description:
          'One-shot instant: a date/datetime (ISO, 7/4, or Jul 4) or `now` (key value)',
      },
      every: {
        description:
          'Recurring: every <year|month|week|N days|weeks|months> [on <instant>] [at <time>] [from <date>]',
      },
      on: {
        description:
          'Instant within the cadence: Aug 21 | 3rd Tuesday | last Friday | Friday',
      },
      at: {
        description: 'Time of day: 18:00 | 6pm | 6:30pm; default midnight',
      },
      from: {
        description:
          'Interval anchor date: every [N] day|week|month from <date> (e.g. every month from 2026-01-31)',
      },
      units: {
        description: 'human (default) | days | full | clock | weeks | words',
      },
      round: { description: 'up (default) | down | nearest' },
      fields: { description: 'full-mode segments: subset of d,h,m,s' },
      'no-visual': {
        description: 'Suppress the default-on calendar band (header only)',
      },
      tz: {
        description:
          'Pin authored times to an IANA zone (e.g. America/New_York) so the count never drifts with the viewer; default viewer-local',
      },
      lang: { description: 'Locale for words/month names (en)' },
      'on-day': { description: 'Text shown on the occurrence day (recurring)' },
      since: { description: 'Anchor year → enables the ordinal ("7th")' },
      'since-label': {
        description:
          'Eyebrow template: Nth → ordinal word, N → number (e.g. "Nth Anniversary")',
      },
      expired: { description: 'Text shown once a one-shot target passes' },
    }),
  ],
  [
    'clock',
    // Live world-clock board. Each row's anchor is a city (gazetteer), an IANA
    // zone, or a `UTC±HH:MM` offset (+ optional `as` alias).
    // Directives shape the board; all space-separated key value (no colon).
    withGlobals({
      analog: { description: 'Analog dials (default face is digital)' },
      hours: {
        description:
          'Working window: 9-17 | 9am-5pm | 8:30-17:15 (enables status)',
      },
      // Canonical since decision #48; `days` parses as a legacy alias but is
      // no longer offered.
      workweek: {
        description: 'Working days: mon-fri | mon,wed,fri (default mon-fri)',
      },
      'no-sun': {
        description: 'Hide the sundown/sunrise line (on by default)',
      },
      'time-24': {
        description: '24-hour readout (12-hour am/pm is the default)',
      },
      // Canonical direction booleans (§1.9); key+value `direction lr|tb`
      // (and its `columns` value alias) parses as legacy but is no longer
      // offered.
      'direction-lr': {
        description: 'Columns — panels in a horizontal strip (time on top)',
      },
      'direction-tb': {
        description: 'Rows — the default vertical stack',
      },
      'color-by': {
        description:
          'What drives each place color: place (default) | work | daylight | time | none',
        values: ['place', 'work', 'daylight', 'time', 'none'],
      },
    }),
  ],
  [
    'bracket',
    // Tournament bracket. `rounds`/`seed` shape the field; `single-elim` is the
    // default format. `beats`/`vs` are infix match keywords (not directives).
    withGlobals({
      rounds: {
        description:
          'Name the columns (comma-separated, or an indented block with per-round colors)',
      },
      seed: {
        description:
          'Declare a seeded entrant (`seed N Name`) → day-0 skeleton',
      },
      tag: {
        description: 'Tag group — a competitor tag colors its box outline',
      },
      // `accent <color>` is a legacy alias (decision #48) — the title-line
      // trailing color token is the canonical winner-accent slot, so the
      // directive is no longer offered in completion.
      'no-legend': { description: 'Hide the tag legend' },
      'no-round': { description: 'Suppress the round/column labels' },
      'single-elim': { description: 'Single-elimination format (default)' },
      'double-elim': {
        description: 'Double-elimination (reserved — not yet supported)',
      },
      seeded: { description: 'Force seeded mode (full skeleton from day 0)' },
    }),
  ],
  [
    'sketch',
    // GUI-first canvas: shapes carry their own metadata (shape:/at:); the only
    // directives are legend/fill/description toggles.
    withGlobals({
      'no-legend': { description: 'Hide the tag legend' },
      'no-descriptions': {
        description: 'Hide card metadata rows — the name fills each card',
      },
    }),
  ],
  [
    'map',
    // Geographic map directives (§24B.2/.7). Cosmetics are ON by default — the
    // only switches are bare `no-*` opt-outs, surfaced proactively so a
    // zero-config map still hints at what can be turned off. `poi`/`route` are
    // content keywords, not directives; metadata keys (heat/size/width/label/style)
    // live in the reserved-key registry.
    withGlobals({
      'region-heat': {
        description:
          'Label for the region value→colour ramp, with an optional trailing [low] [high] color pair (pairs with the `heat:` key)',
      },
      'poi-size': {
        description:
          'Label for the POI value→marker-size channel (pairs with the `size:` key)',
      },
      'flow-width': {
        description:
          'Label for the edge/leg value→line-thickness channel (pairs with the `width:` key)',
      },
      locale: {
        description:
          'Default country/state for bare place names, e.g. locale US-GA',
      },
      'active-tag': {
        description: 'Which tag group leads when several are present',
      },
      caption: { description: 'Caption line (data-source attribution)' },
      'no-title': { description: 'Suppress the title banner' },
      'no-legend': { description: 'Suppress the legend' },
      'no-coastline': {
        description: 'Turn off coastal water-lines (on by default)',
      },
      'no-relief': {
        description: 'Turn off mountain-range relief shading (on by default)',
      },
      'no-context-labels': {
        description: 'Turn off orientation labels for water + nearby countries',
      },
      'no-region-labels': {
        description: 'Turn off subdivision name labels (on by default)',
      },
      'no-region-heat-value': {
        description:
          'Turn off the heat value shown under each region (on by default)',
      },
      'no-poi-labels': { description: 'Turn off POI labels (on by default)' },
      'no-colorize': {
        description:
          'Force plain green-land reference dress (regions are auto-coloured by default)',
      },
      'no-cities': {
        description:
          'Turn off the subtle city dots scattered across the basemap (on by default)',
      },
      'no-cluster-pois': {
        description:
          'Always fan out coincident POI markers instead of collapsing them into a count badge',
      },
    }),
  ],
]);

// ── Cross-chart-type bare-keyword options: the fill family ──────
// Adds the §1.9 fill-family directives (`fill-tint`/`fill-solid`/
// `fill-outline`) to every chart type whose renderer actually responds to
// them. Chart types where the family is a no-op (map/gantt/infra/tech-radar
// deliberately opt out — their tint encodes data; wordcloud/slope/
// version-control have no tinted shape fill) intentionally don't list them —
// keeps the completion popup honest. `line` honors them only for area
// (`fill`) charts; line/function area fills and sankey ribbons honor
// `fill-solid` but ignore `fill-outline` (the fill is the data surface).
const FILL_FAMILY_CAPABLE = new Set([
  'sketch',
  'flowchart',
  'state',
  'sequence',
  'c4',
  'org',
  'family',
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
  'pie',
  'polar-area',
  'radar',
  'scatter',
  'pert',
  'block',
  'swimlane',
  'treemap',
  'heatmap',
  'venn',
  'timeline',
  'line',
  'event-line',
  'goal',
  'quadrant',
  'arc',
  'bracket',
  'body',
  'clock',
  'countdown',
  'raci',
]);
for (const [type, spec] of COMPLETION_REGISTRY) {
  if (FILL_FAMILY_CAPABLE.has(type)) {
    spec.directives['fill-solid'] = {
      description:
        'Render shapes with full intent color instead of the default 25% tint',
    };
    spec.directives['fill-outline'] = {
      description:
        'No fill — theme-background shapes with the color carried by the outline',
    };
    spec.directives['fill-tint'] = {
      description:
        'The default 25% tint fill, spelled explicitly (overrides an earlier fill-solid/fill-outline)',
    };
  }
}

// ============================================================
// Chart types array (for chart type completion popup)
// ============================================================

/** All chart types with descriptions, for chart type autocomplete. */
const CHART_TYPE_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  chartTypes.map((c) => [c.id, c.description])
);

export const CHART_TYPES: ReadonlyArray<{ name: string; description: string }> =
  [...ALL_CHART_TYPES].map((name) => ({
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
  ['sequence', ['actor', 'database', 'queue', 'cache']],
  [
    'c4',
    ['person', 'system', 'container', 'component', 'external', 'database'],
  ],
]);

// ============================================================
// Structural keywords for line-leading completion
// ============================================================

/**
 * Chart-type-specific structural keywords offered on an empty/start-of-line in
 * the data zone (block openers like `loop`, section headers like `containers`,
 * the `tag` block declaration, etc.). This is the single source of truth for
 * the editor's structural-keyword popup — every entry MUST be a token the
 * corresponding parser actually recognizes (validated by the
 * completion-conformance suite). Do NOT add removed/diagnostic-only tokens
 * (e.g. cycle's `no-descriptions`) or tokens the parser ignores.
 *
 * Chart types not listed here have no structural keywords (most data charts).
 */
export const STRUCTURAL_KEYWORDS = new Map<string, string[]>([
  ['sequence', ['if', 'else', 'loop', 'parallel', 'note', 'tag']],
  ['gantt', ['era', 'marker', 'holiday', 'workweek', 'parallel', 'tag']],
  ['c4', ['containers', 'components', 'deployment', 'tag']],
  ['timeline', ['era', 'marker', 'tag']],
  ['org', ['tag']],
  ['family', ['tag']],
  ['kanban', ['tag']],
  ['sitemap', ['tag']],
  ['infra', ['tag']],
  ['pert', ['tag']],
  ['mindmap', ['tag']],
  ['treemap', ['tag']],
  ['block', ['tag']],
  ['sketch', ['tag']],
  ['boxes-and-lines', ['tag']],
  ['swimlane', ['lane', 'tag']],
  [
    'version-control',
    ['merge', 'cherry-pick', 'rebase', 'reset', 'revert', 'ref', 'note'],
  ],
  ['er', ['tag']],
  ['cycle', ['direction-counterclockwise', 'circle-nodes']],
  ['journey-map', ['persona', 'tag']],
  ['raci', ['roles']],
  ['tech-radar', ['rings']],
  [
    'wireframe',
    [
      'nav',
      'tabs',
      'table',
      'image',
      'modal',
      'skeleton',
      'alert',
      'progress',
      'chart',
      'mobile',
      'tag',
    ],
  ],
  ['class', ['abstract', 'interface', 'enum', 'extends', 'implements']],
]);

/**
 * Chart types that support `tag` block declarations (and thus the
 * `alias`/`default` sub-keywords inside a tag block). Derived from
 * STRUCTURAL_KEYWORDS so the two can never drift — a chart supports tag blocks
 * iff it offers the `tag` keyword.
 */
export const TAG_SUPPORTING_TYPES: ReadonlySet<string> = new Set(
  [...STRUCTURAL_KEYWORDS]
    .filter(([, kws]) => kws.includes('tag'))
    .map(([type]) => type)
);

// ============================================================
// Reference grammar descriptor (slot 5 — entity reference)
// ============================================================

/** Whether a chart type has a reference position (arrow/operator → a prior
 *  declaration) and which operators open it. The single oracle that drives
 *  the library extractor audit, the app's entity-trigger map, and the
 *  conformance drift-guard — so the three can never disagree. v1 models
 *  reference-after-operator only (NOT metadata-target references). */
export interface ReferenceGrammar {
  hasReferenceGrammar: boolean;
  /** Literal operator tokens that introduce a reference (e.g. `->`, `<->`,
   *  `~>`, `+`). The app derives its trigger regex from these (allowing the
   *  labeled `-label->` / `~label~>` variants where applicable). */
  referenceOperators: string[];
}

/**
 * Per-type reference grammar. Grounded in each parser's arrow/operator
 * grammar — NOT hand-typed blind. Types with no reference position (org,
 * kanban, mindmap, all data charts, the radial/visualization types) declare
 * `hasReferenceGrammar: false`. `map` references (`route A ~> B`) are owned by
 * the app's bespoke geo-completion path, so it stays `false` here to avoid
 * double-handling.
 */
export const REFERENCE_GRAMMAR = new Map<string, ReferenceGrammar>([
  // Diagrams with a genuine reference position
  ['sequence', { hasReferenceGrammar: true, referenceOperators: ['->', '~>'] }],
  ['flowchart', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
  ['state', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
  ['sitemap', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
  [
    'c4',
    {
      hasReferenceGrammar: true,
      referenceOperators: ['->', '<->', '~>', '<~>'],
    },
  ],
  // ER/class/infra reference grammars are irregular (cardinality / typed
  // relationship operators / indented arrows); the app keeps a special-cased
  // trigger for those, but they're still reference-grammar types here so the
  // drift-guard covers their extractors.
  ['er', { hasReferenceGrammar: true, referenceOperators: ['--'] }],
  [
    'class',
    {
      hasReferenceGrammar: true,
      referenceOperators: ['-->', '--|>', '..|>', '*--', 'o--', '..>'],
    },
  ],
  ['infra', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
  ['gantt', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
  ['pert', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
  ['arc', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
  ['sankey', { hasReferenceGrammar: true, referenceOperators: ['->', '--'] }],
  [
    'boxes-and-lines',
    { hasReferenceGrammar: true, referenceOperators: ['->', '<->'] },
  ],
  // Sketch edges reference aliases / unambiguous labels (spec §31.4);
  // includes the net-new headless forms.
  [
    'sketch',
    {
      hasReferenceGrammar: true,
      referenceOperators: ['->', '<->', '~>', '<~>', '--', '~~'],
    },
  ],
  // Venn references prior sets via the `+` intersection operator (not an arrow).
  ['venn', { hasReferenceGrammar: true, referenceOperators: ['+'] }],
  // Family unions reference a prior/again-named person via the `+` couple operator.
  ['family', { hasReferenceGrammar: true, referenceOperators: ['+'] }],
]);

// Every other registered chart type has no reference position.
for (const type of ALL_CHART_TYPES) {
  if (!REFERENCE_GRAMMAR.has(type)) {
    REFERENCE_GRAMMAR.set(type, {
      hasReferenceGrammar: false,
      referenceOperators: [],
    });
  }
}

// ============================================================
// Closed value enums (slot 7) sourced from parser constants
// ============================================================

/**
 * RACI marker alphabet (slot-7 enum in the role-assignment value position).
 * Consumed by editor completion. The chart type is always `raci`; the variant
 * (RACI / RASCI / DACI) is inferred from the markers used, so completion offers
 * the full union (R / A / S / C / I / D) sourced from `raci/variants.ts`'s
 * `ALL_MARKERS` — the marker set can never drift from the parser.
 */
export const RACI_MARKER_ALPHABETS: ReadonlyMap<string, readonly string[]> =
  new Map([['raci', [...ALL_MARKERS]]]);

/**
 * Closed set of wireframe element state flags (slot-7 trailing enum, e.g.
 * `(Submit) primary destructive`). Sourced from the wireframe parser's
 * `STATE_KEYWORDS` — exported there and consumed here, never re-typed.
 */
export const WIREFRAME_FLAGS: readonly string[] = [...WIREFRAME_STATE_KEYWORDS];

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
 * IMPORTANT: NEVER add 'sequence' here. The `|` character in sequence
 * diagrams separates display names from identifiers and tag metadata.
 * Adding sequence would trigger false pipe-metadata completions on every `|`.
 */
export type PipeContextMap = Record<string, Record<string, PipeKeySpec>>;

export const PIPE_METADATA = new Map<string, PipeContextMap>([
  [
    'sketch',
    {
      node: {
        shape: {
          description:
            'Morph from the default rectangle: database, queue, person, document, note',
        },
        at: {
          description:
            'Half-slot position `at: C R` (integers; omit to flow-place)',
        },
        collapsed: {
          description: 'Bare flag on a [Box] line — start folded',
        },
      },
    },
  ],
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
      node: {
        duration: { description: 'Task duration (e.g., 30bd, 5d, 1.5w)' },
        start: { description: 'Explicit start date (e.g., 2024-01-15)' },
        progress: { description: 'Task progress (0–100)' },
        offset: { description: 'Task start offset (e.g., 8bd, -3bd)' },
      },
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
        heat: { description: 'Numeric value for the heat (colour) ramp' },
      },
      edge: {},
    },
  ],
  [
    'mindmap',
    {
      node: {
        description: { description: 'Node description text' },
        collapsed: {
          description:
            'Legacy `collapsed: true` — canonical is the bare trailing `collapsed` flag on the node line',
        },
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
    // Journey-map step pipe metadata (spec §22).
    // Tag aliases (e.g. `ch: Web`) are user-defined via the `tag` block
    // and resolved dynamically — not part of the static map.
    'journey-map',
    {
      step: {
        score: { description: 'Step score (1–5 integer; high = good)' },
        emotion: { description: 'Emotional state at this step' },
        description: { description: 'Step description text' },
        pain: { description: 'Pain point at this step' },
        opportunity: { description: 'Opportunity at this step' },
        thought: { description: 'User thought at this step' },
      },
    },
  ],
  [
    'org',
    {
      node: {
        description: { description: 'Person/team description' },
        role: { description: 'Role or job title' },
        location: { description: 'Office location' },
        email: { description: 'Email address' },
        phone: { description: 'Phone number' },
      },
    },
  ],
  [
    // Family §32: person metadata + the union-level marriage year.
    'family',
    {
      node: {
        sex: { description: 'Sex: m or f (drives node color)' },
        b: { description: 'Birth year' },
        d: { description: 'Death year' },
        bp: { description: 'Birth place' },
        dp: { description: 'Death place' },
        occupation: { description: 'Occupation' },
        military: { description: 'Military service' },
        education: { description: 'Education' },
        religion: { description: 'Religion' },
        burial: { description: 'Burial place' },
        m: { description: 'Marriage year (on a union line)' },
      },
    },
  ],
  [
    'er',
    {
      node: {
        description: { description: 'Entity description' },
        domain: { description: 'Domain grouping' },
      },
    },
  ],
  [
    'class',
    {
      node: {
        description: { description: 'Class description' },
      },
    },
  ],
  [
    'kanban',
    {
      node: {
        description: { description: 'Card description' },
        assignee: { description: 'Assigned person' },
        due: { description: 'Due date (YYYY-MM-DD)' },
      },
    },
  ],
  [
    'sitemap',
    {
      node: {
        description: { description: 'Page description' },
        status: { description: 'Page status' },
      },
    },
  ],
  [
    'pert',
    {
      node: {
        description: { description: 'Activity description' },
        confidence: {
          description: 'Confidence factor',
          values: ['high', 'medium', 'low'],
        },
        collapsed: {
          description:
            'Collapse detail (legacy `collapsed: true`; on group lines the bare trailing `collapsed` flag is canonical)',
        },
      },
    },
  ],
  [
    'timeline',
    {
      node: {
        description: { description: 'Event description' },
        duration: { description: 'Event duration (e.g., 30d, 1.5y)' },
      },
    },
  ],
]);

// ============================================================
// Derived metadata key set
// ============================================================

/** All known directive keys, derived from COMPLETION_REGISTRY. Includes implicit keys. */
export const METADATA_KEY_SET: ReadonlySet<string> = new Set([
  'chart',
  'title', // implicit directives recognized as metadata
  // Legacy key+value direction form (`direction LR|TB`) — no longer offered
  // by completion (the §1.9 booleans are canonical) but still parse-accepted,
  // so extractors must keep skipping it as a directive line.
  'direction',
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
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    const arrowMatch = trimmed.match(STATE_ARROW_RE);
    if (arrowMatch) {
      // Regex captured groups 1 and 2 by successful match; split('|')[0] always defined.
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
    }
  }

  return { kind: 'state', entities };
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
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();

    // Check for tag declaration — try explicit `alias` keyword first, then shorthand
    const tagMatch =
      trimmed.match(TAG_DECL_EXPLICIT_RE) ?? trimmed.match(TAG_DECL_SHORT_RE);
    if (tagMatch) {
      // Save previous tag group
      if (currentAlias !== null) {
        result.set(currentAlias, currentValues);
      }
      // Both regexes capture groups 1 (and 2 for explicit) on successful match.
      const name = tagMatch[1]!;
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
      // Regex captured group 1 by successful re-match (test passed above).
      currentAlias = trimmed.match(/^tag\s+(\S+)/i)![1]!;
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
        // Strip trailing-token color (§1.5): `Frontend blue` → `Frontend`.
        // Whitespace-split; if the last token is a recognized color word,
        // drop it; otherwise the whole trimmed string is the value.
        const lastSpaceIdx = trimmed.lastIndexOf(' ');
        const value =
          lastSpaceIdx > 0 &&
          RECOGNIZED_COLOR_SET.has(trimmed.substring(lastSpaceIdx + 1))
            ? trimmed.substring(0, lastSpaceIdx).trim()
            : trimmed;
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
    // Regex captured groups 1 and 2 by successful match.
    const canonical = match[1]!.trim();
    const alias = match[2]!;
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
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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
      // Regex captured group 1 by successful match; split('|')[0] always defined.
      const name = containerMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      lastNodeIndent = indent;
      continue;
    }

    // Arrows: -> Target or -label-> Target
    const bareArrow = trimmed.match(SITEMAP_BARE_ARROW_RE);
    const labeledArrow = !bareArrow ? trimmed.match(SITEMAP_ARROW_RE) : null;
    if (bareArrow || labeledArrow) {
      // split('|')[0] always defined on any string.
      const target = (bareArrow?.[1] ?? labeledArrow?.[1] ?? '')
        .split('|')[0]!
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
    // split('|')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.trim();
    if (label) {
      if (!entities.includes(label)) entities.push(label);
      lastNodeIndent = indent;
    }
  }

  return { kind: 'sitemap', entities };
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

    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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
      // Regex captured group 2 by successful match; split('|')[0] always defined.
      const name = elemMatch[2]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Is-a declaration: Name is a person
    const isAMatch = trimmed.match(C4_IS_A_RE);
    if (isAMatch) {
      // Regex captured group 1 by successful match; split('|')[0] always defined.
      const name = isAMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Arrow lines: Source -> Target, Source ~> Target, etc.
    const arrowMatch = trimmed.match(C4_ARROW_RE);
    if (arrowMatch) {
      // Regex captured groups 1 and 2 by successful match; split('|')[0] always defined.
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }
  }

  return {
    kind: 'c4',
    entities,
  };
}

// ============================================================
// Gantt extractor
// ============================================================

const GANTT_LEGACY_DURATION_RE =
  /^(\d+(?:\.\d+)?)(min|bd|sp|d|w|m|q|y|h|s)\??\s+(.+)$/;
const GANTT_LEGACY_DATE_RE = /^(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)\s+(.+)$/;
const GANTT_GROUP_RE = /^\[(.+?)\]/;
const GANTT_STRUCTURAL_RE = /^(era|marker|holiday|workweek|parallel)\b/i;
const GANTT_META_KEY_RE = /\b(?:duration|start):\s/;

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

    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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

    // Groups: [GroupName]
    const groupMatch = trimmed.match(GANTT_GROUP_RE);
    if (groupMatch) {
      const name = groupMatch[1]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // New syntax: Task Name duration: 5d or Task Name start: 2024-01-15
    // (checked before structural keyword skip so "Era of Innovation duration: 5d" isn't skipped)
    if (GANTT_META_KEY_RE.test(trimmed)) {
      const cutIdx = trimmed.search(
        /\b(?:duration|start|progress|offset|color|description):\s/
      );
      if (cutIdx > 0) {
        let taskName = trimmed.substring(0, cutIdx).trim();
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

    // Skip structural keywords (after new-syntax check so "Era of Innovation duration: 5d" isn't skipped)
    if (GANTT_STRUCTURAL_RE.test(trimmed)) continue;

    // Legacy: Tasks by duration: 30d Task Name
    const durMatch = trimmed.match(GANTT_LEGACY_DURATION_RE);
    if (durMatch) {
      let taskName = durMatch[3]!.split('|')[0]!.trim();
      const arrowIdx = taskName.indexOf('->');
      if (arrowIdx > 0)
        taskName = taskName
          .substring(0, arrowIdx)
          .replace(/-[^>]*$/, '')
          .trim();
      if (taskName && !entities.includes(taskName)) entities.push(taskName);
      continue;
    }

    // Legacy: Tasks by date: 2024-01-15 Task Name
    const dateMatch = trimmed.match(GANTT_LEGACY_DATE_RE);
    if (dateMatch) {
      let taskName = dateMatch[2]!.split('|')[0]!.trim();
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

  return { kind: 'gantt', entities };
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

    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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
      // Regex captured groups 1 and 2 by successful match; split('|')[0] always defined.
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }

    // Node lines
    // split('|')[0] and chained split('[')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.split('[')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'boxes-and-lines', entities };
}

// ============================================================
// Org extractor
// ============================================================

const ORG_GROUP_RE = /^\[(.+?)\]/;

function extractOrgSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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

    // Team/group headers: [Team Name]
    const groupMatch = trimmed.match(ORG_GROUP_RE);
    if (groupMatch) {
      const name = groupMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Skip indented metadata lines (key: value)
    if (indent > 0 && /^[a-z]+\s*:/.test(trimmed)) continue;

    // Person name (indent 0 or direct child)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'org', entities };
}

// ============================================================
// Family extractor — person names for reference completion
// ============================================================

function extractFamilySymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;
  let inTagBlock = false;

  const add = (raw: string): void => {
    let s = raw.trim();
    // Strip trailing `key:` metadata, a bare `adopted` token, and quotes.
    const mIdx = s.search(/\s[A-Za-z][\w-]*\s*:/);
    if (mIdx >= 0) s = s.slice(0, mIdx);
    s = s.replace(/\s+adopted\s*$/i, '');
    s = s
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (s && !entities.includes(s)) entities.push(s);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    // Union line → both sides; person/child line → the single name.
    for (const side of trimmed.split(/\s+\+\s+/)) add(side);
  }

  return { kind: 'family', entities };
}

// ============================================================
// Kanban extractor
// ============================================================

const KANBAN_COLUMN_RE = /^\[(.+?)\]/;

function extractKanbanSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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

    // Column headers: [Column Name]
    const colMatch = trimmed.match(KANBAN_COLUMN_RE);
    if (colMatch) {
      const name = colMatch[1]!.split('|')[0]!.trim();
      if (name && !entities.includes(name)) entities.push(name);
      continue;
    }

    // Card names (indented under columns)
    if (indent > 0) {
      const label = trimmed.split('|')[0]!.trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: 'kanban', entities };
}

// ============================================================
// Mindmap extractor
// ============================================================

function extractMindmapSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
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

    // Skip indented metadata (description:, collapsed:)
    if (/^(description|collapsed)\s*:/i.test(trimmed)) continue;

    // Node name (at any indent level)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'mindmap', entities };
}

// ============================================================
// Treemap extractor
// ============================================================

function extractTreemapSymbols(docText: string): DiagramSymbols {
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

    // Directives and tag blocks are not node entities.
    if (
      /^(depth|heat|no-[a-z]+)\s/i.test(trimmed) ||
      /^(no-[a-z]+|radial)$/i.test(trimmed)
    )
      continue;
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    // Node name: strip same-line metadata + the bare trailing value number.
    let label = trimmed.split(/\s+\w+:/)[0]!.trim();
    label = label.replace(/\s+-?\d[\d_,.]*$/, '').trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'treemap', entities };
}

/** Block-diagram symbols: every `[Label]` on a grid row (skips tag blocks and
 *  the `columns` / `no-*` directives). */
function extractBlockSymbols(docText: string): DiagramSymbols {
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
    if (/^(columns|no-[a-z]+)\b/i.test(trimmed)) continue;
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }
    const re = /\[([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      const label = m[1]!.trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: 'block', entities };
}

/** Sketch symbols: shape labels, aliases, and box labels — everything an
 *  edge line can reference (spec §31.4). */
function extractSketchSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  const push = (value: string): void => {
    const v = value.trim();
    if (v && !entities.includes(v)) entities.push(v);
  };
  let pastFirstLine = false;
  let inTagBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }
    if (/^(no-[a-z-]+|fill-tint|fill-solid|fill-outline)\s*$/i.test(trimmed))
      continue;
    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }
    if (/^[<\-~]/.test(trimmed)) continue; // edge line
    const boxMatch = trimmed.match(
      /^\[([^\]]+)\]\s*(?:as\s+([A-Za-z][A-Za-z0-9_]{0,11}))?/
    );
    if (boxMatch) {
      push(boxMatch[1]!);
      if (boxMatch[2]) push(boxMatch[2]);
      continue;
    }
    // Shape line: cut metadata at the first reserved key, peel `as alias`.
    let name = trimmed;
    const metaCut = name.search(/\s(?:shape|at|collapsed)\s*:/i);
    if (metaCut >= 0) name = name.slice(0, metaCut);
    const aliasMatch = name.match(
      /^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/
    );
    if (aliasMatch) {
      push(aliasMatch[1]!.replace(/^"|"$/g, ''));
      push(aliasMatch[2]!);
    } else {
      push(name.replace(/^"|"$/g, ''));
    }
  }

  return { kind: 'sketch', entities };
}

// ============================================================
// Pyramid extractor
// ============================================================

function extractPyramidSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'inverted' ||
      firstToken === 'fill-tint' ||
      firstToken === 'fill-solid' ||
      firstToken === 'fill-outline'
    )
      continue;

    // Skip indented description lines
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Layer name (strip pipe metadata)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'pyramid', entities };
}

// ============================================================
// Ring extractor
// ============================================================

function extractRingSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'fill-tint' ||
      firstToken === 'fill-solid' ||
      firstToken === 'fill-outline'
    )
      continue;

    // Skip indented description lines
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Layer name (strip pipe metadata)
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'ring', entities };
}

// ============================================================
// Arc extractor
// ============================================================

const ARC_ARROW_RE = /^(\S+)\s+(?:->|-[^>]*->)\s+(\S+)/;

function extractArcSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    const arrowMatch = trimmed.match(ARC_ARROW_RE);
    if (arrowMatch) {
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
    }
  }

  return { kind: 'arc', entities };
}

// ============================================================
// Sankey extractor
// ============================================================

// Sankey links accept both directed `->` and undirected `--` (echarts.ts §1.5).
const SANKEY_ARROW_RE = /^(.+?)\s+(?:->|--)\s+(.+?)\s+(\d[\d,_.]*)/;

function extractSankeySymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    const arrowMatch = trimmed.match(SANKEY_ARROW_RE);
    if (arrowMatch) {
      const src = arrowMatch[1]!.split('|')[0]!.trim();
      const dst = arrowMatch[2]!.split('|')[0]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
    } else {
      // Standalone node declaration (just a name, possibly with color)
      const label = trimmed.split('|')[0]!.trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: 'sankey', entities };
}

// ============================================================
// Timeline extractor
// ============================================================

const TIMELINE_ERA_RE = /^era\s+/i;
const TIMELINE_MARKER_RE = /^marker\s+/i;

const TIMELINE_SCHEDULING_RE = /\b(?:start|end|duration)\s*:/;

function extractTimelineSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (TIMELINE_ERA_RE.test(trimmed) || TIMELINE_MARKER_RE.test(trimmed))
      continue;

    if (/^tag\s+/i.test(trimmed)) {
      inTagBlock = true;
      continue;
    }
    const indent = line.search(/\S/);
    if (inTagBlock) {
      if (indent > 0) continue;
      inTagBlock = false;
    }

    let label: string;
    if (TIMELINE_SCHEDULING_RE.test(trimmed)) {
      label = trimmed
        .replace(/\b(?:start|end|duration|color|description)\s*:.*$/, '')
        .split('|')[0]!
        .trim();
    } else {
      label = trimmed
        .replace(
          /^\d{4}(?:-\d{2}(?:-\d{2})?)?\s*(?:->\s*\d{4}(?:-\d{2}(?:-\d{2})?)?)?\s*/,
          ''
        )
        .split('|')[0]!
        .trim();
    }
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'timeline', entities };
}

// ============================================================
// Venn extractor
// ============================================================

function extractVennSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Skip indented intersection lines
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Skip intersection rows — those are references to prior sets, not
    // declarations. Set NAMES + aliases come from the declaration lines below
    // (the `+`-completion offers those). Match the parser's detection (d3.ts:
    // any `+` on the line = intersection), not just the spaced form.
    if (trimmed.includes('+')) continue;

    // Set declaration: `Name [as <alias>] [color]`. Emit both the clean name
    // and the alias so `Set + ` reference completion can offer either token.
    const work = trimmed.split('|')[0]!.trim();
    const asMatch = work.match(/^(.+?)\s+as\s+([A-Za-z][\w-]*)\b/i);
    if (asMatch) {
      const name = asMatch[1]!.trim();
      const alias = asMatch[2]!;
      if (name && !entities.includes(name)) entities.push(name);
      if (alias && !entities.includes(alias)) entities.push(alias);
      continue;
    }
    // No alias — strip a trailing color token if present.
    const colorMatch = work.match(/^(.+?)\s+(\S+)$/);
    const label =
      colorMatch && RECOGNIZED_COLOR_SET.has(colorMatch[2]!.toLowerCase())
        ? colorMatch[1]!.trim()
        : work;
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'venn', entities };
}

// ============================================================
// Quadrant extractor
// ============================================================

const QUADRANT_POSITION_RE =
  /^(top-right|top-left|bottom-right|bottom-left)\s+/i;

function extractQuadrantSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (QUADRANT_POSITION_RE.test(trimmed)) continue;

    // Point name (may have coordinates: Name x,y)
    const parts = trimmed.split(/\s+\d/);
    const label = (parts[0] ?? '').split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'quadrant', entities };
}

// ============================================================
// Slope extractor
// ============================================================

function extractSlopeSymbols(docText: string): DiagramSymbols {
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

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (firstToken === 'period') continue;

    // Data row: Label value1 value2 [color]
    // Extract just the label (everything before first number)
    const numIdx = trimmed.search(/\s\d/);
    const label =
      numIdx > 0
        ? trimmed.slice(0, numIdx).trim()
        : trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return { kind: 'slope', entities };
}

// ============================================================
// Generic data chart extractor
// ============================================================

const SERIES_RE = /^series\s+(.+)$/i;
// "A -> B value" / "A -- B value" flow-link rows (chord/sankey via the shared
// extractor). Both endpoints captured; trailing weight optional.
const DATA_EDGE_RE = /^(.+?)\s+(?:->|--)\s+(.+?)(?:\s+-?\d[\d,_.]*)?\s*$/;

function extractDataChartSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let chartType = 'bar';
  let pastFirstLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
      if (firstToken) chartType = firstToken;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // Series declarations: "series Revenue, Expenses"
    const seriesMatch = trimmed.match(SERIES_RE);
    if (seriesMatch) {
      for (const s of seriesMatch[1]!.split(',')) {
        const name = s.trim().split(/\s+/)[0]!;
        if (name && !entities.includes(name)) entities.push(name);
      }
      continue;
    }

    // Edge rows (chord / flow links): "A -> B value" / "A -- B value" — recover
    // BOTH endpoints. Without this the trailing-number scan below mangles the
    // whole "A -> B" into a single junk entity.
    const edgeMatch = trimmed.match(DATA_EDGE_RE);
    if (edgeMatch) {
      const src = edgeMatch[1]!.trim();
      const dst = edgeMatch[2]!.trim();
      if (src && !entities.includes(src)) entities.push(src);
      if (dst && !entities.includes(dst)) entities.push(dst);
      continue;
    }

    // Label-expression rows (function curves §15.4): "Name: expression". ONLY
    // for `function` — other data charts have no colon-form and would otherwise
    // truncate legitimate colon-bearing labels (`12:00 5` → `12`). Column-0
    // only, so indented `key: value` metadata is never misread as an entity.
    if (chartType === 'function') {
      const indent = line.length - line.trimStart().length;
      const colonIdx = trimmed.indexOf(':');
      if (indent === 0 && colonIdx > 0) {
        const beforeColon = trimmed.slice(0, colonIdx).trim();
        if (beforeColon && !METADATA_KEY_SET.has(beforeColon.toLowerCase())) {
          if (!entities.includes(beforeColon)) entities.push(beforeColon);
          continue;
        }
      }
    }

    // Data rows: "Label value [value...] [color]"
    const numIdx = trimmed.search(/\s-?\d/);
    if (numIdx > 0) {
      const label = trimmed.slice(0, numIdx).trim();
      if (label && !entities.includes(label)) entities.push(label);
    }
  }

  return { kind: chartType, entities };
}

// ============================================================
// Wireframe extractor
// ============================================================

// Wireframe element grammar is not a numeric-row variant, so it earns its own
// extractor: `[label]` fields, `(button)`, `{a | b}` dropdowns/selects, with
// possibly several elements per line. Returns the element labels as entities.
const WF_FIELD_RE = /\[([^\]]*)\]/g;
const WF_BUTTON_RE = /\(([^)]+)\)/g;
const WF_DROPDOWN_RE = /\{([^}]+)\}/g;

function extractWireframeSymbols(docText: string): DiagramSymbols {
  const lines = docText.split('\n');
  const entities: string[] = [];
  let pastFirstLine = false;

  const push = (s: string): void => {
    // Strip any legacy trailing `| meta` inside a bracket; the `{a|b}` pipe is
    // handled separately by the dropdown split below.
    const t = s.split('|')[0]!.trim();
    if (t && !entities.includes(t)) entities.push(t);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!pastFirstLine) {
      pastFirstLine = true;
      continue;
    }

    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;

    // `[label]` input/group fields.
    for (const m of trimmed.matchAll(WF_FIELD_RE)) {
      const inner = m[1]!.trim();
      if (inner) push(inner);
    }
    // `(button)` — skip radio markers `(*)` / `( )`.
    for (const m of trimmed.matchAll(WF_BUTTON_RE)) {
      const inner = m[1]!.trim();
      if (inner === '*' || inner === '') continue;
      push(inner);
    }
    // `{opt1 | opt2}` dropdown/select — each option is an entity (carve-out pipe).
    for (const m of trimmed.matchAll(WF_DROPDOWN_RE)) {
      for (const opt of m[1]!.split('|')) {
        const t = opt.trim();
        if (t && !entities.includes(t)) entities.push(t);
      }
    }
  }

  return { kind: 'wireframe', entities };
}

// ============================================================
// Register built-in extractors
// ============================================================

registerExtractor('body', extractBodySymbols);
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
registerExtractor('org', extractOrgSymbols);
registerExtractor('family', extractFamilySymbols);
registerExtractor('kanban', extractKanbanSymbols);
registerExtractor('mindmap', extractMindmapSymbols);
registerExtractor('treemap', extractTreemapSymbols);
registerExtractor('block', extractBlockSymbols);
registerExtractor('sketch', extractSketchSymbols);
registerExtractor('pyramid', extractPyramidSymbols);
registerExtractor('ring', extractRingSymbols);
registerExtractor('arc', extractArcSymbols);
registerExtractor('sankey', extractSankeySymbols);
registerExtractor('timeline', extractTimelineSymbols);
registerExtractor('venn', extractVennSymbols);
registerExtractor('quadrant', extractQuadrantSymbols);
registerExtractor('slope', extractSlopeSymbols);
registerExtractor('bar', extractDataChartSymbols);
registerExtractor('line', extractDataChartSymbols);
registerExtractor('pie', extractDataChartSymbols);
registerExtractor('polar-area', extractDataChartSymbols);
registerExtractor('radar', extractDataChartSymbols);
registerExtractor('scatter', extractDataChartSymbols);
registerExtractor('heatmap', extractDataChartSymbols);
registerExtractor('funnel', extractDataChartSymbols);
// `function` (`Name: expr`) and `wordcloud` (`Word weight`) had NO extractor
// registered — extractDiagramSymbols returned null for them. The generalized
// shared extractor now handles the colon-label form, so register both.
registerExtractor('function', extractDataChartSymbols);
registerExtractor('wordcloud', extractDataChartSymbols);
registerExtractor('wireframe', extractWireframeSymbols);

function extractTechRadarSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];

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
        // Regex captured groups 1 and 2 by successful match.
        entities.push(aliasMatch[1]!.trim());
        entities.push(aliasMatch[2]!.trim());
      } else {
        entities.push(trimmed);
      }
    }
  }

  return { kind: 'tech-radar', entities };
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
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (
      firstToken === 'direction-counterclockwise' ||
      firstToken === 'circle-nodes'
    )
      continue;

    // Skip indented lines (descriptions, edges)
    if (line[0] === ' ' || line[0] === '\t') continue;

    // Node label (strip pipe metadata)
    // split('|')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return {
    kind: 'cycle',
    entities,
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
      // split(/\s+/) on non-empty `trimmed` always yields at least one element.
      const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
      if (firstToken === 'raci') {
        chartType = firstToken;
      }
      continue;
    }

    const indent = measureIndent(line);

    // Header directives
    if (indent === 0) {
      const rolesMatch = trimmed.match(RACI_ROLES_DIRECTIVE_RE);
      if (rolesMatch) {
        // Regex captured group 1 by successful match.
        for (const r of rolesMatch[1]!.split(',')) push(r);
        continue;
      }
      if (RACI_VARIANT_DIRECTIVE_RE.test(trimmed)) continue;
      // split(/\s+/) on non-empty `trimmed` always yields at least one element.
      if (METADATA_KEY_SET.has(trimmed.split(/\s+/)[0]!.toLowerCase()))
        continue;
      if (
        trimmed.toLowerCase() === 'draft' ||
        trimmed.toLowerCase() === 'fill-tint' ||
        trimmed.toLowerCase() === 'fill-solid' ||
        trimmed.toLowerCase() === 'fill-outline'
      )
        continue;
    }

    // [Phase Label]
    const phaseMatch = trimmed.match(RACI_PHASE_RE);
    if (phaseMatch && indent === 0) {
      // Regex captured group 1 by successful match.
      push(phaseMatch[1]!);
      underTask = false;
      continue;
    }

    // Role assignment (Role: markers) — only valid under a task
    const roleMatch = trimmed.match(RACI_ROLE_ASSIGNMENT_RE);
    if (underTask && roleMatch) {
      // Strip a possible trailing `# annotation`
      // Regex captured group 1 by successful match.
      const rolePart = roleMatch[1]!.trim();
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
    // split(/\s+/) on non-empty `trimmed` always yields at least one element.
    const firstToken = trimmed.split(/\s+/)[0]!.toLowerCase();
    if (METADATA_KEY_SET.has(firstToken)) continue;
    if (firstToken === 'persona' || firstToken === 'tag') continue;

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
      // Regex captured group 1 by successful match.
      entities.push(phaseMatch[1]!.trim());
      continue;
    }

    // Step label (strip pipe metadata) — works for both indent 0 and indented steps
    // split('|')[0] always defined on any string.
    const label = trimmed.split('|')[0]!.trim();
    if (label && !entities.includes(label)) entities.push(label);
  }

  return {
    kind: 'journey-map',
    entities,
  };
}
