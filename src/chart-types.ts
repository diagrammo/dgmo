// ============================================================
// Chart-type REGISTRY — single source of truth for the chart-type set.
// ============================================================
//
// Data model only: each type's id, human description, and the `fallback` flag.
// The parser, router, CLI, and editor completion consume it.
//
// NOTE: chart-type SELECTION (turning a plain-English prompt into a type) is
// AI-authoring functionality and does NOT live here — it moved to the dgmo-mcp
// server (src/suggest/), which pairs this registry with its own trigger
// vocabulary. The render library ships no NLP trigger data.
//
// Ordering rule (specificity-based):
//   List specialized types FIRST (journey-map, c4, er, …) so a consumer that
//   resolves ties by source order prefers them over generic catch-alls.
//
// fallback?: true
//   Flags general-purpose types. The selection engine (dgmo-mcp) reads this
//   flag, so renaming a type does not silently break the fallback list.

export interface ChartTypeMeta {
  readonly id: string;
  readonly description: string;
  readonly fallback?: true;
}

export const chartTypes: readonly ChartTypeMeta[] = [
  // ── Tier 1 — Narrative / architecture diagrams ────────────
  {
    id: 'journey-map',
    description:
      'User experience flow with emotion scores, phases, and annotations',
  },
  {
    id: 'c4',
    description:
      'System architecture (context, container, component, deployment)',
  },
  {
    id: 'er',
    description: 'Database schemas and relationships',
  },
  {
    id: 'class',
    description: 'UML class hierarchies',
  },
  {
    id: 'sequence',
    description: 'Message request and response interaction flows',
    fallback: true,
  },
  {
    id: 'state',
    description: 'State machine / lifecycle transitions',
  },
  {
    id: 'infra',
    description: 'Infrastructure traffic flow with RPS computation',
  },
  {
    id: 'gantt',
    description: 'Project scheduling with task dependencies and milestones',
  },
  {
    id: 'pert',
    description:
      'Project network with three-point estimates, critical path, and uncertainty (Beta-PERT, Monte Carlo)',
  },

  // ── Tier 2 — Specialized structural diagrams ──────────────
  {
    id: 'timeline',
    description: 'Events, eras, and date ranges',
  },
  {
    id: 'org',
    description: 'Reporting hierarchy',
  },
  {
    id: 'sitemap',
    description: 'Site / app navigation structure',
  },
  {
    id: 'kanban',
    description: 'Task board columns',
  },
  {
    id: 'raci',
    description: 'Tasks × roles responsibility matrix with constraint linting',
  },
  {
    id: 'rasci',
    description: 'RACI variant adding Support (R A S C I)',
  },
  {
    id: 'daci',
    description: 'Decision matrix with Driver, Approver, Contributor, Informed',
  },
  {
    id: 'tech-radar',
    description: 'Technology adoption quadrants (adopt/trial/assess/hold)',
  },
  {
    id: 'mindmap',
    description: 'Radial hierarchy of ideas branching from a central topic',
  },
  {
    id: 'wireframe',
    description:
      'Low-fidelity UI layout with panels, controls, and annotations',
  },
  {
    id: 'cycle',
    description: 'Cyclical process visualization (PDCA, OODA, DevOps loops)',
  },
  {
    id: 'pyramid',
    description: 'Stacked hierarchy of layers with descriptions (Maslow, DIKW)',
  },
  {
    id: 'ring',
    description:
      'Concentric rings showing nested or hierarchical categories (read core-out)',
  },
  {
    id: 'map',
    description:
      'Geographic concept map: highlight/score regions, drop points of interest, connect with routes or edges',
  },

  // ── Tier 3 — Specialized analytical charts ────────────────
  {
    id: 'quadrant',
    description: '2x2 positioning matrix',
  },
  {
    id: 'venn',
    description: 'Set overlaps',
  },
  {
    id: 'funnel',
    description: 'Conversion pipeline',
  },
  {
    id: 'slope',
    description: 'Change between 2 time periods',
  },
  {
    id: 'sankey',
    description: 'Flow / allocation visualization',
  },
  {
    id: 'chord',
    description: 'Circular flow relationships',
  },
  {
    id: 'arc',
    description: 'Network relationships',
  },
  {
    id: 'wordcloud',
    description: 'Term frequency visualization',
  },
  {
    id: 'heatmap',
    description: 'Matrix intensity visualization',
  },
  {
    id: 'function',
    description: 'Mathematical expressions',
  },

  // ── Tier 4 — General-purpose data charts ──────────────────
  {
    id: 'bar',
    description: 'Categorical comparisons for 3 - 5 figures',
    fallback: true,
  },
  {
    id: 'line',
    description: 'Trends over time',
    fallback: true,
  },
  {
    id: 'multi-line',
    description: 'Multiple series trends over time',
  },
  {
    id: 'area',
    description: 'Filled line chart',
  },
  {
    id: 'pie',
    description: 'Part-to-whole proportions',
  },
  {
    id: 'doughnut',
    description: 'Ring-style pie chart',
  },
  {
    id: 'radar',
    description: 'Multi-dimensional metrics',
  },
  {
    id: 'polar-area',
    description: 'Radial bar chart',
  },
  {
    id: 'bar-stacked',
    description: 'Multi-series categorical',
  },
  {
    id: 'scatter',
    description: '2D data points or bubble chart',
  },

  // ── Tier 5 — Generic catch-alls (listed last on purpose) ──
  {
    id: 'flowchart',
    description: 'Decision trees and process flows',
    fallback: true,
  },
  {
    id: 'boxes-and-lines',
    description: 'General-purpose node-edge diagrams with groups and tags',
    fallback: true,
  },
] as const;
