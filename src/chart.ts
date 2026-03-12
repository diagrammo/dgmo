// ============================================================
// Types
// ============================================================

export type ChartType =
  | 'bar'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'area'
  | 'polar-area'
  | 'radar'
  | 'bar-stacked';

export interface ChartDataPoint {
  label: string;
  value: number;
  extraValues?: number[];
  color?: string;
  lineNumber: number;
}

export interface ChartEra {
  start: string;        // exact category label, e.g. "'77"
  end: string;          // exact category label, e.g. "'81"
  label: string;        // display name, e.g. "Carter"
  color: string | null; // resolved CSS color, or null → palette default
}

import type { DgmoError } from './diagnostics';

export interface ParsedChart {
  type: ChartType;
  title?: string;
  titleLineNumber?: number;
  series?: string;
  xlabel?: string;
  ylabel?: string;
  seriesNames?: string[];
  seriesNameColors?: (string | undefined)[];
  orientation?: 'horizontal' | 'vertical';
  color?: string;
  label?: string;
  labels?: 'name' | 'value' | 'percent' | 'full';
  data: ChartDataPoint[];
  eras?: ChartEra[];
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Colors
// ============================================================

import { resolveColor } from './colors';
import type { PaletteColors } from './palettes';
import { makeDgmoError, formatDgmoError, suggest } from './diagnostics';
import { extractColor, parseSeriesNames } from './utils/parsing';

// ============================================================
// Parser
// ============================================================

const VALID_TYPES = new Set<ChartType>([
  'bar',
  'line',
  'pie',
  'doughnut',
  'area',
  'polar-area',
  'radar',
  'bar-stacked',
]);

const TYPE_ALIASES: Record<string, ChartType> = {
  'multi-line': 'line',
};

/**
 * Parses the simple chart text format into a structured object.
 *
 * Format:
 * ```
 * chart: bar
 * title: My Chart
 * series: Revenue
 *
 * Jan: 120
 * Feb: 200
 * Mar: 150
 * ```
 */
export function parseChart(
  content: string,
  palette?: PaletteColors
): ParsedChart {
  const lines = content.split('\n');
  const parsedEras: ChartEra[] = [];
  const result: ParsedChart = {
    type: 'bar',
    data: [],
    eras: parsedEras,
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedChart => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Reject legacy ## section headers
    if (/^#{2,}\s+/.test(trimmed)) {
      result.diagnostics.push(makeDgmoError(lineNumber, `'${trimmed}' — ## syntax is no longer supported. Use [Group] containers instead`));
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // Era line: must be matched before colon-split (era '77 -> '81: Carter has colons inside)
    const eraMatch = trimmed.match(/^era\s+(.+?)\s*->\s*(.+?)\s*:\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
    if (eraMatch) {
      parsedEras.push({
        start: eraMatch[1].trim(),
        end: eraMatch[2].trim(),
        label: eraMatch[3].trim(),
        color: eraMatch[4] ? resolveColor(eraMatch[4].trim(), palette) : null,
      });
      continue;
    }

    // Parse key: value pairs
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
    const value = trimmed.substring(colonIndex + 1).trim();

    // Handle metadata
    if (key === 'chart') {
      const raw = value.toLowerCase();
      const chartType = (TYPE_ALIASES[raw] ?? raw) as ChartType;
      if (VALID_TYPES.has(chartType)) {
        result.type = chartType;
      } else {
        let msg = `Unsupported chart type: ${value}. Supported types: ${[...VALID_TYPES].join(', ')}.`;
        const hint = suggest(raw, [...VALID_TYPES]);
        if (hint) msg += ` ${hint}`;
        return fail(lineNumber, msg);
      }
      continue;
    }

    if (key === 'title') {
      result.title = value;
      result.titleLineNumber = lineNumber;
      continue;
    }

    if (key === 'xlabel') {
      result.xlabel = value;
      continue;
    }

    if (key === 'ylabel') {
      result.ylabel = value;
      continue;
    }

    if (key === 'label') {
      result.label = value;
      continue;
    }

    if (key === 'labels') {
      const v = value.toLowerCase();
      if (v === 'name' || v === 'value' || v === 'percent' || v === 'full') {
        result.labels = v;
      }
      continue;
    }

    if (key === 'orientation') {
      // Only bar and bar-stacked support orientation (axis swapping)
      if (result.type === 'bar' || result.type === 'bar-stacked') {
        const v = value.toLowerCase();
        if (v === 'horizontal' || v === 'vertical') {
          result.orientation = v;
        }
      }
      continue;
    }

    if (key === 'color') {
      result.color = resolveColor(value.trim(), palette);
      continue;
    }

    if (key === 'series') {
      const parsed = parseSeriesNames(value, lines, i, palette);
      i = parsed.newIndex;
      result.series = parsed.series;
      if (parsed.names.length > 1) {
        result.seriesNames = parsed.names;
      }
      if (parsed.nameColors.some(Boolean)) result.seriesNameColors = parsed.nameColors;
      continue;
    }

    // Data point: Label: value  or  Label: v1, v2, ...
    const parts = value.split(',').map((s) => s.trim());
    const numValue = parseFloat(parts[0]);
    if (!isNaN(numValue)) {
      const { label: rawLabel, color: pointColor } = extractColor(trimmed.substring(0, colonIndex).trim(), palette);
      const extra = parts
        .slice(1)
        .map((s) => parseFloat(s))
        .filter((n) => !isNaN(n));
      result.data.push({
        label: rawLabel,
        value: numValue,
        ...(extra.length > 0 && { extraValues: extra }),
        ...(pointColor && { color: pointColor }),
        lineNumber,
      });
    }
  }

  // Eras are only valid for line, multi-line (aliased to 'line'), and area chart types
  if (result.type !== 'line' && result.type !== 'area') {
    result.eras = undefined;
  }

  // Validation
  const setChartError = (line: number, message: string) => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  };

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!result.error && result.data.length === 0) {
    warn(1, 'No data points found. Add data in format: Label: 123');
  }

  if (!result.error && result.type === 'bar-stacked' && !result.seriesNames) {
    setChartError(1, 'Chart type "bar-stacked" requires multiple series names. Use: series: Name1, Name2, Name3');
  }

  if (!result.error && result.seriesNames) {
    const expectedCount = result.seriesNames.length;
    for (const dp of result.data) {
      const actualCount = 1 + (dp.extraValues?.length ?? 0);
      if (actualCount !== expectedCount) {
        warn(dp.lineNumber, `Data point "${dp.label}" has ${actualCount} value(s), but ${expectedCount} series defined. Each row must have ${expectedCount} comma-separated values.`);
      }
    }
    // Filter out mismatched data points so renderers get clean data
    result.data = result.data.filter((dp) => {
      const actualCount = 1 + (dp.extraValues?.length ?? 0);
      return actualCount === expectedCount;
    });
  }

  return result;
}
