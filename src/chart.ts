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
  data: ChartDataPoint[];
  error?: string;
}

// ============================================================
// Colors
// ============================================================

import { resolveColor } from './colors';
import type { PaletteColors } from './palettes';

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
  const result: ParsedChart = {
    type: 'bar',
    data: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Recognize ## section headers (skip, but don't treat as comments)
    if (/^#{2,}\s+/.test(trimmed)) continue;

    // Skip comments
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

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
        result.error = `Unsupported chart type: ${value}. Supported types: ${[...VALID_TYPES].join(', ')}.`;
        return result;
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

    if (key === 'orientation') {
      const v = value.toLowerCase();
      if (v === 'horizontal' || v === 'vertical') {
        result.orientation = v;
      }
      continue;
    }

    if (key === 'color') {
      result.color = resolveColor(value.trim(), palette);
      continue;
    }

    if (key === 'series') {
      result.series = value;
      // Parse comma-separated series names for multi-series chart types
      const rawNames = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const names: string[] = [];
      const nameColors: (string | undefined)[] = [];
      for (const raw of rawNames) {
        const colorMatch = raw.match(/\(([^)]+)\)\s*$/);
        if (colorMatch) {
          const resolved = resolveColor(colorMatch[1].trim(), palette);
          nameColors.push(resolved);
          names.push(raw.substring(0, colorMatch.index!).trim());
        } else {
          nameColors.push(undefined);
          names.push(raw);
        }
      }
      if (names.length === 1) {
        result.series = names[0];
      }
      if (names.length > 1) {
        result.seriesNames = names;
      }
      if (nameColors.some(Boolean)) result.seriesNameColors = nameColors;
      continue;
    }

    // Data point: Label: value  or  Label: v1, v2, ...
    const parts = value.split(',').map((s) => s.trim());
    const numValue = parseFloat(parts[0]);
    if (!isNaN(numValue)) {
      let rawLabel = trimmed.substring(0, colonIndex).trim();
      let pointColor: string | undefined;
      const colorMatch = rawLabel.match(/\(([^)]+)\)\s*$/);
      if (colorMatch) {
        const resolved = resolveColor(colorMatch[1].trim(), palette);
        pointColor = resolved;
        rawLabel = rawLabel.substring(0, colorMatch.index!).trim();
      }
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

  // Validation
  if (!result.error && result.data.length === 0) {
    result.error = 'No data points found. Add data in format: Label: 123';
  }

  if (!result.error && result.type === 'bar-stacked' && !result.seriesNames) {
    result.error = `Chart type "bar-stacked" requires multiple series names. Use: series: Name1, Name2, Name3`;
  }

  if (!result.error && result.seriesNames) {
    const expectedCount = result.seriesNames.length;
    for (const dp of result.data) {
      const actualCount = 1 + (dp.extraValues?.length ?? 0);
      if (actualCount !== expectedCount) {
        result.error = `Data point "${dp.label}" has ${actualCount} value(s), but ${expectedCount} series defined. Each row must have ${expectedCount} comma-separated values.`;
        break;
      }
    }
  }

  return result;
}
