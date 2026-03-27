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
import { extractColor, normalizeDirection, normalizeGroupedNumber, parseFirstLine, parseSeriesNames } from './utils/parsing';

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

/** Known option keywords for the simple chart parser. */
const KNOWN_OPTIONS = new Set([
  'chart', 'title', 'series', 'xlabel', 'ylabel', 'label', 'labels',
  'orientation', 'direction', 'color',
]);

/**
 * Parses the simple chart text format into a structured object.
 *
 * Format (colon-free):
 * ```
 * bar My Chart
 * series Revenue
 *
 * Jan 120
 * Feb 200
 * Mar 150
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

  let firstLineParsed = false;

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

    // First non-empty, non-comment line: chart type + optional title
    if (!firstLineParsed) {
      firstLineParsed = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        const raw = firstLine.chartType.toLowerCase();
        const chartType = (TYPE_ALIASES[raw] ?? raw) as ChartType;
        if (VALID_TYPES.has(chartType)) {
          result.type = chartType;
          if (firstLine.title) {
            result.title = firstLine.title;
            result.titleLineNumber = lineNumber;
          }
          continue;
        } else {
          let msg = `Unsupported chart type: ${firstLine.chartType}. Supported types: ${[...VALID_TYPES].join(', ')}.`;
          const hint = suggest(raw, [...VALID_TYPES]);
          if (hint) msg += ` ${hint}`;
          return fail(lineNumber, msg);
        }
      }
      // If the first line is a single word (no spaces, no colon, no numbers),
      // treat it as an unrecognized chart type rather than falling through
      if (!trimmed.includes(' ') && !trimmed.includes(':') && !/\d/.test(trimmed)) {
        let msg = `Unsupported chart type: ${trimmed}. Supported types: ${[...VALID_TYPES].join(', ')}.`;
        const hint = suggest(trimmed.toLowerCase(), [...VALID_TYPES]);
        if (hint) msg += ` ${hint}`;
        return fail(lineNumber, msg);
      }
      // Fall through — first line might be a data row or option
    }

    // Era line: era '77 -> '81 Carter (blue) — colon-free
    const eraMatch = trimmed.match(/^era\s+(.+?)\s*->\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
    if (eraMatch) {
      // Split the "end label" part: everything after -> is "endPart label (color)"
      // We need to separate the end marker from the era label.
      // The regex captured: group1=start, group2=everything between -> and optional (color), group3=color
      // group2 might be "B Phase 1" — we need to split: first token = end, rest = label
      const afterArrow = eraMatch[2].trim();
      const spaceIdx = afterArrow.indexOf(' ');
      if (spaceIdx >= 0) {
        const end = afterArrow.substring(0, spaceIdx).trim();
        const label = afterArrow.substring(spaceIdx + 1).trim();
        parsedEras.push({
          start: eraMatch[1].trim(),
          end,
          label,
          color: eraMatch[3] ? resolveColor(eraMatch[3].trim(), palette) : null,
        });
      }
      // If no space (e.g., just "era A -> B") — skip malformed era
      continue;
    }

    // Extract first token to check for known options
    const spaceIdx = trimmed.indexOf(' ');
    const firstToken = (spaceIdx >= 0 ? trimmed.substring(0, spaceIdx) : trimmed).toLowerCase();

    // Known option with a value
    if (KNOWN_OPTIONS.has(firstToken) && spaceIdx >= 0) {
      const value = trimmed.substring(spaceIdx + 1).trim();

      if (firstToken === 'chart') {
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

      if (firstToken === 'title') {
        result.title = value;
        result.titleLineNumber = lineNumber;
        continue;
      }

      if (firstToken === 'xlabel') {
        result.xlabel = value;
        continue;
      }

      if (firstToken === 'ylabel') {
        result.ylabel = value;
        continue;
      }

      if (firstToken === 'label') {
        result.label = value;
        continue;
      }

      if (firstToken === 'labels') {
        const v = value.toLowerCase();
        if (v === 'name' || v === 'value' || v === 'percent' || v === 'full') {
          result.labels = v;
        }
        continue;
      }

      if (firstToken === 'orientation' || firstToken === 'direction') {
        // Only bar and bar-stacked support orientation (axis swapping)
        if (result.type === 'bar' || result.type === 'bar-stacked') {
          const vLower = value.toLowerCase();
          if (vLower === 'horizontal' || vLower === 'vertical') {
            result.orientation = vLower;
          } else {
            const dir = normalizeDirection(value);
            if (dir === 'LR') result.orientation = 'horizontal';
            else if (dir === 'TB') result.orientation = 'vertical';
          }
        }
        continue;
      }

      if (firstToken === 'color') {
        result.color = resolveColor(value.trim(), palette) ?? undefined;
        continue;
      }

      if (firstToken === 'series') {
        const parsed = parseSeriesNames(value, lines, i, palette);
        i = parsed.newIndex;
        result.series = parsed.series;
        if (parsed.names.length > 1) {
          result.seriesNames = parsed.names;
        }
        if (parsed.nameColors.some(Boolean)) result.seriesNameColors = parsed.nameColors;
        continue;
      }
    }

    // Bare "series" keyword with no value — collect indented names
    if (firstToken === 'series' && spaceIdx === -1) {
      const parsed = parseSeriesNames('', lines, i, palette);
      i = parsed.newIndex;
      result.series = parsed.series;
      if (parsed.names.length > 1) {
        result.seriesNames = parsed.names;
      }
      if (parsed.nameColors.some(Boolean)) result.seriesNameColors = parsed.nameColors;
      continue;
    }

    // Data row: parse from the right — rightmost numeric token(s) = value(s), everything left = label
    // Supports comma-separated multi-values: "Jan 100, 200, 300"
    // Supports comma-grouped numbers: "Revenue 1,200, 1,500" → [1200, 1500]
    const dataValues = parseDataRowValues(trimmed);
    if (dataValues) {
      const { label: rawLabel, color: pointColor } = extractColor(dataValues.label, palette);
      const [first, ...rest] = dataValues.values;
      result.data.push({
        label: rawLabel,
        value: first,
        ...(rest.length > 0 && { extraValues: rest }),
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
    warn(1, 'No data points found. Add data in format: Label 123');
  }

  if (!result.error && result.type === 'bar-stacked' && !result.seriesNames) {
    setChartError(1, 'Chart type "bar-stacked" requires multiple series names. Use: series Name1, Name2, Name3');
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

// ============================================================
// Data Row Parser
// ============================================================

/**
 * Parse a data row line: everything before the last numeric token(s) is the label,
 * numeric tokens at the end are the values. Supports comma-separated multi-values
 * and comma-grouped numbers (e.g., "1,087").
 *
 * Examples:
 *   "Jan 120"           → { label: "Jan", values: [120] }
 *   "North America 250" → { label: "North America", values: [250] }
 *   "Region 5 300"      → { label: "Region 5", values: [300] }
 *   "Q1 10, 20, 30"     → { label: "Q1", values: [10, 20, 30] }
 *   "Revenue 1,200"     → { label: "Revenue", values: [1200] }
 *
 * Returns null if the line has no numeric value at the end.
 */
export function parseDataRowValues(
  line: string,
): { label: string; values: number[] } | null {
  // First, normalize comma-grouped numbers: replace patterns like "1,087" with "1087"
  // We need to be careful: commas also separate multi-values.
  // Strategy: tokenize by commas, normalize grouped numbers, then re-parse.

  // Split by comma to get segments
  const segments = line.split(',');

  // Normalize each segment: if a segment (trimmed) matches grouped number pattern,
  // merge it with the previous segment
  const normalized: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].trim();
    // Check if this segment is a continuation of a grouped number
    // A continuation looks like exactly 3 digits and follows a segment ending in digits.
    // Grouped numbers have NO space around the comma (e.g., "1,087"), so skip if
    // the raw segment has leading whitespace (e.g., ", 350" is a value separator).
    if (i > 0 && /^\d{3}$/.test(seg) && !/^\s/.test(segments[i])) {
      const prevSeg = normalized[normalized.length - 1].trimEnd();
      // Check if previous segment ends with a number (1-3 digits at the end of the last token)
      if (/\d{1,3}$/.test(prevSeg)) {
        // Check if the combined token would be a valid grouped number
        // Extract the trailing number from prev
        const prevMatch = prevSeg.match(/(\d{1,3})$/);
        if (prevMatch) {
          // Tentatively merge and validate
          const mergedTail = prevMatch[1] + ',' + seg;
          // Build full token by looking at what's left in normalized
          // Simple approach: just merge
          normalized[normalized.length - 1] = prevSeg + seg;
          continue;
        }
      }
    }
    normalized.push(segments[i]);
  }

  const rebuilt = normalized.join(',');

  // Now check for comma-separated values at the end
  // Strategy: find where the label ends and values begin
  // Values are comma-separated numeric tokens at the end of the line

  // Try splitting by comma first — if the line has commas, the last comma-separated tokens
  // that are all numeric form the values
  const commaParts = rebuilt.split(',');
  if (commaParts.length > 1) {
    // Find how many trailing comma-separated parts are numeric
    let numericCount = 0;
    for (let j = commaParts.length - 1; j >= 0; j--) {
      const part = commaParts[j].trim();
      if (part && !isNaN(parseFloat(part)) && isFinite(Number(part))) {
        numericCount++;
      } else {
        break;
      }
    }
    if (numericCount > 0) {
      // Pure numeric trailing comma-parts are extra values.
      // Everything before them (joined by comma) contains "label firstValue".
      const splitAt = commaParts.length - numericCount;
      const extraValueParts = commaParts.slice(splitAt);
      const firstPart = commaParts.slice(0, splitAt).join(',').trim();

      // Split firstPart from the right: last space-separated token must be numeric
      const lastSpaceIdx = firstPart.lastIndexOf(' ');
      if (lastSpaceIdx >= 0) {
        const possibleFirstVal = firstPart.substring(lastSpaceIdx + 1).trim();
        if (possibleFirstVal && !isNaN(parseFloat(possibleFirstVal)) && isFinite(Number(possibleFirstVal))) {
          const label = firstPart.substring(0, lastSpaceIdx).trim();
          if (label) {
            const values = [parseFloat(possibleFirstVal)];
            for (const p of extraValueParts) {
              values.push(parseFloat(p.trim()));
            }
            return { label, values };
          }
        }
      }
    }
  }

  // No commas or comma parsing didn't work — split by spaces from right
  // Last space-separated token that is numeric = the value
  const lastSpaceIdx = rebuilt.lastIndexOf(' ');
  if (lastSpaceIdx < 0) return null;

  const possibleValue = rebuilt.substring(lastSpaceIdx + 1).trim();
  const num = parseFloat(possibleValue);
  if (isNaN(num) || !isFinite(Number(possibleValue))) return null;

  const label = rebuilt.substring(0, lastSpaceIdx).trim();
  if (!label) return null;

  return { label, values: [num] };
}
