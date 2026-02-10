import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { FONT_FAMILY } from './fonts';

// ============================================================
// Types
// ============================================================

export type EChartsChartType =
  | 'sankey'
  | 'chord'
  | 'function'
  | 'scatter'
  | 'heatmap'
  | 'funnel';

export interface EChartsDataPoint {
  label: string;
  value: number;
  color?: string;
  lineNumber: number;
}

export interface ParsedSankeyLink {
  source: string;
  target: string;
  value: number;
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

export interface ParsedEChart {
  type: EChartsChartType;
  title?: string;
  series?: string;
  seriesNames?: string[];
  seriesNameColors?: (string | undefined)[];
  data: EChartsDataPoint[];
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
  error?: string;
}

// ============================================================
// Nord Colors for Charts
// ============================================================

import { resolveColor } from './colors';
import type { PaletteColors } from './palettes';
import { getSeriesColors, contrastText } from './palettes';
import { parseChart } from './chart';
import type { ParsedChart } from './chart';

// ============================================================
// Parser
// ============================================================

/**
 * Parses the simple echart text format into a structured object.
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
export function parseEChart(
  content: string,
  palette?: PaletteColors
): ParsedEChart {
  const lines = content.split('\n');
  const result: ParsedEChart = {
    type: 'scatter',
    data: [],
  };

  // Track current category for grouped scatter charts
  let currentCategory = 'Default';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Check for markdown-style category header: ## Category Name or ## Category Name(color)
    const mdCategoryMatch = trimmed.match(/^#{2,}\s+(.+)$/);
    if (mdCategoryMatch) {
      let catName = mdCategoryMatch[1].trim();
      const catColorMatch = catName.match(/\(([^)]+)\)\s*$/);
      if (catColorMatch) {
        const resolved = resolveColor(catColorMatch[1].trim(), palette);
        if (!result.categoryColors) result.categoryColors = {};
        catName = catName.substring(0, catColorMatch.index!).trim();
        result.categoryColors[catName] = resolved;
      }
      currentCategory = catName;
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    // Check for category header: [Category Name]
    const categoryMatch = trimmed.match(/^\[(.+)\]$/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    // Parse key: value pairs
    const colonIndex = trimmed.indexOf(':');
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
        result.error = `Unsupported chart type: ${value}. Supported types: scatter, sankey, chord, function, heatmap, funnel.`;
        return result;
      }
      continue;
    }

    if (key === 'title') {
      result.title = value;
      continue;
    }

    if (key === 'series') {
      result.series = value;
      const rawNames = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const names: string[] = [];
      const nameColors: (string | undefined)[] = [];
      for (const raw of rawNames) {
        const colorMatch = raw.match(/\(([^)]+)\)\s*$/);
        if (colorMatch) {
          nameColors.push(resolveColor(colorMatch[1].trim(), palette));
          names.push(raw.substring(0, colorMatch.index!).trim());
        } else {
          nameColors.push(undefined);
          names.push(raw);
        }
      }
      if (names.length === 1) {
        result.series = names[0];
      }
      if (nameColors.some(Boolean)) result.seriesNameColors = nameColors;
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
      result.columns = value.split(',').map((s) => s.trim());
      continue;
    }

    if (key === 'rows') {
      result.rows = value.split(',').map((s) => s.trim());
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

    // Check for Sankey arrow syntax: Source -> Target: Value
    const arrowMatch = trimmed.match(/^(.+?)\s*->\s*(.+?):\s*(\d+(?:\.\d+)?)$/);
    if (arrowMatch) {
      const [, source, target, val] = arrowMatch;
      if (!result.links) result.links = [];
      result.links.push({
        source: source.trim(),
        target: target.trim(),
        value: parseFloat(val),
        lineNumber,
      });
      continue;
    }

    // For function charts, treat non-numeric values as function expressions
    if (result.type === 'function') {
      let fnName = trimmed.substring(0, colonIndex).trim();
      let fnColor: string | undefined;
      const colorMatch = fnName.match(/\(([^)]+)\)\s*$/);
      if (colorMatch) {
        fnColor = resolveColor(colorMatch[1].trim(), palette);
        fnName = fnName.substring(0, colorMatch.index!).trim();
      }
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
        let scatterName = trimmed.substring(0, colonIndex).trim();
        let scatterColor: string | undefined;
        const colorMatch = scatterName.match(/\(([^)]+)\)\s*$/);
        if (colorMatch) {
          scatterColor = resolveColor(colorMatch[1].trim(), palette);
          scatterName = scatterName.substring(0, colorMatch.index!).trim();
        }
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
      // Use the original case for the label (before lowercasing)
      let rawLabel = trimmed.substring(0, colonIndex).trim();
      let pointColor: string | undefined;
      const colorMatch = rawLabel.match(/\(([^)]+)\)\s*$/);
      if (colorMatch) {
        pointColor = resolveColor(colorMatch[1].trim(), palette);
        rawLabel = rawLabel.substring(0, colorMatch.index!).trim();
      }
      result.data.push({
        label: rawLabel,
        value: numValue,
        ...(pointColor && { color: pointColor }),
        lineNumber,
      });
    }
  }

  if (!result.error) {
    if (result.type === 'sankey') {
      if (!result.links || result.links.length === 0) {
        result.error =
          'No links found. Add links in format: Source -> Target: 123';
      }
    } else if (result.type === 'chord') {
      if (!result.links || result.links.length === 0) {
        result.error =
          'No links found. Add links in format: Source -> Target: 123';
      }
    } else if (result.type === 'function') {
      if (!result.functions || result.functions.length === 0) {
        result.error =
          'No functions found. Add functions in format: Name: expression';
      }
      if (!result.xRange) {
        result.xRange = { min: -10, max: 10 }; // Default range
      }
    } else if (result.type === 'scatter') {
      if (!result.scatterPoints || result.scatterPoints.length === 0) {
        result.error =
          'No scatter points found. Add points in format: Name: x, y or Name: x, y, size';
      }
    } else if (result.type === 'heatmap') {
      if (!result.heatmapRows || result.heatmapRows.length === 0) {
        result.error =
          'No heatmap data found. Add data in format: RowLabel: val1, val2, val3';
      }
      if (!result.columns || result.columns.length === 0) {
        result.error =
          'No columns defined. Add columns in format: columns: Col1, Col2, Col3';
      }
    } else if (result.type === 'funnel') {
      if (result.data.length === 0) {
        result.error = 'No data found. Add data in format: Label: value';
      }
    }
  }

  return result;
}

// ============================================================
// ECharts Option Builder
// ============================================================

/**
 * Converts parsed echart data to ECharts option object.
 */
export function buildEChartsOption(
  parsed: ParsedEChart,
  palette: PaletteColors,
  _isDark: boolean
): EChartsOption {
  const textColor = palette.text;
  const axisLineColor = palette.border;
  const colors = getSeriesColors(palette);

  if (parsed.error) {
    // Return empty option, error will be shown separately
    return {};
  }

  // Common title configuration
  const titleConfig = parsed.title
    ? {
        text: parsed.title,
        left: 'center' as const,
        textStyle: {
          color: textColor,
          fontSize: 18,
          fontWeight: 'bold' as const,
          fontFamily: FONT_FAMILY,
        },
      }
    : undefined;

  // Shared tooltip theme so tooltips match light/dark mode
  const tooltipTheme = {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    textStyle: { color: palette.text },
  };

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
    return buildChordOption(
      parsed,
      textColor,
      colors,
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
      colors,
      titleConfig,
      tooltipTheme
    );
  }

  // Scatter plot
  if (parsed.type === 'scatter') {
    return buildScatterOption(
      parsed,
      palette,
      textColor,
      axisLineColor,
      colors,
      titleConfig,
      tooltipTheme
    );
  }

  // Funnel chart
  if (parsed.type === 'funnel') {
    return buildFunnelOption(
      parsed,
      textColor,
      colors,
      titleConfig,
      tooltipTheme
    );
  }

  // Heatmap
  return buildHeatmapOption(
    parsed,
    palette,
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
  parsed: ParsedEChart,
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
      color: colors[index % colors.length],
    },
  }));

  return {
    backgroundColor: 'transparent',
    animation: false,
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
        },
        nodeAlign: 'left',
        nodeGap: 12,
        nodeWidth: 20,
        data: nodes,
        links: parsed.links ?? [],
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
  parsed: ParsedEChart,
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
  const categories = nodeNames.map((name, index) => ({
    name,
    itemStyle: {
      color: colors[index % colors.length],
    },
  }));

  return {
    backgroundColor: 'transparent',
    animation: false,
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
  parsed: ParsedEChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
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
    };
  });

  return {
    backgroundColor: 'transparent',
    animation: false,
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
      left: '3%',
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
      },
      splitLine: {
        lineStyle: {
          color: palette.overlay,
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
      },
      splitLine: {
        lineStyle: {
          color: palette.overlay,
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
  parsed: ParsedEChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
  colors: string[],
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
        ...(p.color && { itemStyle: { color: p.color } }),
      }));

      return {
        name: category,
        type: 'scatter' as const,
        data,
        ...(hasSize
          ? { symbolSize: (val: number[]) => val[2] }
          : { symbolSize: defaultSize }),
        itemStyle: { color: catColor },
        label: labelConfig,
        emphasis: emphasisConfig,
      };
    });
  } else {
    // Single series — per-point colors
    const data = points.map((p, index) => ({
      name: p.name,
      value: hasSize ? [p.x, p.y, p.size ?? 0] : [p.x, p.y],
      ...(hasSize
        ? { symbolSize: p.size ?? defaultSize }
        : { symbolSize: defaultSize }),
      itemStyle: {
        color: p.color ?? colors[index % colors.length],
      },
    }));

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
    backgroundColor: 'transparent',
    animation: false,
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
      left: '3%',
      right: '4%',
      bottom: hasCategories ? '15%' : '3%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: parsed.xlabel,
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: {
        color: textColor,
        fontSize: 12,
      },
      min: Math.floor(xMin - xPad),
      max: Math.ceil(xMax + xPad),
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
      },
      splitLine: {
        lineStyle: {
          color: palette.overlay,
        },
      },
    },
    yAxis: {
      type: 'value',
      name: parsed.ylabel,
      nameLocation: 'middle',
      nameGap: 40,
      nameTextStyle: {
        color: textColor,
        fontSize: 12,
      },
      min: Math.floor(yMin - yPad),
      max: Math.ceil(yMax + yPad),
      axisLine: {
        lineStyle: { color: axisLineColor },
      },
      axisLabel: {
        color: textColor,
      },
      splitLine: {
        lineStyle: {
          color: palette.overlay,
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
  parsed: ParsedEChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
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
    backgroundColor: 'transparent',
    animation: false,
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
          palette.bg,
          palette.primary,
          palette.colors.cyan,
          palette.colors.yellow,
          palette.colors.orange,
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
        label: {
          show: true,
          color: textColor,
        },
        emphasis: {
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
  parsed: ParsedEChart,
  textColor: string,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  // Sort data descending by value for funnel ordering
  const sorted = [...parsed.data].sort((a, b) => b.value - a.value);
  const topValue = sorted.length > 0 ? sorted[0].value : 1;

  const data = sorted.map((d) => ({
    name: d.label,
    value: d.value,
    itemStyle: {
      color: d.color ?? colors[parsed.data.indexOf(d) % colors.length],
      borderWidth: 0,
    },
  }));

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
    backgroundColor: 'transparent',
    animation: false,
    title: titleConfig,
    tooltip: {
      trigger: 'item',
      ...tooltipTheme,
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; dataIndex: number };
        const val = p.value;
        const prev = prevValueMap.get(p.name) ?? val;
        const isFirst = p.dataIndex === 0;
        let html = `<strong>${p.name}</strong>: ${val}`;
        if (!isFirst) {
          const stepDrop = ((1 - val / prev) * 100).toFixed(1);
          html += `<br/>Step drop-off: ${stepDrop}%`;
        }
        if (!isFirst && topValue > 0) {
          const totalDrop = ((1 - val / topValue) * 100).toFixed(1);
          html += `<br/>Overall drop-off: ${totalDrop}%`;
        }
        return html;
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
  label?: string,
  data?: string[]
): Record<string, unknown> {
  return {
    type,
    ...(data && { data }),
    axisLine: { lineStyle: { color: axisLineColor } },
    axisLabel: { color: textColor, fontFamily: FONT_FAMILY },
    splitLine: { lineStyle: { color: splitLineColor } },
    ...(label && {
      name: label,
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: textColor, fontSize: 12, fontFamily: FONT_FAMILY },
    }),
  };
}

/**
 * Converts a ParsedChart into an EChartsOption.
 * Renders standard chart types (bar, line, pie, etc.) with ECharts.
 */
export function buildEChartsOptionFromChart(
  parsed: ParsedChart,
  palette: PaletteColors,
  _isDark: boolean
): EChartsOption {
  if (parsed.error) return {};

  const textColor = palette.text;
  const axisLineColor = palette.border;
  const splitLineColor = palette.overlay;
  const colors = getSeriesColors(palette);

  const titleConfig = parsed.title
    ? {
        text: parsed.title,
        left: 'center' as const,
        textStyle: {
          color: textColor,
          fontSize: 18,
          fontWeight: 'bold' as const,
          fontFamily: FONT_FAMILY,
        },
      }
    : undefined;

  const tooltipTheme = {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    textStyle: { color: palette.text },
  };

  switch (parsed.type) {
    case 'bar':
      return buildBarOption(parsed, textColor, axisLineColor, splitLineColor, colors, titleConfig, tooltipTheme);
    case 'bar-stacked':
      return buildBarStackedOption(parsed, textColor, axisLineColor, splitLineColor, colors, titleConfig, tooltipTheme);
    case 'line':
      return parsed.seriesNames
        ? buildMultiLineOption(parsed, textColor, axisLineColor, splitLineColor, colors, titleConfig, tooltipTheme)
        : buildLineOption(parsed, palette, textColor, axisLineColor, splitLineColor, titleConfig, tooltipTheme);
    case 'area':
      return buildAreaOption(parsed, palette, textColor, axisLineColor, splitLineColor, titleConfig, tooltipTheme);
    case 'pie':
      return buildPieOption(parsed, textColor, colors, titleConfig, tooltipTheme, false);
    case 'doughnut':
      return buildPieOption(parsed, textColor, colors, titleConfig, tooltipTheme, true);
    case 'radar':
      return buildRadarOption(parsed, palette, textColor, colors, titleConfig, tooltipTheme);
    case 'polar-area':
      return buildPolarAreaOption(parsed, textColor, colors, titleConfig, tooltipTheme);
  }
}

// ── Bar ──────────────────────────────────────────────────────

function buildBarOption(
  parsed: ParsedChart,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const isHorizontal = parsed.orientation === 'horizontal';
  const labels = parsed.data.map((d) => d.label);
  const data = parsed.data.map((d, i) => ({
    value: d.value,
    itemStyle: { color: d.color ?? colors[i % colors.length] },
  }));

  const categoryAxis = makeGridAxis('category', textColor, axisLineColor, splitLineColor, isHorizontal ? yLabel : xLabel, labels);
  const valueAxis = makeGridAxis('value', textColor, axisLineColor, splitLineColor, isHorizontal ? xLabel : yLabel);

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'shadow' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series: [
      {
        type: 'bar',
        data,
      },
    ],
  };
}

// ── Line ─────────────────────────────────────────────────────

function buildLineOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const lineColor = parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const labels = parsed.data.map((d) => d.label);
  const values = parsed.data.map((d) => d.value);

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'line' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: makeGridAxis('category', textColor, axisLineColor, splitLineColor, xLabel, labels),
    yAxis: makeGridAxis('value', textColor, axisLineColor, splitLineColor, yLabel),
    series: [
      {
        type: 'line',
        data: values,
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: lineColor, width: 3 },
        itemStyle: { color: lineColor },
      },
    ],
  };
}

// ── Multi-line ───────────────────────────────────────────────

function buildMultiLineOption(
  parsed: ParsedChart,
  textColor: string,
  axisLineColor: string,
  splitLineColor: string,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const seriesNames = parsed.seriesNames ?? [];
  const labels = parsed.data.map((d) => d.label);

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
    };
  });

  return {
    backgroundColor: 'transparent',
    animation: false,
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
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: makeGridAxis('category', textColor, axisLineColor, splitLineColor, xLabel, labels),
    yAxis: makeGridAxis('value', textColor, axisLineColor, splitLineColor, yLabel),
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
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const { xLabel, yLabel } = resolveAxisLabels(parsed);
  const lineColor = parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const labels = parsed.data.map((d) => d.label);
  const values = parsed.data.map((d) => d.value);

  return {
    backgroundColor: 'transparent',
    animation: false,
    title: titleConfig,
    tooltip: {
      trigger: 'axis',
      ...tooltipTheme,
      axisPointer: { type: 'line' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
    xAxis: makeGridAxis('category', textColor, axisLineColor, splitLineColor, xLabel, labels),
    yAxis: makeGridAxis('value', textColor, axisLineColor, splitLineColor, yLabel),
    series: [
      {
        type: 'line',
        data: values,
        smooth: false,
        symbolSize: 8,
        lineStyle: { color: lineColor, width: 3 },
        itemStyle: { color: lineColor },
        areaStyle: { opacity: 0.25 },
      },
    ],
  };
}

// ── Pie / Doughnut ───────────────────────────────────────────

function buildPieOption(
  parsed: ParsedChart,
  textColor: string,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>,
  isDoughnut: boolean
): EChartsOption {
  const data = parsed.data.map((d, i) => ({
    name: d.label,
    value: d.value,
    itemStyle: { color: d.color ?? colors[i % colors.length] },
  }));

  return {
    backgroundColor: 'transparent',
    animation: false,
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
          formatter: '{b} — {c} ({d}%)',
          color: textColor,
          fontFamily: FONT_FAMILY,
        },
        labelLine: { show: true },
      },
    ],
  };
}

// ── Radar ────────────────────────────────────────────────────

function buildRadarOption(
  parsed: ParsedChart,
  palette: PaletteColors,
  textColor: string,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const radarColor = parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
  const values = parsed.data.map((d) => d.value);
  const maxValue = Math.max(...values) * 1.15;
  const gridOpacity = 0.6;

  const indicator = parsed.data.map((d) => ({
    name: d.label,
    max: maxValue,
  }));

  return {
    backgroundColor: 'transparent',
    animation: false,
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
            areaStyle: { color: radarColor, opacity: 0.25 },
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
      },
    ],
  };
}

// ── Polar Area ───────────────────────────────────────────────

function buildPolarAreaOption(
  parsed: ParsedChart,
  textColor: string,
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
): EChartsOption {
  const data = parsed.data.map((d, i) => ({
    name: d.label,
    value: d.value,
    itemStyle: { color: d.color ?? colors[i % colors.length] },
  }));

  return {
    backgroundColor: 'transparent',
    animation: false,
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
          formatter: '{b} — {c} ({d}%)',
          color: textColor,
          fontFamily: FONT_FAMILY,
        },
        labelLine: { show: true },
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
  colors: string[],
  titleConfig: EChartsOption['title'],
  tooltipTheme: Record<string, unknown>
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
    const labelColor = contrastText(color, '#ffffff', '#333333');
    return {
      name,
      type: 'bar' as const,
      stack: 'total',
      data,
      itemStyle: { color },
      label: {
        show: true,
        position: 'inside' as const,
        formatter: '{c}',
        color: labelColor,
        fontSize: 11,
        fontFamily: FONT_FAMILY,
      },
    };
  });

  const categoryAxis = makeGridAxis('category', textColor, axisLineColor, splitLineColor, isHorizontal ? yLabel : xLabel, labels);
  const valueAxis = makeGridAxis('value', textColor, axisLineColor, splitLineColor, isHorizontal ? xLabel : yLabel);

  return {
    backgroundColor: 'transparent',
    animation: false,
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
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: parsed.title ? '15%' : '5%',
      containLabel: true,
    },
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
 * Renders an ECharts diagram to SVG using server-side rendering.
 * Mirrors the `renderD3ForExport` API — returns an SVG string or empty string on failure.
 */
export async function renderEChartsForExport(
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
  const chartLine = content.match(/^chart\s*:\s*(.+)/im);
  const chartType = chartLine?.[1]?.trim().toLowerCase();

  let option: EChartsOption;
  if (chartType && STANDARD_CHART_TYPES.has(chartType)) {
    const parsed = parseChart(content, effectivePalette);
    if (parsed.error) return '';
    option = buildEChartsOptionFromChart(parsed, effectivePalette, isDark);
  } else {
    const parsed = parseEChart(content, effectivePalette);
    if (parsed.error) return '';
    option = buildEChartsOption(parsed, effectivePalette, isDark);
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
    // Inject font-family on the root <svg> element for consistent rendering.
    return svgString.replace(
      /^<svg /,
      `<svg style="font-family: ${FONT_FAMILY}" `
    );
  } finally {
    chart.dispose();
  }
}
