import {
  REGISTRY_DIRECTIVE_TOKENS,
  REGISTRY_CONTROL_TOKENS,
} from '../directives-registry';

/** All supported DGMO chart types. */
export const CHART_TYPES = new Set([
  // Diagram types
  'sequence',
  'flowchart',
  'class',
  'er',
  'org',
  'kanban',
  'c4',
  'state',
  'sitemap',
  'infra',
  'gantt',
  'pert',
  'boxes-and-lines',
  'wireframe',
  'tech-radar',
  'mindmap',
  'journey-map',
  'pyramid',
  'ring',
  'raci',
  'rasci',
  'daci',
  'cycle',
  // Data chart types
  'bar',
  'line',
  'pie',
  'doughnut',
  'area',
  'polar-area',
  'radar',
  'bar-stacked',
  'multi-line',
  'scatter',
  'sankey',
  'chord',
  'function',
  'heatmap',
  'funnel',
  // Visualization types
  'slope',
  'wordcloud',
  'arc',
  'timeline',
  'venn',
  'quadrant',
  'map',
]);

/** Metadata keys recognized across chart types. */
export const METADATA_KEYS = new Set([
  'title',
  'series',
  'orientation',
  'x-label',
  'y-label',
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
]);

/** Tag declaration keyword. */
export const TAG_KEYWORD = 'tag';

/** Directive keywords — commands that configure chart behavior. */
export const DIRECTIVE_KEYWORDS = new Set([
  // Single-source: the infra / gantt / map vocab is owned by
  // directives-registry.ts (the parsers derive their Sets from the same
  // source). This spreads its bare-directive contribution in — do NOT re-list
  // those tokens below. Provided here: start, sort, today-marker,
  // critical-path, sprint-*, solid-fill, title, no-title, active-tag,
  // default-rps/latency-ms/uptime, slo-* and all map `region-metric`/`no-*`
  // directives. (Behavior/edge colon-keys go to ATTRIBUTE_KEYS instead.)
  ...REGISTRY_DIRECTIVE_TOKENS,
  // Gantt (registry covers start/sort/today-marker/critical-path/sprint-*)
  'era',
  'marker',
  'holiday',
  'workweek',
  'no-dependencies',
  // Tech-radar
  'rings',
  // Tags
  'tags',
  'import',
  'hide',
  'direction',
  // Boxes-and-lines
  'box-metric',
  'show-values',
  // ER
  'notation',
  // Class
  'extends',
  'implements',
  'abstract',
  'interface',
  'enum',
  // C4
  'containers',
  'components',
  'deployment',
  // Infra directives (registry covers slo-*/default-*; behavior keys →
  // ATTRIBUTE_KEYS)
  'sub-node-label',
  'show-sub-node-count',
  'animate',
  // Sequence
  'activations',
  'no-activations',
  // Map element keywords (the `region-metric`/`no-*` directives come from the
  // registry; `poi`/`route` are element leaders, not in DIRECTIVE_SET)
  'poi',
  'route',
  // Data charts
  'stacked',
  'no-name',
  'no-value',
  'no-percent',
  // Slope
  'period',
  // Quadrant
  'x-axis',
  'y-axis',
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  // Layout
  'direction-tb',
  'direction-lr',
  // Pyramid
  'inverted',
  // Data chart metadata (registry covers `title`)
  'series',
  'orientation',
  'x-label',
  'y-label',
  'size-label',
  'columns',
  'rows',
  'labels',
  'rotate',
  'scale',
  'values',
  // Color (cross-chart-type)
  'color',
  // Note suppression (cross-chart-type — graph notes)
  'no-notes',
  // Flowchart layout
  'orientation-vertical',
  // RACI
  'variant-raci',
  'variant-rasci',
  'variant-daci',
  'roles',
  // Cycle
  'direction-counterclockwise',
  'circle-nodes',
  // Journey-map
  'persona',
  // Tech-radar
  'show-blip-legend',
  'trend',
  // Bar-stacked / data-chart layout
  'orientation-horizontal',
  // Function
  'x',
  'shade',
  // Wordcloud
  'max',
  'size',
  // Arc
  'order',
  // C4
  'technology',
  // PERT
  'time-unit',
  'default-confidence',
  'node-detail',
  'trials',
  'seed',
  'scrubber-trials',
  'start-date',
  'end-date',
]);

/** Control flow keywords — structural blocks. */
export const CONTROL_KEYWORDS = new Set([
  'if',
  'else',
  'loop',
  'parallel',
  'note',
  // Wireframe elements (`chart` is also a gantt option — registry-sourced)
  ...REGISTRY_CONTROL_TOKENS,
  'nav',
  'tabs',
  'table',
  'image',
  'modal',
  'skeleton',
  'alert',
  'progress',
  'mobile',
]);

/** Status keywords — kanban. */
export const STATUS_KEYWORDS = new Set([
  'na',
  'todo',
  'wip',
  'done',
  'blocked',
  'in-progress',
  'backlog',
  'ready',
  // Tech-radar trend values (`new`, `up`, `down`, `stable`) are
  // intentionally NOT in this set — they collide with common English
  // prose ("Bring up coffee", "new requirement"). The tech-radar
  // parser still validates them explicitly, and the completion
  // provider still suggests them in trend-value position.
]);

/** Modifier keywords — adjust declarations. */
export const MODIFIER_KEYWORDS = new Set([
  'as',
  'alias',
  'aka',
  'position',
  'default',
  // ER column modifiers
  'pk',
  'fk',
  'nullable',
  'unique',
  // ER data types
  'int',
  'varchar',
  'text',
  'boolean',
  'date',
  'timestamp',
  'float',
  'decimal',
]);
