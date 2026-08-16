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
  /**
   * Routable but never OFFERED. The type parses, routes and renders like any
   * other, but no surface that enumerates types for a human or a model may list
   * it — nobody hand-authors one, so a picker entry would produce a file the
   * user cannot complete.
   *
   * Honoured at five edges, and deliberately NOT inside `getAllChartTypes()`,
   * which keeps meaning "everything routable":
   *   1. `cli.ts` — `dgmo types` (plain and `--json`)
   *   2. `completion-registry.ts` — the chart-type completion popup
   *   3. `dgmo-mcp/src/index.ts` — the `list_chart_types` tool
   *   4. `dgmo-mcp/src/suggest/scoring.ts` — the suggester's candidate pool
   *   5. `scripts/gen-ai-core.mjs` — the generated AI core every model reads
   * `tests/internal-chart-types.test.ts` is this flag's specification; without
   * it the flag is a convention and the next refactor drops an edge silently.
   */
  readonly internal?: true;
  /**
   * Offered, but not finished — expect rough edges and syntax changes.
   *
   * Unlike `internal`, a beta type IS listed everywhere; the flag only adds a
   * mark beside it, so somebody choosing one knows what they are choosing.
   *
   * 🔴 It lives HERE rather than in the app because the app and the marketing
   * site each held their own hand-written id set, kept in step by a comment,
   * and neither reached the CLI, the MCP server or anything else that names a
   * chart type. `sketch` shipped unmarked on every one of those surfaces while
   * being marked in two (issue #221). The original reasoning — "which charts
   * are beta is a product decision, not a parser concern" — was sound about
   * ownership and wrong about location: a fact every surface needs belongs
   * where every surface can read it. It costs a dgmo release to change, which
   * is the right price for something that moves once or twice in a type's life.
   *
   * Honoured at the same kind of edge `internal` is, and for the same reason
   * — an unlisted edge is a surface that silently stops telling the truth:
   *   1. `cli.ts` — `dgmo types` (plain and `--json`)
   *   2. `dgmo-mcp` — `list_chart_types`, so a model says so before choosing
   *   3. `diagrammo-app` — the New File dialog and the docs
   *   4. `diagrammo_app_site` — the docs nav and page headers
   * `tests/beta-chart-types.test.ts` is this flag's specification.
   */
  readonly beta?: true;
}

// Declared without a type annotation so the literal ids survive: an explicit
// `readonly ChartTypeMeta[]` here widens every id back to `string`, which is
// what let four separate hand-written copies of this list exist. `satisfies`
// keeps the shape checked while `as const` keeps the ids.
const chartTypesData = [
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
    beta: true,
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
  {
    id: 'swimlane',
    description:
      'Cross-functional process flow with lanes, phases and gateways (BPMN-style)',
  },
  {
    id: 'version-control',
    description:
      'Git / version-control branch-and-merge graph: commits, branches, merges, rebase, HEAD and remote-tracking (gitGraph-style)',
  },

  // ── Tier 2 — Specialized structural diagrams ──────────────
  {
    id: 'timeline',
    description: 'Events, eras, and date ranges',
  },
  {
    id: 'event-line',
    description:
      'Annotated narrative timeline — events on a horizontal line with descriptions (not the date-scaled timeline)',
  },
  {
    id: 'body',
    description:
      'Human anatomy figure annotated by muscle/bone/joint name — for medical, exercise, and educational diagrams',
  },
  {
    id: 'org',
    description: 'Reporting hierarchy',
  },
  {
    id: 'family',
    description:
      'Family tree / genealogy: unions (couples), children, remarriage, adoption, and GEDCOM-style metadata',
  },
  {
    id: 'sitemap',
    description: 'Site / app navigation structure',
  },
  {
    id: 'bracket',
    description:
      'Single-elimination tournament bracket: winners auto-advance up a tree; seed the field for a day-0 skeleton or list results for a casual bracket, with two sides mirroring inward to a championship',
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
    id: 'treemap',
    description:
      'Nested rectangles sized by value — show a hierarchy’s proportions (budgets, disk usage, portfolios) with color by category, value heatmap, or branch',
  },
  {
    id: 'block',
    description:
      'Block diagram: an author-controlled grid of rectangular blocks with nested, collapsible containers — system/hardware/architecture layouts where the 2-D arrangement is the meaning',
  },
  {
    id: 'sketch',
    description:
      'GUI-first constrained canvas: uniformly-sized shapes placed freely on a snap grid, arrows between them, meaning through tags — the markup is generated by the canvas editor',
    beta: true,
  },
  {
    id: 'goal',
    description:
      'Single progress-toward-a-target value (now vs target) as a progress bar, thermometer, or gauge — KPIs, fundraising, quotas, completion',
  },
  {
    id: 'countdown',
    description:
      'Live "N days until X" that ticks every second and is accurate on every load — trip dates, launches, deadlines; the only dynamic chart type',
  },
  {
    id: 'clock',
    description:
      'Live world-clock board: current time for people/places across time zones, ticking every second, with optional working-hours status and sundown line',
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
    beta: true,
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
    id: 'arc',
    description: 'Network relationships (linear or circular via `layout`)',
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
    id: 'pie',
    description: 'Part-to-whole proportions',
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

  // ── Not a tier — a pointer, not a drawing ─────────────────
  // `live-link` holds no diagram of its own; it names one published to
  // Diagrammo Cloud. Internal (see `internal` above): it arrives by being saved
  // from a shared link, never by being picked from a list. Kept LAST because
  // `chartTypes.slice(0, 8)` is a live window feeding language-reference checks
  // and the generated AI core — any insertion above position 8 shifts it.
  {
    id: 'live-link',
    description: 'A pointer to a diagram published at Diagrammo Cloud',
    internal: true,
  },
] as const satisfies readonly ChartTypeMeta[];

/**
 * Every chart type the router can dispatch — the "routable" set.
 *
 * Distinct from the "offered" set (`utils/offered-types.ts`), which drops the
 * `internal` types nobody hand-authors. A live link is routable but never
 * offered.
 *
 * This union is the reason the id list lives here: `chart-type-registry.ts`
 * keys its `Record` by it, so a chart type missing from the registry is a
 * compile error, and `ALL_CHART_TYPES` / the editor's `CHART_TYPES` derive from
 * the same array rather than restating it.
 */
export type ChartTypeId = (typeof chartTypesData)[number]['id'];

export const chartTypes: readonly ChartTypeMeta[] = chartTypesData;

/** Every routable chart-type id. The one list the others derive from. */
export const CHART_TYPE_IDS: readonly ChartTypeId[] = chartTypesData.map(
  (c) => c.id
);
