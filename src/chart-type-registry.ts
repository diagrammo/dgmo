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
import {
  parseSankey,
  parseFunctionChart,
  parseScatter,
  parseHeatmap,
  parseFunnel,
  EXTENDED_CHART_DOORS,
} from './data-chart-parser';
import { parseSlope } from './slope/parser';
import { parseArc } from './arc/parser';
import { parseTimeline } from './timeline/viz-parser';
import { parseEventLine } from './event-line/parser';
import { parseVersionControl } from './version-control/parser';
import { parseWordcloud } from './wordcloud/parser';
import { parseVenn } from './venn/parser';
import { parseQuadrant } from './quadrant/parser';
import { parseOrg } from './org/parser';
import { parseKanban } from './kanban/parser';
import { parseC4 } from './c4/parser';
import { parseSitemap } from './sitemap/parser';
import { parseInfra } from './infra/parser';
import { parseGantt } from './gantt/parser';
import { parsePert } from './pert/parser';
import { parseMap } from './map/parser';
import { parseBoxesAndLines } from './boxes-and-lines/parser';
import { parseSketch } from './sketch/parser';
import { parseSwimlane } from './swimlane/parser';
import { parseMindmap } from './mindmap/parser';
import { parseWireframe } from './wireframe/parser';
import { parseTechRadar } from './tech-radar/parser';
import { parseCycle } from './cycle/parser';
import { parseJourneyMap } from './journey-map/parser';
import { parsePyramid } from './pyramid/parser';
import { parseRing } from './ring/parser';
import { parseTreemap } from './treemap/parser';
import { parseBlock } from './block/parser';
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
  readonly minDims?: (counts: ContentCounts) => {
    width: number;
    height: number;
  };
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
  const parsed = parseHeatmap(content);
  return {
    columns: parsed.columns?.length ?? 0,
    rows: parsed.heatmapRows?.length ?? parsed.rows?.length ?? 0,
  };
}

function measureArc(content: string): ContentCounts {
  const parsed = parseArc(content);
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

function measureSwimlane(content: string): ContentCounts {
  const parsed = parseSwimlane(content);
  return { lanes: parsed.lanes.length, nodes: parsed.nodes.length };
}

// ============================================================
// minDims() implementations — relocated verbatim from computeMinDimensions() in
// utils/scaling.ts so the registry owns per-type minimum-dimension formulas
// alongside measure(). Each maps ContentCounts → {width,height}. Types without a
// minDims fall back to {300,200} (the old switch `default`) via the
// REGISTRY_BY_ID lookup in dimensions.ts.
// ============================================================

function minDimsSequence(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.participants ?? 2) * 80, 320),
    height: Math.max((c.messages ?? 1) * 20 + 120, 200),
  };
}
function minDimsRaci(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.roles ?? 2) * 50 + 180, 300),
    height: Math.max((c.tasks ?? 1) * 28 + 80, 200),
  };
}
function minDimsMindmap(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.nodes ?? 3) * 30, 300),
    height: Math.max((c.depth ?? 2) * 60, 200),
  };
}
function minDimsTechRadar(): { width: number; height: number } {
  return { width: 360, height: 400 };
}
function minDimsHeatmap(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.columns ?? 3) * 40, 300),
    height: Math.max((c.rows ?? 3) * 30 + 60, 200),
  };
}
function minDimsArc(c: ContentCounts): { width: number; height: number } {
  return {
    width: 300,
    height: Math.max((c.nodes ?? 3) * 20 + 120, 200),
  };
}
function measureEventLine(content: string): ContentCounts {
  return { items: parseEventLine(content).events.length };
}
function minDimsEventLine(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max(640, 120 + (c.items ?? 3) * 100),
    height: 420,
  };
}
function measureVersionControl(content: string): ContentCounts {
  return { nodes: parseVersionControl(content).nodes.length };
}
function minDimsVersionControl(c: ContentCounts): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(480, 160 + (c.nodes ?? 3) * 86),
    height: 360,
  };
}
function minDimsOrg(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.nodes ?? 3) * 60, 300),
    height: Math.max((c.depth ?? 2) * 80, 200),
  };
}
function minDimsGantt(c: ContentCounts): { width: number; height: number } {
  return {
    width: 400,
    height: Math.max((c.tasks ?? 3) * 24 + 80, 200),
  };
}
function minDimsKanban(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.columns ?? 3) * 120, 360),
    height: 300,
  };
}
// er + class share this formula.
function minDimsEntities(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.nodes ?? 2) * 140, 300),
    height: Math.max((c.nodes ?? 2) * 80, 200),
  };
}
// flowchart + state share this formula.
function minDimsGraph(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.nodes ?? 3) * 60, 300),
    height: Math.max((c.nodes ?? 3) * 50, 200),
  };
}
function minDimsPert(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.tasks ?? 3) * 80, 340),
    height: Math.max((c.tasks ?? 3) * 40 + 80, 200),
  };
}
function minDimsInfra(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.nodes ?? 3) * 80, 300),
    height: Math.max((c.nodes ?? 3) * 60, 200),
  };
}
// Lane diagrams run wide (flow along the long axis); keep a generous width and a
// height that grows with lane count — don't fall back to the {300,200} default.
function minDimsSwimlane(c: ContentCounts): { width: number; height: number } {
  return {
    width: Math.max((c.nodes ?? 4) * 90, 480),
    height: Math.max((c.lanes ?? 3) * 100 + 60, 240),
  };
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
    minDims: minDimsSequence,
  },
  {
    id: 'flowchart',
    category: 'diagram',
    parse: parseFlowchart,
    measure: measureFlowchart,
    minDims: minDimsGraph,
  },
  {
    id: 'class',
    category: 'diagram',
    parse: parseClassDiagram,
    measure: measureClass,
    minDims: minDimsEntities,
  },
  {
    id: 'er',
    category: 'diagram',
    parse: parseERDiagram,
    measure: measureER,
    minDims: minDimsEntities,
  },
  {
    id: 'state',
    category: 'diagram',
    parse: parseState,
    measure: measureStateGraph,
    minDims: minDimsGraph,
  },
  {
    id: 'org',
    category: 'diagram',
    parse: parseOrg,
    measure: measureOrg,
    minDims: minDimsOrg,
  },
  {
    id: 'kanban',
    category: 'diagram',
    parse: parseKanban,
    measure: measureKanban,
    minDims: minDimsKanban,
  },
  { id: 'c4', category: 'diagram', parse: parseC4 },
  { id: 'sitemap', category: 'diagram', parse: parseSitemap },
  {
    id: 'infra',
    category: 'diagram',
    parse: parseInfra,
    measure: measureInfra,
    minDims: minDimsInfra,
  },
  {
    id: 'gantt',
    category: 'diagram',
    parse: parseGantt,
    measure: measureGantt,
    minDims: minDimsGantt,
  },
  {
    id: 'pert',
    category: 'diagram',
    parse: parsePert,
    measure: measurePert,
    minDims: minDimsPert,
  },
  { id: 'boxes-and-lines', category: 'diagram', parse: parseBoxesAndLines },
  { id: 'sketch', category: 'diagram', parse: parseSketch },
  {
    id: 'swimlane',
    category: 'diagram',
    parse: parseSwimlane,
    measure: measureSwimlane,
    minDims: minDimsSwimlane,
  },
  {
    id: 'version-control',
    category: 'diagram',
    parse: parseVersionControl,
    measure: measureVersionControl,
    minDims: minDimsVersionControl,
  },
  {
    id: 'mindmap',
    category: 'diagram',
    parse: parseMindmap,
    measure: measureMindmap,
    minDims: minDimsMindmap,
  },
  { id: 'wireframe', category: 'diagram', parse: parseWireframe },
  { id: 'journey-map', category: 'diagram', parse: parseJourneyMap },
  {
    id: 'raci',
    category: 'diagram',
    parse: parseRaci,
    measure: measureRaci,
    minDims: minDimsRaci,
  },

  // ── Standard ECharts charts (parseChart) ──────────────────
  { id: 'bar', category: 'data-chart', parse: parseChart },
  { id: 'line', category: 'data-chart', parse: parseChart },
  { id: 'pie', category: 'data-chart', parse: parseChart },
  { id: 'radar', category: 'data-chart', parse: parseChart },
  { id: 'polar-area', category: 'data-chart', parse: parseChart },

  // ── Extended ECharts charts — own per-type parser door (Story 109.2a) ──
  { id: 'scatter', category: 'data-chart', parse: parseScatter },
  { id: 'sankey', category: 'data-chart', parse: parseSankey },
  { id: 'function', category: 'data-chart', parse: parseFunctionChart },
  {
    id: 'heatmap',
    category: 'data-chart',
    parse: parseHeatmap,
    measure: measureHeatmap,
    minDims: minDimsHeatmap,
  },
  { id: 'funnel', category: 'data-chart', parse: parseFunnel },

  // ── D3 visualizations — own per-viz parser door (Story 109.2) ──
  { id: 'slope', category: 'visualization', parse: parseSlope },
  { id: 'wordcloud', category: 'visualization', parse: parseWordcloud },
  {
    id: 'arc',
    category: 'visualization',
    parse: parseArc,
    measure: measureArc,
    minDims: minDimsArc,
  },
  { id: 'timeline', category: 'visualization', parse: parseTimeline },
  {
    id: 'event-line',
    category: 'visualization',
    parse: parseEventLine,
    measure: measureEventLine,
    minDims: minDimsEventLine,
  },
  { id: 'venn', category: 'visualization', parse: parseVenn },
  { id: 'quadrant', category: 'visualization', parse: parseQuadrant },

  // ── Visualizations with their own parsers ─────────────────
  {
    id: 'tech-radar',
    category: 'visualization',
    parse: parseTechRadar,
    measure: measureTechRadar,
    minDims: minDimsTechRadar,
  },
  { id: 'cycle', category: 'visualization', parse: parseCycle },
  { id: 'pyramid', category: 'visualization', parse: parsePyramid },
  { id: 'ring', category: 'visualization', parse: parseRing },
  // Treemap: squarified hierarchy. No measure/minDims — a treemap fills whatever
  // rectangle it's given and has no intrinsic aspect/size (F11).
  { id: 'treemap', category: 'visualization', parse: parseTreemap },
  // Block diagram: deterministic grid (no measure/minDims — it sizes to content
  // and is scaled to fit whatever rectangle it's given).
  { id: 'block', category: 'visualization', parse: parseBlock },

  // ── Geographic map (own parser → resolver → layout → renderer) ──
  { id: 'map', category: 'visualization', parse: parseMap },
];

/** id → descriptor, for O(1) dispatch lookups. */
export const REGISTRY_BY_ID: ReadonlyMap<string, ChartTypeDescriptor> = new Map(
  CHART_TYPE_REGISTRY.map((d) => [d.id, d])
);

/**
 * True when a type is rendered by the extended-ECharts engine. Story 109.2a gave
 * each extended type its own parser door, so this checks membership in the door
 * set rather than identity against the single former `parseExtendedChart`.
 */
export function isExtendedChartParser(parse: ParseFn): boolean {
  return EXTENDED_CHART_DOORS.has(parse);
}
