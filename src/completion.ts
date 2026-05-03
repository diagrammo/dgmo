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
  return fn(docText);
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
    withGlobals({
      'direction-lr': { description: 'Switch to left-to-right layout' },
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
    withGlobals({
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'org',
    withGlobals({
      'sub-node-label': { description: 'Label for sub-nodes' },
      'show-sub-node-count': { description: 'Show sub-node counts' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'kanban',
    withGlobals({
      'no-auto-color': { description: 'Disable automatic card coloring' },
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'c4',
    withGlobals({
      'active-tag': { description: 'Active tag group name' },
    }),
  ],
  [
    'state',
    withGlobals({
      'direction-tb': { description: 'Switch to top-to-bottom layout' },
      color: { description: 'Color mode', values: ['off'] },
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
    'gantt',
    withGlobals({
      start: { description: 'Project start date (YYYY-MM-DD)' },
      'today-marker': {
        description: 'Today marker (bare = on, or YYYY-MM-DD date)',
      },
      sort: { description: 'Sort order', values: ['time', 'group', 'tag'] },
      'critical-path': { description: 'Show critical path' },
      dependencies: { description: 'Show dependencies' },
      'active-tag': { description: 'Active tag group name' },
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
    withGlobals({
      rings: { description: 'Ring names block (innermost to outermost)' },
      quadrant: {
        description:
          'Quadrant position (top-left, top-right, bottom-left, bottom-right)',
      },
      ring: { description: 'Ring assignment for a blip' },
      trend: { description: 'Blip trend (new, up, down, stable)' },
      color: { description: 'Override quadrant color' },
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
    withGlobals({
      'no-legend': { description: 'Hide the score legend' },
      persona: { description: 'Define the journey persona' },
    }),
  ],
  [
    'pyramid',
    withGlobals({
      inverted: { description: 'Flip apex to the bottom (funnel orientation)' },
      color: { description: 'Override layer color (pipe metadata)' },
      description: { description: 'Layer description (pipe or indented body)' },
    }),
  ],
]);

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
 * Keyed by chart type → { node: ..., edge: ... }.
 *
 * IMPORTANT: NEVER add 'sequence' here. The `|` character in sequence
 * diagrams separates display names from identifiers and tag metadata.
 * Adding sequence would trigger false pipe-metadata completions on every `|`.
 */
export const PIPE_METADATA = new Map<
  string,
  {
    node: Record<string, PipeKeySpec>;
    edge: Record<string, PipeKeySpec>;
  }
>([
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
    'tech-radar',
    {
      node: {
        quadrant: {
          description: 'Quadrant position',
          values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        },
        ring: { description: 'Ring assignment for blip' },
        trend: {
          description: 'Blip trend indicator',
          values: ['new', 'up', 'down', 'stable'],
        },
        color: { description: 'Override quadrant color' },
      },
      edge: {},
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
]);

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
registerExtractor('boxes-and-lines', extractBoxesAndLinesSymbols);
registerExtractor('tech-radar', extractTechRadarSymbols);
registerExtractor('cycle', extractCycleSymbols);
registerExtractor('journey-map', extractJourneyMapSymbols);

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
