// ============================================================
// .dgmo Unified Format — Chart Type Router
// ============================================================

import { looksLikeSequence } from './sequence/parser';

/**
 * Framework identifiers used by the .dgmo router.
 * Maps to the existing preview components and export paths.
 */
export type DgmoFramework = 'chartjs' | 'echart' | 'd3' | 'mermaid';

/**
 * Maps every supported chart type string to its backing framework.
 *
 * Chart.js: standard chart types (bar, line, pie, etc.)
 * ECharts:  scatter, flow/relationship diagrams, math, heatmap
 * D3:       slope, wordcloud, arc diagram, timeline
 */
export const DGMO_CHART_TYPE_MAP: Record<string, DgmoFramework> = {
  // Chart.js
  bar: 'chartjs',
  line: 'chartjs',
  'multi-line': 'chartjs',
  area: 'chartjs',
  pie: 'chartjs',
  doughnut: 'chartjs',
  radar: 'chartjs',
  'polar-area': 'chartjs',
  'bar-stacked': 'chartjs',

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

  // Infer sequence chart type when content contains arrow patterns
  if (looksLikeSequence(content)) return 'sequence';

  return null;
}
