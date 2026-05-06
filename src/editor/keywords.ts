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
  'boxes-and-lines',
  'wireframe',
  'tech-radar',
  'mindmap',
  'journey-map',
  'pyramid',
  'ring',
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
  'no-auto-color',
  // Infra node properties
  'description',
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
  'split',
  'slo-p90-latency-ms',
  'slo-availability',
  'cache-hit',
  'concurrency',
  'duration-ms',
  'cold-start-ms',
  'rps',
  // Sequence
  'activations',
  'no-activations',
  // Data charts
  'stacked',
  'no-name',
  'no-value',
  'no-percent',
  'no-descriptions',
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
  // Tech-radar trend values
  'new',
  'up',
  'down',
  'stable',
]);

/** Modifier keywords — adjust declarations. */
export const MODIFIER_KEYWORDS = new Set([
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
