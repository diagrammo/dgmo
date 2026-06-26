// ============================================================
// Hand-built (D3) data-chart renderer — SPIKE entry point.
//
// Drop-in alternative to the ECharts path for the Tier-1 data-chart types.
// render() routes here when `engine: 'd3'` is requested; everything else still
// flows through echarts.ts. The goal of the spike is to prove that the
// bar/line/pie families can be rendered with the existing D3 + export-container
// machinery — no ECharts — at acceptable fidelity and code cost.
// ============================================================

import { parseChart, type ChartType } from '../chart';
import type { PaletteColors } from '../palettes';
import {
  initD3Chart,
  renderChartTitle,
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
  EXPORT_WIDTH,
  EXPORT_HEIGHT,
} from '../utils/d3-helpers';
import { renderBar } from './bar';
import { renderLine } from './line';
import { renderPie } from './pie';

/** Data-chart types the hand-built renderers currently cover (Tier 1). */
export const D3_DATA_CHART_TYPES = new Set<ChartType>([
  'bar',
  'bar-stacked',
  'line',
  'area',
  'pie',
  'doughnut',
]);

export function supportsD3DataChart(type: string): boolean {
  return D3_DATA_CHART_TYPES.has(type as ChartType);
}

/**
 * Render a Tier-1 data chart to an SVG string with the hand-built renderers.
 * Requires DOM globals (jsdom) to be installed by the caller, same as every
 * other D3 export path. Returns '' on parse error / empty data.
 */
export async function renderDataChartD3(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors
): Promise<string> {
  const effectivePalette = await resolveExportPalette(theme, palette);
  const chart = parseChart(content, effectivePalette);
  if (chart.error || chart.data.length === 0) return '';
  if (!D3_DATA_CHART_TYPES.has(chart.type)) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  const init = initD3Chart(container, effectivePalette, {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  });
  if (!init) {
    document.body.removeChild(container);
    return '';
  }
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;
  const isDark = theme === 'dark';
  const hasTitle = !chart.noTitle && !!chart.title;

  if (hasTitle) {
    renderChartTitle(svg, chart.title, chart.titleLineNumber, width, textColor);
  }

  switch (chart.type) {
    case 'bar':
    case 'bar-stacked':
      renderBar(
        svg,
        chart,
        width,
        height,
        colors,
        effectivePalette,
        isDark,
        textColor,
        mutedColor,
        hasTitle
      );
      break;
    case 'line':
    case 'area':
      renderLine(
        svg,
        chart,
        width,
        height,
        colors,
        effectivePalette,
        isDark,
        textColor,
        mutedColor,
        bgColor,
        hasTitle
      );
      break;
    case 'pie':
    case 'doughnut':
      renderPie(
        svg,
        chart,
        width,
        height,
        effectivePalette,
        isDark,
        textColor,
        hasTitle ? 52 : 24
      );
      break;
  }

  return finalizeSvgExport(container, theme, effectivePalette);
}
