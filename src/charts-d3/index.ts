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
import {
  injectLegendGroups,
  markPreviewLegend,
  type Svg,
  type InlineTitleInfo,
} from './shared';
import {
  applyChartFrame,
  reserveChartFrame,
  placeFrameTitle,
  type ChartFrame,
  type ChartFrameReserve,
} from '../utils/chart-frame';
import { renderBar } from './bar';
import { renderLine } from './line';
import { renderPie } from './pie';
import { renderRadar } from './radar';
import { renderPolarArea } from './polar';
import { renderFunnel } from './funnel';
import { renderHeatmap, heatmapLegendGroups } from './heatmap';
import { LEGEND_HEIGHT, LEGEND_INK_BOTTOM } from '../utils/legend-constants';
import { storyLegend } from '../utils/emphasis';
import { renderScatter } from './scatter';
import { renderSankey } from './sankey';
import { renderFunction } from './function';
import { renderBoxplot } from './boxplot';
import { renderHistogram } from './histogram';
import { unitOnAxisTitle } from '../utils/number-format';
import { unitsOnAxisTitles } from '../utils/axis-format';

/** Types parsed by parseChart → ParsedChart. */
const STANDARD = new Set(['bar', 'line', 'pie', 'radar', 'polar-area']);
/** Types parsed by parseExtendedChart → ParsedExtendedChart. */
const EXTENDED = new Set([
  'funnel',
  'heatmap',
  'scatter',
  'sankey',
  'function',
  'boxplot',
  'histogram',
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
  'histogram',
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
  dims?: { width?: number; height?: number },
  /** True only for the app's live preview (`mountD3DataChart`). Every other
   *  caller is a static render, whose legend is the plain key (#1826). */
  preview = false
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
  // A width with no height keeps the sheet's proportions rather than taking a
  // flat EXPORT_HEIGHT, which turned a narrow request into a portrait canvas.
  const h =
    dims?.height && dims.height > 0
      ? Math.round(dims.height)
      : dims?.width && dims.width > 0
        ? Math.round((w * EXPORT_HEIGHT) / EXPORT_WIDTH)
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
  if (preview) markPreviewLegend(svg);

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

/**
 * Draw one data chart, then its frame (#1827): the plot is laid out into the
 * canvas less the subtitle and footer bands, and `applyChartFrame` places the
 * subtitle, notes, source and byline around it.
 */
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
  const frame: FrameSlot = {};
  const h0 = Number(s.attr('height') ?? 0);
  const ok = renderPlot(
    s,
    content,
    palette,
    isDark,
    width,
    height,
    textColor,
    mutedColor,
    bgColor,
    colors,
    frame
  );
  if (ok) passivePlotText(s.node());
  // A plot may grow the drawing: a bar chart's note key (#2159).
  const grown = height + Math.max(0, Number(s.attr('height') ?? 0) - h0);
  if (ok && frame.reserve)
    applyChartFrame(s, frame.reserve, width, grown, palette, frame.frame);
  // The title's edge (#1838), frame lines or not.
  if (ok) placeFrameTitle(s.node(), frame.frame);
  return ok;
}

/**
 * Text drawn over a mark (value labels, overlay labels, radar ticks, sankey
 * node values) must not catch the pointer: the mark's hover, CSS `:hover` and
 * the app's `closest('.dgmo-datum')` lookup, ends the moment the cursor is on
 * the text (#2086). Clicks fall through to the mark, which carries the line
 * number. The clickable axis labels, the chart title and legend entries keep
 * their own hit targets.
 */
function passivePlotText(svg: SVGSVGElement | null): void {
  svg?.querySelectorAll('text').forEach((t) => {
    if (t.closest('.dgmo-axis-label, .chart-title, [data-legend-entry]'))
      return;
    t.setAttribute('pointer-events', 'none');
  });
}

/** Where `renderPlot` leaves the frame it reserved, for `renderInto`. */
interface FrameSlot {
  reserve?: ChartFrameReserve | undefined;
  frame?: ChartFrame | undefined;
}

function renderPlot(
  s: Svg,
  content: string,
  palette: PaletteColors,
  isDark: boolean,
  width: number,
  height: number,
  textColor: string,
  mutedColor: string,
  bgColor: string,
  colors: string[],
  frame: FrameSlot
): boolean {
  // Route by the declared first-token type: extended types MUST go to
  // parseExtendedChart, or parseChart would read them as a fallback bar chart.
  const firstTok = firstNonCommentToken(content);
  const forceExtended = EXTENDED.has(firstTok);

  // Standard (parseChart) path.
  const std = forceExtended ? null : parseChart(content, palette);
  if (std && !std.error && std.data.length > 0 && STANDARD.has(std.type)) {
    frame.frame = std.frame;
    frame.reserve = reserveChartFrame(std.frame, width);
    if (frame.reserve) height -= frame.reserve.top + frame.reserve.bottom;
    const hasTitle = !std.noTitle && !!std.title;
    // §1.9 `legend-inline` (decision #50): the legend path owns the title so it
    // can lay title + legend on one row. Only the top-center-legend types honour
    // it; everyone else renders a centered title here as before.
    const inlineTitle = inlineTitleFor(std, hasTitle, textColor);
    // A wrapped title pushes the plot down by its extra line (#1718).
    const titleExtra =
      hasTitle && !inlineTitle
        ? renderChartTitle(
            s,
            std.title,
            std.titleLineNumber,
            width,
            textColor,
            undefined,
            2
          )
        : 0;
    // A word unit goes on the value-axis title once (#2088); y is the value
    // axis whichever way the bars run.
    const onAxis =
      std.type === 'bar' || std.type === 'line'
        ? unitsOnAxisTitles(std, ['ylabel', 'yrlabel'])
        : std;
    switch (std.type) {
      case 'bar':
        // A bar chart with lines (#1852) is drawn by the line renderer, which
        // owns the combo: bars under lines, a second axis, mark swatches.
        if (std.seriesMarks) {
          renderLine(
            s,
            onAxis,
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
        }
        renderBar(
          s,
          onAxis,
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
          onAxis,
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
          (hasTitle ? 52 : 24) + titleExtra
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
          inlineTitle,
          std.frame
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
          (hasTitle ? 52 : 24) + titleExtra
        );
        return true;
    }
  }

  // Extended (parseExtendedChart) path.
  const ext = parseExtendedChart(content, palette);
  if (ext.error || !EXTENDED.has(ext.type)) return false;
  frame.frame = ext.frame;
  frame.reserve = reserveChartFrame(ext.frame, width);
  if (frame.reserve) height -= frame.reserve.top + frame.reserve.bottom;
  const seriesColors = getSeriesColors(palette);
  const hasTitle = !ext.noTitle && !!ext.title;
  const inlineTitle = inlineTitleFor(ext, hasTitle, textColor);
  const titleExtra =
    hasTitle && !inlineTitle
      ? renderChartTitle(
          s,
          ext.title,
          ext.titleLineNumber,
          width,
          textColor,
          undefined,
          2
        )
      : 0;

  // A word unit goes on the value-axis title once (#2088): y, except a
  // histogram, whose formatted numbers are its x bin edges.
  switch (ext.type) {
    case 'boxplot':
      renderBoxplot(
        s,
        unitsOnAxisTitles(ext, ['ylabel']),
        width,
        height,
        palette,
        isDark,
        textColor,
        mutedColor,
        (hasTitle ? 52 : 24) + titleExtra
      );
      return true;
    case 'funnel':
      renderFunnel(
        s,
        ext,
        width,
        height,
        seriesColors,
        palette,
        isDark,
        (hasTitle ? 52 : 24) + titleExtra
      );
      return true;
    case 'heatmap': {
      // A colour bar keys the ramp (#1837); `no-legend` drops it and the band.
      const groups = ext.noLegend
        ? []
        : heatmapLegendGroups(ext, palette, isDark);
      // The grid's first ink (its column labels) sits 8 below the inset, as
      // under a bare title. Under a legend the gap is LEGEND_BODY_GAP from the
      // legend's INK, not its row box (#1838), so give back the box's un-inked
      // bottom.
      const top =
        groups.length > 0
          ? injectLegendGroups(
              s,
              groups,
              palette,
              isDark,
              hasTitle,
              width,
              inlineTitle,
              ext.frame
            ) -
            (LEGEND_HEIGHT - LEGEND_INK_BOTTOM)
          : (hasTitle ? 52 : 24) + titleExtra;
      renderHeatmap(
        s,
        ext,
        width,
        height,
        palette,
        isDark,
        textColor,
        bgColor,
        top
      );
      return true;
    }
    case 'scatter': {
      // Legends follow the drawing under story view (#2046).
      const groups = ext.noLegend
        ? []
        : storyLegend(
            getExtendedChartLegendGroups(ext, seriesColors),
            ext.emphasis?.kind === 'highlight' ? ext.emphasis : undefined,
            palette,
            isDark
          );
      const top = injectLegendGroups(
        s,
        groups,
        palette,
        isDark,
        hasTitle,
        width,
        inlineTitle,
        ext.frame
      );
      renderScatter(
        s,
        unitsOnAxisTitles(ext, ['ylabel']),
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
        ext,
        width,
        height,
        seriesColors,
        bgColor,
        textColor,
        (hasTitle ? 52 : 24) + titleExtra,
        palette,
        isDark
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
        inlineTitle,
        ext.frame
      );
      renderFunction(
        s,
        unitsOnAxisTitles(ext, ['ylabel']),
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
    case 'histogram': {
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
        inlineTitle,
        ext.frame
      );
      renderHistogram(
        s,
        unitOnAxisTitle(ext, ['xlabel']),
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
    default:
      return false;
  }
}
