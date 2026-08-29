// ============================================================
// Hand-built (D3) data-chart renderer — SPIKE entry point.
//
// Drop-in alternative to the ECharts path. render() routes here when
// `engine: 'd3'` is requested; everything else still flows through echarts.ts.
// Tier 1: bar/line/pie (parseChart).
// Tier 2: radar/polar-area (parseChart) + funnel/heatmap/scatter
// (parseExtendedChart).
// ============================================================

import { naturalDataChartSize } from './natural-size';
import { parseChart } from '../chart';
import { getSimpleChartLegendGroups } from '../data-chart-parser';
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
import { injectLegendGroups, type Svg, type InlineTitleInfo } from './shared';
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

/** Types with a top-center series legend that can host an inline header (§1.9
 *  `legend-inline`, decision #50). Others take the directive as a no-op. */
const INLINE_LEGEND_TYPES = new Set([
  'bar',
  'line',
  'radar',
  'scatter',
  'function',
]);

/**
 * Build the {@link InlineTitleInfo} to hand the legend path when the chart opted
 * into `legend-inline` and can host it — otherwise `undefined`, so the caller
 * renders a centered title as before. Centralizes the gate for both the standard
 * and extended dispatch paths.
 */
function inlineTitleFor(
  chart: {
    type: string;
    title?: string;
    titleLineNumber?: number;
    legendInline?: boolean;
    noLegend?: boolean;
  },
  hasTitle: boolean,
  textColor: string
): InlineTitleInfo | undefined {
  if (
    !hasTitle ||
    !chart.legendInline ||
    chart.noLegend ||
    !INLINE_LEGEND_TYPES.has(chart.type)
  ) {
    return undefined;
  }
  return {
    title: chart.title!,
    ...(chart.titleLineNumber !== undefined && {
      titleLineNumber: chart.titleLineNumber,
    }),
    textColor,
  };
}

/** First non-empty, non-comment line's leading token, lowercased. */
function firstNonCommentToken(content: string): string {
  for (const raw of content.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('//')) continue;
    return l.split(/\s+/)[0]!.toLowerCase();
  }
  return '';
}

export async function renderDataChartD3(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors,
  dims?: { width?: number; height?: number }
): Promise<string> {
  const effectivePalette = await resolveExportPalette(theme, palette);
  const isDark = theme === 'dark';

  // A caller's width always wins. Absent one, the chart sizes itself from its
  // own content rather than inheriting a flat 1200 — see natural-size.ts.
  const natural = naturalDataChartSize(content, effectivePalette);
  const w =
    dims?.width && dims.width > 0
      ? Math.round(dims.width)
      : (natural?.width ?? EXPORT_WIDTH);
  const h =
    dims?.height && dims.height > 0
      ? Math.round(dims.height)
      : dims?.width && dims.width > 0
        ? EXPORT_HEIGHT
        : (natural?.height ?? EXPORT_HEIGHT);
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
  // Route by the declared first-token type. Extended types (incl. the `chord`
  // circular preset re-emitted by the arc `layout chord` override, #29) MUST go
  // to parseExtendedChart — `chord` is no longer a top-level keyword, so the
  // simple parseChart would silently treat `chord …` as a fallback bar chart.
  const firstTok = firstNonCommentToken(content);
  const forceExtended = EXTENDED.has(firstTok);

  // Standard (parseChart) path.
  const std = forceExtended ? null : parseChart(content, palette);
  if (std && !std.error && std.data.length > 0 && STANDARD.has(std.type)) {
    const hasTitle = !std.noTitle && !!std.title;
    // §1.9 `legend-inline` (decision #50): the legend path owns the title so it
    // can lay title + legend on one row. Only the top-center-legend types honour
    // it; everyone else renders a centered title here as before.
    const inlineTitle = inlineTitleFor(std, hasTitle, textColor);
    if (hasTitle && !inlineTitle)
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
          hasTitle,
          inlineTitle
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
          hasTitle,
          inlineTitle
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
      case 'radar': {
        // Multi-series radar (§15.1) gets the shared series legend; single-series
        // yields no groups, so injectLegendGroups returns the same top inset as
        // before (52 with title, 24 without) — no regression.
        const groups = std.noLegend
          ? []
          : getSimpleChartLegendGroups(std, colors);
        const top = injectLegendGroups(
          s,
          groups,
          palette,
          isDark,
          hasTitle,
          width,
          inlineTitle
        );
        renderRadar(
          s,
          std,
          width,
          height,
          colors,
          palette,
          isDark,
          textColor,
          mutedColor,
          top
        );
        return true;
      }
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
  const inlineTitle = inlineTitleFor(ext, hasTitle, textColor);
  if (hasTitle && !inlineTitle)
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
      const groups = ext.noLegend
        ? []
        : getExtendedChartLegendGroups(ext, seriesColors);
      const top = injectLegendGroups(
        s,
        groups,
        palette,
        isDark,
        hasTitle,
        width,
        inlineTitle
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
      const groups = ext.noLegend
        ? []
        : getExtendedChartLegendGroups(ext, seriesColors);
      const top = injectLegendGroups(
        s,
        groups,
        palette,
        isDark,
        hasTitle,
        width,
        inlineTitle
      );
      renderFunction(
        s,
        ext as ParsedFunctionChart,
        width,
        height,
        seriesColors,
        textColor,
        mutedColor,
        top,
        palette,
        isDark
      );
      return true;
    }
    default:
      return false;
  }
}
