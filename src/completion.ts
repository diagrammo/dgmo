/**
 * Diagram symbol extraction API.
 *
 * Provides DiagramSymbols interface + extractDiagramSymbols() dispatch.
 * Each diagram type registers its own extractor via registerExtractor().
 * All built-in extractors are registered at module init below.
 */

import { extractSymbols as extractErSymbols } from './er/parser';
import { extractSymbols as extractFlowchartSymbols } from './graph/flowchart-parser';
import { extractSymbols as extractInfraSymbols } from './infra/parser';
import { extractSymbols as extractClassSymbols } from './class/parser';

// ChartType is just a string — alias here for documentation clarity.
export type ChartType = string;

export interface DiagramSymbols {
  kind: ChartType;
  entities: string[]; // table names, node IDs, class names, etc.
  keywords: string[]; // diagram-specific reserved words
}

export type ExtractFn = (docText: string) => DiagramSymbols;

const registry = new Map<ChartType, ExtractFn>();

export function registerExtractor(kind: ChartType, fn: ExtractFn): void {
  registry.set(kind, fn);
}

/**
 * Extract diagram symbols from document text.
 * Returns null if the chart type is unknown or has no registered extractor.
 */
export function extractDiagramSymbols(docText: string): DiagramSymbols | null {
  // Parse chartType from first `chart:` line — lightweight, no full parser.
  let chartType: string | null = null;
  for (const line of docText.split('\n')) {
    const m = line.match(/^\s*chart\s*:\s*(.+)/i);
    if (m) {
      chartType = m[1]!.trim().toLowerCase();
      break;
    }
  }
  if (!chartType) return null;
  const fn = registry.get(chartType);
  if (!fn) return null;
  return fn(docText);
}

// ============================================================
// Register built-in extractors
// ============================================================

registerExtractor('er', extractErSymbols);
registerExtractor('flowchart', extractFlowchartSymbols);
registerExtractor('infra', extractInfraSymbols);
registerExtractor('class', extractClassSymbols);
