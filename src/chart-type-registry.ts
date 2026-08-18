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
//
// `dgmo-router.ts` DERIVES its tables from here; it no longer maintains a
// parallel list. `chart-type-registry.test.ts` asserts the derived tables stay
// complete, extending the existing parser cross-check to the render-category
// site.
//
// A third pair of fields lived here and no longer does: `measure` (content →
// ContentCounts) and `minDims` (counts → {width,height}), relocated in from
// `dimensions.ts`. That module was deleted 2026-08-04 (issue 12) and was their
// only production caller, so the 38 formulas and the `ContentCounts` shape went
// with them on 2026-08-17 (issue 14). Git history holds them if a real caller
// ever appears; do not rebuild the layer speculatively.
//
// NOTE: the EXPORT-RENDER dispatch (renderForExport) is coverage-checked
// against this registry in d3.ts rather than referenced from here — pulling
// every renderer into this module would defeat the lazy per-type imports that
// keep consumer bundles small. See DIAGRAM_EXPORT_HANDLERS in d3.ts.
//
// Description + fallback metadata stays in `chart-types.ts` (the data model the
// AI-authoring selection engine reads); this file owns dispatch behavior.

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
import { parseFamily } from './family/parser';
import { parseMindmap } from './mindmap/parser';
import { parseWireframe } from './wireframe/parser';
import { parseTechRadar } from './tech-radar/parser';
import { parseCycle } from './cycle/parser';
import { parseJourneyMap } from './journey-map/parser';
import { parsePyramid } from './pyramid/parser';
import { parseRing } from './ring/parser';
import { parseTreemap } from './treemap/parser';
import { parseBlock } from './block/parser';
import { parseGoal } from './goal/parser';
import { parseCountdown } from './countdown/parser';
import { parseClock } from './clock/parser';
import { parseBracket } from './bracket/parser';
import { parseRaci } from './raci/parser';
import { parseBody } from './body/parser';
import { parseLiveLink } from './live-link/parser';
import type { DgmoError } from './diagnostics';
import type { ChartTypeId } from './chart-types';

/** User-visible rendering category for dispatch and routing. */
export type RenderCategory = 'data-chart' | 'visualization' | 'diagram';

type ParseResult = { diagnostics: readonly DgmoError[] };
type ParseFn = (content: string) => ParseResult;

/** Everything dispatch needs to know about one chart type. */
export interface ChartTypeDescriptor {
  readonly id: string;
  readonly category: RenderCategory;
  readonly parse: ParseFn;
}

// ============================================================
// THE REGISTRY — ordered to match the previous chartTypeParsers grouping
// (structured diagrams, standard ECharts, extended ECharts, D3 visualizations,
// map). Order only affects knownChartTypeIds; tier order for descriptions lives
// in chart-types.ts.
// ============================================================

const REGISTRY: Record<ChartTypeId, Omit<ChartTypeDescriptor, 'id'>> = {
  // ── Structured diagrams ───────────────────────────────────
  sequence: { category: 'diagram', parse: parseSequenceDgmo },
  flowchart: { category: 'diagram', parse: parseFlowchart },
  class: { category: 'diagram', parse: parseClassDiagram },
  er: { category: 'diagram', parse: parseERDiagram },
  state: { category: 'diagram', parse: parseState },
  org: { category: 'diagram', parse: parseOrg },
  kanban: { category: 'diagram', parse: parseKanban },
  c4: { category: 'diagram', parse: parseC4 },
  sitemap: { category: 'diagram', parse: parseSitemap },
  infra: { category: 'diagram', parse: parseInfra },
  gantt: { category: 'diagram', parse: parseGantt },
  pert: { category: 'diagram', parse: parsePert },
  'boxes-and-lines': { category: 'diagram', parse: parseBoxesAndLines },
  sketch: { category: 'diagram', parse: parseSketch },
  swimlane: { category: 'diagram', parse: parseSwimlane },
  family: { category: 'diagram', parse: parseFamily },
  'version-control': { category: 'diagram', parse: parseVersionControl },
  mindmap: { category: 'diagram', parse: parseMindmap },
  wireframe: { category: 'diagram', parse: parseWireframe },
  'journey-map': { category: 'diagram', parse: parseJourneyMap },
  raci: { category: 'diagram', parse: parseRaci },

  // ── Standard ECharts charts (parseChart) ──────────────────
  bar: { category: 'data-chart', parse: parseChart },
  line: { category: 'data-chart', parse: parseChart },
  pie: { category: 'data-chart', parse: parseChart },
  radar: { category: 'data-chart', parse: parseChart },
  'polar-area': { category: 'data-chart', parse: parseChart },

  // ── Extended ECharts charts — own per-type parser door (Story 109.2a) ──
  scatter: { category: 'data-chart', parse: parseScatter },
  sankey: { category: 'data-chart', parse: parseSankey },
  function: { category: 'data-chart', parse: parseFunctionChart },
  heatmap: { category: 'data-chart', parse: parseHeatmap },
  funnel: { category: 'data-chart', parse: parseFunnel },

  // ── D3 visualizations — own per-viz parser door (Story 109.2) ──
  slope: { category: 'visualization', parse: parseSlope },
  wordcloud: { category: 'visualization', parse: parseWordcloud },
  arc: { category: 'visualization', parse: parseArc },
  timeline: { category: 'visualization', parse: parseTimeline },
  'event-line': { category: 'visualization', parse: parseEventLine },
  venn: { category: 'visualization', parse: parseVenn },
  quadrant: { category: 'visualization', parse: parseQuadrant },
  body: { category: 'diagram', parse: parseBody },

  // ── Visualizations with their own parsers ─────────────────
  'tech-radar': { category: 'visualization', parse: parseTechRadar },
  cycle: { category: 'visualization', parse: parseCycle },
  pyramid: { category: 'visualization', parse: parsePyramid },
  ring: { category: 'visualization', parse: parseRing },
  // Treemap: squarified hierarchy — fills whatever rectangle it's given and has
  // no intrinsic aspect/size (F11).
  treemap: { category: 'visualization', parse: parseTreemap },
  // Block diagram: deterministic grid — sizes to content and is scaled to fit
  // whatever rectangle it's given.
  block: { category: 'visualization', parse: parseBlock },
  // Goal: a single now/target value in one of three faces (bar/thermometer/
  // gauge) — centers in whatever rectangle it's given.
  goal: { category: 'visualization', parse: parseGoal },
  // Countdown: the only dynamic chart — a single "N days until X" that ticks
  // live, centered in whatever rectangle it's given.
  countdown: { category: 'visualization', parse: parseCountdown },
  // Clock: live world-clock board — one row per place/zone, ticking every
  // second; sizes to its rows and scales to fit.
  clock: { category: 'visualization', parse: parseClock },
  // Bracket: single-elim tournament tree. A diagram (structural, node-and-edge);
  // sizes to content and scales to fit its rectangle.
  bracket: { category: 'diagram', parse: parseBracket },

  // ── Geographic map (own parser → resolver → layout → renderer) ──
  map: { category: 'visualization', parse: parseMap },

  // Live link: a pointer to a diagram published at Diagrammo Cloud, rendered
  // as a reference card. `diagram` like every other card-shaped type, so the
  // export-handler cross-check covers it rather than being relaxed for it. The
  // card sizes to its own text and scales to fit.
  'live-link': { category: 'diagram', parse: parseLiveLink },
};

/**
 * The registry as a list. Derived from `REGISTRY`, whose `Record` key type makes
 * a missing or misspelled chart type a COMPILE error rather than a test failure.
 */
export const CHART_TYPE_REGISTRY: readonly ChartTypeDescriptor[] =
  Object.entries(REGISTRY).map(([id, d]) => ({ id, ...d }));

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
