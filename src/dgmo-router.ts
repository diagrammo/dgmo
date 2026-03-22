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
import { looksLikeInitiativeStatus, parseInitiativeStatus } from './initiative-status/parser';
import { looksLikeSitemap, parseSitemap } from './sitemap/parser';
import { parseInfra } from './infra/parser';
import { parseGantt } from './gantt/parser';
import type { DgmoError } from './diagnostics';

/**
 * Extracts the `chart:` type value from raw file content.
 * Falls back to inference when no explicit `chart:` line is found
 * (e.g. content containing `->` is inferred as `sequence`).
 */
export function parseDgmoChartType(content: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//'))
      continue;
    const match = trimmed.match(/^chart\s*:\s*(.+)/i);
    if (match) return match[1].trim().toLowerCase();
  }

  // Infer chart type from content patterns (sequence before flowchart —
  // both use `->` but sequence uses bare names while flowchart uses shape delimiters)
  if (looksLikeSequence(content)) return 'sequence';
  if (looksLikeFlowchart(content)) return 'flowchart';
  if (looksLikeClassDiagram(content)) return 'class';
  if (looksLikeERDiagram(content)) return 'er';
  if (looksLikeInitiativeStatus(content)) return 'initiative-status';
  if (looksLikeState(content)) return 'state';
  if (looksLikeSitemap(content)) return 'sitemap';
  if (looksLikeOrg(content)) return 'org';

  return null;
}

// ============================================================
// Public render-category API
// ============================================================

/** User-visible rendering category for dispatch and routing. */
export type RenderCategory = 'data-chart' | 'visualization' | 'diagram';

const DATA_CHART_TYPES = new Set([
  'bar', 'line', 'pie', 'doughnut', 'area', 'polar-area', 'radar',
  'bar-stacked', 'multi-line', 'scatter', 'sankey', 'chord', 'function',
  'heatmap', 'funnel',
]);
const VISUALIZATION_TYPES = new Set([
  'slope', 'wordcloud', 'arc', 'timeline', 'venn', 'quadrant',
]);
const DIAGRAM_TYPES = new Set([
  'sequence', 'flowchart', 'class', 'er', 'org', 'kanban', 'c4',
  'initiative-status', 'state', 'sitemap', 'infra', 'gantt',
]);
const EXTENDED_CHART_TYPES = new Set([
  'scatter', 'sankey', 'chord', 'function', 'heatmap', 'funnel',
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
  'bar', 'line', 'multi-line', 'area', 'pie', 'doughnut',
  'radar', 'polar-area', 'bar-stacked',
]);

/**
 * Returns all supported chart type identifiers.
 * Useful for CLI enumeration and autocomplete.
 */
export function getAllChartTypes(): string[] {
  return [
    ...DATA_CHART_TYPES,
    ...VISUALIZATION_TYPES,
    ...DIAGRAM_TYPES,
  ];
}

// ECharts-native types parsed by parseExtendedChart
const ECHART_TYPES = new Set([
  'scatter', 'sankey', 'chord', 'function', 'heatmap', 'funnel',
]);

/** Map chart type strings to their parse function (content → { diagnostics }). */
const PARSE_DISPATCH = new Map<string, (content: string) => { diagnostics: DgmoError[] }>([
  ['sequence', (c) => parseSequenceDgmo(c)],
  ['flowchart', (c) => parseFlowchart(c)],
  ['class', (c) => parseClassDiagram(c)],
  ['er', (c) => parseERDiagram(c)],
  ['org', (c) => parseOrg(c)],
  ['kanban', (c) => parseKanban(c)],
  ['c4', (c) => parseC4(c)],
  ['initiative-status', (c) => parseInitiativeStatus(c)],
  ['state', (c) => parseState(c)],
  ['sitemap', (c) => parseSitemap(c)],
  ['infra', (c) => parseInfra(c)],
  ['gantt', (c) => parseGantt(c)],
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
