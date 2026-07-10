import {
  REGISTRY_DIRECTIVE_TOKENS,
  REGISTRY_CONTROL_TOKENS,
  REGISTRY_STATUS_TOKENS,
  REGISTRY_MODIFIER_TOKENS,
} from '../directives-registry';

/** All supported DGMO chart types. */
export const CHART_TYPES = new Set([
  // Diagram types
  'sequence',
  'flowchart',
  'class',
  'er',
  'org',
  'family',
  'kanban',
  'c4',
  'state',
  'sitemap',
  'infra',
  'gantt',
  'pert',
  'boxes-and-lines',
  'swimlane',
  'version-control',
  'wireframe',
  'tech-radar',
  'mindmap',
  'journey-map',
  'pyramid',
  'ring',
  'treemap',
  'block',
  'sketch',
  'raci',
  'cycle',
  // Data chart types
  'bar',
  'line',
  'pie',
  'polar-area',
  'radar',
  'scatter',
  'sankey',
  'function',
  'heatmap',
  'funnel',
  // Visualization types
  'slope',
  'wordcloud',
  'arc',
  'timeline',
  'event-line',
  'venn',
  'quadrant',
  'map',
  'body',
]);

/** Metadata keys recognized across chart types. */
export const METADATA_KEYS = new Set([
  'title',
  'series',
  // Bar layout headers + pie/line directives (consolidation #23–#26)
  'stack',
  'group',
  'hole',
  'fill',
  'layout',
  'orientation',
  'x-label',
  'y-label',
  'y-right-label',
  'size-label',
  'x',
  'columns',
  'rows',
  'labels',
  'rotate',
  'max',
  'size',
  'order',
  'sort',
  'scale',
  'values',
  'notation',
  'x-axis',
  'y-axis',
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  // Tech-radar pipe metadata
  'quadrant',
  'ring',
  'trend',
  // Map (§24B) reserved metadata keys
  'value',
  'label',
  'style',
  // Treemap color-by-value metric key
  'heat',
]);

/** Tag declaration keyword. */
export const TAG_KEYWORD = 'tag';

// The four specializer-read keyword sets below are now sourced entirely from
// directives-registry.ts (the single declaration site). Each is a thin spread
// of that registry's category contribution; add or change vocabulary in the
// registry, not here. tests/highlight-coverage.test.ts asserts these sets
// equal the registry contributions exactly (no drift) and pins a full
// inventory snapshot.

/** Directive keywords — commands that configure chart behavior. */
export const DIRECTIVE_KEYWORDS = new Set([...REGISTRY_DIRECTIVE_TOKENS]);

/** Control flow keywords — structural blocks + wireframe element leaders. */
export const CONTROL_KEYWORDS = new Set([...REGISTRY_CONTROL_TOKENS]);

/**
 * Status keywords — kanban. (Tech-radar trend values `new`/`up`/`down`/`stable`
 * are intentionally absent — they collide with common English prose; the
 * tech-radar parser validates them explicitly and completion still suggests
 * them in trend-value position.)
 */
export const STATUS_KEYWORDS = new Set([...REGISTRY_STATUS_TOKENS]);

/** Modifier keywords — adjust declarations (incl. ER column types/modifiers). */
export const MODIFIER_KEYWORDS = new Set([...REGISTRY_MODIFIER_TOKENS]);
