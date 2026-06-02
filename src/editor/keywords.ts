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
  // Gantt
  'start',
  'era',
  'marker',
  'holiday',
  'workweek',
  'today-marker',
  'critical-path',
  'no-dependencies',
  'sort',
  // Tech-radar
  'rings',
  // Tags
  'tags',
  'import',
  'active-tag',
  'hide',
  'mode',
  'direction',
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
  // Infra directives
  'sub-node-label',
  'show-sub-node-count',
  // Infra node properties
  'instances',
  'max-rps',
  'latency-ms',
  'uptime',
  'firewall-block',
  'ratelimit-rps',
  'cb-error-threshold',
  'cb-latency-threshold-ms',
  'buffer',
  'drain-rate',
  'retention-hours',
  'partitions',
  'slo-p90-latency-ms',
  'slo-availability',
  'slo-warning-margin',
  'cache-hit',
  'concurrency',
  'duration-ms',
  'cold-start-ms',
  'rps',
  // Sequence
  'activations',
  'no-activations',
  // Map (§24B) directives — cosmetics on by default, bare `no-*` opt-outs
  'region-metric',
  'poi-metric',
  'flow-metric',
  'locale',
  'active-tag',
  'caption',
  'no-legend',
  'no-coastline',
  'no-relief',
  'no-context-labels',
  'no-region-labels',
  'no-poi-labels',
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
  // Fill mode (cross-chart-type)
  'solid-fill',
  // Pyramid
  'inverted',
  // Data chart metadata
  'title',
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
  // Title suppression (cross-chart-type)
  'no-title',
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
  // Gantt
  'no-dependencies',
  'sprint-length',
  'sprint-number',
  'sprint-start',
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
  // Infra defaults + animate flags
  'default-rps',
  'default-latency-ms',
  'default-uptime',
  'animate',
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
  // Wireframe elements
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
