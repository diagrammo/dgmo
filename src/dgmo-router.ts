// ============================================================
// .dgmo Unified Format — Chart Type Router
// ============================================================

import { looksLikeSequence, parseSequenceDgmo } from './sequence/parser';
import { looksLikeFlowchart, parseFlowchart } from './graph/flowchart-parser';
import { looksLikeClassDiagram, parseClassDiagram } from './class/parser';
import { looksLikeERDiagram, parseERDiagram } from './er/parser';
import { parseChart } from './chart';
import { parseEChart } from './echarts';
import { parseD3 } from './d3';
import { parseOrg, looksLikeOrg } from './org/parser';
import { parseKanban } from './kanban/parser';
import { parseC4 } from './c4/parser';
import type { DgmoError } from './diagnostics';

/**
 * Framework identifiers used by the .dgmo router.
 * Maps to the existing preview components and export paths.
 */
export type DgmoFramework = 'echart' | 'd3' | 'mermaid';

/**
 * Maps every supported chart type string to its backing framework.
 *
 * ECharts:  standard chart types (bar, line, pie, etc.), scatter, flow/relationship diagrams, math, heatmap
 * D3:       slope, wordcloud, arc diagram, timeline
 */
export const DGMO_CHART_TYPE_MAP: Record<string, DgmoFramework> = {
  // Standard charts (via ECharts)
  bar: 'echart',
  line: 'echart',
  'multi-line': 'echart',
  area: 'echart',
  pie: 'echart',
  doughnut: 'echart',
  radar: 'echart',
  'polar-area': 'echart',
  'bar-stacked': 'echart',

  // ECharts
  scatter: 'echart',
  sankey: 'echart',
  chord: 'echart',
  function: 'echart',
  heatmap: 'echart',
  funnel: 'echart',

  // D3
  slope: 'd3',
  wordcloud: 'd3',
  arc: 'd3',
  timeline: 'd3',
  venn: 'd3',
  quadrant: 'd3',
  sequence: 'd3',
  flowchart: 'd3',
  class: 'd3',
  er: 'd3',
  org: 'd3',
  kanban: 'd3',
  c4: 'd3',
};

/**
 * Returns the framework for a given chart type, or `null` if unknown.
 */
export function getDgmoFramework(chartType: string): DgmoFramework | null {
  return DGMO_CHART_TYPE_MAP[chartType.toLowerCase()] ?? null;
}

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
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//'))
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
  if (looksLikeOrg(content)) return 'org';

  return null;
}

// Standard chart types parsed by parseChart (then rendered via ECharts)
const STANDARD_CHART_TYPES = new Set([
  'bar', 'line', 'multi-line', 'area', 'pie', 'doughnut',
  'radar', 'polar-area', 'bar-stacked',
]);

// ECharts-native types parsed by parseEChart
const ECHART_TYPES = new Set([
  'scatter', 'sankey', 'chord', 'function', 'heatmap', 'funnel',
]);

/**
 * Parse DGMO content and return diagnostics without rendering.
 * Useful for the CLI and editor to surface all errors before attempting render.
 */
export function parseDgmo(content: string): { diagnostics: DgmoError[] } {
  const chartType = parseDgmoChartType(content);

  if (!chartType) {
    // No chart type detected — try D3 parser as fallback (it handles missing chart: line)
    const parsed = parseD3(content);
    return { diagnostics: parsed.diagnostics };
  }

  if (chartType === 'sequence') {
    const parsed = parseSequenceDgmo(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (chartType === 'flowchart') {
    const parsed = parseFlowchart(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (chartType === 'class') {
    const parsed = parseClassDiagram(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (chartType === 'er') {
    const parsed = parseERDiagram(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (chartType === 'org') {
    const parsed = parseOrg(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (chartType === 'kanban') {
    const parsed = parseKanban(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (chartType === 'c4') {
    const parsed = parseC4(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (STANDARD_CHART_TYPES.has(chartType)) {
    const parsed = parseChart(content);
    return { diagnostics: parsed.diagnostics };
  }
  if (ECHART_TYPES.has(chartType)) {
    const parsed = parseEChart(content);
    return { diagnostics: parsed.diagnostics };
  }

  // D3 types (slope, wordcloud, arc, timeline, venn, quadrant)
  const parsed = parseD3(content);
  return { diagnostics: parsed.diagnostics };
}
