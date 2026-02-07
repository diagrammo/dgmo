import type { ChartConfiguration } from 'chart.js';
import 'chartjs-plugin-datalabels';

// ============================================================
// Types
// ============================================================

export type ChartJsChartType =
  | 'bar'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'area'
  | 'polar-area'
  | 'radar'
  | 'bar-stacked';

export interface ChartJsDataPoint {
  label: string;
  value: number;
  extraValues?: number[];
  color?: string;
  lineNumber: number;
}

export interface ParsedChartJs {
  type: ChartJsChartType;
  title?: string;
  series?: string;
  xlabel?: string;
  ylabel?: string;
  seriesNames?: string[];
  seriesNameColors?: (string | undefined)[];
  orientation?: 'horizontal' | 'vertical';
  color?: string;
  label?: string;
  data: ChartJsDataPoint[];
  error?: string;
}

// ============================================================
// Nord Colors for Charts
// ============================================================

import { resolveColor } from './colors';
import type { PaletteColors } from './palettes';
import { getSeriesColors } from './palettes';

// ============================================================
// Parser
// ============================================================

const VALID_TYPES = new Set<ChartJsChartType>([
  'bar',
  'line',
  'pie',
  'doughnut',
  'area',
  'polar-area',
  'radar',
  'bar-stacked',
]);

const TYPE_ALIASES: Record<string, ChartJsChartType> = {
  'multi-line': 'line',
};

/**
 * Parses the simple chartjs text format into a structured object.
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
export function parseChartJs(
  content: string,
  palette?: PaletteColors
): ParsedChartJs {
  const lines = content.split('\n');
  const result: ParsedChartJs = {
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
      const chartType = (TYPE_ALIASES[raw] ?? raw) as ChartJsChartType;
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

// ============================================================
// Chart.js Config Builder
// ============================================================

/**
 * Converts parsed chartjs data to a Chart.js configuration object.
 */
export function buildChartJsConfig(
  parsed: ParsedChartJs,
  palette: PaletteColors,
  _isDark: boolean
): ChartConfiguration {
  const textColor = palette.text;
  const gridColor = palette.border + '80';
  const crosshairColor = palette.border + '60';
  const colors = getSeriesColors(palette);

  // Plugin: draws a vertical line at the hovered x-position on line/area charts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verticalCrosshairPlugin: any = {
    id: 'verticalCrosshair',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterDraw(chart: any) {
      const tooltip = chart.tooltip;
      if (!tooltip || !tooltip.getActiveElements().length) return;
      const { ctx, chartArea } = chart;
      const x = tooltip.caretX;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = crosshairColor;
      ctx.stroke();
      ctx.restore();
    },
  };

  const labels = parsed.data.map((d) => d.label);
  const values = parsed.data.map((d) => d.value);
  const perPointColors = parsed.data.map(
    (d, i) => d.color ?? colors[i % colors.length]
  );

  const titlePlugin = parsed.title
    ? {
        display: true as const,
        text: parsed.title,
        color: textColor,
        font: { size: 18, weight: 'bold' as const },
        padding: { bottom: 16 },
      }
    : { display: false as const };

  const tooltipConfig = {
    backgroundColor: palette.surface,
    titleColor: palette.text,
    bodyColor: palette.text,
    borderColor: palette.border,
    borderWidth: 1,
  };

  // Resolve `label:` to the value axis (Y for vertical, X for horizontal)
  const isHorizontalChart = parsed.orientation === 'horizontal';
  const resolvedXLabel =
    parsed.xlabel ?? (isHorizontalChart ? parsed.label : undefined);
  const resolvedYLabel =
    parsed.ylabel ?? (isHorizontalChart ? undefined : parsed.label);

  // Axis title configs (used by chart types with x/y scales)
  const xAxisTitle = resolvedXLabel
    ? { display: true, text: resolvedXLabel, color: textColor }
    : undefined;
  const yAxisTitle = resolvedYLabel
    ? { display: true, text: resolvedYLabel, color: textColor }
    : undefined;

  // Radar chart
  if (parsed.type === 'radar') {
    const radarColor =
      parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;
    // Subtle grid color for concentric reference lines drawn on top
    const radarGridColor = palette.border + '60';

    // Plugin: draws concentric polygon grid lines ON TOP of the data area.
    // This makes the reference shapes visible even with solid fill.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const radarGridOverlayPlugin: any = {
      id: 'radarGridOverlay',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterDatasetsDraw(chart: any) {
        const scale = chart.scales.r;
        if (!scale) return;
        const ticks = scale.ticks as { value: number }[];
        if (!ticks || ticks.length < 1) return;

        const { ctx } = chart;
        const pointCount = chart.data.labels?.length ?? 0;
        if (pointCount < 3) return;

        ctx.save();
        ctx.strokeStyle = radarGridColor;
        ctx.lineWidth = 1;

        // Draw concentric polygon lines for each tick
        for (let i = 0; i < ticks.length; i++) {
          const dist = scale.getDistanceFromCenterForValue(
            ticks[i].value
          ) as number;
          if (dist <= 0) continue;

          ctx.beginPath();
          for (let p = 0; p < pointCount; p++) {
            const pos = scale.getPointPosition(p, dist);
            if (p === 0) ctx.moveTo(pos.x, pos.y);
            else ctx.lineTo(pos.x, pos.y);
          }
          ctx.closePath();
          ctx.stroke();
        }

        // Draw angle lines from center to each point
        const outerDist = scale.getDistanceFromCenterForValue(
          ticks[ticks.length - 1].value
        ) as number;
        for (let p = 0; p < pointCount; p++) {
          const pos = scale.getPointPosition(p, outerDist);
          ctx.beginPath();
          ctx.moveTo(scale.xCenter, scale.yCenter);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
        }

        ctx.restore();
      },
    };

    return {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            label: parsed.series ?? 'Value',
            data: values,
            backgroundColor: radarColor,
            borderColor: 'transparent',
            borderWidth: 0,
            pointBackgroundColor: radarColor,
            pointRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          title: titlePlugin,
          tooltip: tooltipConfig,
          datalabels: {
            display: true,
            color: textColor,
            backgroundColor: palette.bg + 'cc',
            borderRadius: 3,
            padding: { top: 2, bottom: 2, left: 4, right: 4 },
            font: { size: 11, weight: 'bold' as const },
            anchor: 'center' as const,
            align: 'center' as const,
            formatter: (value: number) => value.toString(),
          },
        },
        scales: {
          r: {
            beginAtZero: true,
            ticks: {
              // Hide tick labels - we show actual values on data points instead
              display: false,
            },
            grid: {
              // Hide default grid - we draw it on top via plugin
              display: false,
            },
            angleLines: {
              // Hide default angle lines - we draw them on top via plugin
              display: false,
            },
            pointLabels: {
              color: textColor,
              font: { size: 12, weight: 'bold' as const },
            },
          },
        },
      },
      plugins: [radarGridOverlayPlugin],
    } as ChartConfiguration;
  }

  // Polar Area chart (styled like pie/doughnut: outer labels, no legend)
  if (parsed.type === 'polar-area') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const polarConnectorPlugin: any = {
      id: 'polarConnectorLines',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterDatasetsDraw(chart: any) {
        const meta = chart.getDatasetMeta(0);
        if (!meta?.data?.length) return;

        const { ctx } = chart;
        ctx.save();
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 1;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meta.data.forEach((arc: any) => {
          const {
            startAngle,
            endAngle,
            outerRadius,
            x: cx,
            y: cy,
          } = arc.getProps(['startAngle', 'endAngle', 'outerRadius', 'x', 'y']);
          const midAngle = (startAngle + endAngle) / 2;
          const r1 = outerRadius + 2;
          const r2 = outerRadius + 14;

          ctx.beginPath();
          ctx.moveTo(
            cx + Math.cos(midAngle) * r1,
            cy + Math.sin(midAngle) * r1
          );
          ctx.lineTo(
            cx + Math.cos(midAngle) * r2,
            cy + Math.sin(midAngle) * r2
          );
          ctx.stroke();
        });

        ctx.restore();
      },
    };

    const polarTitlePlugin = parsed.title
      ? {
          display: true as const,
          text: parsed.title,
          color: textColor,
          font: { size: 18, weight: 'bold' as const },
          padding: { bottom: 24 },
        }
      : { display: false as const };

    return {
      type: 'polarArea',
      data: {
        labels,
        datasets: [
          {
            label: parsed.series ?? 'Value',
            data: values,
            backgroundColor: perPointColors,
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 10, bottom: 40, left: 60, right: 60 } },
        plugins: {
          legend: { display: false },
          title: polarTitlePlugin,
          tooltip: tooltipConfig,
          datalabels: {
            display: true,
            color: textColor,
            font: { weight: 'bold' as const },
            formatter: (_value: number, ctx: { dataIndex: number }) =>
              labels[ctx.dataIndex] ?? '',
            anchor: 'end' as const,
            align: 'end' as const,
            offset: 16,
          },
        },
        scales: {
          r: {
            ticks: { display: false },
            grid: { color: gridColor },
          },
        },
      },
      plugins: [polarConnectorPlugin],
    } as ChartConfiguration;
  }

  // Pie / Doughnut chart
  if (parsed.type === 'pie' || parsed.type === 'doughnut') {
    // Inline plugin to draw connector lines from each slice to its outer label
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pieConnectorPlugin: any = {
      id: 'pieConnectorLines',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterDatasetsDraw(chart: any) {
        const meta = chart.getDatasetMeta(0);
        if (!meta?.data?.length) return;

        const { ctx } = chart;
        ctx.save();
        ctx.strokeStyle = textColor;
        ctx.lineWidth = 1;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meta.data.forEach((arc: any) => {
          const {
            startAngle,
            endAngle,
            outerRadius,
            x: cx,
            y: cy,
          } = arc.getProps(['startAngle', 'endAngle', 'outerRadius', 'x', 'y']);
          const midAngle = (startAngle + endAngle) / 2;
          const r1 = outerRadius + 2;
          const r2 = outerRadius + 14;

          ctx.beginPath();
          ctx.moveTo(
            cx + Math.cos(midAngle) * r1,
            cy + Math.sin(midAngle) * r1
          );
          ctx.lineTo(
            cx + Math.cos(midAngle) * r2,
            cy + Math.sin(midAngle) * r2
          );
          ctx.stroke();
        });

        ctx.restore();
      },
    };

    const pieTitlePlugin = parsed.title
      ? {
          display: true as const,
          text: parsed.title,
          color: textColor,
          font: { size: 18, weight: 'bold' as const },
          padding: { bottom: 24 },
        }
      : { display: false as const };

    return {
      type: parsed.type,
      data: {
        labels,
        datasets: [
          {
            label: parsed.series ?? 'Value',
            data: values,
            backgroundColor: perPointColors,
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        // radius is valid for pie/doughnut at runtime but not in the strict type
        radius: '70%',
        layout: { padding: { top: 10, bottom: 40, left: 60, right: 60 } },
        plugins: {
          legend: { display: false },
          title: pieTitlePlugin,
          tooltip: tooltipConfig,
          datalabels: {
            display: true,
            color: textColor,
            font: { weight: 'bold' as const },
            formatter: (_value: number, ctx: { dataIndex: number }) =>
              labels[ctx.dataIndex] ?? '',
            anchor: 'end' as const,
            align: 'end' as const,
            offset: 16,
          },
        },
      },
      plugins: [pieConnectorPlugin],
    } as ChartConfiguration;
  }

  // Multi-series: bar-stacked, or line with multiple series
  const isMultiSeries =
    parsed.type === 'bar-stacked' ||
    (parsed.type === 'line' && parsed.seriesNames);
  if (isMultiSeries) {
    const seriesNames = parsed.seriesNames ?? ['Value'];
    const isHorizontal = parsed.orientation === 'horizontal';
    const isMultiLine = parsed.type === 'line';

    // Transpose row-based data into per-series datasets
    const datasets = seriesNames.map((name, seriesIdx) => {
      const data = parsed.data.map((dp) => {
        if (seriesIdx === 0) return dp.value;
        return dp.extraValues?.[seriesIdx - 1] ?? 0;
      });

      const color =
        parsed.seriesNameColors?.[seriesIdx] ??
        colors[seriesIdx % colors.length];

      if (isMultiLine) {
        return {
          label: name,
          data,
          borderColor: color,
          backgroundColor: color + '40',
          borderWidth: 3,
          pointBackgroundColor: color,
          pointRadius: 4,
          tension: 0,
          fill: false,
        };
      }

      return {
        label: name,
        data,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 1,
      };
    });

    const scaleOptions = isMultiLine
      ? {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor },
            ...(xAxisTitle && { title: xAxisTitle }),
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor },
            ...(yAxisTitle && { title: yAxisTitle }),
          },
        }
      : {
          x: {
            stacked: true as const,
            grid: { color: gridColor },
            ticks: { color: textColor },
            ...(xAxisTitle && { title: xAxisTitle }),
          },
          y: {
            stacked: true as const,
            grid: { color: gridColor },
            ticks: { color: textColor },
            ...(yAxisTitle && { title: yAxisTitle }),
          },
        };

    return {
      type: isMultiLine ? 'line' : 'bar',
      data: {
        labels,
        datasets,
      },
      options: {
        indexAxis: isHorizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: 'top' as const, labels: { color: textColor } },
          title: titlePlugin,
          tooltip: tooltipConfig,
          datalabels: { display: false },
        },
        ...(isMultiLine
          ? { interaction: { mode: 'index' as const, intersect: false } }
          : {}),
        scales: scaleOptions,
      },
      ...(isMultiLine ? { plugins: [verticalCrosshairPlugin] } : {}),
    } as ChartConfiguration;
  }

  // Bar, line, area
  const isHorizontal = parsed.orientation === 'horizontal';
  const isLine = parsed.type === 'line' || parsed.type === 'area';
  const isArea = parsed.type === 'area';
  const lineColor =
    parsed.color ?? parsed.seriesNameColors?.[0] ?? palette.primary;

  return {
    type: isLine ? 'line' : 'bar',
    data: {
      labels,
      datasets: [
        {
          label: parsed.series ?? 'Value',
          data: values,
          backgroundColor: isLine
            ? isArea
              ? lineColor + '40'
              : lineColor
            : perPointColors,
          borderColor: isLine ? lineColor : undefined,
          borderWidth: isLine ? 3 : 0,
          pointBackgroundColor: isLine ? lineColor : undefined,
          pointRadius: isLine ? 4 : undefined,
          tension: isLine ? 0 : undefined,
          fill: isArea ? true : undefined,
        },
      ],
    },
    options: {
      indexAxis: isHorizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      ...(isLine && !isArea
        ? { interaction: { mode: 'index' as const, intersect: false } }
        : {}),
      plugins: {
        legend: { display: false },
        title: titlePlugin,
        tooltip: tooltipConfig,
        datalabels: { display: false },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor },
          ...(xAxisTitle && { title: xAxisTitle }),
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor },
          ...(yAxisTitle && { title: yAxisTitle }),
        },
      },
    },
    ...(isLine && !isArea ? { plugins: [verticalCrosshairPlugin] } : {}),
  };
}
