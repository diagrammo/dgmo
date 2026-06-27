// ============================================================
// Hand-built (D3) data-chart renderer — SPIKE entry point.
//
// Drop-in alternative to the ECharts path. render() routes here when
// `engine: 'd3'` is requested; everything else still flows through echarts.ts.
// Tier 1: bar/line/pie (parseChart).
// Tier 2: radar/polar-area (parseChart) + funnel/heatmap/scatter
// (parseExtendedChart).
// ============================================================

import { parseChart } from '../chart';
import {
  parseExtendedChart,
  getExtendedChartLegendGroups,
  type ParsedFunnel,
  type ParsedHeatmap,
  type ParsedScatter,
  type ParsedSankey,
  type ParsedChord,
  type ParsedFunctionChart,
} from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { getSeriesColors } from '../palettes/color-utils';
import {
  initD3Chart,
  renderChartTitle,
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
  EXPORT_WIDTH,
  EXPORT_HEIGHT,
} from '../utils/d3-helpers';
import { injectLegendGroups, type Svg } from './shared';
import { renderBar } from './bar';
import { renderLine } from './line';
import { renderPie } from './pie';
import { renderRadar } from './radar';
import { renderPolarArea } from './polar';
import { renderFunnel } from './funnel';
import { renderHeatmap } from './heatmap';
import { renderScatter } from './scatter';
import { renderSankey } from './sankey';
import { renderChord } from './chord';
import { renderFunction } from './function';

/** Types parsed by parseChart → ParsedChart. */
const STANDARD = new Set(['bar', 'line', 'pie', 'radar', 'polar-area']);
/** Types parsed by parseExtendedChart → ParsedExtendedChart. */
const EXTENDED = new Set([
  'funnel',
  'heatmap',
  'scatter',
  'sankey',
  'chord',
  'function',
]);

/** All data-chart types the hand-built renderers currently cover. */
export const D3_DATA_CHART_TYPES = new Set<string>([...STANDARD, ...EXTENDED]);

export function supportsD3DataChart(type: string): boolean {
  return D3_DATA_CHART_TYPES.has(type);
}

export async function renderDataChartD3(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors,
  dims?: { width?: number; height?: number }
): Promise<string> {
  const effectivePalette = await resolveExportPalette(theme, palette);
  const isDark = theme === 'dark';

  const w =
    dims?.width && dims.width > 0 ? Math.round(dims.width) : EXPORT_WIDTH;
  const h =
    dims?.height && dims.height > 0 ? Math.round(dims.height) : EXPORT_HEIGHT;
  const container = createExportContainer(w, h);
  const init = initD3Chart(container, effectivePalette, {
    width: w,
    height: h,
  });
  if (!init) {
    document.body.removeChild(container);
    return '';
  }
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  const ok = renderInto(
    svg,
    content,
    effectivePalette,
    isDark,
    width,
    height,
    textColor,
    mutedColor,
    bgColor,
    colors
  );
  if (!ok) {
    document.body.removeChild(container);
    return '';
  }
  return finalizeSvgExport(container, theme, effectivePalette);
}

function renderInto(
  s: Svg,
  content: string,
  palette: PaletteColors,
  isDark: boolean,
  width: number,
  height: number,
  textColor: string,
  mutedColor: string,
  bgColor: string,
  colors: string[]
): boolean {
  // Standard (parseChart) path.
  const std = parseChart(content, palette);
  if (!std.error && std.data.length > 0 && STANDARD.has(std.type)) {
    const hasTitle = !std.noTitle && !!std.title;
    if (hasTitle)
      renderChartTitle(s, std.title, std.titleLineNumber, width, textColor);
    switch (std.type) {
      case 'bar':
        renderBar(
          s,
          std,
          width,
          height,
          colors,
          palette,
          isDark,
          textColor,
          mutedColor,
          hasTitle
        );
        return true;
      case 'line':
        renderLine(
          s,
          std,
          width,
          height,
          colors,
          palette,
          isDark,
          textColor,
          mutedColor,
          bgColor,
          hasTitle
        );
        return true;
      case 'pie':
        renderPie(
          s,
          std,
          width,
          height,
          palette,
          isDark,
          textColor,
          hasTitle ? 52 : 24
        );
        return true;
      case 'radar':
        renderRadar(
          s,
          std,
          width,
          height,
          palette,
          isDark,
          textColor,
          mutedColor,
          hasTitle ? 52 : 24
        );
        return true;
      case 'polar-area':
        renderPolarArea(
          s,
          std,
          width,
          height,
          palette,
          isDark,
          textColor,
          hasTitle ? 52 : 24
        );
        return true;
    }
  }

  // Extended (parseExtendedChart) path.
  const ext = parseExtendedChart(content, palette);
  if (ext.error || !EXTENDED.has(ext.type)) return false;
  const seriesColors = getSeriesColors(palette);
  const hasTitle = !ext.noTitle && !!ext.title;
  if (hasTitle)
    renderChartTitle(s, ext.title, ext.titleLineNumber, width, textColor);

  switch (ext.type) {
    case 'funnel':
      renderFunnel(
        s,
        ext as ParsedFunnel,
        width,
        height,
        seriesColors,
        palette,
        isDark,
        textColor,
        hasTitle ? 52 : 24
      );
      return true;
    case 'heatmap':
      renderHeatmap(
        s,
        ext as ParsedHeatmap,
        width,
        height,
        palette,
        isDark,
        textColor,
        bgColor,
        hasTitle ? 52 : 24
      );
      return true;
    case 'scatter': {
      const groups = getExtendedChartLegendGroups(ext, seriesColors);
      const top = injectLegendGroups(
        s,
        groups,
        palette,
        isDark,
        hasTitle,
        width
      );
      renderScatter(
        s,
        ext as ParsedScatter,
        width,
        height,
        seriesColors,
        palette,
        isDark,
        textColor,
        mutedColor,
        top
      );
      return true;
    }
    case 'sankey':
      renderSankey(
        s,
        ext as ParsedSankey,
        width,
        height,
        seriesColors,
        bgColor,
        textColor,
        hasTitle ? 52 : 24
      );
      return true;
    case 'chord':
      renderChord(
        s,
        ext as ParsedChord,
        width,
        height,
        seriesColors,
        palette,
        isDark,
        textColor,
        hasTitle ? 52 : 24
      );
      return true;
    case 'function': {
      const groups = getExtendedChartLegendGroups(ext, seriesColors);
      const top = injectLegendGroups(
        s,
        groups,
        palette,
        isDark,
        hasTitle,
        width
      );
      renderFunction(
        s,
        ext as ParsedFunctionChart,
        width,
        height,
        seriesColors,
        textColor,
        mutedColor,
        top
      );
      return true;
    }
    default:
      return false;
  }
}
