// ============================================================
// Chart-type REGISTRY — single source of truth for dispatch.
// ============================================================
//
// Story 109.1 (arch-review). Before this file, "what a chart type is" was
// re-stated across four sites: the parser map + render-category sets in
// `dgmo-router.ts`, and the content-count switch in `dimensions.ts`. Adding a
// type meant editing each, and a missed site failed silently.
//
// This registry is the one place that binds, per chart type:
//   - `category`  → drives `getRenderCategory` (data-chart | visualization | diagram)
//   - `parse`     → drives `chartTypeParsers` / `PARSER_BY_ID`
//   - `measure`   → drives `dimensions.extractContentCounts`
//
// `dgmo-router.ts` and `dimensions.ts` DERIVE their tables from here; they no
// longer maintain parallel lists. `chart-type-registry.test.ts` asserts the
// derived tables stay complete, extending the existing parser cross-check to
// the render-category and measure sites.
//
// NOTE: the EXPORT-RENDER dispatch (renderForExport) is coverage-checked
// against this registry in d3.ts rather than referenced from here — pulling
// every renderer into this module would defeat the lazy per-type imports that
// keep consumer bundles small. See DIAGRAM_EXPORT_HANDLERS in d3.ts.
//
// Description + fallback metadata stays in `chart-types.ts` (the data model the
// AI-authoring selection engine reads); this file owns dispatch behavior.

import type { ContentCounts } from './utils/scaling';

// Parsers — the same leaf modules dgmo-router consumed before. Importing them
// here (not the router) keeps the dependency direction router → registry → leaf.
import { parseSequenceDgmo } from './sequence/parser';
import { parseFlowchart } from './graph/flowchart-parser';
import { parseState } from './graph/state-parser';
import { parseClassDiagram } from './class/parser';
import { parseERDiagram } from './er/parser';
import { parseChart } from './chart';
import { parseExtendedChart } from './echarts';
import { parseVisualization } from './d3';
import { parseOrg } from './org/parser';
import { parseKanban } from './kanban/parser';
import { parseC4 } from './c4/parser';
import { parseSitemap } from './sitemap/parser';
import { parseInfra } from './infra/parser';
import { parseGantt } from './gantt/parser';
import { parsePert } from './pert/parser';
import { parseMap } from './map/parser';
import { parseBoxesAndLines } from './boxes-and-lines/parser';
import { parseMindmap } from './mindmap/parser';
import { parseWireframe } from './wireframe/parser';
import { parseTechRadar } from './tech-radar/parser';
import { parseCycle } from './cycle/parser';
import { parseJourneyMap } from './journey-map/parser';
import { parsePyramid } from './pyramid/parser';
import { parseRing } from './ring/parser';
import { parseRaci, allTasks } from './raci/parser';
import type { DgmoError } from './diagnostics';

/** User-visible rendering category for dispatch and routing. */
export type RenderCategory = 'data-chart' | 'visualization' | 'diagram';

type ParseResult = { diagnostics: readonly DgmoError[] };
type ParseFn = (content: string) => ParseResult;

/**
 * Everything dispatch needs to know about one chart type.
 *
 * `measure` is optional: types without a meaningful content-count (most data
 * charts and several visualizations) simply omit it and fall back to `{}` — the
 * absence is explicit per descriptor, not a silent switch default.
 */
export interface ChartTypeDescriptor {
  readonly id: string;
  readonly category: RenderCategory;
  readonly parse: ParseFn;
  readonly measure?: (content: string) => ContentCounts;
}

// ============================================================
// measure() implementations — relocated verbatim from dimensions.ts so the
// registry owns content-count extraction. Each returns ContentCounts.
// ============================================================

function measureSequence(content: string): ContentCounts {
  const parsed = parseSequenceDgmo(content);
  return {
    participants: parsed.participants.length,
    messages: parsed.messages.length,
  };
}

function measureRaci(content: string): ContentCounts {
  const parsed = parseRaci(content);
  let taskCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _task of allTasks(parsed)) taskCount++;
  return {
    roles: parsed.roles.length,
    tasks: taskCount,
  };
}

function walkTree(
  nodes: readonly { children: readonly unknown[] }[],
  depth: number,
  acc: { nodes: number; depth: number }
): void {
  for (const node of nodes) {
    acc.nodes++;
    if (depth > acc.depth) acc.depth = depth;
    walkTree(
      node.children as readonly { children: readonly unknown[] }[],
      depth + 1,
      acc
    );
  }
}

function measureMindmap(content: string): ContentCounts {
  const parsed = parseMindmap(content);
  const acc = { nodes: 0, depth: 0 };
  walkTree(parsed.roots, 1, acc);
  return { nodes: acc.nodes, depth: acc.depth };
}

function measureTechRadar(content: string): ContentCounts {
  const parsed = parseTechRadar(content);
  let blipCount = 0;
  for (const q of parsed.quadrants) blipCount += q.blips.length;
  return { blips: blipCount };
}

function measureHeatmap(content: string): ContentCounts {
  const parsed = parseExtendedChart(content);
  return {
    columns: parsed.columns?.length ?? 0,
    rows: parsed.heatmapRows?.length ?? parsed.rows?.length ?? 0,
  };
}

function measureArc(content: string): ContentCounts {
  const parsed = parseVisualization(content);
  const allNodes = new Set<string>();
  for (const g of parsed.arcNodeGroups) {
    for (const n of g.nodes) allNodes.add(n);
  }
  return { nodes: allNodes.size };
}

function measureOrg(content: string): ContentCounts {
  const parsed = parseOrg(content);
  const acc = { nodes: 0, depth: 0 };
  walkTree(parsed.roots, 1, acc);
  return { nodes: acc.nodes, depth: acc.depth };
}

function measureGantt(content: string): ContentCounts {
  const parsed = parseGantt(content);
  const taskCount = parsed.nodes.filter(
    (n: { kind: string }) => n.kind === 'task'
  ).length;
  return { tasks: taskCount };
}

function measureKanban(content: string): ContentCounts {
  const parsed = parseKanban(content);
  return { columns: parsed.columns.length };
}

function measureER(content: string): ContentCounts {
  const parsed = parseERDiagram(content);
  return { nodes: parsed.tables.length };
}

function measureClass(content: string): ContentCounts {
  const parsed = parseClassDiagram(content);
  return { nodes: parsed.classes.length };
}

function measureFlowchart(content: string): ContentCounts {
  const parsed = parseFlowchart(content);
  return { nodes: parsed.nodes.length };
}

function measureStateGraph(content: string): ContentCounts {
  const parsed = parseState(content);
  return { nodes: parsed.nodes.length };
}

function measurePert(content: string): ContentCounts {
  const parsed = parsePert(content);
  return { tasks: parsed.activities.length };
}

function measureInfra(content: string): ContentCounts {
  const parsed = parseInfra(content);
  return { nodes: parsed.nodes.length };
}

// ============================================================
// THE REGISTRY — ordered to match the previous chartTypeParsers grouping
// (structured diagrams, standard ECharts, extended ECharts, D3 visualizations,
// map). Order only affects knownChartTypeIds; tier order for descriptions lives
// in chart-types.ts.
// ============================================================

export const CHART_TYPE_REGISTRY: readonly ChartTypeDescriptor[] = [
  // ── Structured diagrams ───────────────────────────────────
  {
    id: 'sequence',
    category: 'diagram',
    parse: parseSequenceDgmo,
    measure: measureSequence,
  },
  {
    id: 'flowchart',
    category: 'diagram',
    parse: parseFlowchart,
    measure: measureFlowchart,
  },
  {
    id: 'class',
    category: 'diagram',
    parse: parseClassDiagram,
    measure: measureClass,
  },
  { id: 'er', category: 'diagram', parse: parseERDiagram, measure: measureER },
  {
    id: 'state',
    category: 'diagram',
    parse: parseState,
    measure: measureStateGraph,
  },
  { id: 'org', category: 'diagram', parse: parseOrg, measure: measureOrg },
  {
    id: 'kanban',
    category: 'diagram',
    parse: parseKanban,
    measure: measureKanban,
  },
  { id: 'c4', category: 'diagram', parse: parseC4 },
  { id: 'sitemap', category: 'diagram', parse: parseSitemap },
  {
    id: 'infra',
    category: 'diagram',
    parse: parseInfra,
    measure: measureInfra,
  },
  {
    id: 'gantt',
    category: 'diagram',
    parse: parseGantt,
    measure: measureGantt,
  },
  { id: 'pert', category: 'diagram', parse: parsePert, measure: measurePert },
  { id: 'boxes-and-lines', category: 'diagram', parse: parseBoxesAndLines },
  {
    id: 'mindmap',
    category: 'diagram',
    parse: parseMindmap,
    measure: measureMindmap,
  },
  { id: 'wireframe', category: 'diagram', parse: parseWireframe },
  { id: 'journey-map', category: 'diagram', parse: parseJourneyMap },
  { id: 'raci', category: 'diagram', parse: parseRaci, measure: measureRaci },
  { id: 'rasci', category: 'diagram', parse: parseRaci, measure: measureRaci },
  { id: 'daci', category: 'diagram', parse: parseRaci, measure: measureRaci },

  // ── Standard ECharts charts (parseChart) ──────────────────
  { id: 'bar', category: 'data-chart', parse: parseChart },
  { id: 'line', category: 'data-chart', parse: parseChart },
  { id: 'multi-line', category: 'data-chart', parse: parseChart },
  { id: 'area', category: 'data-chart', parse: parseChart },
  { id: 'pie', category: 'data-chart', parse: parseChart },
  { id: 'doughnut', category: 'data-chart', parse: parseChart },
  { id: 'radar', category: 'data-chart', parse: parseChart },
  { id: 'polar-area', category: 'data-chart', parse: parseChart },
  { id: 'bar-stacked', category: 'data-chart', parse: parseChart },

  // ── Extended ECharts charts (parseExtendedChart) ──────────
  { id: 'scatter', category: 'data-chart', parse: parseExtendedChart },
  { id: 'sankey', category: 'data-chart', parse: parseExtendedChart },
  { id: 'chord', category: 'data-chart', parse: parseExtendedChart },
  { id: 'function', category: 'data-chart', parse: parseExtendedChart },
  {
    id: 'heatmap',
    category: 'data-chart',
    parse: parseExtendedChart,
    measure: measureHeatmap,
  },
  { id: 'funnel', category: 'data-chart', parse: parseExtendedChart },

  // ── D3 visualizations (parseVisualization) ────────────────
  { id: 'slope', category: 'visualization', parse: parseVisualization },
  { id: 'wordcloud', category: 'visualization', parse: parseVisualization },
  {
    id: 'arc',
    category: 'visualization',
    parse: parseVisualization,
    measure: measureArc,
  },
  { id: 'timeline', category: 'visualization', parse: parseVisualization },
  { id: 'venn', category: 'visualization', parse: parseVisualization },
  { id: 'quadrant', category: 'visualization', parse: parseVisualization },

  // ── Visualizations with their own parsers ─────────────────
  {
    id: 'tech-radar',
    category: 'visualization',
    parse: parseTechRadar,
    measure: measureTechRadar,
  },
  { id: 'cycle', category: 'visualization', parse: parseCycle },
  { id: 'pyramid', category: 'visualization', parse: parsePyramid },
  { id: 'ring', category: 'visualization', parse: parseRing },

  // ── Geographic map (own parser → resolver → layout → renderer) ──
  { id: 'map', category: 'visualization', parse: parseMap },
];

/** id → descriptor, for O(1) dispatch lookups. */
export const REGISTRY_BY_ID: ReadonlyMap<string, ChartTypeDescriptor> = new Map(
  CHART_TYPE_REGISTRY.map((d) => [d.id, d])
);

/** True when a type is rendered by the extended-ECharts parser. */
export function isExtendedChartParser(parse: ParseFn): boolean {
  return parse === parseExtendedChart;
}
