import * as echarts from 'echarts/core';
import type { EChartsOption } from 'echarts';
import {
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  SankeyChart,
  GraphChart,
  HeatmapChart,
  FunnelChart,
} from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  RadarComponent,
  VisualMapComponent,
  GraphicComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  SankeyChart,
  GraphChart,
  HeatmapChart,
  FunnelChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  RadarComponent,
  VisualMapComponent,
  GraphicComponent,
  SVGRenderer,
]);
import { FONT_FAMILY } from './fonts';
import { renderLegendSvg } from './utils/legend-svg';
import type { LegendGroupData } from './utils/legend-svg';
import {
  type LabelRect,
  type PointCircle,
  rectsOverlap,
  rectCircleOverlap,
} from './label-layout';
import { ScaleContext } from './utils/scaling';

// ============================================================
// Types
// ============================================================

export type ExtendedChartType =
  | 'sankey'
  | 'chord'
  | 'function'
  | 'scatter'
  | 'heatmap'
  | 'funnel';

interface ExtendedChartDataPoint {
  label: string;
  value: number;
  color?: string;
  lineNumber: number;
}

interface ParsedSankeyLink {
  source: string;
  target: string;
  value: number;
  color?: string;
  directed?: boolean;
  lineNumber: number;
}

interface ParsedFunction {
  name: string;
  expression: string;
  color?: string;
  lineNumber: number;
}

interface ParsedScatterPoint {
  name: string;
  x: number;
  y: number;
  size?: number;
  color?: string;
  category?: string;
  lineNumber: number;
}

interface ParsedHeatmapRow {
  label: string;
  values: number[];
  lineNumber: number;
}

import type { DgmoError } from './diagnostics';

export interface ParsedExtendedChart {
  type: ExtendedChartType;
  title?: string;
  titleLineNumber?: number;
  series?: string;
  seriesLineNumber?: number;
  seriesNames?: string[];
  seriesNameLineNumbers?: number[];
  seriesNameColors?: (string | undefined)[];
  data: ExtendedChartDataPoint[];
  links?: ParsedSankeyLink[];
  functions?: ParsedFunction[];
  scatterPoints?: ParsedScatterPoint[];
  heatmapRows?: ParsedHeatmapRow[];
  columns?: string[];
  rows?: string[];
  xRange?: { min: number; max: number };
  xlabel?: string;
  xlabelLineNumber?: number;
  ylabel?: string;
  ylabelLineNumber?: number;
  sizelabel?: string;
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
  shade?: boolean;
  /** Render with full intent saturation instead of the canonical 25% tint. */
  solidFill?: boolean;
  /** Cross-chart-type: when true, the renderer suppresses the chart title. */
  noTitle?: boolean;
  categoryColors?: Record<string, string>;
  categoryLineNumbers?: Record<string, number>;
  nodeColors?: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Nord Colors for Charts
// ============================================================

import type { PaletteColors } from './palettes';
import { getSeriesColors, getSegmentColors } from './palettes';
import {
  contrastText,
  mix,
  shapeFill,
  hexToHSL,
  hslToHex,
} from './palettes/color-utils';
import { parseChart } from './chart';
import type { ParsedChart, ChartEra } from './chart';
import { makeDgmoError, formatDgmoError, suggest } from './diagnostics';
import { resolveColorWithDiagnostic } from './colors';
import {
  collectIndentedValues,
  extractColor,
  measureIndent,
  normalizeNumericToken,
  parseFirstLine,
  parseSeriesNames,
} from './utils/parsing';
import { parseDataRowValues } from './chart';

// ============================================================
// Shared Constants
// ============================================================

const EMPHASIS_SELF = {
  focus: 'self' as const,
  blurScope: 'global' as const,
  itemStyle: { opacity: 1 },
};
const EMPHASIS_SERIES = {
  focus: 'series' as const,
  blurScope: 'global' as const,
  itemStyle: { opacity: 1 },
};
const BLUR_DIM = { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.15 } };
const EMPHASIS_LINE = { ...EMPHASIS_SELF };
const CHART_BASE: Pick<
  EChartsOption,
  'backgroundColor' | 'animation' | 'tooltip'
> = {
  backgroundColor: 'transparent',
  animation: false,
  tooltip: { show: false },
};
const CHART_BORDER_WIDTH = 2;

// ============================================================
// Parser
// ============================================================

const VALID_EXTENDED_TYPES = new Set<ExtendedChartType>([
  'sankey',
  'chord',
  'function',
  'scatter',
  'heatmap',
  'funnel',
]);

/** Known option keywords for the extended chart parser. */
const KNOWN_EXTENDED_OPTIONS = new Set([
  'chart',
  'title',
  'series',
  'x-label',
  'y-label',
  'size-label',
  'no-name',
  'no-value',
  'no-percent',
  'columns',
  'rows',
  'x',
]);

/**
 * Parse a scatter data row: "Name x, y[, size]" or "Name(color) x, y[, size]"
 * Returns a ParsedScatterPoint or null if the line doesn't match.
 */
function parseScatterRow(
  line: string,
  palette: PaletteColors | undefined,
  currentCategory: string,
  lineNumber: number
): ParsedScatterPoint | null {
  const dataRow = parseDataRowValues(line, { multiValue: true });
  if (!dataRow || dataRow.values.length < 2) return null;
  const { label: rawLabel, color: pointColor } = extractColor(
    dataRow.label,
    palette
  );
  return {
    name: rawLabel,
    // In-bounds by length >= 2 guard above.
    x: dataRow.values[0]!,
    y: dataRow.values[1]!,
    ...(dataRow.values[2] !== undefined && { size: dataRow.values[2] }),
    ...(pointColor && { color: pointColor }),
    ...(currentCategory !== 'Default' && { category: currentCategory }),
    lineNumber,
  };
}

/**
 * Parses extended chart content into a structured object.
 *
 * Format (colon-free):
 * ```
 * scatter My Chart
 * xlabel Weight
 *
 * Alice 165, 60
 * Bob 180, 85
 * ```
 */
export function parseExtendedChart(
  content: string,
  palette?: PaletteColors
): ParsedExtendedChart {
  const lines = content.split('\n');
  const result: ParsedExtendedChart = {
    type: 'scatter',
    data: [],
    diagnostics: [],
    error: null,
  };

  // Track current category for grouped scatter charts
  let currentCategory = 'Default';

  // Sankey indentation state: stack of source nodes by indent level
  const sankeyStack: { name: string; indent: number }[] = [];
  let firstLineParsed = false;

  // Per-parse alias literal → canonical node name (TD-18). Per C8.
  // Used by sankey + chord link slots.
  const nameAliasMap = new Map<string, string>();
  /** Peel `as <alias>` and resolve bare alias references in one pass. */
  function resolveSlot(raw: string): string {
    const trimmed = raw.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (m) {
      // Regex capture groups [1] and [2] are non-optional in the pattern.
      const canonical = m[1]!.trim();
      nameAliasMap.set(m[2]!, canonical);
      return canonical;
    }
    const aliased = nameAliasMap.get(trimmed);
    return aliased !== undefined ? aliased : trimmed;
  }

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Reject legacy ## category syntax
    if (/^#{2,}\s+/.test(trimmed)) {
      const name = trimmed
        .replace(/^#{2,}\s+/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `'## ${name}' is no longer supported. Use '[${name}]' instead`
        )
      );
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // First non-empty, non-comment line: chart type + optional title
    if (!firstLineParsed) {
      firstLineParsed = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        const chartType =
          firstLine.chartType.toLowerCase() as ExtendedChartType;
        if (VALID_EXTENDED_TYPES.has(chartType)) {
          result.type = chartType;
          if (firstLine.title) {
            result.title = firstLine.title;
            result.titleLineNumber = lineNumber;
          }
          continue;
        } else {
          const validTypes = [...VALID_EXTENDED_TYPES];
          let msg = `Unsupported chart type: ${firstLine.chartType}. Supported types: ${validTypes.join(', ')}.`;
          const hint = suggest(chartType, validTypes);
          if (hint) msg += ` ${hint}`;
          const diag = makeDgmoError(lineNumber, msg);
          result.diagnostics.push(diag);
          result.error = formatDgmoError(diag);
          return result;
        }
      }
      // If the first line is a single word (no spaces, no colon, no numbers),
      // treat it as an unrecognized chart type rather than falling through
      if (
        !trimmed.includes(' ') &&
        !trimmed.includes(':') &&
        !/\d/.test(trimmed)
      ) {
        const validTypes = [...VALID_EXTENDED_TYPES];
        let msg = `Unsupported chart type: ${trimmed}. Supported types: ${validTypes.join(', ')}.`;
        const hint = suggest(trimmed.toLowerCase(), validTypes);
        if (hint) msg += ` ${hint}`;
        const diag = makeDgmoError(lineNumber, msg);
        result.diagnostics.push(diag);
        result.error = formatDgmoError(diag);
        return result;
      }
      // Fall through — first line might be a data row or option
    }

    // [Category] container header with optional color: [Category Name] or [Category Name](color)
    // Category brackets with optional trailing-token color (§1.5):
    // `[Name]` or `[Name] color`. Per universal rule, color is a bare token.
    const categoryMatch = trimmed.match(/^\[(.+?)\](?:\s+(\S+))?\s*$/);
    if (categoryMatch) {
      // Regex capture group [1] is non-optional in the pattern.
      const catName = categoryMatch[1]!.trim();
      const rawCatColor = categoryMatch[2]?.trim();
      const catColor = rawCatColor
        ? (resolveColorWithDiagnostic(
            rawCatColor,
            lineNumber,
            result.diagnostics,
            palette
          ) ?? null)
        : null;
      if (catColor) {
        if (!result.categoryColors) result.categoryColors = {};
        result.categoryColors[catName] = catColor;
      }
      if (!result.categoryLineNumbers) result.categoryLineNumbers = {};
      result.categoryLineNumbers[catName] = lineNumber;
      currentCategory = catName;
      continue;
    }

    // Sankey/chord link syntax (§1.5 universal trailing-token):
    //   `Source -> Target value`           (directed, no link color)
    //   `Source -> Target value linkColor` (directed, trailing-token link color)
    //   `Source -- Target value`           (undirected)
    // Link color (if present) must be a recognized lowercase palette word.
    // Source/target labels still accept trailing-token color via extractColor.
    const arrowMatch = trimmed.match(
      /^(.+?)\s*(->|--)\s*(.+?)\s+(-?[\d,_]+(?:\.[\d]+)?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
    );
    if (arrowMatch) {
      const [, rawSource, arrow, rawTarget, rawVal, rawLinkColor] = arrowMatch;
      // Captures 1-4 are non-optional in the regex pattern.
      const val = normalizeNumericToken(rawVal!) ?? rawVal!;
      // TD-18: peel/resolve aliases on source and target before color extraction.
      const sourceResolved = resolveSlot(rawSource!);
      const targetResolved = resolveSlot(rawTarget!);
      const { label: source, color: sourceColor } = extractColor(
        sourceResolved,
        palette
      );
      const { label: target, color: targetColor } = extractColor(
        targetResolved,
        palette
      );
      if (sourceColor || targetColor) {
        if (!result.nodeColors) result.nodeColors = {};
        if (sourceColor) result.nodeColors[source] = sourceColor;
        if (targetColor) result.nodeColors[target] = targetColor;
      }
      const linkColor = rawLinkColor
        ? resolveColorWithDiagnostic(
            rawLinkColor.trim(),
            lineNumber,
            result.diagnostics,
            palette
          )
        : undefined;
      if (!result.links) result.links = [];
      result.links.push({
        source,
        target,
        value: parseFloat(val),
        ...(linkColor && { color: linkColor }),
        directed: arrow === '->',
        lineNumber,
      });
      continue;
    }

    // Sankey: bare label (no numeric value) at any indent = source node for indented children
    if (result.type === 'sankey') {
      // In-bounds by loop guard (i < lines.length).
      const indent = measureIndent(lines[i]!);
      // Sankey indented child: "  Target value (color)" under a source on the stack
      if (indent > 0 && sankeyStack.length > 0) {
        // Pop entries at same or deeper indent to find the parent
        while (sankeyStack.length && sankeyStack.at(-1)!.indent >= indent) {
          sankeyStack.pop();
        }
        if (sankeyStack.length > 0) {
          // Indented sankey child (§1.5 trailing-token):
          //   `TargetName value`                  — link, no link color
          //   `TargetName value linkColor`        — link with link color
          //   `TargetName nodeColor value`        — node-colored child
          //   `TargetName nodeColor value linkColor` — both
          // Strategy: peel a trailing recognized color word (after the value)
          // first, then run parseDataRowValues on the remainder. Trailing
          // tokens that aren't recognized colors stay in the data row.
          const valColorMatch = trimmed.match(
            /(-?[\d,_]+(?:\.[\d]+)?)\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\s*$/
          );
          const strippedLine = valColorMatch
            ? trimmed.replace(
                /\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\s*$/,
                ''
              )
            : trimmed;
          const dataRow = parseDataRowValues(strippedLine);
          if (dataRow?.values.length === 1) {
            const source = sankeyStack.at(-1)!.name;
            const linkColor = valColorMatch?.[2]
              ? resolveColorWithDiagnostic(
                  valColorMatch[2].trim(),
                  lineNumber,
                  result.diagnostics,
                  palette
                )
              : undefined;
            // TD-18: peel/resolve alias on the indented child target name.
            const targetResolved = resolveSlot(dataRow.label);
            const { label: target, color: targetColor } = extractColor(
              targetResolved,
              palette
            );
            if (targetColor) {
              if (!result.nodeColors) result.nodeColors = {};
              result.nodeColors[target] = targetColor;
            }
            if (!result.links) result.links = [];
            result.links.push({
              source,
              target,
              // In-bounds by values.length === 1 guard above.
              value: dataRow.values[0]!,
              ...(linkColor && { color: linkColor }),
              lineNumber,
            });
            sankeyStack.push({ name: target, indent });
            continue;
          }
        }
      }

      // Bare label at indent 0 (or any indent without a value) = new source node.
      // Skip cross-chart bare-keyword options so they're handled by the
      // bare-keyword block below instead of becoming a phantom "solid-fill" node.
      const spaceIdx = trimmed.indexOf(' ');
      const lastTok = trimmed.substring(trimmed.lastIndexOf(' ') + 1);
      const hasNumericSuffix =
        spaceIdx >= 0 &&
        !isNaN(parseFloat(normalizeNumericToken(lastTok) ?? lastTok));
      const isBareKeywordOption =
        spaceIdx < 0 &&
        /^(solid-fill|no-name|no-value|no-percent|shade|no-title)$/i.test(
          trimmed
        );
      if (!hasNumericSuffix && !isBareKeywordOption) {
        while (sankeyStack.length && sankeyStack.at(-1)!.indent >= indent) {
          sankeyStack.pop();
        }
        // TD-18: peel/resolve alias on the bare source node label.
        const trimmedResolved = resolveSlot(trimmed);
        const { label: nodeName, color: nodeColor } = extractColor(
          trimmedResolved,
          palette
        );
        if (nodeColor) {
          if (!result.nodeColors) result.nodeColors = {};
          result.nodeColors[nodeName] = nodeColor;
        }
        sankeyStack.push({ name: nodeName, indent });
        continue;
      }
    }

    // Extract first token to check for known options
    const spaceIdx = trimmed.indexOf(' ');
    const firstToken = (
      spaceIdx >= 0 ? trimmed.substring(0, spaceIdx) : trimmed
    ).toLowerCase();

    // Known option with a value
    if (KNOWN_EXTENDED_OPTIONS.has(firstToken) && spaceIdx >= 0) {
      const value = trimmed.substring(spaceIdx + 1).trim();

      if (firstToken === 'chart') {
        const chartType = value.toLowerCase() as ExtendedChartType;
        if (VALID_EXTENDED_TYPES.has(chartType)) {
          result.type = chartType;
        } else {
          const validTypes = [...VALID_EXTENDED_TYPES];
          let msg = `Unsupported chart type: ${value}. Supported types: ${validTypes.join(', ')}.`;
          const hint = suggest(chartType, validTypes);
          if (hint) msg += ` ${hint}`;
          const diag = makeDgmoError(lineNumber, msg);
          result.diagnostics.push(diag);
          result.error = formatDgmoError(diag);
          return result;
        }
        continue;
      }

      if (firstToken === 'title') {
        result.title = value;
        result.titleLineNumber = lineNumber;
        continue;
      }

      if (firstToken === 'series') {
        const parsed = parseSeriesNames(value, lines, i, palette);
        i = parsed.newIndex;
        result.series = parsed.series;
        result.seriesLineNumber = lineNumber;
        if (parsed.names.length > 1) {
          result.seriesNames = parsed.names;
          result.seriesNameLineNumbers = parsed.nameLineNumbers;
        }
        if (parsed.nameColors.some(Boolean))
          result.seriesNameColors = parsed.nameColors;
        continue;
      }

      if (firstToken === 'x-label') {
        result.xlabel = value;
        result.xlabelLineNumber = lineNumber;
        continue;
      }
      if (firstToken === 'y-label') {
        result.ylabel = value;
        result.ylabelLineNumber = lineNumber;
        continue;
      }
      if (firstToken === 'size-label') {
        result.sizelabel = value;
        continue;
      }

      if (firstToken === 'columns') {
        if (value) {
          result.columns = value.includes(',')
            ? value.split(',').map((s) => s.trim())
            : value.split(/\s+/);
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          result.columns = collected.values;
        }
        continue;
      }

      if (firstToken === 'rows') {
        if (value) {
          result.rows = value.includes(',')
            ? value.split(',').map((s) => s.trim())
            : value.split(/\s+/);
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          result.rows = collected.values;
        }
        continue;
      }

      if (firstToken === 'x') {
        const rangeMatch = value.match(/^(-?[\d.]+)\s+to\s+(-?[\d.]+)$/);
        if (rangeMatch) {
          result.xRange = {
            // Regex capture groups [1] and [2] are non-optional in the pattern.
            min: parseFloat(rangeMatch[1]!),
            max: parseFloat(rangeMatch[2]!),
          };
        }
        continue;
      }
    }

    // Bare boolean options
    if (firstToken === 'no-name') {
      result.noName = true;
      continue;
    }
    if (firstToken === 'no-value') {
      result.noValue = true;
      continue;
    }
    if (firstToken === 'no-percent') {
      result.noPercent = true;
      continue;
    }
    if (firstToken === 'shade') {
      result.shade = true;
      continue;
    }
    if (firstToken === 'solid-fill') {
      result.solidFill = true;
      continue;
    }
    if (firstToken === 'no-title' && spaceIdx < 0) {
      result.noTitle = true;
      continue;
    }
    // Silent-ignore unrecognized no-* flags (typos, future flags).
    if (firstToken.startsWith('no-') && spaceIdx < 0) {
      continue;
    }

    // Bare keyword options (no value)
    if (firstToken === 'series' && spaceIdx === -1) {
      const parsed = parseSeriesNames('', lines, i, palette);
      i = parsed.newIndex;
      result.series = parsed.series;
      result.seriesLineNumber = lineNumber;
      if (parsed.names.length > 1) {
        result.seriesNames = parsed.names;
        result.seriesNameLineNumbers = parsed.nameLineNumbers;
      }
      if (parsed.nameColors.some(Boolean))
        result.seriesNameColors = parsed.nameColors;
      continue;
    }

    if (firstToken === 'columns' && spaceIdx === -1) {
      const collected = collectIndentedValues(lines, i);
      i = collected.newIndex;
      result.columns = collected.values;
      continue;
    }

    if (firstToken === 'rows' && spaceIdx === -1) {
      const collected = collectIndentedValues(lines, i);
      i = collected.newIndex;
      result.rows = collected.values;
      continue;
    }

    // Function chart: "name expression" where name may contain parens like f(x)
    // Must use colon to separate name from expression since both can contain spaces
    if (result.type === 'function') {
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex >= 0) {
        const { label: fnName, color: fnColor } = extractColor(
          trimmed.substring(0, colonIndex).trim(),
          palette
        );
        const fnValue = trimmed.substring(colonIndex + 1).trim();
        if (!result.functions) result.functions = [];
        result.functions.push({
          name: fnName,
          expression: fnValue,
          ...(fnColor && { color: fnColor }),
          lineNumber,
        });
        continue;
      }
    }

    // Scatter chart: "Name x, y" or "Name x, y, size"
    if (result.type === 'scatter') {
      // Parse from right: trailing comma-separated numbers are x, y [, size]
      const scatterData = parseScatterRow(
        trimmed,
        palette,
        currentCategory,
        lineNumber
      );
      if (scatterData) {
        if (!result.scatterPoints) result.scatterPoints = [];
        result.scatterPoints.push(scatterData);
        continue;
      }
    }

    // Heatmap data row: "RowLabel val1, val2, val3, ..." or "RowLabel val1 val2 val3"
    if (result.type === 'heatmap') {
      const dataRow = parseDataRowValues(trimmed, { multiValue: true });
      if (dataRow && dataRow.values.length > 0) {
        if (!result.heatmapRows) result.heatmapRows = [];
        result.heatmapRows.push({
          label: dataRow.label,
          values: dataRow.values,
          lineNumber,
        });
        continue;
      }
    }

    // Funnel / generic data point: "Label value"
    const dataRow = parseDataRowValues(trimmed);
    if (dataRow?.values.length === 1) {
      const { label: rawLabel, color: pointColor } = extractColor(
        dataRow.label,
        palette
      );
      result.data.push({
        label: rawLabel,
        // In-bounds by values.length === 1 guard above.
        value: dataRow.values[0]!,
        ...(pointColor && { color: pointColor }),
        lineNumber,
      });
      continue;
    }

    // Catch-all: nothing matched this line
    result.diagnostics.push(
      makeDgmoError(lineNumber, `Unexpected line: '${trimmed}'.`, 'warning')
    );
  }

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!result.error) {
    if (result.type === 'sankey') {
      if (!result.links || result.links.length === 0) {
        warn(1, 'No links found. Add links in format: Source -> Target: 123');
      }
    } else if (result.type === 'chord') {
      if (!result.links || result.links.length === 0) {
        warn(1, 'No links found. Add links in format: Source -> Target: 123');
      }
    } else if (result.type === 'function') {
      if (!result.functions || result.functions.length === 0) {
        warn(
          1,
          'No functions found. Add functions in format: Name: expression'
        );
      }
      if (!result.xRange) {
        result.xRange = { min: -10, max: 10 }; // Default range
      }
    } else if (result.type === 'scatter') {
      if (!result.scatterPoints || result.scatterPoints.length === 0) {
        warn(
          1,
          'No scatter points found. Add points in format: Name: x, y or Name: x, y, size'
        );
      }
    } else if (result.type === 'heatmap') {
      if (!result.heatmapRows || result.heatmapRows.length === 0) {
        warn(
          1,
          'No heatmap data found. Add data in format: RowLabel: val1, val2, val3'
        );
      }
      if (!result.columns || result.columns.length === 0) {
        warn(
          1,
          'No columns defined. Add columns in format: columns: Col1, Col2, Col3'
        );
      }
    } else if (result.type === 'funnel') {
      if (result.data.length === 0) {
        warn(1, 'No data found. Add data in format: Label: value');
      }
    }
  }

  return result;
}

// ============================================================
// ECharts Option Builder
// ============================================================

/**
 * Computes the shared set of theme-derived variables used by all chart option builders.
 */
function buildChartCommons(
  parsed: { title?: string; noTitle?: boolean; error?: string | null },
  palette: PaletteColors,
  isDark: boolean,
  sc?: ScaleContext
) {
  const s = sc ?? ScaleContext.identity();
  const textColor = palette.text;
  const axisLineColor = palette.border;
  const splitLineColor = palette.border;
  const gridOpacity = isDark ? 0.7 : 0.55;
  const colors = getSeriesColors(palette);
  const titleConfig =
    parsed.title && !parsed.noTitle
      ? {
          text: parsed.title,
          left: 'center' as const,
          top: 8,
          textStyle: {
            color: textColor,
            fontSize: s.text(20),
            fontWeight: 'bold' as const,
            fontFamily: FONT_FAMILY,
          },
        }
      : undefined;
  return {
    textColor,
    axisLineColor,
    splitLineColor,
    gridOpacity,
    colors,
    titleConfig,
  };
}

/**
 * Converts a ParsedExtendedChart into an EChartsOption.
 * Handles extended chart types: scatter, sankey, chord, function, heatmap, funnel.
 * @param parsed - Result of parseExtendedChart()
 */
export function buildExtendedChartOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  isDark: boolean,
  ctx?: ScaleContext
): EChartsOption {
  if (parsed.error) {
    // Return empty option, error will be shown separately
    return {};
  }

  const sc = ctx ?? ScaleContext.identity();
  const { textColor, axisLineColor, gridOpacity, colors, titleConfig } =
    buildChartCommons(parsed, palette, isDark, sc);

  // Sankey chart has different structure
  if (parsed.type === 'sankey') {
    const bg = isDark ? palette.surface : palette.bg;
    return buildSankeyOption(parsed, textColor, colors, bg, titleConfig, sc);
  }

  // Chord diagram
  if (parsed.type === 'chord') {
    const bg = isDark ? palette.surface : palette.bg;
    return buildChordOption(
      parsed,
      palette,
      isDark,
      textColor,
      colors,
      bg,
      titleConfig,
      sc
    );
  }

  // Function plot
  if (parsed.type === 'function') {
    return buildFunctionOption(
      parsed,
      palette,
      isDark,
      textColor,
      axisLineColor,
      gridOpacity,
      colors,
      titleConfig,
      sc
    );
  }

  // Scatter plot
  if (parsed.type === 'scatter') {
    // Label rect bg matches the chart bg so it disappears against the plot area
    // while still masking connector lines behind the text.
    const bg = palette.bg;
    return buildScatterOption(
      parsed,
      palette,
      isDark,
      textColor,
      axisLineColor,
      gridOpacity,
      colors,
      bg,
      titleConfig,
      sc
    );
  }

  // Funnel chart
  if (parsed.type === 'funnel') {
    const bg = isDark ? palette.surface : palette.bg;
    return buildFunnelOption(
      parsed,
      palette,
      isDark,
      textColor,
      colors,
      bg,
      titleConfig,
      sc
    );
  }

  // Heatmap
  return buildHeatmapOption(
    parsed,
    palette,
    isDark,
    textColor,
    axisLineColor,
    titleConfig,
    ctx
  );
}

/**
 * Builds ECharts option for sankey diagrams.
 */
function buildSankeyOption(
  parsed: ParsedExtendedChart,
  textColor: string,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  sc?: ScaleContext
): EChartsOption {
  // Extract unique nodes from links
  const nodeSet = new Set<string>();
  if (parsed.links) {
    for (const link of parsed.links) {
      nodeSet.add(link.source);
      nodeSet.add(link.target);
    }
  }

  // Sankey is the only chart in dgmo with both dense parallel node-bars
  // AND many bezier links. The 75%/45% desaturation is load-bearing for
  // visual quietness; collapsing to the canonical shapeFill() 25% tint
  // washes out the layout. Verified via preview spike 2026-05-02.
  // See: tech-spec-shape-fill-standardization, TD-4.
  // sankey-baseline.test.ts asserts these literals stay intact.
  // When `solid-fill` is requested, both nodes and links use the raw
  // intent color (no desaturation) — opt-in only, default stays quiet.
  const solid = parsed.solidFill === true;
  const tintNode = (c: string) => (solid ? c : mix(c, bg, 75));
  const tintLink = (c: string) => (solid ? c : mix(c, bg, 45));

  const nodeColorMap = new Map<string, string>();
  const nodes = Array.from(nodeSet).map((name, index) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const raw = parsed.nodeColors?.[name] ?? colors[index % colors.length]!;
    const tinted = tintNode(raw);
    nodeColorMap.set(name, tintLink(raw));
    return { name, itemStyle: { color: tinted } };
  });

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    xAxis: { show: false },
    yAxis: { show: false },
    series: [
      {
        type: 'sankey',
        emphasis: {
          focus: 'adjacency',
          blurScope: 'global' as const,
          itemStyle: { opacity: 1 },
        },
        blur: BLUR_DIM,
        nodeAlign: 'left',
        nodeGap: 12,
        nodeWidth: 20,
        data: nodes,
        links: (parsed.links ?? []).map((link) => {
          const linkColor = link.color
            ? tintLink(link.color)
            : nodeColorMap.get(link.source);
          return {
            source: link.source,
            target: link.target,
            value: link.value,
            lineStyle: {
              ...(linkColor !== undefined && { color: linkColor }),
            },
          };
        }),
        lineStyle: {
          curveness: 0.5,
          opacity: 0.6,
        },
        label: {
          color: textColor,
          fontSize: (sc ?? ScaleContext.identity()).text(12),
        },
      },
    ],
  };
}

/**
 * Builds ECharts option for chord diagrams.
 */
function buildChordOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  colors: string[],
  _bg: string,
  titleConfig: EChartsOption['title'],
  sc?: ScaleContext
): EChartsOption {
  // Extract unique nodes from links
  const nodeSet = new Set<string>();
  if (parsed.links) {
    for (const link of parsed.links) {
      nodeSet.add(link.source);
      nodeSet.add(link.target);
    }
  }

  const nodeNames = Array.from(nodeSet);
  const nodeCount = nodeNames.length;

  // Build adjacency matrix
  const matrix: number[][] = Array(nodeCount)
    .fill(null)
    .map(() => Array(nodeCount).fill(0));

  if (parsed.links) {
    for (const link of parsed.links) {
      const sourceIndex = nodeNames.indexOf(link.source);
      const targetIndex = nodeNames.indexOf(link.target);
      if (sourceIndex !== -1 && targetIndex !== -1) {
        // sourceIndex/targetIndex are valid (indexOf !== -1) and matrix rows
        // were pre-allocated to nodeCount entries above.
        matrix[sourceIndex]![targetIndex] = link.value;
      }
    }
  }

  // Create category data for nodes with colors
  const categories = nodeNames.map((name, index) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const stroke = colors[index % colors.length]!;
    return {
      name,
      itemStyle: {
        color: shapeFill(palette, stroke, isDark, {
          solid: parsed.solidFill === true,
        }),
        borderColor: stroke,
        borderWidth: CHART_BORDER_WIDTH,
      },
    };
  });

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    xAxis: { show: false },
    yAxis: { show: false },
    series: [
      {
        type: 'graph',
        layout: 'circular',
        circular: {
          rotateLabel: true,
        },
        center: ['50%', '55%'],
        width: '60%',
        height: '60%',
        data: categories.map((cat) => ({
          name: cat.name,
          symbolSize: (sc ?? ScaleContext.identity()).structural(20),
          itemStyle: cat.itemStyle,
          label: {
            show: true,
            color: textColor,
          },
        })),
        links: (() => {
          const allLinks = parsed.links ?? [];
          // Detect opposing link pairs to offset curvatures
          const pairKeys = new Set<string>();
          for (const l of allLinks) {
            const rev = allLinks.find(
              (r) => r.source === l.target && r.target === l.source && r !== l
            );
            if (rev) pairKeys.add(`${l.source}\0${l.target}`);
          }
          return allLinks.map((link) => {
            const hasOpposite = pairKeys.has(`${link.source}\0${link.target}`);
            // Offset curvature for opposing pairs: one curves more, the other less
            const baseCurve = 0.3;
            const curveness = hasOpposite
              ? link.source < link.target
                ? baseCurve + 0.15
                : baseCurve - 0.15
              : baseCurve;
            return {
              source: link.source,
              target: link.target,
              value: link.value,
              ...(link.directed && {
                symbol: ['none', 'arrow'],
                symbolSize: [0, 10],
              }),
              lineStyle: {
                width: Math.max(1, Math.min(link.value / 20, 10)),
                // colors is a non-empty palette array; modulo index is always in-bounds.
                color: colors[nodeNames.indexOf(link.source) % colors.length]!,
                curveness,
                opacity: 0.6,
              },
            };
          });
        })(),
        roam: false,
        label: {
          position: 'right',
          formatter: '{b}',
        },
        emphasis: {
          focus: 'adjacency',
          itemStyle: { opacity: 1 },
          lineStyle: {
            width: 5,
            opacity: 1,
          },
        },
        blur: BLUR_DIM,
      },
    ],
  };
}

/**
 * Evaluates a mathematical expression for a given x value.
 * Supports: +, -, *, /, ^, sin, cos, tan, log, ln, exp, sqrt, abs, pi, e
 */
function evaluateExpression(expr: string, x: number): number {
  try {
    // Replace mathematical constants and functions
    const processed = expr
      .replace(/\bpi\b/gi, String(Math.PI))
      .replace(/\be\b/g, String(Math.E))
      .replace(/\bsin\s*\(/gi, 'Math.sin(')
      .replace(/\bcos\s*\(/gi, 'Math.cos(')
      .replace(/\btan\s*\(/gi, 'Math.tan(')
      .replace(/\bln\s*\(/gi, 'Math.log(')
      .replace(/\blog\s*\(/gi, 'Math.log10(')
      .replace(/\bexp\s*\(/gi, 'Math.exp(')
      .replace(/\bsqrt\s*\(/gi, 'Math.sqrt(')
      .replace(/\babs\s*\(/gi, 'Math.abs(')
      .replace(/\bx\b/gi, `(${x})`)
      .replace(/\^/g, '**');

    // Evaluate the expression
    const result = new Function(`return ${processed}`)() as unknown;
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Builds ECharts option for function plots.
 */
function buildFunctionOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  _isDark: boolean,
  textColor: string,
  axisLineColor: string,
  gridOpacity: number,
  colors: string[],
  titleConfig: EChartsOption['title'],
  sc?: ScaleContext
): EChartsOption {
  const xRange = parsed.xRange ?? { min: -10, max: 10 };
  const samples = 200;
  const step = (xRange.max - xRange.min) / samples;

  // Generate x values
  const xValues: number[] = [];
  for (let i = 0; i <= samples; i++) {
    xValues.push(xRange.min + i * step);
  }

  // Generate series for each function
  const series = (parsed.functions ?? []).map((fn, index) => {
    const data = xValues.map((x) => {
      const y = evaluateExpression(fn.expression, x);
      return [x, y];
    });

    // colors is a non-empty palette array; modulo index is always in-bounds.
    const fnColor = fn.color ?? colors[index % colors.length]!;
    return {
      name: fn.name,
      type: 'line' as const,
      // Invisible symbols at every sample act as hit targets so mouseover
      // fires reliably along the curve (a thin line is a near-impossible
      // target on its own). Transparent fill + zero border keeps them
      // hidden in the base state; the hovered point becomes visible via
      // emphasis below, marking the precise hover position.
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 12,
      smooth: true,
      data,
      lineStyle: {
        width: 2,
        color: fnColor,
      },
      itemStyle: {
        color: 'transparent',
        borderColor: 'transparent',
        borderWidth: 0,
      },
      ...(parsed.shade && {
        areaStyle: {
          color: fnColor,
          opacity: 0.15,
        },
      }),
      emphasis: {
        ...EMPHASIS_SELF,
        itemStyle: { color: fnColor, opacity: 1 },
      },
      blur: BLUR_DIM,
    };
  });

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    legend: {
      data: (parsed.functions ?? []).map((fn) => fn.name),
      bottom: 10,
      textStyle: {
        color: textColor,
      },
    },
    grid: makeChartGrid({
      xLabel: parsed.xlabel,
      yLabel: parsed.ylabel,
      hasTitle: !!(parsed.title && !parsed.noTitle),
      hasLegend: (parsed.functions ?? []).length > 0,
    }),
    xAxis: {
      type: 'value',
      min: xRange.min,
      max: xRange.max,
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: (sc ?? ScaleContext.identity()).text(16),
      },
      splitLine: {
        lineStyle: {
          color: palette.border,
          opacity: gridOpacity,
        },
      },
    },
    yAxis: {
      type: 'value',
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: (sc ?? ScaleContext.identity()).text(16),
      },
      splitLine: {
        lineStyle: {
          color: palette.border,
          opacity: gridOpacity,
        },
      },
    },
    series,
  };
}

/**
 * Extracts legend group data from standard chart types (multi-line, bar-stacked).
 * Returns empty array if chart has no multi-series legend.
 */
export function getSimpleChartLegendGroups(
  parsed: ParsedChart,
  colors: string[]
): LegendGroupData[] {
  if (!parsed.seriesNames || parsed.seriesNames.length <= 1) return [];
  return [
    {
      name: 'Series',
      entries: parsed.seriesNames.map((name, i) => ({
        value: name,
        // colors is a non-empty palette array; modulo index is always in-bounds.
        color: parsed.seriesNameColors?.[i] ?? colors[i % colors.length]!,
      })),
    },
  ];
}

/**
 * Extracts legend group data from extended chart types.
 * Supports scatter (categories), chord (nodes), and function (series).
 */
export function getExtendedChartLegendGroups(
  parsed: ParsedExtendedChart,
  colors: string[]
): LegendGroupData[] {
  if (parsed.type === 'scatter') {
    const points = parsed.scatterPoints ?? [];
    const categories = [
      ...new Set(points.map((p) => p.category).filter(Boolean)),
    ] as string[];
    if (categories.length === 0) return [];
    return [
      {
        name: 'Group',
        entries: categories.map((cat, i) => ({
          value: cat,
          // colors is a non-empty palette array; modulo index is always in-bounds.
          color: parsed.categoryColors?.[cat] ?? colors[i % colors.length]!,
        })),
      },
    ];
  }

  if (parsed.type === 'function') {
    const fns = parsed.functions ?? [];
    if (fns.length === 0) return [];
    return [
      {
        name: 'Function',
        entries: fns.map((fn, i) => ({
          value: fn.name,
          // colors is a non-empty palette array; modulo index is always in-bounds.
          color: fn.color ?? colors[i % colors.length]!,
        })),
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Scatter label collision avoidance — greedy placement algorithm
// ---------------------------------------------------------------------------

export interface ScatterLabelPoint {
  name: string;
  px: number;
  py: number;
  color: string;
  size?: number; // per-point symbol size (for bubble charts)
}

/**
 * Greedy label placement for scatter charts.
 * Returns ECharts `graphic` elements (text + background rects + optional connector lines).
 * Pure function — no ECharts instance dependency.
 *
 * @param bg - chart background color, used for label background rects that mask connector lines
 */
export function computeScatterLabelGraphics(
  points: ScatterLabelPoint[],
  chartBounds: { top: number; bottom: number },
  fontSize: number,
  symbolSize: number,
  bg?: string
): Record<string, unknown>[] {
  const labelHeight = fontSize + 4;
  const stepSize = labelHeight + 2;

  // Build collision circles for ALL points (per-point size for bubble charts)
  const pointCircles: PointCircle[] = points.map((p) => ({
    cx: p.px,
    cy: p.py,
    r: (p.size ?? symbolSize) / 2,
  }));

  const placedLabels: LabelRect[] = [];
  const elements: Record<string, unknown>[] = [];

  for (let i = 0; i < points.length; i++) {
    // In-bounds by loop guard (i < points.length).
    const pt = points[i]!;
    const ptSize = pt.size ?? symbolSize;
    const minGap = ptSize / 2 + 4;
    const labelWidth = pt.name.length * fontSize * 0.6 + 8;
    const labelX = pt.px - labelWidth / 2; // centered horizontally

    // Try both directions, pick whichever keeps the label closest to the point
    let bestLabelY = 0;
    let bestOffset = Infinity;
    let placed = false;

    for (const dir of [-1, 1]) {
      for (let offset = minGap; ; offset += stepSize) {
        const labelY =
          dir === -1
            ? pt.py - offset - labelHeight // above: label bottom edge is offset above point center
            : pt.py + offset; // below: label top edge is offset below point center

        // Check chart bounds
        if (
          labelY < chartBounds.top ||
          labelY + labelHeight > chartBounds.bottom
        )
          break;

        const candidate: LabelRect = {
          x: labelX,
          y: labelY,
          w: labelWidth,
          h: labelHeight,
        };

        // Check collisions with all placed labels
        let collision = false;
        for (const pl of placedLabels) {
          if (rectsOverlap(candidate, pl)) {
            collision = true;
            break;
          }
        }

        // Check collisions with all point circles
        if (!collision) {
          for (const circle of pointCircles) {
            if (rectCircleOverlap(candidate, circle)) {
              collision = true;
              break;
            }
          }
        }

        if (!collision) {
          // Found closest slot in this direction — keep if it beats the other
          if (offset < bestOffset) {
            bestOffset = offset;
            bestLabelY = labelY;
          }
          placed = true;
          break; // best for this direction found, try the other
        }
      }
    }

    // Fallback: try above first, then below — prefer whichever is within bounds
    if (!placed) {
      const aboveY = pt.py - minGap - labelHeight;
      const belowY = pt.py + minGap;
      if (aboveY >= chartBounds.top) {
        bestLabelY = aboveY;
      } else if (belowY + labelHeight <= chartBounds.bottom) {
        bestLabelY = belowY;
      } else {
        bestLabelY = aboveY; // last resort — may clip
      }
    }

    const labelRect: LabelRect = {
      x: labelX,
      y: bestLabelY,
      w: labelWidth,
      h: labelHeight,
    };
    placedLabels.push(labelRect);

    const textY = bestLabelY + labelHeight / 2;

    // Connector line (z=1, rendered below labels)
    const isAbove = bestLabelY + labelHeight <= pt.py;
    const pointEdge = isAbove ? pt.py - ptSize / 2 : pt.py + ptSize / 2;
    const labelEdge = isAbove ? bestLabelY + labelHeight : bestLabelY;
    const gap = Math.abs(pointEdge - labelEdge);

    if (gap > 4) {
      elements.push({
        type: 'line',
        id: `scatter-line-${i}`,
        z: 1,
        shape: {
          x1: pt.px,
          y1: pointEdge,
          x2: pt.px,
          y2: labelEdge,
        },
        style: {
          stroke: pt.color,
          lineWidth: 1,
        },
        silent: true,
      });
    }

    // Background rect (z=2, masks connector lines behind label text)
    if (bg) {
      const bgPad = 2;
      elements.push({
        type: 'rect',
        id: `scatter-bg-${i}`,
        z: 2,
        shape: {
          x: labelX - bgPad,
          y: bestLabelY - bgPad,
          width: labelWidth + bgPad * 2,
          height: labelHeight + bgPad * 2,
        },
        style: { fill: bg },
        silent: true,
      });
    }

    // Text element (z=3, rendered on top). The text fill is the point color,
    // which in solid-fill mode matches the bubble fill exactly → invisible on
    // the bubble. Add a paint-order halo using the chart bg so the text stays
    // readable whether it lands on the plot bg, on a connector line, or
    // partially on a same-colored bubble.
    elements.push({
      type: 'text',
      id: `scatter-label-${i}`,
      z: 3,
      x: pt.px,
      y: textY,
      style: {
        text: pt.name,
        fill: pt.color,
        ...(bg && {
          stroke: bg,
          lineWidth: 3,
          paintOrder: 'stroke',
        }),
        fontSize,
        fontFamily: FONT_FAMILY,
        textAlign: 'center',
        textVerticalAlign: 'middle',
      },
      silent: true,
    });
  }

  return elements;
}

/**
 * Convert data coordinates to pixel coordinates using linear interpolation.
 * For SSR path where chart instance is not available for convertToPixel.
 */
function dataToPixel(
  dataX: number,
  dataY: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  gridLeftPct: number,
  gridRightPct: number,
  gridTopPct: number,
  gridBottomPct: number,
  chartWidth: number,
  chartHeight: number
): { px: number; py: number } {
  // containLabel: true shrinks the plot area — apply conservative 30px inset
  const inset = 30;
  const gridLeftPx = (gridLeftPct * chartWidth) / 100 + inset;
  const gridRightPx = chartWidth - (gridRightPct * chartWidth) / 100 - inset;
  const gridTopPx = (gridTopPct * chartHeight) / 100 + inset;
  const gridBottomPx =
    chartHeight - (gridBottomPct * chartHeight) / 100 - inset;
  const plotWidth = gridRightPx - gridLeftPx;
  const plotHeight = gridBottomPx - gridTopPx;

  const px = gridLeftPx + ((dataX - xMin) / (xMax - xMin)) * plotWidth;
  const py = gridTopPx + ((yMax - dataY) / (yMax - yMin)) * plotHeight;
  return { px, py };
}

/**
 * Builds ECharts option for scatter plots.
 * Auto-detects categories and size from point data:
 * - hasCategories → multi-series with legend (one per category)
 * - hasSize → dynamic symbol sizing from 3rd value
 */
function buildScatterOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  axisLineColor: string,
  gridOpacity: number,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const points = parsed.scatterPoints ?? [];
  const defaultSize = s.structural(15);

  const hasCategories = points.some((p) => p.category !== undefined);
  const hasSize = points.some((p) => p.size !== undefined);

  const showLabels = !parsed.noName;
  const labelFontSize = 11;

  // When showLabels is on, we render labels ourselves via graphic — disable ECharts labels
  const labelConfig = {
    show: false,
    formatter: '{b}',
    position: 'top' as const,
    color: textColor,
    fontSize: labelFontSize,
  };

  const emphasisConfig = {
    focus: 'self' as const,
    itemStyle: { opacity: 1 },
  };
  const blurConfig = BLUR_DIM;

  // Build series based on whether categories are present
  let series;

  if (hasCategories) {
    const categories = [
      ...new Set(points.map((p) => p.category).filter(Boolean)),
    ] as string[];

    series = categories.map((category, catIndex) => {
      const categoryPoints = points.filter((p) => p.category === category);
      // colors is a non-empty palette array; modulo index is always in-bounds.
      const catColor =
        parsed.categoryColors?.[category] ?? colors[catIndex % colors.length]!;

      const data = categoryPoints.map((p) => ({
        name: p.name,
        value: hasSize ? [p.x, p.y, p.size ?? 0] : [p.x, p.y],
        ...(p.color && {
          itemStyle: {
            color: shapeFill(palette, p.color, isDark, {
              solid: parsed.solidFill === true,
            }),
            borderColor: p.color,
            borderWidth: CHART_BORDER_WIDTH,
          },
        }),
      }));

      return {
        name: category,
        type: 'scatter' as const,
        data,
        ...(hasSize
          ? // val[2] is guaranteed by hasSize (every point has size) — ECharts
            // builds val from [p.x, p.y, p.size ?? 0] above.
            { symbolSize: (val: number[]) => val[2]! }
          : { symbolSize: defaultSize }),
        itemStyle: {
          color: shapeFill(palette, catColor, isDark, {
            solid: parsed.solidFill === true,
          }),
          borderColor: catColor,
          borderWidth: CHART_BORDER_WIDTH,
        },
        label: labelConfig,
        emphasis: emphasisConfig,
        blur: blurConfig,
      };
    });
  } else {
    // Single series — per-point colors
    const data = points.map((p, index) => {
      // colors is a non-empty palette array; modulo index is always in-bounds.
      const stroke = p.color ?? colors[index % colors.length]!;
      return {
        name: p.name,
        value: hasSize ? [p.x, p.y, p.size ?? 0] : [p.x, p.y],
        ...(hasSize
          ? { symbolSize: p.size ?? defaultSize }
          : { symbolSize: defaultSize }),
        itemStyle: {
          color: shapeFill(palette, stroke, isDark, {
            solid: parsed.solidFill === true,
          }),
          borderColor: stroke,
          borderWidth: CHART_BORDER_WIDTH,
        },
      };
    });

    series = [
      {
        type: 'scatter' as const,
        data,
        label: labelConfig,
        emphasis: emphasisConfig,
        blur: blurConfig,
      },
    ];
  }

  // Auto-fit axes to data range with ~10% padding
  const xValues = points.map((p) => p.x);
  const yValues = points.map((p) => p.y);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;

  const axisXMin = Math.floor(xMin - xPad);
  const axisXMax = Math.ceil(xMax + xPad);
  const axisYMin = Math.floor(yMin - yPad);
  const axisYMax = Math.ceil(yMax + yPad);

  const gridLeft = parsed.ylabel ? 12 : 3;
  const gridRight = 4;
  const gridBottom = hasCategories ? 15 : parsed.xlabel ? 10 : 3;
  const gridTop = parsed.title && !parsed.noTitle ? 15 : 5;

  // Compute custom label graphics for SSR when labels are enabled
  let graphic: Record<string, unknown>[] | undefined;
  if (showLabels && points.length > 0) {
    // Collect label points with resolved colors
    const labelPoints: ScatterLabelPoint[] = [];
    if (hasCategories) {
      const categories = [
        ...new Set(points.map((p) => p.category).filter(Boolean)),
      ] as string[];
      for (let idx = 0; idx < points.length; idx++) {
        // In-bounds by loop guard (idx < points.length).
        const pt = points[idx]!;
        const catIndex = pt.category ? categories.indexOf(pt.category) : -1;
        // colors is a non-empty palette array; modulo index is always in-bounds.
        const catColor = pt.category
          ? (parsed.categoryColors?.[pt.category] ??
            colors[catIndex % colors.length]!)
          : colors[idx % colors.length]!;
        const color = pt.color ?? catColor;
        const { px, py } = dataToPixel(
          pt.x,
          pt.y,
          axisXMin,
          axisXMax,
          axisYMin,
          axisYMax,
          gridLeft,
          gridRight,
          gridTop,
          gridBottom,
          ECHART_EXPORT_WIDTH,
          ECHART_EXPORT_HEIGHT
        );
        labelPoints.push({
          name: pt.name,
          px,
          py,
          color,
          ...(pt.size !== undefined && { size: pt.size }),
        });
      }
    } else {
      points.forEach((pt, index) => {
        // colors is a non-empty palette array; modulo index is always in-bounds.
        const color = pt.color ?? colors[index % colors.length]!;
        const { px, py } = dataToPixel(
          pt.x,
          pt.y,
          axisXMin,
          axisXMax,
          axisYMin,
          axisYMax,
          gridLeft,
          gridRight,
          gridTop,
          gridBottom,
          ECHART_EXPORT_WIDTH,
          ECHART_EXPORT_HEIGHT
        );
        labelPoints.push({
          name: pt.name,
          px,
          py,
          color,
          ...(pt.size !== undefined && { size: pt.size }),
        });
      });
    }

    const chartBoundsTop = (gridTop * ECHART_EXPORT_HEIGHT) / 100;
    const chartBoundsBottom =
      ECHART_EXPORT_HEIGHT - (gridBottom * ECHART_EXPORT_HEIGHT) / 100;
    graphic = computeScatterLabelGraphics(
      labelPoints,
      { top: chartBoundsTop, bottom: chartBoundsBottom },
      labelFontSize,
      defaultSize,
      bg
    );
  }

  // Build legend for categorized scatter charts
  const categories = hasCategories
    ? ([...new Set(points.map((p) => p.category).filter(Boolean))] as string[])
    : [];
  const legendConfig =
    categories.length > 0
      ? { data: categories, bottom: 10, textStyle: { color: textColor } }
      : undefined;

  // Hover behavior is wired in the consumer (diagrammo-app's EChartsPreview)
  // via mouseover/mouseout handlers that render crosshair graphics. Doing it
  // there gives strict point-only scoping that the option-config approach
  // (axisPointer cross) can't deliver — it always fires on plain mousemove.
  // Static exports get no hover (correctly).

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    ...(legendConfig && { legend: legendConfig }),
    grid: {
      left: `${gridLeft}%`,
      right: `${gridRight}%`,
      bottom: `${gridBottom}%`,
      top: `${gridTop}%`,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      ...(parsed.xlabel !== undefined && { name: parsed.xlabel }),
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: {
        color: textColor,
        fontSize: s.text(18),
      },
      min: axisXMin,
      max: axisXMax,
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: s.text(16),
      },
      splitLine: {
        lineStyle: {
          color: palette.border,
          opacity: gridOpacity,
        },
      },
    },
    yAxis: {
      type: 'value',
      ...(parsed.ylabel !== undefined && { name: parsed.ylabel }),
      nameLocation: 'middle',
      nameGap: 50,
      nameTextStyle: {
        color: textColor,
        fontSize: s.text(18),
      },
      min: axisYMin,
      max: axisYMax,
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: s.text(16),
      },
      splitLine: {
        lineStyle: {
          color: palette.border,
          opacity: gridOpacity,
        },
      },
    },
    series,
    ...(graphic && { graphic }),
  };
}

/**
 * Builds ECharts option for heatmap charts.
 */
function buildHeatmapOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  axisLineColor: string,
  titleConfig: EChartsOption['title'],
  ctx?: ScaleContext
): EChartsOption {
  const sc = ctx ?? ScaleContext.identity();
  const bg = isDark ? palette.surface : palette.bg;
  const heatmapRows = parsed.heatmapRows ?? [];
  const columns = parsed.columns ?? [];
  const rowLabels = heatmapRows.map((r) => r.label);

  // First pass: compute value range for the visualMap gradient.
  let minValue = Infinity;
  let maxValue = -Infinity;
  heatmapRows.forEach((row) => {
    row.values.forEach((value) => {
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    });
  });

  // Mirror the visualMap gradient so we can derive per-cell label tints
  // matching the cell fill.
  const gradientStops = [
    shapeFill(palette, palette.primary, isDark),
    shapeFill(palette, palette.colors.cyan, isDark),
    shapeFill(palette, palette.colors.yellow, isDark),
    shapeFill(palette, palette.colors.orange, isDark),
  ];
  const gradientAt = (t: number): string => {
    // In-bounds: gradientStops is a 4-element literal; length === 1 guard for [0],
    // and idx is clamped to length-2 so idx and idx+1 are both valid.
    if (gradientStops.length === 1) return gradientStops[0]!;
    const tt = Math.max(0, Math.min(1, t));
    const seg = 1 / (gradientStops.length - 1);
    const idx = Math.min(gradientStops.length - 2, Math.floor(tt / seg));
    const localT = (tt - idx * seg) / seg;
    return mix(gradientStops[idx + 1]!, gradientStops[idx]!, localT * 100);
  };
  const labelTint = (cellColor: string): string => {
    const { h, s } = hexToHSL(cellColor);
    // Pull saturation up so the tint reads as colored, not gray. Push
    // lightness toward the bright end on dark themes and the deep end on
    // light themes — keeps the label clearly a variation of the cell color.
    const targetS = Math.min(75, Math.max(s + 25, 50));
    const targetL = isDark ? 72 : 30;
    return hslToHex(h, targetS, targetL);
  };

  type HeatmapDatum = {
    value: [number, number, number];
    label: { color: string };
    emphasis: { label: { color: string } };
    blur: { label: { color: string } };
  };
  const data: HeatmapDatum[] = [];
  heatmapRows.forEach((row, rowIndex) => {
    row.values.forEach((value, colIndex) => {
      const t =
        maxValue === minValue
          ? 0.5
          : (value - minValue) / (maxValue - minValue);
      const tint = labelTint(gradientAt(t));
      // Repeat the tint in emphasis/blur so ECharts state changes (triggered
      // by hover, including the row/col handler in the app layer) don't
      // reset label color back to the series default.
      data.push({
        value: [colIndex, rowIndex, value],
        label: { color: tint },
        emphasis: { label: { color: tint } },
        blur: { label: { color: tint } },
      });
    });
  });

  // Rotate column labels only when they'd overlap at the default font size.
  // Estimate: each char ~7px at 12px font; rotate if longest label exceeds
  // an even share of a ~900px-wide chart.
  const CHAR_WIDTH = 7;
  const ESTIMATED_CHART_WIDTH = 900;
  const scaledChartWidth = sc.structural(ESTIMATED_CHART_WIDTH);
  const longestCol = Math.max(...columns.map((c) => c.length), 0);
  const slotWidth =
    columns.length > 0 ? scaledChartWidth / columns.length : Infinity;
  const needsRotation = longestCol * CHAR_WIDTH > slotWidth * 0.85;

  const ESTIMATED_PLOT_W = 770;
  const ESTIMATED_PLOT_H = 380;
  const scaledPlotW = sc.structural(ESTIMATED_PLOT_W);
  const scaledPlotH = sc.structural(ESTIMATED_PLOT_H);
  const cellW = columns.length > 0 ? scaledPlotW / columns.length : scaledPlotW;
  const cellH =
    heatmapRows.length > 0 ? scaledPlotH / heatmapRows.length : scaledPlotH;
  const maxValueChars = Math.max(
    1,
    ...heatmapRows.flatMap((r) => r.values.map((v) => String(v).length))
  );
  const fontFromWidth = (cellW * 0.75) / (maxValueChars * 0.55);
  const fontFromHeight = (cellH * 0.75) / 0.72;
  const cellFontFloor = sc.text(16);
  const labelFontSize = Math.max(
    cellFontFloor,
    Math.min(72, Math.floor(Math.min(fontFromWidth, fontFromHeight)))
  );

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    grid: {
      left: '3%',
      right: '3%',
      bottom: '3%',
      top: parsed.title && !parsed.noTitle ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: columns,
      position: 'top',
      splitArea: {
        show: false,
      },
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: sc.text(12),
        interval: 0,
        ...(needsRotation && {
          rotate: -45,
          width: 200,
          overflow: 'none' as const,
        }),
      },
    },
    yAxis: {
      type: 'category',
      data: rowLabels,
      inverse: true,
      splitArea: {
        show: false,
      },
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: sc.text(12),
        interval: 0,
      },
    },
    visualMap: {
      show: false,
      min: minValue,
      max: maxValue,
      // Heatmap INTENTIONALLY ignores `solid-fill`. The cell color IS the
      // value gradient — solid mode collapses each color into its full
      // intent and ECharts interpolates between them, producing high-saturation
      // cells where text is unreadable. Same opt-out as gantt and infra.
      inRange: {
        color: gradientStops,
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: {
          borderWidth: 2,
          borderColor: bg,
        },
        label: {
          // Per-cell `label.color` is set in `data` above (a tint of each
          // cell's gradient color). textColor here is just a fallback.
          show: !parsed.noValue,
          color: textColor,
          fontSize: labelFontSize,
          fontWeight: 'bold' as const,
        },
        // Hovered cell: stay as-is (label color comes from per-cell tint).
        emphasis: {
          itemStyle: { opacity: 1 },
        },
        // Non-hovered cells (set by the app's heatmap-hover handler): dim
        // heavily. Row/col matches get a lighter dim applied at runtime
        // via `dispatchAction({ type: 'highlight' })`.
        blur: {
          itemStyle: { opacity: 0.25 },
        },
      },
    ],
  };
}

/**
 * Builds ECharts option for funnel charts.
 */
function buildFunnelOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  colors: string[],
  _bg: string,
  titleConfig: EChartsOption['title'],
  sc?: ScaleContext
): EChartsOption {
  // Sort data descending by value for funnel ordering
  const sorted = [...parsed.data].sort((a, b) => b.value - a.value);

  const data = sorted.map((d) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const stroke = d.color ?? colors[parsed.data.indexOf(d) % colors.length]!;
    return {
      name: d.label,
      value: d.value,
      itemStyle: {
        color: shapeFill(palette, stroke, isDark, {
          solid: parsed.solidFill === true,
        }),
        borderColor: stroke,
        borderWidth: CHART_BORDER_WIDTH,
      },
    };
  });

  // Build lookup for tooltip: previous step value (in sorted order)
  const prevValueMap = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    // In-bounds by loop guard (i < sorted.length); i-1 valid when i > 0.
    prevValueMap.set(
      sorted[i]!.label,
      i > 0 ? sorted[i - 1]!.value : sorted[i]!.value
    );
  }

  const funnelTop = parsed.title && !parsed.noTitle ? 60 : 20;
  const funnelLayout = {
    left: '20%',
    top: funnelTop,
    bottom: 20,
    width: '60%',
    sort: 'descending' as const,
    gap: 0,
    minSize: '8%',
  };

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    xAxis: { show: false },
    yAxis: { show: false },
    series: [
      {
        type: 'funnel',
        ...funnelLayout,
        label: {
          show: !parsed.noName,
          position: 'left',
          formatter: '{b}',
          color: textColor,
          fontSize: (sc ?? ScaleContext.identity()).text(13),
        },
        labelLine: {
          show: !parsed.noName,
          length: 10,
          lineStyle: { color: textColor, opacity: 0.3 },
        },
        emphasis: {
          ...EMPHASIS_SELF,
        },
        blur: BLUR_DIM,
        data,
      },
      {
        type: 'funnel',
        ...funnelLayout,
        silent: true,
        itemStyle: { color: 'transparent', borderWidth: 0 },
        label: {
          show: !parsed.noValue,
          position: 'right',
          formatter: '{c}',
          color: textColor,
          fontSize: (sc ?? ScaleContext.identity()).text(13),
        },
        labelLine: {
          show: !parsed.noValue,
          length: 10,
          lineStyle: { color: textColor, opacity: 0.3 },
        },
        emphasis: { disabled: true },
        data: data.map((d) => ({
          ...d,
          itemStyle: { color: 'transparent', borderWidth: 0 },
        })),
      },
    ],
  };
}

// ============================================================
// Standard Chart → ECharts Option Builder
// ============================================================

/**
 * Resolves axis labels from parsed chart orientation/xlabel/ylabel/label.
 */
function resolveAxisLabels(parsed: ParsedChart): {
  xLabel?: string;
  yLabel?: string;
} {
  const isHorizontal = parsed.orientation === 'horizontal';
  const xLabel = parsed.xlabel ?? (isHorizontal ? parsed.label : undefined);
  const yLabel = parsed.ylabel ?? (isHorizontal ? undefined : parsed.label);
  return {
    ...(xLabel !== undefined && { xLabel }),
    ...(yLabel !== undefined && { yLabel }),
  };
}

/**
 * Produces a reusable axis config object for category or value axes.
 */
function makeGridAxis(
  type: 'category' | 'value',
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  label?: string,
  data?: string[],
  nameGapOverride?: number,
  chartWidthHint?: number,
  intervalOverride?: number,
  sc?: ScaleContext
): Record<string, unknown> {
  const s = sc ?? ScaleContext.identity();
  const defaultGap = type === 'value' ? 75 : 40;

  // Compute category label sizing: font size and width constraint
  let catFontSize = 16;
  let catLabelExtras: Record<string, unknown> = {};
  if (type === 'category' && data && data.length > 0) {
    const maxLabelLen = Math.max(...data.map((l) => l.length));
    const count = data.length;
    // When interval skips labels, base sizing on visible count (≈ count / step)
    const step =
      intervalOverride != null && intervalOverride > 0
        ? intervalOverride + 1
        : 1;
    const visibleCount = Math.ceil(count / step);
    // Reduce font size based on density and label length
    if (visibleCount > 10 || maxLabelLen > 20) catFontSize = 10;
    else if (visibleCount > 5 || maxLabelLen > 14) catFontSize = 11;
    else if (maxLabelLen > 8) catFontSize = 12;

    // Constrain labels to their allotted slot width so ECharts wraps instead of hiding.
    // Skip when interval > 0 — visible labels are spread out and need no constraint.
    if (
      (intervalOverride == null || intervalOverride === 0) &&
      chartWidthHint &&
      count > 0
    ) {
      const availPerLabel = Math.floor((chartWidthHint * 0.85) / count);
      catLabelExtras = {
        width: availPerLabel,
        overflow: 'break',
      };
    }
  }

  return {
    type,
    ...(data && { data }),
    axisLine: { lineStyle: { color: axisLineColor } },
    axisLabel: {
      color: textColor,
      fontSize: s.text(type === 'category' && data ? catFontSize : 16),
      fontFamily: FONT_FAMILY,
      ...(type === 'category' && {
        interval: intervalOverride ?? 0,
        // Prevent ECharts auto-rotation: it measures raw slot width (chartWidth/N),
        // which is too narrow when an interval skips most labels, and rotates to 90°.
        rotate: 0,
        formatter: (value: string) =>
          value.replace(/([a-z])([A-Z])/g, '$1\n$2'),
        ...catLabelExtras,
      }),
    },
    splitLine: { lineStyle: { color: splitLineColor, opacity: gridOpacity } },
    ...(label && {
      name: label,
      nameLocation: 'middle',
      nameGap: nameGapOverride ?? defaultGap,
      nameTextStyle: {
        color: textColor,
        fontSize: s.text(18),
        fontFamily: FONT_FAMILY,
      },
    }),
  };
}

/**
 * Converts a ParsedChart into an EChartsOption.
 * Handles standard chart types: bar, line, area, pie, doughnut, radar, polar-area, bar-stacked, multi-line.
 * @param parsed - Result of parseChart()
 */
export function buildSimpleChartOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  isDark: boolean,
  chartWidth?: number,
  ctx?: ScaleContext
): EChartsOption {
  if (parsed.error) return {};

  const sc = ctx ?? ScaleContext.identity();
  const {
    textColor,
    axisLineColor,
    splitLineColor,
    gridOpacity,
    colors,
    titleConfig,
  } = buildChartCommons(parsed, palette, isDark, sc);
  const bg = isDark ? palette.surface : palette.bg;

  switch (parsed.type) {
    case 'bar':
      return buildBarOption(
        parsed,
        palette,
        isDark,
        textColor,
        axisLineColor,
        splitLineColor,
        gridOpacity,
        colors,
        bg,
        titleConfig,
        chartWidth,
        sc
      );
    case 'bar-stacked':
      return buildBarStackedOption(
        parsed,
        palette,
        isDark,
        textColor,
        axisLineColor,
        splitLineColor,
        gridOpacity,
        colors,
        bg,
        titleConfig,
        chartWidth,
        sc
      );
    case 'line':
      return parsed.seriesNames
        ? buildMultiLineOption(
            parsed,
            palette,
            textColor,
            axisLineColor,
            splitLineColor,
            gridOpacity,
            colors,
            titleConfig,
            chartWidth,
            sc
          )
        : buildLineOption(
            parsed,
            palette,
            textColor,
            axisLineColor,
            splitLineColor,
            gridOpacity,
            titleConfig,
            chartWidth,
            sc
          );
    case 'area':
      return buildAreaOption(
        parsed,
        palette,
        textColor,
        axisLineColor,
        splitLineColor,
        gridOpacity,
        titleConfig,
        chartWidth,
        sc
      );
    case 'pie':
      return buildPieOption(
        parsed,
        palette,
        isDark,
        textColor,
        getSegmentColors(palette, parsed.data.length),
        bg,
        titleConfig,
        false,
        sc
      );
    case 'doughnut':
      return buildPieOption(
        parsed,
        palette,
        isDark,
        textColor,
        getSegmentColors(palette, parsed.data.length),
        bg,
        titleConfig,
        true,
        sc
      );
    case 'radar':
      return buildRadarOption(
        parsed,
        palette,
        isDark,
        textColor,
        gridOpacity,
        titleConfig,
        sc
      );
    case 'polar-area':
      return buildPolarAreaOption(
        parsed,
        palette,
        isDark,
        textColor,
        getSegmentColors(palette, parsed.data.length),
        bg,
        titleConfig,
        sc
      );
  }
}

/**
 * Builds a standard chart grid object with consistent spacing rules.
 */
function makeChartGrid(options: {
  // eOPT: widened — call sites destructure from resolveAxisLabels and pass
  // the slot through directly; the function only checks truthiness.
  xLabel?: string | undefined;
  yLabel?: string | undefined;
  hasTitle: boolean;
  hasLegend?: boolean | undefined;
  isHorizontal?: boolean | undefined;
}): Record<string, unknown> {
  const left = options.yLabel ? '12%' : '3%';
  // The custom legend renderer in renderExtendedChartForExport always hoists
  // the legend to the TOP (just under the title), so top must reserve room
  // for title + legend together; bottom no longer needs legend space.
  const top =
    options.hasTitle && options.hasLegend
      ? '22%'
      : options.hasTitle
        ? '15%'
        : options.hasLegend
          ? '12%'
          : '5%';
  return {
    left,
    right: '4%',
    bottom: options.xLabel ? '10%' : '3%',
    top,
    containLabel: true,
  };
}

/** Wrap a label string at word boundaries to fit within `maxChars` per line. */
function wrapLabel(text: string, maxChars: number): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

// ── Bar ──────────────────────────────────────────────────────

function buildBarOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  colors: string[],
  _bg: string,
  titleConfig: EChartsOption['title'],
  chartWidth?: number,
  sc?: ScaleContext
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const isHorizontal = parsed.orientation === 'horizontal';
  const labels = parsed.data.map((d) => d.label);
  const data = parsed.data.map((d, i) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const stroke = d.color ?? colors[i % colors.length]!;
    return {
      value: d.value,
      itemStyle: {
        color: shapeFill(palette, stroke, isDark, {
          solid: parsed.solidFill === true,
        }),
        borderColor: stroke,
        borderWidth: CHART_BORDER_WIDTH,
      },
    };
  });

  // For horizontal bars, wrap long category labels at word boundaries so they
  // don't consume too much horizontal space on the y-axis.
  const catLabels = isHorizontal ? labels.map((l) => wrapLabel(l, 12)) : labels;

  // Compute the max visible line width after wrapping for nameGap calculation.
  const maxVisibleLen = Math.max(
    ...catLabels.map((l) => Math.max(...l.split('\n').map((seg) => seg.length)))
  );
  const hCatGap =
    isHorizontal && yLabel ? Math.max(40, maxVisibleLen * 8 + 16) : undefined;
  const categoryAxis = makeGridAxis(
    'category',
    textColor,
    axisLineColor,
    splitLineColor,
    gridOpacity,
    isHorizontal ? yLabel : xLabel,
    catLabels,
    hCatGap,
    !isHorizontal ? chartWidth : undefined,
    undefined,
    sc
  );
  // For horizontal bars, the xlabel sits on the value axis (bottom).
  // Use a moderate nameGap so it doesn't drift.
  const hValueGap = isHorizontal && xLabel ? 40 : undefined;
  const valueAxis = makeGridAxis(
    'value',
    textColor,
    axisLineColor,
    splitLineColor,
    gridOpacity,
    isHorizontal ? xLabel : yLabel,
    undefined,
    hValueGap,
    undefined,
    undefined,
    sc
  );

  const s = sc ?? ScaleContext.identity();

  // xAxis is always the bottom axis, yAxis is always the left axis in ECharts

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    grid: makeChartGrid({
      xLabel,
      yLabel,
      hasTitle: !!parsed.title && !parsed.noTitle,
      isHorizontal,
    }),
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: [
      {
        type: 'bar',
        data,
        label: {
          show: !parsed.noValue,
          position: isHorizontal ? 'right' : 'top',
          formatter: '{c}',
          color: textColor,
          fontSize: s.text(11),
          fontFamily: FONT_FAMILY,
        },
        labelLayout: { hideOverlap: true },
        emphasis: EMPHASIS_SELF,
        blur: BLUR_DIM,
      },
    ],
  };
}

// ── Era band helpers ──────────────────────────────────────────

// Returns an integer interval for ECharts axisLabel.interval.
// interval: N means show label at index 0, N+1, 2*(N+1), ...
// For a desired step S we return S-1.
// Targets ~5 visible labels — conservative enough to prevent ECharts stagger.
function buildIntervalStep(labels: string[]): number {
  const count = labels.length;
  if (count <= 12) return 0; // show all
  const snapSteps = [1, 2, 5, 10, 25, 50, 100];
  const raw = Math.ceil(count / 5); // target ~5 visible labels
  const N = [...snapSteps].reverse().find((s) => s <= raw) ?? 1; // snap down
  return N - 1; // ECharts shows labels at indices 0, N, 2N, ...
}

function buildMarkArea(
  eras: ChartEra[],
  labels: string[],
  textColor: string,
  defaultColor: string
): Record<string, unknown> | undefined {
  if (eras.length === 0) return undefined;
  return {
    silent: false,
    tooltip: { show: false },
    data: eras.map((era) => {
      const startIdx = labels.indexOf(era.start);
      const endIdx = labels.indexOf(era.end);
      const bandSlots =
        startIdx >= 0 && endIdx >= 0 ? endIdx - startIdx : Infinity;
      const color = era.color ?? defaultColor;
      return [
        {
          name: era.label,
          xAxis: era.start,
          itemStyle: { color, opacity: 0.15 },
          label: {
            show: bandSlots >= 2,
            position: 'insideTop',
            fontSize: 11,
            color: textColor,
          },
        },
        { xAxis: era.end },
      ];
    }),
  };
}

// ── Line ─────────────────────────────────────────────────────

function buildLineOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  titleConfig: EChartsOption['title'],
  chartWidth?: number,
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const lineColor =
    parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const labels = parsed.data.map((d) => d.label);
  const values = parsed.data.map((d) => d.value);
  const eras = parsed.eras ?? [];
  const interval = buildIntervalStep(labels);
  const markArea = buildMarkArea(eras, labels, textColor, palette.colors.blue);

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    grid: makeChartGrid({
      xLabel,
      yLabel,
      hasTitle: !!parsed.title && !parsed.noTitle,
    }),
    xAxis: makeGridAxis(
      'category',
      textColor,
      axisLineColor,
      splitLineColor,
      gridOpacity,
      xLabel,
      labels,
      undefined,
      chartWidth,
      interval,
      sc
    ),
    yAxis: makeGridAxis(
      'value',
      textColor,
      axisLineColor,
      splitLineColor,
      gridOpacity,
      yLabel,
      undefined,
      undefined,
      undefined,
      undefined,
      sc
    ),
    series: [
      {
        type: 'line',
        data: values,
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: lineColor, width: 3 },
        itemStyle: { color: lineColor },
        label: {
          show: !parsed.noValue,
          position: 'top',
          formatter: '{c}',
          color: textColor,
          fontSize: s.text(11),
          fontFamily: FONT_FAMILY,
        },
        labelLayout: { hideOverlap: true },
        emphasis: EMPHASIS_LINE,
        blur: BLUR_DIM,
        ...(markArea && { markArea }),
      },
    ],
  };
}

// ── Multi-line ───────────────────────────────────────────────

function buildMultiLineOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  colors: string[],
  titleConfig: EChartsOption['title'],
  chartWidth?: number,
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const seriesNames = parsed.seriesNames ?? [];
  const labels = parsed.data.map((d) => d.label);
  const eras = parsed.eras ?? [];
  const interval = buildIntervalStep(labels);
  const markArea = buildMarkArea(eras, labels, textColor, palette.colors.blue);

  const series = seriesNames.map((name, idx) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const color =
      parsed.seriesNameColors?.[idx] ?? colors[idx % colors.length]!;
    const data = parsed.data.map((dp) =>
      idx === 0 ? dp.value : (dp.extraValues?.[idx - 1] ?? 0)
    );
    return {
      name,
      type: 'line' as const,
      data,
      smooth: false,
      symbolSize: 8,
      lineStyle: { color, width: 3 },
      itemStyle: { color },
      label: {
        show: !parsed.noValue,
        position: 'top' as const,
        formatter: '{c}',
        color: textColor,
        fontSize: s.text(11),
        fontFamily: FONT_FAMILY,
      },
      labelLayout: { hideOverlap: true },
      emphasis: EMPHASIS_LINE,
      blur: BLUR_DIM,
      ...(idx === 0 && markArea && { markArea }),
    };
  });

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    legend: {
      data: seriesNames,
      bottom: 10,
      textStyle: { color: textColor },
    },
    grid: makeChartGrid({
      xLabel,
      yLabel,
      hasTitle: !!parsed.title && !parsed.noTitle,
      hasLegend: true,
    }),
    xAxis: makeGridAxis(
      'category',
      textColor,
      axisLineColor,
      splitLineColor,
      gridOpacity,
      xLabel,
      labels,
      undefined,
      chartWidth,
      interval,
      sc
    ),
    yAxis: makeGridAxis(
      'value',
      textColor,
      axisLineColor,
      splitLineColor,
      gridOpacity,
      yLabel,
      undefined,
      undefined,
      undefined,
      undefined,
      sc
    ),
    series,
  };
}

// ── Area ─────────────────────────────────────────────────────

function buildAreaOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  titleConfig: EChartsOption['title'],
  chartWidth?: number,
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const lineColor =
    parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const labels = parsed.data.map((d) => d.label);
  const values = parsed.data.map((d) => d.value);
  const eras = parsed.eras ?? [];
  const interval = buildIntervalStep(labels);
  const markArea = buildMarkArea(eras, labels, textColor, palette.colors.blue);

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    grid: makeChartGrid({
      xLabel,
      yLabel,
      hasTitle: !!parsed.title && !parsed.noTitle,
    }),
    xAxis: makeGridAxis(
      'category',
      textColor,
      axisLineColor,
      splitLineColor,
      gridOpacity,
      xLabel,
      labels,
      undefined,
      chartWidth,
      interval,
      sc
    ),
    yAxis: makeGridAxis(
      'value',
      textColor,
      axisLineColor,
      splitLineColor,
      gridOpacity,
      yLabel,
      undefined,
      undefined,
      undefined,
      undefined,
      sc
    ),
    series: [
      {
        type: 'line',
        data: values,
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: lineColor, width: 3 },
        itemStyle: { color: lineColor },
        areaStyle: { opacity: 0.25 },
        label: {
          show: !parsed.noValue,
          position: 'top',
          formatter: '{c}',
          color: textColor,
          fontSize: s.text(11),
          fontFamily: FONT_FAMILY,
        },
        labelLayout: { hideOverlap: true },
        emphasis: EMPHASIS_LINE,
        blur: BLUR_DIM,
        ...(markArea && { markArea }),
      },
    ],
  };
}

// ── Segment label formatter ──────────────────────────────────

function segmentLabelFormatter(parsed: ParsedChart): string {
  const showName = !parsed.noName;
  const showValue = !parsed.noValue;
  const showPercent = !parsed.noPercent;

  const parts: string[] = [];
  if (showName) parts.push('{b}');
  if (showValue) parts.push('{c}');
  if (showPercent) parts.push('{d}%');

  if (parts.length === 0) return '{b}'; // fallback: always show name
  // In-bounds by parts.length === 1 guard.
  if (parts.length === 1) return parts[0]!;

  // Name is joined with " — ", value+percent are grouped with parens when all three
  if (showName && showValue && showPercent) return '{b} — {c} ({d}%)';
  if (showName) return '{b} — ' + parts.slice(1).join(' ');
  return parts.join(' ');
}

// ── Pie / Doughnut ───────────────────────────────────────────

/**
 * Compute pie label config: shrink radius and font when labels are long
 * so nothing gets truncated or wrapped.
 */
function pieLabelLayout(parsed: ParsedChart): {
  outerRadius: number;
  fontSize: number;
} {
  const formatter = segmentLabelFormatter(parsed);
  const total = parsed.data.reduce((s, d) => s + d.value, 0);
  const maxLen = parsed.data.reduce((mx, d) => {
    const label = formatter
      .replace('{b}', d.label)
      .replace('{c}', String(d.value))
      .replace('{d}', total > 0 ? ((d.value / total) * 100).toFixed(2) : '0');
    return Math.max(mx, label.length);
  }, 0);

  // Shrink radius and font for longer labels so they fit without truncation.
  // The chart renders in containers of varying width (800px in-app to 1200px CLI),
  // so we need enough margin for labels at the smallest reasonable container.
  if (maxLen > 30) return { outerRadius: 38, fontSize: 11 };
  if (maxLen > 24) return { outerRadius: 45, fontSize: 12 };
  if (maxLen > 18) return { outerRadius: 55, fontSize: 13 };
  return { outerRadius: 70, fontSize: 14 };
}

function buildPieOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  colors: string[],
  _bg: string,
  titleConfig: EChartsOption['title'],
  isDoughnut: boolean,
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const HIDE_AXES = { xAxis: { show: false }, yAxis: { show: false } };
  const data = parsed.data.map((d, i) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const stroke = d.color ?? colors[i % colors.length]!;
    return {
      name: d.label,
      value: d.value,
      itemStyle: {
        color: shapeFill(palette, stroke, isDark, {
          solid: parsed.solidFill === true,
        }),
        borderColor: stroke,
        borderWidth: CHART_BORDER_WIDTH,
      },
    };
  });

  const { outerRadius, fontSize } = pieLabelLayout(parsed);

  return {
    ...CHART_BASE,
    ...HIDE_AXES,
    ...(titleConfig !== undefined && { title: titleConfig }),
    series: [
      {
        type: 'pie',
        radius: isDoughnut
          ? [`${Math.round(outerRadius * 0.57)}%`, `${outerRadius}%`]
          : ['0%', `${outerRadius}%`],
        data,
        label: {
          position: 'outside',
          formatter: segmentLabelFormatter(parsed),
          color: textColor,
          fontFamily: FONT_FAMILY,
          fontSize: s.text(fontSize),
        },
        labelLine: { show: true },
        emphasis: EMPHASIS_SELF,
        blur: BLUR_DIM,
      },
    ],
  };
}

// ── Radar ────────────────────────────────────────────────────

function buildRadarOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  gridOpacity: number,
  titleConfig: EChartsOption['title'],
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const radarColor =
    parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const values = parsed.data.map((d) => d.value);
  const maxValue = Math.max(...values) * 1.15;

  const indicator = parsed.data.map((d) => ({
    name: d.label,
    max: maxValue,
  }));

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    xAxis: { show: false },
    yAxis: { show: false },
    radar: {
      indicator,
      axisName: {
        color: textColor,
        fontFamily: FONT_FAMILY,
        fontSize: s.text(16),
      },
      splitLine: {
        lineStyle: { color: palette.border, opacity: gridOpacity },
      },
      axisLine: {
        lineStyle: { color: palette.border, opacity: gridOpacity },
      },
      splitArea: { show: false },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: values,
            name: parsed.series ?? 'Value',
            areaStyle: {
              color: shapeFill(palette, radarColor, isDark, {
                solid: parsed.solidFill === true,
              }),
            },
            lineStyle: { color: radarColor },
            itemStyle: { color: radarColor },
            symbol: 'circle',
            symbolSize: 8,
            label: {
              show: !parsed.noValue,
              formatter: '{c}',
              color: textColor,
              fontSize: s.text(11),
              fontFamily: FONT_FAMILY,
            },
          },
        ],
        emphasis: EMPHASIS_SELF,
        blur: BLUR_DIM,
      },
    ],
  };
}

// ── Polar Area ───────────────────────────────────────────────

function buildPolarAreaOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  colors: string[],
  _bg: string,
  titleConfig: EChartsOption['title'],
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const data = parsed.data.map((d, i) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const stroke = d.color ?? colors[i % colors.length]!;
    return {
      name: d.label,
      value: d.value,
      itemStyle: {
        color: shapeFill(palette, stroke, isDark, {
          solid: parsed.solidFill === true,
        }),
        borderColor: stroke,
        borderWidth: CHART_BORDER_WIDTH,
      },
    };
  });

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    xAxis: { show: false },
    yAxis: { show: false },
    series: [
      {
        type: 'pie',
        roseType: 'radius',
        radius: (() => {
          const { outerRadius } = pieLabelLayout(parsed);
          return [`${Math.round(outerRadius * 0.14)}%`, `${outerRadius}%`];
        })(),
        data,
        label: {
          position: 'outside',
          formatter: segmentLabelFormatter(parsed),
          color: textColor,
          fontFamily: FONT_FAMILY,
          fontSize: s.text(pieLabelLayout(parsed).fontSize),
        },
        labelLine: { show: true },
        emphasis: EMPHASIS_SELF,
        blur: BLUR_DIM,
      },
    ],
  };
}

// ── Bar Stacked ──────────────────────────────────────────────

function buildBarStackedOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  colors: string[],
  _bg: string,
  titleConfig: EChartsOption['title'],
  chartWidth?: number,
  sc?: ScaleContext
): EChartsOption {
  const s = sc ?? ScaleContext.identity();
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const isHorizontal = parsed.orientation === 'horizontal';
  const seriesNames = parsed.seriesNames ?? [];
  const labels = parsed.data.map((d) => d.label);

  const series = seriesNames.map((name, idx) => {
    // colors is a non-empty palette array; modulo index is always in-bounds.
    const color =
      parsed.seriesNameColors?.[idx] ?? colors[idx % colors.length]!;
    const segmentFill = shapeFill(palette, color, isDark, {
      solid: parsed.solidFill === true,
    });
    const data = parsed.data.map((dp) =>
      idx === 0 ? dp.value : (dp.extraValues?.[idx - 1] ?? 0)
    );
    return {
      name,
      type: 'bar' as const,
      stack: 'total',
      data,
      itemStyle: {
        color: segmentFill,
        borderColor: color,
        borderWidth: CHART_BORDER_WIDTH,
      },
      label: {
        show: !parsed.noValue,
        position: 'inside' as const,
        formatter: '{c}',
        // Inside-segment label must contrast against the segment fill, not
        // against the chart bg — `textColor` (= palette.text) is illegible
        // on saturated solid fills.
        color: contrastText(
          segmentFill,
          palette.textOnFillLight,
          palette.textOnFillDark
        ),
        fontSize: s.text(14),
        fontWeight: 'bold' as const,
        fontFamily: FONT_FAMILY,
      },
      emphasis: EMPHASIS_SERIES,
      blur: BLUR_DIM,
    };
  });

  const hCatGap =
    isHorizontal && yLabel
      ? Math.max(40, Math.max(...labels.map((l) => l.length)) * 8 + 16)
      : undefined;
  const categoryAxis = makeGridAxis(
    'category',
    textColor,
    axisLineColor,
    splitLineColor,
    gridOpacity,
    isHorizontal ? yLabel : xLabel,
    labels,
    hCatGap,
    !isHorizontal ? chartWidth : undefined,
    undefined,
    sc
  );
  // For horizontal bars with a legend, use a smaller nameGap so the xlabel
  // stays close to the axis ticks rather than drifting toward the legend.
  const hValueGap = isHorizontal && xLabel ? 40 : undefined;
  const valueAxis = makeGridAxis(
    'value',
    textColor,
    axisLineColor,
    splitLineColor,
    gridOpacity,
    isHorizontal ? xLabel : yLabel,
    undefined,
    hValueGap,
    undefined,
    undefined,
    sc
  );

  return {
    ...CHART_BASE,
    ...(titleConfig !== undefined && { title: titleConfig }),
    legend: {
      data: seriesNames,
      bottom: 10,
      textStyle: { color: textColor },
    },
    grid: makeChartGrid({
      xLabel,
      yLabel,
      hasTitle: !!parsed.title && !parsed.noTitle,
      hasLegend: true,
    }),
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series,
  };
}

// ============================================================
// ECharts SSR Export
// ============================================================

export const ECHART_EXPORT_WIDTH = 1200;
const ECHART_EXPORT_HEIGHT = 800;

// Standard chart types handled by buildSimpleChartOption (via parseChart)
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
 * Renders an extended chart (scatter, sankey, chord, function, heatmap, funnel) to SVG using server-side rendering.
 * Mirrors the `renderForExport` API — returns an SVG string or empty string on failure.
 */
export async function renderExtendedChartForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors
): Promise<string> {
  const isDark = theme === 'dark';

  // Fall back to Nord palette if none provided
  const { getPalette } = await import('./palettes');
  const effectivePalette =
    palette ?? (isDark ? getPalette('nord').dark : getPalette('nord').light);

  // Detect chart type to dispatch to the right parser/builder
  // Find first non-empty, non-comment line and use parseFirstLine for new-style detection
  let chartType: string | undefined;
  for (const rawLine of content.split('\n')) {
    const t = rawLine.trim();
    if (!t || t.startsWith('//')) continue;
    const fl = parseFirstLine(t);
    if (fl) chartType = fl.chartType.toLowerCase();
    break;
  }

  // No recognised chart type on the first line → nothing to render
  if (!chartType) return '';

  let option: EChartsOption;
  let legendGroups: LegendGroupData[] = []; // eslint-disable-line no-useless-assignment
  const colors = getSeriesColors(effectivePalette);

  if (STANDARD_CHART_TYPES.has(chartType)) {
    const parsed = parseChart(content, effectivePalette);
    if (parsed.error) return '';
    option = buildSimpleChartOption(
      parsed,
      effectivePalette,
      isDark,
      ECHART_EXPORT_WIDTH,
      ScaleContext.identity()
    );
    legendGroups = getSimpleChartLegendGroups(parsed, colors);
  } else {
    const parsed = parseExtendedChart(content, effectivePalette);
    if (parsed.error) return '';
    option = buildExtendedChartOption(
      parsed,
      effectivePalette,
      isDark,
      ScaleContext.identity()
    );
    legendGroups = getExtendedChartLegendGroups(parsed, colors);
  }
  if (!option || Object.keys(option).length === 0) return '';

  // When using custom legend, strip ECharts' built-in legend
  if (legendGroups.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { legend: _legend, ...rest } = option;
    option = rest;
  }

  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width: ECHART_EXPORT_WIDTH,
    height: ECHART_EXPORT_HEIGHT,
  });

  try {
    chart.setOption(option);
    const svgString = chart.renderToSVGString();
    if (!svgString) return '';

    // The SSR output already includes xmlns, width, height, and viewBox.
    // Inject font-family and background on the root <svg> element.
    const bgStyle =
      theme !== 'transparent' ? `background: ${effectivePalette.bg}; ` : '';
    let result = svgString.replace(
      /^<svg /,
      `<svg style="${bgStyle}font-family: ${FONT_FAMILY}" `
    );

    // Inject custom legend SVG when present
    if (legendGroups.length > 0) {
      const titleHeight =
        option.title && (option.title as { text?: string }).text ? 40 : 0;
      const legendY = 8 + titleHeight;
      // In static export, expand the first group so entries are visible
      // Extract grid offsets for plot-area-centered legend
      const grid = option.grid as Record<string, unknown> | undefined;
      const gridLeftPct = grid?.['left']
        ? parseFloat(String(grid['left']))
        : undefined;
      const gridRightPct = grid?.['right']
        ? parseFloat(String(grid['right']))
        : undefined;
      const { svg: legendSvgStr } = renderLegendSvg(legendGroups, {
        palette: effectivePalette,
        isDark,
        containerWidth: ECHART_EXPORT_WIDTH,
        ...(gridLeftPct !== undefined && { gridLeftPct }),
        ...(gridRightPct !== undefined && { gridRightPct }),
        // In-bounds by legendGroups.length > 0 guard above.
        activeGroup: legendGroups[0]!.name,
        className: 'chart-legend',
      });
      // Insert legend group right after the opening <svg ...> tag
      result = result.replace(
        /(<svg[^>]*>)/,
        `$1<g transform="translate(0,${legendY})">${legendSvgStr}</g>`
      );
    }

    return result;
  } finally {
    chart.dispose();
  }
}
