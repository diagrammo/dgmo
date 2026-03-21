import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { FONT_FAMILY } from './fonts';
import { injectBranding } from './branding';

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

export interface ExtendedChartDataPoint {
  label: string;
  value: number;
  color?: string;
  lineNumber: number;
}

export interface ParsedSankeyLink {
  source: string;
  target: string;
  value: number;
  color?: string;
  lineNumber: number;
}

export interface ParsedFunction {
  name: string;
  expression: string;
  color?: string;
  lineNumber: number;
}

export interface ParsedScatterPoint {
  name: string;
  x: number;
  y: number;
  size?: number;
  color?: string;
  category?: string;
  lineNumber: number;
}

export interface ParsedHeatmapRow {
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
  seriesNames?: string[];
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
  ylabel?: string;
  sizelabel?: string;
  showLabels?: boolean;
  categoryColors?: Record<string, string>;
  nodeColors?: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Nord Colors for Charts
// ============================================================

import type { PaletteColors } from './palettes';
import { getSeriesColors, getSegmentColors } from './palettes';
import { mix } from './palettes/color-utils';
import { parseChart } from './chart';
import type { ParsedChart, ChartEra } from './chart';
import { makeDgmoError, formatDgmoError, suggest } from './diagnostics';
import { resolveColor } from './colors';
import { collectIndentedValues, extractColor, measureIndent, parseSeriesNames } from './utils/parsing';

// ============================================================
// Shared Constants
// ============================================================

const EMPHASIS_SELF = { focus: 'self' as const, blurScope: 'global' as const };
const CHART_BASE: Pick<EChartsOption, 'backgroundColor' | 'animation'> = { backgroundColor: 'transparent', animation: false };
const CHART_BORDER_WIDTH = 2;

// ============================================================
// Parser
// ============================================================

/**
 * Parses extended chart content into a structured object.
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

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Reject legacy ## category syntax
    if (/^#{2,}\s+/.test(trimmed)) {
      const name = trimmed.replace(/^#{2,}\s+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      result.diagnostics.push(makeDgmoError(lineNumber, `'## ${name}' is no longer supported. Use '[${name}]' instead`));
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // [Category] container header with optional color: [Category Name] or [Category Name](color)
    const categoryMatch = trimmed.match(/^\[(.+?)\](?:\s*\(([^)]+)\))?\s*$/);
    if (categoryMatch) {
      const catName = categoryMatch[1].trim();
      const catColor = categoryMatch[2] ? resolveColor(categoryMatch[2].trim(), palette) : null;
      if (catColor) {
        if (!result.categoryColors) result.categoryColors = {};
        result.categoryColors[catName] = catColor;
      }
      currentCategory = catName;
      continue;
    }

    // Parse key: value pairs
    const colonIndex = trimmed.indexOf(':');

    // Sankey: bare label (no colon) at any indent = source node for indented children
    if (result.type === 'sankey' && colonIndex === -1) {
      const indent = measureIndent(lines[i]);
      while (sankeyStack.length && sankeyStack.at(-1)!.indent >= indent) {
        sankeyStack.pop();
      }
      const { label: nodeName, color: nodeColor } = extractColor(trimmed, palette);
      if (nodeColor) {
        if (!result.nodeColors) result.nodeColors = {};
        result.nodeColors[nodeName] = nodeColor;
      }
      sankeyStack.push({ name: nodeName, indent });
      continue;
    }

    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
    const value = trimmed.substring(colonIndex + 1).trim();

    // Handle metadata
    if (key === 'chart') {
      const chartType = value.toLowerCase();
      if (
        chartType === 'sankey' ||
        chartType === 'chord' ||
        chartType === 'function' ||
        chartType === 'scatter' ||
        chartType === 'heatmap' ||
        chartType === 'funnel'
      ) {
        result.type = chartType;
      } else {
        const validTypes = ['scatter', 'sankey', 'chord', 'function', 'heatmap', 'funnel'];
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

    if (key === 'title') {
      result.title = value;
      result.titleLineNumber = lineNumber;
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

    // Axis labels
    if (key === 'xlabel') {
      result.xlabel = value;
      continue;
    }

    if (key === 'ylabel') {
      result.ylabel = value;
      continue;
    }

    if (key === 'sizelabel') {
      result.sizelabel = value;
      continue;
    }

    if (key === 'labels') {
      result.showLabels =
        value.toLowerCase() === 'on' || value.toLowerCase() === 'true';
      continue;
    }

    // Heatmap columns and rows headers
    if (key === 'columns') {
      if (value) {
        result.columns = value.split(',').map((s) => s.trim());
      } else {
        const collected = collectIndentedValues(lines, i);
        i = collected.newIndex;
        result.columns = collected.values;
      }
      continue;
    }

    if (key === 'rows') {
      if (value) {
        result.rows = value.split(',').map((s) => s.trim());
      } else {
        const collected = collectIndentedValues(lines, i);
        i = collected.newIndex;
        result.rows = collected.values;
      }
      continue;
    }

    // Check for x range: "x: min to max"
    if (key === 'x') {
      const rangeMatch = value.match(/^(-?[\d.]+)\s+to\s+(-?[\d.]+)$/);
      if (rangeMatch) {
        result.xRange = {
          min: parseFloat(rangeMatch[1]),
          max: parseFloat(rangeMatch[2]),
        };
      }
      continue;
    }

    // Check for Sankey arrow syntax: Source (color) -> Target (color): Value (color)
    const arrowMatch = trimmed.match(/^(.+?)\s*->\s*(.+?):\s*(\d+(?:\.\d+)?)\s*(?:\(([^)]+)\))?\s*$/);
    if (arrowMatch) {
      const [, rawSource, rawTarget, val, rawLinkColor] = arrowMatch;
      const { label: source, color: sourceColor } = extractColor(rawSource.trim(), palette);
      const { label: target, color: targetColor } = extractColor(rawTarget.trim(), palette);
      if (sourceColor || targetColor) {
        if (!result.nodeColors) result.nodeColors = {};
        if (sourceColor) result.nodeColors[source] = sourceColor;
        if (targetColor) result.nodeColors[target] = targetColor;
      }
      const linkColor = rawLinkColor ? resolveColor(rawLinkColor.trim(), palette) : undefined;
      if (!result.links) result.links = [];
      result.links.push({
        source,
        target,
        value: parseFloat(val),
        ...(linkColor && { color: linkColor }),
        lineNumber,
      });
      continue;
    }

    // Sankey: indented "Target: Value" under a source node on the indent stack
    if (result.type === 'sankey' && sankeyStack.length > 0) {
      const indent = measureIndent(lines[i]);
      if (indent > 0) {
        // Pop entries at same or deeper indent to find the parent
        while (sankeyStack.length && sankeyStack.at(-1)!.indent >= indent) {
          sankeyStack.pop();
        }
        if (sankeyStack.length > 0) {
          const source = sankeyStack.at(-1)!.name;
          const { label: target, color: targetColor } = extractColor(trimmed.substring(0, colonIndex).trim(), palette);
          if (targetColor) {
            if (!result.nodeColors) result.nodeColors = {};
            result.nodeColors[target] = targetColor;
          }
          // Parse value with optional trailing (color) for link color
          const valColorMatch = value.match(/^(\d+(?:\.\d+)?)\s*(?:\(([^)]+)\))?\s*$/);
          const val = valColorMatch ? parseFloat(valColorMatch[1]) : NaN;
          const linkColor = valColorMatch?.[2] ? resolveColor(valColorMatch[2].trim(), palette) : undefined;
          if (!isNaN(val)) {
            if (!result.links) result.links = [];
            result.links.push({ source, target, value: val, ...(linkColor && { color: linkColor }), lineNumber });
            // Push target as potential source for deeper nesting
            sankeyStack.push({ name: target, indent });
            continue;
          }
        }
      }
    }

    // For function charts, treat non-numeric values as function expressions
    if (result.type === 'function') {
      const { label: fnName, color: fnColor } = extractColor(trimmed.substring(0, colonIndex).trim(), palette);
      if (!result.functions) result.functions = [];
      result.functions.push({
        name: fnName,
        expression: value,
        ...(fnColor && { color: fnColor }),
        lineNumber,
      });
      continue;
    }

    // For scatter charts, parse "Name: x, y" or "Name: x, y, size"
    if (result.type === 'scatter') {
      const scatterMatch = value.match(
        /^(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+))?$/
      );
      if (scatterMatch) {
        const { label: scatterName, color: scatterColor } = extractColor(trimmed.substring(0, colonIndex).trim(), palette);
        if (!result.scatterPoints) result.scatterPoints = [];
        result.scatterPoints.push({
          name: scatterName,
          x: parseFloat(scatterMatch[1]),
          y: parseFloat(scatterMatch[2]),
          size: scatterMatch[3] ? parseFloat(scatterMatch[3]) : undefined,
          ...(scatterColor && { color: scatterColor }),
          ...(currentCategory !== 'Default' && { category: currentCategory }),
          lineNumber,
        });
      }
      continue;
    }

    // For heatmap, parse "RowLabel: val1, val2, val3, ..."
    if (result.type === 'heatmap') {
      const values = value.split(',').map((v) => parseFloat(v.trim()));
      if (values.length > 0 && values.every((v) => !isNaN(v))) {
        const originalKey = trimmed.substring(0, colonIndex).trim();
        if (!result.heatmapRows) result.heatmapRows = [];
        result.heatmapRows.push({ label: originalKey, values, lineNumber });
      }
      continue;
    }

    // Otherwise treat as data point (label: value)
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      const { label: rawLabel, color: pointColor } = extractColor(trimmed.substring(0, colonIndex).trim(), palette);
      result.data.push({
        label: rawLabel,
        value: numValue,
        ...(pointColor && { color: pointColor }),
        lineNumber,
      });
    }
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
        warn(1, 'No functions found. Add functions in format: Name: expression');
      }
      if (!result.xRange) {
        result.xRange = { min: -10, max: 10 }; // Default range
      }
    } else if (result.type === 'scatter') {
      if (!result.scatterPoints || result.scatterPoints.length === 0) {
        warn(1, 'No scatter points found. Add points in format: Name: x, y or Name: x, y, size');
      }
    } else if (result.type === 'heatmap') {
      if (!result.heatmapRows || result.heatmapRows.length === 0) {
        warn(1, 'No heatmap data found. Add data in format: RowLabel: val1, val2, val3');
      }
      if (!result.columns || result.columns.length === 0) {
        warn(1, 'No columns defined. Add columns in format: columns: Col1, Col2, Col3');
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
function buildChartCommons(parsed: { title?: string; error?: string | null }, palette: PaletteColors, isDark: boolean) {
  const textColor = palette.text;
  const axisLineColor = palette.border;
  const splitLineColor = palette.border;
  const gridOpacity = isDark ? 0.7 : 0.55;
  const colors = getSeriesColors(palette);
  const titleConfig = parsed.title ? { text: parsed.title, left: 'center' as const, top: 8, textStyle: { color: textColor, fontSize: 20, fontWeight: 'bold' as const, fontFamily: FONT_FAMILY } } : undefined;
  const tooltipTheme = { backgroundColor: palette.surface, borderColor: palette.border, textStyle: { color: palette.text } };
  return { textColor, axisLineColor, splitLineColor, gridOpacity, colors, titleConfig, tooltipTheme };
}

/**
 * Converts a ParsedExtendedChart into an EChartsOption.
 * Handles extended chart types: scatter, sankey, chord, function, heatmap, funnel.
 * @param parsed - Result of parseExtendedChart()
 */
export function buildExtendedChartOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  isDark: boolean
): EChartsOption {
  if (parsed.error) {
    // Return empty option, error will be shown separately
    return {};
  }

  const { textColor, axisLineColor, gridOpacity, colors, titleConfig, tooltipTheme } = buildChartCommons(parsed, palette, isDark);

  // Sankey chart has different structure
  if (parsed.type === 'sankey') {
    return buildSankeyOption(
      parsed,
      textColor,
      colors,
      titleConfig,
      tooltipTheme
    );
  }

  // Chord diagram
  if (parsed.type === 'chord') {
    const bg = isDark ? palette.surface : palette.bg;
    return buildChordOption(
      parsed,
      textColor,
      colors,
      bg,
      titleConfig,
      tooltipTheme
    );
  }

  // Function plot
  if (parsed.type === 'function') {
    return buildFunctionOption(
      parsed,
      palette,
      textColor,
      axisLineColor,
      gridOpacity,
      colors,
      titleConfig,
      tooltipTheme
    );
  }

  // Scatter plot
  if (parsed.type === 'scatter') {
    const bg = isDark ? palette.surface : palette.bg;
    return buildScatterOption(
      parsed,
      palette,
      textColor,
      axisLineColor,
      gridOpacity,
      colors,
      bg,
      titleConfig,
      tooltipTheme
    );
  }

  // Funnel chart
  if (parsed.type === 'funnel') {
    const bg = isDark ? palette.surface : palette.bg;
    return buildFunnelOption(
      parsed,
      textColor,
      colors,
      bg,
      titleConfig,
      tooltipTheme
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
    tooltipTheme
  );
}

/**
 * Builds ECharts option for sankey diagrams.
 */
function buildSankeyOption(
  parsed: ParsedExtendedChart,
  textColor: string,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  // Extract unique nodes from links
  const nodeSet = new Set<string>();
  if (parsed.links) {
    for (const link of parsed.links) {
      nodeSet.add(link.source);
      nodeSet.add(link.target);
    }
  }

  const nodes = Array.from(nodeSet).map((name, index) => ({
    name,
    itemStyle: {
      color: parsed.nodeColors?.[name] ?? colors[index % colors.length],
    },
  }));

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      show: false,
      ...tooltipTheme,
    },
    series: [
      {
        type: 'sankey',
        emphasis: {
          focus: 'adjacency',
          blurScope: 'global' as const,
        },
        nodeAlign: 'left',
        nodeGap: 12,
        nodeWidth: 20,
        data: nodes,
        links: (parsed.links ?? []).map(link => ({
          source: link.source,
          target: link.target,
          value: link.value,
          ...(link.color && { lineStyle: { color: link.color } }),
        })),
        lineStyle: {
          color: 'gradient',
          curveness: 0.5,
        },
        label: {
          color: textColor,
          fontSize: 12,
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
  textColor: string,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
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
        matrix[sourceIndex][targetIndex] = link.value;
      }
    }
  }

  // Create category data for nodes with colors
  const categories = nodeNames.map((name, index) => {
    const stroke = colors[index % colors.length];
    return {
      name,
      itemStyle: { color: mix(stroke, bg, 30), borderColor: stroke, borderWidth: CHART_BORDER_WIDTH },
    };
  });

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'item',
      ...tooltipTheme,
      formatter: (params: unknown) => {
        const p = params as {
          data?: { source: string; target: string; value: number };
        };
        if (p.data && p.data.source && p.data.target) {
          return `${p.data.source} → ${p.data.target}: ${p.data.value}`;
        }
        return '';
      },
    },
    legend: {
      data: nodeNames,
      bottom: 10,
      textStyle: {
        color: textColor,
      },
    },
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
          symbolSize: 20,
          itemStyle: cat.itemStyle,
          label: {
            show: true,
            color: textColor,
          },
        })),
        links: (parsed.links ?? []).map((link) => ({
          source: link.source,
          target: link.target,
          value: link.value,
          lineStyle: {
            width: Math.max(1, Math.min(link.value / 20, 10)),
            color: colors[nodeNames.indexOf(link.source) % colors.length],
            curveness: 0.3,
            opacity: 0.6,
          },
        })),
        roam: true,
        label: {
          position: 'right',
          formatter: '{b}',
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: {
            width: 5,
            opacity: 1,
          },
        },
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
  textColor: string,
  axisLineColor: string,
  gridOpacity: number,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
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

    const fnColor = fn.color ?? colors[index % colors.length];
    return {
      name: fn.name,
      type: 'line' as const,
      showSymbol: false,
      smooth: true,
      data,
      lineStyle: {
        width: 2,
        color: fnColor,
      },
      itemStyle: {
        color: fnColor,
      },
      emphasis: EMPHASIS_SELF,
    };
  });

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: {
        type: 'cross',
      },
    },
    legend: {
      data: (parsed.functions ?? []).map((fn) => fn.name),
      bottom: 10,
      textStyle: {
        color: textColor,
      },
    },
    grid: {
      left: '4%',
      right: '4%',
      bottom: '15%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      min: xRange.min,
      max: xRange.max,
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: 16,
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
        fontSize: 16,
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
 * Builds ECharts option for scatter plots.
 * Auto-detects categories and size from point data:
 * - hasCategories → multi-series with legend (one per category)
 * - hasSize → dynamic symbol sizing from 3rd value
 */
function buildScatterOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
  gridOpacity: number,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const points = parsed.scatterPoints ?? [];
  const defaultSize = 15;

  const hasCategories = points.some((p) => p.category !== undefined);
  const hasSize = points.some((p) => p.size !== undefined);

  const labelConfig = {
    show: parsed.showLabels ?? false,
    formatter: '{b}',
    position: 'top' as const,
    color: textColor,
    fontSize: 11,
  };

  const emphasisConfig = {
    focus: 'self' as const,
    itemStyle: {
      shadowBlur: 10,
      shadowColor: 'rgba(0, 0, 0, 0.3)',
    },
  };

  // Build series based on whether categories are present
  let series;
  let legendData: string[] | undefined;

  if (hasCategories) {
    const categories = [
      ...new Set(points.map((p) => p.category).filter(Boolean)),
    ] as string[];
    legendData = categories;

    series = categories.map((category, catIndex) => {
      const categoryPoints = points.filter((p) => p.category === category);
      const catColor =
        parsed.categoryColors?.[category] ?? colors[catIndex % colors.length];

      const data = categoryPoints.map((p) => ({
        name: p.name,
        value: hasSize ? [p.x, p.y, p.size ?? 0] : [p.x, p.y],
        ...(p.color && {
          itemStyle: { color: mix(p.color, bg, 30), borderColor: p.color, borderWidth: CHART_BORDER_WIDTH },
        }),
      }));

      return {
        name: category,
        type: 'scatter' as const,
        data,
        ...(hasSize
          ? { symbolSize: (val: number[]) => val[2] }
          : { symbolSize: defaultSize }),
        itemStyle: { color: mix(catColor, bg, 30), borderColor: catColor, borderWidth: CHART_BORDER_WIDTH },
        label: labelConfig,
        emphasis: emphasisConfig,
      };
    });
  } else {
    // Single series — per-point colors
    const data = points.map((p, index) => {
      const stroke = p.color ?? colors[index % colors.length];
      return {
        name: p.name,
        value: hasSize ? [p.x, p.y, p.size ?? 0] : [p.x, p.y],
        ...(hasSize
          ? { symbolSize: p.size ?? defaultSize }
          : { symbolSize: defaultSize }),
        itemStyle: { color: mix(stroke, bg, 30), borderColor: stroke, borderWidth: CHART_BORDER_WIDTH },
      };
    });

    series = [
      {
        type: 'scatter' as const,
        data,
        label: labelConfig,
        emphasis: emphasisConfig,
      },
    ];
  }

  // Tooltip adapts to available data
  const tooltip = {
    trigger: 'item' as const,
    ...tooltipTheme,
    formatter: (params: unknown) => {
      const p = params as {
        seriesName: string;
        name: string;
        value: number[];
      };
      const xLabel = parsed.xlabel || 'x';
      const yLabel = parsed.ylabel || 'y';
      let html = `<strong>${p.name}</strong>`;
      if (hasCategories) html += `<br/>${p.seriesName}`;
      html += `<br/>${xLabel}: ${p.value[0]}<br/>${yLabel}: ${p.value[1]}`;
      if (hasSize) html += `<br/>${parsed.sizelabel || 'size'}: ${p.value[2]}`;
      return html;
    },
  };

  // Auto-fit axes to data range with ~10% padding
  const xValues = points.map((p) => p.x);
  const yValues = points.map((p) => p.y);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip,
    ...(legendData && {
      legend: {
        data: legendData,
        bottom: 10,
        textStyle: { color: textColor },
      },
    }),
    grid: {
      left: parsed.ylabel ? '12%' : '3%',
      right: '4%',
      bottom: hasCategories ? '15%' : parsed.xlabel ? '10%' : '3%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: parsed.xlabel,
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: {
        color: textColor,
        fontSize: 18,
      },
      min: Math.floor(xMin - xPad),
      max: Math.ceil(xMax + xPad),
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: 16,
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
      name: parsed.ylabel,
      nameLocation: 'middle',
      nameGap: 50,
      nameTextStyle: {
        color: textColor,
        fontSize: 18,
      },
      min: Math.floor(yMin - yPad),
      max: Math.ceil(yMax + yPad),
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: 16,
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
 * Builds ECharts option for heatmap charts.
 */
function buildHeatmapOption(
  parsed: ParsedExtendedChart,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  axisLineColor: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const bg = isDark ? palette.surface : palette.bg;
  const heatmapRows = parsed.heatmapRows ?? [];
  const columns = parsed.columns ?? [];
  const rowLabels = heatmapRows.map((r) => r.label);

  // Convert row data to [colIndex, rowIndex, value] format
  const data: [number, number, number][] = [];
  let minValue = Infinity;
  let maxValue = -Infinity;

  heatmapRows.forEach((row, rowIndex) => {
    row.values.forEach((value, colIndex) => {
      data.push([colIndex, rowIndex, value]);
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    });
  });

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'item',
      ...tooltipTheme,
      formatter: (params: unknown) => {
        const p = params as { data: [number, number, number] };
        const colName = columns[p.data[0]] ?? p.data[0];
        const rowName = rowLabels[p.data[1]] ?? p.data[1];
        return `${rowName} / ${colName}: <strong>${p.data[2]}</strong>`;
      },
    },
    grid: {
      left: '3%',
      right: '10%',
      bottom: '3%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: columns,
      splitArea: {
        show: true,
      },
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: 16,
      },
    },
    yAxis: {
      type: 'category',
      data: rowLabels,
      splitArea: {
        show: true,
      },
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
        fontSize: 16,
      },
    },
    visualMap: {
      min: minValue,
      max: maxValue,
      calculable: true,
      orient: 'vertical',
      right: '2%',
      top: 'center',
      inRange: {
        color: [
          mix(palette.primary, bg, 30),
          mix(palette.colors.cyan, bg, 30),
          mix(palette.colors.yellow, bg, 30),
          mix(palette.colors.orange, bg, 30),
        ],
      },
      textStyle: {
        color: textColor,
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
          show: true,
          color: textColor,
          fontSize: 14,
          fontWeight: 'bold' as const,
        },
        emphasis: {
          ...EMPHASIS_SELF,
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
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
  textColor: string,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  // Sort data descending by value for funnel ordering
  const sorted = [...parsed.data].sort((a, b) => b.value - a.value);
  const topValue = sorted.length > 0 ? sorted[0].value : 1;

  const data = sorted.map((d) => {
    const stroke = d.color ?? colors[parsed.data.indexOf(d) % colors.length];
    return {
      name: d.label,
      value: d.value,
      itemStyle: {
        color: mix(stroke, bg, 30),
        borderColor: stroke,
        borderWidth: CHART_BORDER_WIDTH,
      },
    };
  });

  // Build lookup for tooltip: previous step value (in sorted order)
  const prevValueMap = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    prevValueMap.set(
      sorted[i].label,
      i > 0 ? sorted[i - 1].value : sorted[i].value
    );
  }

  const funnelTop = parsed.title ? 60 : 20;
  const funnelLayout = {
    left: '20%',
    top: funnelTop,
    bottom: 20,
    width: '60%',
    sort: 'descending' as const,
    gap: 2,
    minSize: '8%',
  };

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'item',
      ...tooltipTheme,
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; dataIndex: number };
        const val = p.value;
        const prev = prevValueMap.get(p.name) ?? val;
        const isFirst = p.dataIndex === 0;
        if (isFirst) return '';
        const parts: string[] = [];
        const stepDrop = ((1 - val / prev) * 100).toFixed(1);
        parts.push(`Step drop-off: ${stepDrop}%`);
        if (topValue > 0) {
          const totalDrop = ((1 - val / topValue) * 100).toFixed(1);
          parts.push(`Overall drop-off: ${totalDrop}%`);
        }
        return parts.join('<br/>');
      },
    },
    series: [
      {
        type: 'funnel',
        ...funnelLayout,
        label: {
          show: true,
          position: 'left',
          formatter: '{b}',
          color: textColor,
          fontSize: 13,
        },
        labelLine: {
          show: true,
          length: 10,
          lineStyle: { color: textColor, opacity: 0.3 },
        },
        emphasis: {
          ...EMPHASIS_SELF,
          label: {
            fontSize: 15,
          },
        },
        data,
      },
      {
        type: 'funnel',
        ...funnelLayout,
        silent: true,
        itemStyle: { color: 'transparent', borderWidth: 0 },
        label: {
          show: true,
          position: 'right',
          formatter: '{c}',
          color: textColor,
          fontSize: 13,
        },
        labelLine: {
          show: true,
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
  return {
    xLabel: parsed.xlabel ?? (isHorizontal ? parsed.label : undefined),
    yLabel: parsed.ylabel ?? (isHorizontal ? undefined : parsed.label),
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
  intervalOverride?: number
): Record<string, unknown> {
  const defaultGap = type === 'value' ? 75 : 40;

  // Compute category label sizing: font size and width constraint
  let catFontSize = 16;
  let catLabelExtras: Record<string, unknown> = {};
  if (type === 'category' && data && data.length > 0) {
    const maxLabelLen = Math.max(...data.map((l) => l.length));
    const count = data.length;
    // When interval skips labels, base sizing on visible count (≈ count / step)
    const step = intervalOverride != null && intervalOverride > 0 ? intervalOverride + 1 : 1;
    const visibleCount = Math.ceil(count / step);
    // Reduce font size based on density and label length
    if (visibleCount > 10 || maxLabelLen > 20) catFontSize = 10;
    else if (visibleCount > 5 || maxLabelLen > 14) catFontSize = 11;
    else if (maxLabelLen > 8) catFontSize = 12;

    // Constrain labels to their allotted slot width so ECharts wraps instead of hiding.
    // Skip when interval > 0 — visible labels are spread out and need no constraint.
    if ((intervalOverride == null || intervalOverride === 0) && chartWidthHint && count > 0) {
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
      fontSize: type === 'category' && data ? catFontSize : 16,
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
      nameTextStyle: { color: textColor, fontSize: 18, fontFamily: FONT_FAMILY },
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
  chartWidth?: number
): EChartsOption {
  if (parsed.error) return {};

  const { textColor, axisLineColor, splitLineColor, gridOpacity, colors, titleConfig, tooltipTheme } = buildChartCommons(parsed, palette, isDark);
  const bg = isDark ? palette.surface : palette.bg;

  switch (parsed.type) {
    case 'bar':
      return buildBarOption(parsed, textColor, axisLineColor, splitLineColor, gridOpacity, colors, bg, titleConfig, tooltipTheme, chartWidth);
    case 'bar-stacked':
      return buildBarStackedOption(parsed, textColor, axisLineColor, splitLineColor, gridOpacity, colors, bg, titleConfig, tooltipTheme, chartWidth);
    case 'line':
      return parsed.seriesNames
        ? buildMultiLineOption(parsed, palette, textColor, axisLineColor, splitLineColor, gridOpacity, colors, titleConfig, tooltipTheme, chartWidth)
        : buildLineOption(parsed, palette, textColor, axisLineColor, splitLineColor, gridOpacity, titleConfig, tooltipTheme, chartWidth);
    case 'area':
      return buildAreaOption(parsed, palette, textColor, axisLineColor, splitLineColor, gridOpacity, titleConfig, tooltipTheme, chartWidth);
    case 'pie':
      return buildPieOption(parsed, textColor, getSegmentColors(palette, parsed.data.length), bg, titleConfig, tooltipTheme, false);
    case 'doughnut':
      return buildPieOption(parsed, textColor, getSegmentColors(palette, parsed.data.length), bg, titleConfig, tooltipTheme, true);
    case 'radar':
      return buildRadarOption(parsed, palette, isDark, textColor, gridOpacity, titleConfig, tooltipTheme);
    case 'polar-area':
      return buildPolarAreaOption(parsed, textColor, getSegmentColors(palette, parsed.data.length), bg, titleConfig, tooltipTheme);
  }
}

/**
 * Builds a standard chart grid object with consistent spacing rules.
 */
function makeChartGrid(options: { xLabel?: string; yLabel?: string; hasTitle: boolean; hasLegend?: boolean }): Record<string, unknown> {
  return {
    left: options.yLabel ? '12%' : '3%',
    right: '4%',
    bottom: options.hasLegend ? '15%' : options.xLabel ? '10%' : '3%',
    top: options.hasTitle ? '15%' : '5%',
    containLabel: true,
  };
}

// ── Bar ──────────────────────────────────────────────────────

function buildBarOption(
  parsed: ParsedChart,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>,
  chartWidth?: number
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const isHorizontal = parsed.orientation === 'horizontal';
  const labels = parsed.data.map((d) => d.label);
  const data = parsed.data.map((d, i) => {
    const stroke = d.color ?? colors[i % colors.length];
    return {
      value: d.value,
      itemStyle: { color: mix(stroke, bg, 30), borderColor: stroke, borderWidth: CHART_BORDER_WIDTH },
    };
  });

  // When category labels are on the y-axis (horizontal bars), they can be wide —
  // compute a nameGap that clears the longest label so the ylabel doesn't overlap.
  const hCatGap = isHorizontal && yLabel
    ? Math.max(40, Math.max(...labels.map((l) => l.length)) * 8 + 16)
    : undefined;
  const categoryAxis = makeGridAxis('category', textColor, axisLineColor, splitLineColor, gridOpacity, isHorizontal ? yLabel : xLabel, labels, hCatGap, !isHorizontal ? chartWidth : undefined);
  const valueAxis = makeGridAxis('value', textColor, axisLineColor, splitLineColor, gridOpacity, isHorizontal ? xLabel : yLabel);

  // xAxis is always the bottom axis, yAxis is always the left axis in ECharts

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'shadow' },
    },
    grid: makeChartGrid({ xLabel, yLabel, hasTitle: !!parsed.title }),
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series: [
      {
        type: 'bar',
        data,
        emphasis: EMPHASIS_SELF,
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
  if (count <= 6) return 0; // show all
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
    tooltip: { show: true },
    data: eras.map((era) => {
      const startIdx = labels.indexOf(era.start);
      const endIdx = labels.indexOf(era.end);
      const bandSlots = startIdx >= 0 && endIdx >= 0 ? endIdx - startIdx : Infinity;
      const color = era.color ?? defaultColor;
      return [
        {
          name: era.label,
          xAxis: era.start,
          itemStyle: { color, opacity: 0.15 },
          label: {
            show: bandSlots >= 3,
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
  tooltipTheme: Record<string, unknown>,
  chartWidth?: number
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const lineColor = parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const labels = parsed.data.map((d) => d.label);
  const values = parsed.data.map((d) => d.value);
  const eras = parsed.eras ?? [];
  const interval = buildIntervalStep(labels);
  const markArea = buildMarkArea(eras, labels, textColor, palette.colors.blue);

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'line' },
    },
    grid: makeChartGrid({ xLabel, yLabel, hasTitle: !!parsed.title }),
    xAxis: makeGridAxis('category', textColor, axisLineColor, splitLineColor, gridOpacity, xLabel, labels, undefined, chartWidth, interval),
    yAxis: makeGridAxis('value', textColor, axisLineColor, splitLineColor, gridOpacity, yLabel),
    series: [
      {
        type: 'line',
        data: values,
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: lineColor, width: 3 },
        itemStyle: { color: lineColor },
        emphasis: EMPHASIS_SELF,
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
  tooltipTheme: Record<string, unknown>,
  chartWidth?: number
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const seriesNames = parsed.seriesNames ?? [];
  const labels = parsed.data.map((d) => d.label);
  const eras = parsed.eras ?? [];
  const interval = buildIntervalStep(labels);
  const markArea = buildMarkArea(eras, labels, textColor, palette.colors.blue);

  const series = seriesNames.map((name, idx) => {
    const color = parsed.seriesNameColors?.[idx] ?? colors[idx % colors.length];
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
      emphasis: EMPHASIS_SELF,
      ...(idx === 0 && markArea && { markArea }),
    };
  });

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'line' },
    },
    legend: {
      data: seriesNames,
      bottom: 10,
      textStyle: { color: textColor },
    },
    grid: makeChartGrid({ xLabel, yLabel, hasTitle: !!parsed.title, hasLegend: true }),
    xAxis: makeGridAxis('category', textColor, axisLineColor, splitLineColor, gridOpacity, xLabel, labels, undefined, chartWidth, interval),
    yAxis: makeGridAxis('value', textColor, axisLineColor, splitLineColor, gridOpacity, yLabel),
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
  tooltipTheme: Record<string, unknown>,
  chartWidth?: number
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const lineColor = parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const labels = parsed.data.map((d) => d.label);
  const values = parsed.data.map((d) => d.value);
  const eras = parsed.eras ?? [];
  const interval = buildIntervalStep(labels);
  const markArea = buildMarkArea(eras, labels, textColor, palette.colors.blue);

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'line' },
    },
    grid: makeChartGrid({ xLabel, yLabel, hasTitle: !!parsed.title }),
    xAxis: makeGridAxis('category', textColor, axisLineColor, splitLineColor, gridOpacity, xLabel, labels, undefined, chartWidth, interval),
    yAxis: makeGridAxis('value', textColor, axisLineColor, splitLineColor, gridOpacity, yLabel),
    series: [
      {
        type: 'line',
        data: values,
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: lineColor, width: 3 },
        itemStyle: { color: lineColor },
        areaStyle: { opacity: 0.25 },
        emphasis: EMPHASIS_SELF,
        ...(markArea && { markArea }),
      },
    ],
  };
}

// ── Segment label formatter ──────────────────────────────────

function segmentLabelFormatter(mode: ParsedChart['labels']): string {
  switch (mode) {
    case 'name':    return '{b}';
    case 'value':   return '{b} — {c}';
    case 'percent': return '{b} — {d}%';
    default:        return '{b} — {c} ({d}%)';
  }
}

// ── Pie / Doughnut ───────────────────────────────────────────

function buildPieOption(
  parsed: ParsedChart,
  textColor: string,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>,
  isDoughnut: boolean
): EChartsOption {
  const data = parsed.data.map((d, i) => {
    const stroke = d.color ?? colors[i % colors.length];
    return {
      name: d.label,
      value: d.value,
      itemStyle: { color: mix(stroke, bg, 30), borderColor: stroke, borderWidth: CHART_BORDER_WIDTH },
    };
  });

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'item',
      ...tooltipTheme,
    },
    series: [
      {
        type: 'pie',
        radius: isDoughnut ? ['40%', '70%'] : ['0%', '70%'],
        data,
        label: {
          position: 'outside',
          formatter: segmentLabelFormatter(parsed.labels),
          color: textColor,
          fontFamily: FONT_FAMILY,
        },
        labelLine: { show: true },
        emphasis: EMPHASIS_SELF,
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
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const bg = isDark ? palette.surface : palette.bg;
  const radarColor = parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const values = parsed.data.map((d) => d.value);
  const maxValue = Math.max(...values) * 1.15;

  const indicator = parsed.data.map((d) => ({
    name: d.label,
    max: maxValue,
  }));

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'item',
      ...tooltipTheme,
    },
    radar: {
      indicator,
      axisName: {
        color: textColor,
        fontFamily: FONT_FAMILY,
        fontSize: 16,
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
            areaStyle: { color: mix(radarColor, bg, 30) },
            lineStyle: { color: radarColor },
            itemStyle: { color: radarColor },
            symbol: 'circle',
            symbolSize: 8,
            label: {
              show: true,
              formatter: '{c}',
              color: textColor,
              fontSize: 11,
              fontFamily: FONT_FAMILY,
            },
          },
        ],
        emphasis: EMPHASIS_SELF,
      },
    ],
  };
}

// ── Polar Area ───────────────────────────────────────────────

function buildPolarAreaOption(
  parsed: ParsedChart,
  textColor: string,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const data = parsed.data.map((d, i) => {
    const stroke = d.color ?? colors[i % colors.length];
    return {
      name: d.label,
      value: d.value,
      itemStyle: { color: mix(stroke, bg, 30), borderColor: stroke, borderWidth: CHART_BORDER_WIDTH },
    };
  });

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'item',
      ...tooltipTheme,
    },
    series: [
      {
        type: 'pie',
        roseType: 'radius',
        radius: ['10%', '70%'],
        data,
        label: {
          position: 'outside',
          formatter: segmentLabelFormatter(parsed.labels),
          color: textColor,
          fontFamily: FONT_FAMILY,
        },
        labelLine: { show: true },
        emphasis: EMPHASIS_SELF,
      },
    ],
  };
}

// ── Bar Stacked ──────────────────────────────────────────────

function buildBarStackedOption(
  parsed: ParsedChart,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  gridOpacity: number,
  colors: string[],
  bg: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>,
  chartWidth?: number
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const isHorizontal = parsed.orientation === 'horizontal';
  const seriesNames = parsed.seriesNames ?? [];
  const labels = parsed.data.map((d) => d.label);

  const series = seriesNames.map((name, idx) => {
    const color = parsed.seriesNameColors?.[idx] ?? colors[idx % colors.length];
    const data = parsed.data.map((dp) =>
      idx === 0 ? dp.value : (dp.extraValues?.[idx - 1] ?? 0)
    );
    return {
      name,
      type: 'bar' as const,
      stack: 'total',
      data,
      itemStyle: { color: mix(color, bg, 30), borderColor: color, borderWidth: CHART_BORDER_WIDTH },
      label: {
        show: true,
        position: 'inside' as const,
        formatter: '{c}',
        color: textColor,
        fontSize: 14,
        fontWeight: 'bold' as const,
        fontFamily: FONT_FAMILY,
      },
      emphasis: EMPHASIS_SELF,
    };
  });

  const hCatGap = isHorizontal && yLabel
    ? Math.max(40, Math.max(...labels.map((l) => l.length)) * 8 + 16)
    : undefined;
  const categoryAxis = makeGridAxis('category', textColor, axisLineColor, splitLineColor, gridOpacity, isHorizontal ? yLabel : xLabel, labels, hCatGap, !isHorizontal ? chartWidth : undefined);
  // For horizontal bars with a legend, use a smaller nameGap so the xlabel
  // stays close to the axis ticks rather than drifting toward the legend.
  const hValueGap = isHorizontal && xLabel ? 40 : undefined;
  const valueAxis = makeGridAxis('value', textColor, axisLineColor, splitLineColor, gridOpacity, isHorizontal ? xLabel : yLabel, undefined, hValueGap);

  return {
    ...CHART_BASE,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'shadow' },
    },
    legend: {
      data: seriesNames,
      bottom: 10,
      textStyle: { color: textColor },
    },
    grid: makeChartGrid({ xLabel, yLabel, hasTitle: !!parsed.title, hasLegend: true }),
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series,
  };
}

// ============================================================
// ECharts SSR Export
// ============================================================

const ECHART_EXPORT_WIDTH = 1200;
const ECHART_EXPORT_HEIGHT = 800;

// Standard chart types handled by buildSimpleChartOption (via parseChart)
const STANDARD_CHART_TYPES = new Set([
  'bar', 'line', 'multi-line', 'area', 'pie', 'doughnut',
  'radar', 'polar-area', 'bar-stacked',
]);

/**
 * Renders an extended chart (scatter, sankey, chord, function, heatmap, funnel) to SVG using server-side rendering.
 * Mirrors the `renderForExport` API — returns an SVG string or empty string on failure.
 */
export async function renderExtendedChartForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors,
  options?: { branding?: boolean }
): Promise<string> {
  const isDark = theme === 'dark';

  // Fall back to Nord palette if none provided
  const { getPalette } = await import('./palettes');
  const effectivePalette =
    palette ?? (isDark ? getPalette('nord').dark : getPalette('nord').light);

  // Detect chart type to dispatch to the right parser/builder
  const chartLine = content.match(/^chart\s*:\s*(.+)/im);
  const chartType = chartLine?.[1]?.trim().toLowerCase();

  let option: EChartsOption;
  if (chartType && STANDARD_CHART_TYPES.has(chartType)) {
    const parsed = parseChart(content, effectivePalette);
    if (parsed.error) return '';
    option = buildSimpleChartOption(parsed, effectivePalette, isDark, ECHART_EXPORT_WIDTH);
  } else {
    const parsed = parseExtendedChart(content, effectivePalette);
    if (parsed.error) return '';
    option = buildExtendedChartOption(parsed, effectivePalette, isDark);
  }
  if (!option || Object.keys(option).length === 0) return '';

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
    const bgStyle = theme !== 'transparent' ? `background: ${effectivePalette.bg}; ` : '';
    let result = svgString.replace(
      /^<svg /,
      `<svg style="${bgStyle}font-family: ${FONT_FAMILY}" `
    );

    if (options?.branding !== false) {
      const brandColor = theme === 'transparent' ? '#888' : effectivePalette.textMuted;
      result = injectBranding(result, brandColor);
    }

    return result;
  } finally {
    chart.dispose();
  }
}
