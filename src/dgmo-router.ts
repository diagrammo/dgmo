// ============================================================
// .dgmo Unified Format — Chart Type Router
// ============================================================

import { looksLikeSequence, parseSequenceDgmo } from './sequence/parser';
import { looksLikeFlowchart, parseFlowchart } from './graph/flowchart-parser';
import { looksLikeState, parseState } from './graph/state-parser';
import { looksLikeClassDiagram, parseClassDiagram } from './class/parser';
import { looksLikeERDiagram, parseERDiagram } from './er/parser';
import { parseChart } from './chart';
import { parseExtendedChart } from './echarts';
import { parseVisualization } from './d3';
import { parseOrg, looksLikeOrg } from './org/parser';
import { parseKanban } from './kanban/parser';
import { parseC4 } from './c4/parser';
import { looksLikeSitemap, parseSitemap } from './sitemap/parser';
import { parseInfra } from './infra/parser';
import { parseGantt } from './gantt/parser';
import { parseBoxesAndLines } from './boxes-and-lines/parser';
import { parseMindmap } from './mindmap/parser';
import { parseWireframe } from './wireframe/parser';
import { parseTechRadar } from './tech-radar/parser';
import { parseCycle } from './cycle/parser';
import { parseJourneyMap } from './journey-map/parser';
import { parsePyramid } from './pyramid/parser';
import { parseFirstLine } from './utils/parsing';
import { makeDgmoError, suggest } from './diagnostics';
import type { DgmoError } from './diagnostics';

// ============================================================
// Content-based chart type inference helpers
// ============================================================

/** Gantt duration patterns: `10bd Task` */
const GANTT_DURATION_RE = /^\d+(?:\.\d+)?(?:min|bd|d|w|m|q|y|h)(?:\?)?\s+/;
/** Gantt date patterns: `2025-01-01 Task` */
const GANTT_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\s+/;

/**
 * Returns true if content looks like a gantt chart.
 * Detects duration patterns like `10bd Task` or `5d Task`.
 */
export function looksLikeGantt(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (GANTT_DURATION_RE.test(trimmed) || GANTT_DATE_RE.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/** C4 `Name is a person/system/container/component` pattern */
const C4_TYPE_RE = /\bis\s+an?\s+(person|system|container|component)\b/i;

/**
 * Returns true if content looks like a C4 diagram.
 * Detects `Name is a person/system/container/component` declarations.
 * Does NOT match bare words like `container` at line start.
 */
export function looksLikeC4(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (C4_TYPE_RE.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Extracts the chart type from raw file content.
 * First tries the first non-empty, non-comment line as a bare chart type name
 * (e.g., `gantt Product Launch`).
 * Falls back to inference when no explicit chart type is found.
 */
export function parseDgmoChartType(content: string): string | null {
  const lines = content.split('\n');

  // Find first non-empty, non-comment line
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Try new first-line detection (bare chart type name)
    const firstLineResult = parseFirstLine(trimmed);
    if (firstLineResult) return firstLineResult.chartType;

    // Not a chart type on the first line — stop looking for explicit declaration
    break;
  }

  // Infer chart type from content patterns (sequence before flowchart —
  // both use `->` but sequence uses bare names while flowchart uses shape delimiters)
  // C4 must come AFTER sequence (both use `is a` but with different type nouns)
  if (looksLikeSequence(content)) return 'sequence';
  if (looksLikeFlowchart(content)) return 'flowchart';
  if (looksLikeClassDiagram(content)) return 'class';
  if (looksLikeERDiagram(content)) return 'er';
  if (looksLikeState(content)) return 'state';
  if (looksLikeSitemap(content)) return 'sitemap';
  if (looksLikeOrg(content)) return 'org';
  if (looksLikeC4(content)) return 'c4';
  if (looksLikeGantt(content)) return 'gantt';

  return null;
}

// ============================================================
// Public render-category API
// ============================================================

/** User-visible rendering category for dispatch and routing. */
export type RenderCategory = 'data-chart' | 'visualization' | 'diagram';

const DATA_CHART_TYPES = new Set([
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
]);
const VISUALIZATION_TYPES = new Set([
  'slope',
  'wordcloud',
  'arc',
  'timeline',
  'venn',
  'quadrant',
  'tech-radar',
  'cycle',
  'pyramid',
]);
const DIAGRAM_TYPES = new Set([
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
  'mindmap',
  'wireframe',
  'journey-map',
]);
const EXTENDED_CHART_TYPES = new Set([
  'scatter',
  'sankey',
  'chord',
  'function',
  'heatmap',
  'funnel',
]);

/**
 * Returns the render category for a given chart type, or `null` if unknown.
 * Use this instead of the internal framework map for dispatch in consumers.
 */
export function getRenderCategory(chartType: string): RenderCategory | null {
  const type = chartType.toLowerCase();
  if (DATA_CHART_TYPES.has(type)) return 'data-chart';
  if (VISUALIZATION_TYPES.has(type)) return 'visualization';
  if (DIAGRAM_TYPES.has(type)) return 'diagram';
  return null;
}

/**
 * Returns true if the chart type is an extended chart type
 * handled by parseExtendedChart (scatter, sankey, chord, function, heatmap, funnel).
 * Returns false for standard chart types and all other types.
 */
export function isExtendedChartType(chartType: string): boolean {
  return EXTENDED_CHART_TYPES.has(chartType.toLowerCase());
}

/** Standard chart types parsed by parseChart (then rendered via ECharts). Internal use. */
const STANDARD_CHART_TYPES = new Set([
  'bar',
  'line',
  'multi-line',
  'area',
  'pie',
  'doughnut',
  'radar',
  'polar-area',
  'bar-stacked',
]);

/**
 * Returns all supported chart type identifiers.
 * Useful for CLI enumeration and autocomplete.
 */
export function getAllChartTypes(): string[] {
  return [...DATA_CHART_TYPES, ...VISUALIZATION_TYPES, ...DIAGRAM_TYPES];
}

/**
 * Canonical descriptions for every supported chart type. Shared by the CLI
 * `--chart-types` flag, the editor autocomplete popup, and the MCP
 * `list_chart_types` tool so all three surfaces stay in sync.
 */
export const CHART_TYPE_DESCRIPTIONS: Record<string, string> = {
  bar: 'Bar chart — categorical comparisons',
  line: 'Line chart — trends over time; supports era bands (era start -> end Label (color)) for annotating named periods',
  'multi-line':
    'Multi-line chart — multiple series trends over time; supports era bands',
  area: 'Area chart — filled line chart; supports era bands',
  pie: 'Pie chart — part-to-whole proportions',
  doughnut: 'Doughnut chart — ring-style pie chart',
  radar: 'Radar chart — multi-dimensional metrics',
  'polar-area': 'Polar area chart — radial bar chart',
  'bar-stacked': 'Stacked bar chart — multi-series categorical',
  scatter: 'Scatter plot — 2D data points or bubble chart',
  sankey: 'Sankey diagram — flow/allocation visualization',
  chord: 'Chord diagram — circular flow relationships',
  function: 'Function plot — mathematical expressions',
  heatmap: 'Heatmap — matrix intensity visualization',
  funnel: 'Funnel chart — conversion pipeline',
  slope: 'Slope chart — change between two periods',
  wordcloud: 'Word cloud — term frequency visualization',
  arc: 'Arc diagram — network relationships',
  timeline: 'Timeline — events, eras, and date ranges',
  venn: 'Venn diagram — set overlaps',
  quadrant: 'Quadrant chart — 2x2 positioning matrix',
  'tech-radar':
    'Tech radar — technology adoption quadrants (adopt/trial/assess/hold)',
  cycle:
    'Cycle diagram — cyclical process visualization (PDCA, OODA, DevOps loops)',
  sequence: 'Sequence diagram — message/interaction flows',
  flowchart: 'Flowchart — decision trees and process flows',
  class: 'Class diagram — UML class hierarchies',
  er: 'ER diagram — database schemas and relationships',
  org: 'Org chart — hierarchical tree structures',
  kanban: 'Kanban board — task/workflow columns',
  c4: 'C4 diagram — system architecture (context, container, component, deployment)',
  state: 'State diagram — state machine / lifecycle transitions',
  sitemap:
    'Sitemap — navigable UI structure with pages, groups, and cross-link arrows',
  infra:
    'Infrastructure diagram — traffic flow with RPS computation, capacity modeling, and latency analysis',
  gantt:
    'Gantt chart — project scheduling with task dependencies and milestones',
  'boxes-and-lines':
    'Boxes and lines — general-purpose node-edge diagrams with nested groups, tags, and shape inference',
  mindmap: 'Mindmap — radial hierarchy of ideas branching from a central topic',
  wireframe:
    'Wireframe — low-fidelity UI layout with panels, controls, and annotations',
  'journey-map':
    'Journey map — user experience flow with emotion scores, phases, and annotations',
  pyramid:
    'Pyramid — hierarchical layered pyramid (Maslow, DIKW, learning pyramid); inverted for funnel-of-learning style',
};

// ECharts-native types parsed by parseExtendedChart
const ECHART_TYPES = new Set([
  'scatter',
  'sankey',
  'chord',
  'function',
  'heatmap',
  'funnel',
]);

/** Map chart type strings to their parse function (content → { diagnostics }). */
const PARSE_DISPATCH = new Map<
  string,
  (content: string) => { diagnostics: DgmoError[] }
>([
  ['sequence', (c) => parseSequenceDgmo(c)],
  ['flowchart', (c) => parseFlowchart(c)],
  ['class', (c) => parseClassDiagram(c)],
  ['er', (c) => parseERDiagram(c)],
  ['org', (c) => parseOrg(c)],
  ['kanban', (c) => parseKanban(c)],
  ['c4', (c) => parseC4(c)],
  ['state', (c) => parseState(c)],
  ['sitemap', (c) => parseSitemap(c)],
  ['infra', (c) => parseInfra(c)],
  ['gantt', (c) => parseGantt(c)],
  ['boxes-and-lines', (c) => parseBoxesAndLines(c)],
  ['mindmap', (c) => parseMindmap(c)],
  ['wireframe', (c) => parseWireframe(c)],
  ['tech-radar', (c) => parseTechRadar(c)],
  ['cycle', (c) => parseCycle(c)],
  ['journey-map', (c) => parseJourneyMap(c)],
  ['pyramid', (c) => parsePyramid(c)],
]);

/**
 * Parse DGMO content and return diagnostics without rendering.
 * Useful for the CLI and editor to surface all errors before attempting render.
 */
/** All known chart type names for colon-pattern detection. */
const ALL_KNOWN_TYPES = new Set([
  ...DATA_CHART_TYPES,
  ...VISUALIZATION_TYPES,
  ...DIAGRAM_TYPES,
]);

/**
 * Parse DGMO content and return diagnostics without rendering.
 * Useful for the CLI and editor to surface all errors before attempting render.
 */
export function parseDgmo(content: string): {
  diagnostics: DgmoError[];
  chartType: string | null;
} {
  const chartType = parseDgmoChartType(content);

  if (!chartType) {
    // Check for common mistake: colon in chart type declaration (e.g. "bar: Sales")
    const colonDiag = detectColonChartType(content);
    if (colonDiag) {
      const fallback = parseVisualization(content).diagnostics;
      return { diagnostics: [colonDiag, ...fallback], chartType: null };
    }

    // No chart type detected — try visualization parser as fallback
    return {
      diagnostics: parseVisualization(content).diagnostics,
      chartType: null,
    };
  }

  const directParser = PARSE_DISPATCH.get(chartType);
  if (directParser) {
    const result = directParser(content);
    return {
      diagnostics: [...result.diagnostics, ...detectEmptyContent(content)],
      chartType,
    };
  }

  if (STANDARD_CHART_TYPES.has(chartType)) {
    const result = parseChart(content);
    return {
      diagnostics: [...result.diagnostics, ...detectEmptyContent(content)],
      chartType,
    };
  }
  if (ECHART_TYPES.has(chartType)) {
    const result = parseExtendedChart(content);
    return {
      diagnostics: [...result.diagnostics, ...detectEmptyContent(content)],
      chartType,
    };
  }

  // Visualization types (slope, wordcloud, arc, timeline, venn, quadrant)
  const result = parseVisualization(content);
  return {
    diagnostics: [...result.diagnostics, ...detectEmptyContent(content)],
    chartType,
  };
}

// ============================================================
// Common-mistake detectors
// ============================================================

/**
 * Detects colon-separated chart type declarations like "bar: Sales" or "pie: Data".
 * Returns a diagnostic if the word before the colon is a known or similar chart type.
 */
function detectColonChartType(content: string): DgmoError | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//'))
      continue;

    const match = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!match) return null; // First non-empty line doesn't match colon pattern

    const word = match[1].toLowerCase();
    const rest = match[2].trim();

    if (ALL_KNOWN_TYPES.has(word)) {
      const example = rest ? `${word} ${rest}` : word;
      return makeDgmoError(
        i + 1,
        `Remove the colon — use '${example}' instead of '${trimmed}'. DGMO chart types don't use colons.`
      );
    }

    // Check if it's a misspelling of a known type
    const hint = suggest(word, [...ALL_KNOWN_TYPES]);
    if (hint) {
      return makeDgmoError(
        i + 1,
        `Unknown chart type: ${word}. ${hint} Also, DGMO chart types don't use colons.`
      );
    }

    return null; // First line has colon but isn't a chart type — normal data
  }
  return null;
}

/**
 * Detects when content has only the chart type line with no meaningful data lines.
 */
function detectEmptyContent(content: string): DgmoError[] {
  const lines = content.split('\n');
  const nonEmpty = lines.filter(
    (l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('//')
  );
  if (nonEmpty.length <= 1) {
    return [
      makeDgmoError(1, 'No content after chart type declaration.', 'warning'),
    ];
  }
  return [];
}
