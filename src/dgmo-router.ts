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
import { parseFirstLine } from './utils/parsing';
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
]);

/**
 * Parse DGMO content and return diagnostics without rendering.
 * Useful for the CLI and editor to surface all errors before attempting render.
 */
export function parseDgmo(content: string): { diagnostics: DgmoError[] } {
  const chartType = parseDgmoChartType(content);

  if (!chartType) {
    // No chart type detected — try visualization parser as fallback (it handles missing chart: line)
    return { diagnostics: parseVisualization(content).diagnostics };
  }

  const directParser = PARSE_DISPATCH.get(chartType);
  if (directParser) return { diagnostics: directParser(content).diagnostics };

  if (STANDARD_CHART_TYPES.has(chartType)) {
    return { diagnostics: parseChart(content).diagnostics };
  }
  if (ECHART_TYPES.has(chartType)) {
    return { diagnostics: parseExtendedChart(content).diagnostics };
  }

  // Visualization types (slope, wordcloud, arc, timeline, venn, quadrant)
  return { diagnostics: parseVisualization(content).diagnostics };
}
