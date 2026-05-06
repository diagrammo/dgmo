// ============================================================
// Chart-type single source of truth
// ============================================================
//
// Ordering rule (specificity-based):
//   chartTypes is iterated in source order, and scoring ties resolve to the
//   earlier entry. List specialized types FIRST (journey-map, c4, er, …) so
//   they win over generic catch-alls (flowchart, boxes-and-lines) whenever
//   the prompt is ambiguous.
//
// Trigger rule (compound phrases):
//   Triggers are lowercase, multi-word phrases. Bare common words are
//   intentionally avoided — "flow", "chart", "diagram" alone cause too many
//   false positives. Prefer "customer journey" over "journey", "bar chart"
//   over "bar", etc. Scoring uses contiguous token matching, not substring.
//
// fallback?: true
//   Flags general-purpose types returned when the prompt matches no strong
//   trigger. The `suggest_chart_type` MCP tool reads this flag at runtime,
//   so renaming a type does not silently break the fallback list.

export interface ChartTypeMeta {
  readonly id: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly fallback?: true;
}

export const chartTypes: readonly ChartTypeMeta[] = [
  // ── Tier 1 — Narrative / architecture diagrams ────────────
  {
    id: 'journey-map',
    description:
      'User experience flow with emotion scores, phases, and annotations',
    triggers: [
      'user journey',
      'customer journey',
      'customer experience',
      'customer goes through',
      'user goes through',
      'customer path',
      'customer touchpoints',
      'cx flow',
      'ux journey',
      'onboarding flow',
      'persona journey',
      'empathy map',
      'service blueprint',
    ],
  },
  {
    id: 'c4',
    description:
      'System architecture (context, container, component, deployment)',
    triggers: [
      'c4 diagram',
      'system context',
      'container diagram',
      'component diagram',
      'architecture overview',
      'software architecture',
    ],
  },
  {
    id: 'er',
    description: 'Database schemas and relationships',
    triggers: [
      'database schema',
      'er diagram',
      'entity relationship',
      'data model',
      'tables and relationships',
      'foreign keys',
    ],
  },
  {
    id: 'class',
    description: 'UML class hierarchies',
    triggers: [
      'uml class',
      'class hierarchy',
      'class diagram',
      'inheritance tree',
      'oop structure',
    ],
  },
  {
    id: 'sequence',
    description: 'Message / interaction flows',
    triggers: [
      'sequence diagram',
      'message flow',
      'api call flow',
      'request lifecycle',
      'interaction diagram',
      'call sequence',
    ],
    fallback: true,
  },
  {
    id: 'state',
    description: 'State machine / lifecycle transitions',
    triggers: [
      'state diagram',
      'state machine',
      'state transitions',
      'lifecycle diagram',
      'status transitions',
    ],
  },
  {
    id: 'infra',
    description: 'Infrastructure traffic flow with RPS computation',
    triggers: [
      'infrastructure diagram',
      'traffic flow',
      'request path',
      'rps',
      'capacity planning',
      'network topology',
    ],
  },
  {
    id: 'gantt',
    description: 'Project scheduling with task dependencies and milestones',
    triggers: [
      'gantt chart',
      'project schedule',
      'sprint plan',
      'project timeline',
      'task dependencies',
      'project milestones',
    ],
  },

  // ── Tier 2 — Specialized structural diagrams ──────────────
  {
    id: 'timeline',
    description: 'Events, eras, and date ranges',
    triggers: [
      'event timeline',
      'historical timeline',
      'era chart',
      'period chart',
      'project history',
    ],
  },
  {
    id: 'org',
    description: 'Reporting hierarchy',
    triggers: [
      'org chart',
      'organization chart',
      'reporting structure',
      'hierarchy chart',
      'team structure',
    ],
  },
  {
    id: 'sitemap',
    description: 'Site / app navigation structure',
    triggers: [
      'sitemap',
      'site structure',
      'page hierarchy',
      'navigation structure',
      'app navigation',
    ],
  },
  {
    id: 'kanban',
    description: 'Task board columns',
    triggers: [
      'kanban board',
      'task board',
      'workflow columns',
      'todo doing done',
      'agile board',
    ],
  },
  {
    id: 'tech-radar',
    description: 'Technology adoption quadrants (adopt/trial/assess/hold)',
    triggers: [
      'tech radar',
      'technology radar',
      'tech adoption',
      'adopt trial assess hold',
      'tech choices',
    ],
  },
  {
    id: 'mindmap',
    description: 'Radial hierarchy of ideas branching from a central topic',
    triggers: [
      'mind map',
      'brainstorm diagram',
      'concept map',
      'idea tree',
      'radial ideas',
    ],
  },
  {
    id: 'wireframe',
    description:
      'Low-fidelity UI layout with panels, controls, and annotations',
    triggers: [
      'wireframe',
      'ui mockup',
      'screen layout',
      'page layout',
      'low-fidelity mockup',
    ],
  },
  {
    id: 'cycle',
    description: 'Cyclical process visualization (PDCA, OODA, DevOps loops)',
    triggers: [
      'pdca cycle',
      'ooda loop',
      'feedback loop',
      'cyclical process',
      'devops loop',
      'continuous loop',
    ],
  },
  {
    id: 'pyramid',
    description: 'Stacked hierarchy of layers with descriptions (Maslow, DIKW)',
    triggers: [
      'pyramid diagram',
      'layered hierarchy',
      'maslow hierarchy',
      'dikw pyramid',
      'layered model',
    ],
  },
  {
    id: 'ring',
    description:
      'Concentric rings showing nested or hierarchical categories (read core-out)',
    triggers: [
      'ring diagram',
      'concentric rings',
      'circle hierarchy',
      'circles of influence',
      'nested circles',
    ],
  },

  // ── Tier 3 — Specialized analytical charts ────────────────
  {
    id: 'quadrant',
    description: '2x2 positioning matrix',
    triggers: [
      '2x2 matrix',
      'priority matrix',
      'quadrant chart',
      'impact effort matrix',
      'positioning matrix',
    ],
  },
  {
    id: 'venn',
    description: 'Set overlaps',
    triggers: [
      'venn diagram',
      'set overlap',
      'intersection of',
      'shared traits',
      'overlapping circles',
    ],
  },
  {
    id: 'funnel',
    description: 'Conversion pipeline',
    triggers: [
      'conversion funnel',
      'sales funnel',
      'user funnel',
      'pipeline stages',
      'drop-off funnel',
    ],
  },
  {
    id: 'slope',
    description: 'Change between two periods',
    triggers: [
      'slope chart',
      'before and after',
      'two-period change',
      'delta chart',
      'shift comparison',
    ],
  },
  {
    id: 'sankey',
    description: 'Flow / allocation visualization',
    triggers: [
      'sankey diagram',
      'flow allocation',
      'budget flow',
      'energy flow',
      'traffic allocation',
    ],
  },
  {
    id: 'chord',
    description: 'Circular flow relationships',
    triggers: [
      'chord diagram',
      'circular flow',
      'relationship wheel',
      'team connections',
    ],
  },
  {
    id: 'arc',
    description: 'Network relationships',
    triggers: [
      'arc diagram',
      'relationship chart',
      'connection arcs',
      'network arcs',
    ],
  },
  {
    id: 'wordcloud',
    description: 'Term frequency visualization',
    triggers: [
      'word cloud',
      'tag cloud',
      'term frequency',
      'keyword frequency',
    ],
  },
  {
    id: 'heatmap',
    description: 'Matrix intensity visualization',
    triggers: [
      'heatmap',
      'intensity matrix',
      'activity heatmap',
      'correlation matrix',
    ],
  },
  {
    id: 'function',
    description: 'Mathematical expressions',
    triggers: [
      'function plot',
      'mathematical plot',
      'equation chart',
      'graph y=f(x)',
    ],
  },

  // ── Tier 4 — General-purpose data charts ──────────────────
  {
    id: 'bar',
    description: 'Categorical comparisons',
    triggers: ['bar chart', 'categorical comparison', 'bar graph'],
    fallback: true,
  },
  {
    id: 'line',
    description: 'Trends over time',
    triggers: ['line chart', 'trend over time', 'time series'],
    fallback: true,
  },
  {
    id: 'multi-line',
    description: 'Multiple series trends over time',
    triggers: [
      'multi-line chart',
      'multiple trends',
      'multiple series over time',
    ],
  },
  {
    id: 'area',
    description: 'Filled line chart',
    triggers: ['area chart', 'filled line', 'cumulative trend'],
  },
  {
    id: 'pie',
    description: 'Part-to-whole proportions',
    triggers: ['pie chart', 'part to whole', 'percentage breakdown'],
  },
  {
    id: 'doughnut',
    description: 'Ring-style pie chart',
    triggers: ['doughnut chart', 'donut chart', 'ring chart'],
  },
  {
    id: 'radar',
    description: 'Multi-dimensional metrics',
    triggers: ['radar chart', 'spider chart', 'multi-dimensional metrics'],
  },
  {
    id: 'polar-area',
    description: 'Radial bar chart',
    triggers: ['polar area', 'radial bar chart'],
  },
  {
    id: 'bar-stacked',
    description: 'Multi-series categorical',
    triggers: [
      'stacked bar',
      'stacked bar chart',
      'multi-series bar',
      'composite bar',
    ],
  },
  {
    id: 'scatter',
    description: '2D data points or bubble chart',
    triggers: [
      'scatter plot',
      'correlation plot',
      'bubble chart',
      '2d data points',
    ],
  },

  // ── Tier 5 — Generic catch-alls (listed last on purpose) ──
  {
    id: 'flowchart',
    description: 'Decision trees and process flows',
    triggers: [
      'flowchart',
      'decision tree',
      'if-then diagram',
      'process flow with decisions',
    ],
    fallback: true,
  },
  {
    id: 'boxes-and-lines',
    description: 'General-purpose node-edge diagrams with groups and tags',
    triggers: [
      'boxes and lines',
      'nodes and edges',
      'generic diagram',
      'general-purpose network',
    ],
    fallback: true,
  },
] as const;

// Chart-type ids currently flagged as beta. Renderers/UIs use this set to
// surface a "β BETA" badge next to titles, nav entries, and template tiles.
// Promote/demote by editing this set + the corresponding registry titles.
export const BETA_CHART_IDS: ReadonlySet<string> = new Set(['c4', 'venn']);
