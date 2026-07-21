/**
 * Static completion registries — the LIGHT completion surface
 * (`@diagrammo/dgmo/completion`).
 *
 * Pure data: chart-type directive registries, structural keywords, entity-type
 * vocabularies, the reference-grammar descriptor, closed value enums, pipe /
 * same-line metadata keys, and the derived metadata key set.
 *
 * Split out of `./completion` (which additionally owns the symbol *extractors*)
 * so editor front-ends can import the registries without dragging the chart
 * parsers — notably `body/parser`, whose figure-asset catalog is ~290 KB — onto
 * their startup path. Same rationale and rule as `./chart-meta`: only symbols
 * whose transitive imports are parser-constant-only live here.
 *
 * Closed enum sets (`ALL_MARKERS`, wireframe `STATE_KEYWORDS` /
 * `GROUP_ONLY_METADATA`) are imported from their owning parsers — never
 * hand-copied — so completion can't drift from the grammar (one-oracle rule).
 */

import { ALL_CHART_TYPES } from './utils/parsing';
import { ALL_MARKERS } from './raci/variants';
import {
  STATE_KEYWORDS as WIREFRAME_STATE_KEYWORDS,
  GROUP_ONLY_METADATA as WIREFRAME_GROUP_ONLY_METADATA,
} from './wireframe/parser';
// Read chart-type descriptions directly from the source-of-truth data
// module instead of via dgmo-router.ts — chart-types.ts is a leaf module
// with zero imports, so this entry stays cycle-free and renderer-free.
import { chartTypes } from './chart-types';

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
  'legend-inline': {
    description: 'Title left, legend right on one row (§1.9)',
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
      'no-value': { description: 'Hide value labels at each vertex' },
    }),
  ],

  // ── Extended charts ──────────────────────────────────────
  [
    'scatter',
    withGlobals({
      'no-legend': { description: 'Hide the legend' },
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
  [
    'sankey',
    // Spec §1.11 (decision #49): the emphasis family. `highlight` lights the
    // named node's whole upstream+downstream flow closure and recedes the rest;
    // `dim` recedes exactly the named nodes. Mutually exclusive, last-one-wins.
    withGlobals({
      highlight: {
        description:
          'Light the named flow and recede everything else (highlight Barrel Aging)',
      },
      dim: {
        description:
          'Recede the named nodes and their flows, leaving the rest untouched (dim Spoilage)',
      },
    }),
  ],
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
      now: {
        description:
          '"now" pin at today (bare) or a pinned date (now 2026-07-20)',
      },
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
      'no-legend': { description: 'Hide the legend' },
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
  [
    'class',
    withGlobals({
      'no-legend': { description: 'Hide the legend' },
    }),
  ],
  [
    'er',
    // Spec §9 §8.5: notation (chen/crow), active-tag.
    withGlobals({
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
      'direction-tb': { description: 'Top-to-bottom layout (the default)' },
      'direction-lr': { description: 'Switch to left-to-right layout' },
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
      hide: { description: 'Hide tag:value pairs' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  // RACI / RASCI / DACI — one chart type (`raci`); the variant (RACI, RASCI,
  // or DACI) is inferred from the markers used (D → DACI, S → RASCI).
  [
    'raci',
    withGlobals({
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
      'direction-tb': { description: 'Top-to-bottom layout (the default)' },
      'direction-lr': { description: 'Switch to left-to-right layout' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'state',
    // Spec §6 §5.6: direction booleans, fill family, no-notes, active-tag
    // (decision #48 — state gained the standard tag system).
    withGlobals({
      'no-legend': { description: 'Hide the legend' },
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'no-notes': { description: 'Suppress all state note boxes' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'sitemap',
    withGlobals({
      'no-legend': { description: 'Hide the legend' },
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      'direction-lr': { description: 'Left-to-right layout (the default)' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'infra',
    withGlobals({
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
      'no-legend': { description: 'Hide the legend' },
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
  ['state', ['note', 'tag']],
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
  // Swimlane edges are authored inline inside lane blocks (§27.6) and may
  // forward-reference or cross lanes (`Lane.Node`). Only `->`: the message
  // flow `~>` is a §27.8 reserved seam that the parser rejects today, so
  // completion must not offer it.
  ['swimlane', { hasReferenceGrammar: true, referenceOperators: ['->'] }],
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

/**
 * The subset of `WIREFRAME_FLAGS` that only make sense on group elements
 * (`[...]`). Editor completion drops these for non-group elements (buttons
 * `(...)`, dropdowns `{...}`). Sourced from the wireframe parser's
 * `GROUP_ONLY_METADATA` — exported there and consumed here, never re-typed.
 */
export const WIREFRAME_GROUP_ONLY_FLAGS: readonly string[] = [
  ...WIREFRAME_GROUP_ONLY_METADATA,
];

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
