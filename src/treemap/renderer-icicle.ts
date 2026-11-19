// ============================================================
// Treemap — Icicle D3 SVG Renderer
// ============================================================
//
// Emits a static, full-tree icicle: one column per depth level, root on the
// left, depth to the right; a band's height is its share of the whole. Labels
// are horizontal (name, then value · share) and are dropped when the band is
// too short to hold them. Colour reuses the treemap colour engine
// (`treemap-shared.ts`) exactly as the sunburst does: branch hue tinted by
// depth, or tag / heat modes. The chart title is the shared title block, like
// the rectangular treemap's.
//
// Static only — hover, drill and the mode switcher live app-side.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { growChartFrame } from '../utils/chart-frame';
import { contrastText, getSeriesColors } from '../palettes/color-utils';
import { tagAttrKey } from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  getMaxLegendReservedHeight,
  getLegendExtent,
} from '../utils/legend-layout';
import { layoutInlineHeader } from '../utils/inline-header';
import { LEGEND_GROUP_GAP, legendInkBottom } from '../utils/legend-constants';
import type { LegendPosition } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  FRAME_BODY_TOP,
  LEGEND_BODY_GAP,
} from '../utils/title-constants';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedTreemap, TreemapColorMode } from './types';
import { layoutTreemapIcicle, type IcicleCell } from './layout-icicle';
import {
  activeTagGroupOf,
  buildHeatScale,
  buildLegend,
  compactNumber,
  formatPct,
  resolveCellColor,
  resolveColorMode,
  type CellColorContext,
  mutedFill,
  treemapRecedes,
  treemapStory,
} from './treemap-shared';
import { EMPHASIS_DIM_OPACITY, storyLegend } from '../utils/emphasis';

const PADDING = 12;
const TITLE_BAND = 36;

/** Standard placement every dgmo legend uses: centered, under the title. */
const LEGEND_POSITION: LegendPosition = {
  placement: 'top-center',
  titleRelation: 'below-title',
};

/** Label type: the name line and the value · share line under it. */
const NAME_FS = 11.5;
const VALUE_FS = 10.5;
/** Inset of the label block from the band's top-left corner. */
const LABEL_PAD_X = 8;
const NAME_BASELINE = 16;
const VALUE_BASELINE = 31;
/** A band shorter than this drops its label (kept in hover). */
const ICICLE_MIN_NAME_H = 22;
/** A band shorter than this keeps the name but drops the value line. */
const ICICLE_MIN_VALUE_H = 37;
/** A band narrower than this drops its label. */
const MIN_LABEL_W = 30;

export interface TreemapIcicleRenderOptions {
  /** Color mode override (app's runtime switcher). Defaults to source. */
  colorMode?: TreemapColorMode;
  /** Interactive render budget. Export omits it → full tree. */
  maxDepth?: number;
  /** Shift the branch-hue index (drilled-into view keeps its expanded hue). */
  colorOffset?: number;
  exportMode?: boolean;
}

/** Render for CLI/export (full tree, no interactive chrome). */
export function renderTreemapIcicleForExport(
  container: HTMLDivElement,
  parsed: ParsedTreemap,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options?: TreemapIcicleRenderOptions
): void {
  renderTreemapIcicle(container, parsed, palette, isDark, exportDims, {
    exportMode: true,
    ...options,
  });
}

export function renderTreemapIcicle(
  container: HTMLDivElement,
  parsed: ParsedTreemap,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options: TreemapIcicleRenderOptions = {}
): void {
  if (parsed.error || parsed.roots.length === 0) return;

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const mode = resolveColorMode(parsed, options.colorMode);
  const opts = parsed.options;
  const exportMode = options.exportMode ?? false;
  const seriesColors = getSeriesColors(palette);
  const showTitle = !!parsed.title;
  const titleH = showTitle ? TITLE_BAND : 0;

  const heat = buildHeatScale(parsed, palette);
  const legend = !opts.noLegend
    ? buildLegend(mode, parsed, heat, seriesColors, options.colorOffset ?? 0)
    : null;
  // Legends follow the drawing under story view (#2046).
  if (legend)
    legend.groups = storyLegend(
      legend.groups,
      parsed.emphasis,
      palette,
      isDark
    );

  const legendMode = exportMode ? 'export' : 'preview';
  const legendReserve = legend
    ? getMaxLegendReservedHeight(
        { groups: legend.groups, position: LEGEND_POSITION, mode: legendMode },
        width
      ) + LEGEND_GROUP_GAP
    : 0;

  // §1.9 `legend-inline`: one-line header when it fits, else stacked — the
  // same header the rectangular treemap draws.
  const inlineRequested = opts.legendInline === true;
  const legendExtent =
    inlineRequested && legend
      ? getLegendExtent(
          {
            groups: legend.groups,
            position: {
              placement: 'top-center',
              titleRelation: 'inline-with-title',
            },
            mode: legendMode,
            showInactivePills: !exportMode,
            showEmptyGroups: !exportMode,
          },
          { activeGroup: legend.activeGroup },
          width
        )
      : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: parsed.title ?? '',
    hasLegend: !!legend,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth: width,
    titleBandHeight: titleH,
    legendReserve,
    titleBaselineY: TITLE_Y,
    titleFontSize: TITLE_FONT_SIZE,
  });

  // Body top: the shared line under a title (#1838), or under the legend.
  const areaY = !showTitle
    ? (header.inline ? titleH : titleH + legendReserve) + PADDING
    : legend && !header.inline
      ? titleH +
        legendInkBottom(legendReserve - LEGEND_GROUP_GAP) +
        LEGEND_BODY_GAP
      : FRAME_BODY_TOP;
  const areaX = PADDING;
  const areaW = Math.max(1, width - PADDING * 2);
  const areaH = Math.max(1, height - areaY - PADDING);

  const layout = layoutTreemapIcicle(parsed.roots, {
    width: areaW,
    height: areaH,
    ...(options.maxDepth !== undefined && { maxDepth: options.maxDepth }),
  });

  // ── SVG root ───────────────────────────────────────────────
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('class', 'dgmo-treemap dgmo-treemap-icicle')
    .style('font-family', FONT_FAMILY);

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  if (showTitle) {
    const title = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', header.titleX)
      .attr('y', TITLE_Y)
      .attr('text-anchor', header.titleAnchor)
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(parsed.title);
    if (parsed.titleLineNumber !== null) {
      title.attr('data-line-number', parsed.titleLineNumber);
    }
  }

  const plot = svg
    .append('g')
    .attr('class', 'dgmo-treemap-cells')
    .attr('transform', `translate(${areaX},${areaY})`);

  const activeGroup = activeTagGroupOf(parsed)?.name ?? null;
  const rootIndexByLabel = new Map(parsed.roots.map((r, i) => [r.label, i]));
  const colorCtx: CellColorContext = {
    mode,
    heat,
    tagGroups: parsed.tagGroups,
    activeGroup,
    rootIndexByLabel,
    seriesColors,
    colorOffset: options.colorOffset ?? 0,
    bg: palette.bg,
    muted: mutedFill(palette),
  };

  // ── Bands ──────────────────────────────────────────────────
  if (layout.isEmpty) {
    plot
      .append('text')
      .attr('class', 'dgmo-treemap-empty')
      .attr('x', areaW / 2)
      .attr('y', areaH / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', 13)
      .attr('fill', palette.textMuted)
      .text('No values to chart');
  } else {
    const recedes = treemapRecedes(parsed);
    // Story view (#2046): lit bands solid, the rest one grey ground.
    const story = treemapStory(parsed, palette, isDark);
    for (const cell of layout.cells) {
      const w = Math.max(0, cell.x1 - cell.x0);
      const h = Math.max(0, cell.y1 - cell.y0);
      if (w <= 0 || h <= 0) continue;
      const recede = recedes(cell);
      const own = resolveCellColor(cell, colorCtx);
      const fill = !story.active
        ? own
        : recede
          ? cell.isContainer
            ? story.groundStroke
            : story.groundFill
          : story.subject(own);
      const g = plot
        .append('g')
        .attr('class', 'dgmo-treemap-cell')
        .attr('transform', `translate(${cell.x0},${cell.y0})`)
        .attr('data-node-path', cell.path.join(' / '))
        // The top-level branch the branch legend names (diagrammo/diagrammo#1215).
        .attr('data-branch', cell.path[0] ?? '');
      if (cell.lineNumber !== undefined) {
        g.attr('data-line-number', cell.lineNumber);
      }
      if (cell.heat !== undefined) g.attr('data-heat', cell.heat);
      if (cell.node && activeGroup) {
        const key = tagAttrKey(activeGroup);
        const tagVal = cell.node.metadata[key];
        if (tagVal) g.attr(`data-tag-${tagAttrKey(key)}`, tagVal);
      }
      // §1.11 emphasis (#1829): a receded band keeps its paint and fades whole.
      if (recede && !story.active) g.attr('opacity', EMPHASIS_DIM_OPACITY);

      g.append('rect')
        .attr(
          'class',
          cell.isContainer ? 'dgmo-treemap-rect branch' : 'dgmo-treemap-rect'
        )
        .attr('width', w)
        .attr('height', h)
        .attr('fill', fill)
        .attr('stroke', palette.bg)
        .attr('stroke-width', 1);

      drawBandLabel(g, cell, w, h, opts, palette, fill);
    }
  }

  // ── Legend ─────────────────────────────────────────────────
  if (legend) {
    const legendG = svg
      .append('g')
      .attr('class', 'dgmo-treemap-legend')
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0, ${titleH})`
      );
    renderIntegratedLegend(legendG, {
      frame: parsed.frame,
      groups: legend.groups,
      palette: {
        bg: palette.bg,
        surface: palette.surface,
        text: palette.text,
        textMuted: palette.textMuted,
        primary: palette.primary,
      },
      isDark,
      width,
      mode: legendMode,
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      activeGroup: legend.activeGroup,
      showInactivePills: !exportMode,
      showEmptyGroups: !exportMode,
    });
  }

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });
}

// ============================================================
// Band labels — horizontal, name then value · share
// ============================================================

function drawBandLabel(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  cell: IcicleCell,
  w: number,
  h: number,
  opts: ParsedTreemap['options'],
  palette: PaletteColors,
  fill: string
): void {
  if (h < ICICLE_MIN_NAME_H || w < MIN_LABEL_W) return;
  const maxW = w - LABEL_PAD_X * 2;
  const name = clipLabel(cell.label, maxW, NAME_FS);
  if (!name) return;
  const ink = contrastText(
    fill,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  g.append('text')
    .attr('class', 'dgmo-treemap-label')
    .attr('x', LABEL_PAD_X)
    .attr('y', NAME_BASELINE)
    .attr('font-size', NAME_FS)
    .attr('font-weight', cell.depth === 1 ? 700 : 600)
    .attr('fill', ink)
    .text(name);

  const valStr = [
    opts.noValues ? '' : compactNumber(cell.value),
    opts.noPercent ? '' : formatPct(cell.pctOfRoot),
  ]
    .filter(Boolean)
    .join(' · ');
  if (!valStr || h < ICICLE_MIN_VALUE_H) return;
  if (measureText(valStr, VALUE_FS) > maxW) return;
  g.append('text')
    .attr('class', 'dgmo-treemap-value')
    .attr('x', LABEL_PAD_X)
    .attr('y', VALUE_BASELINE)
    .attr('font-size', VALUE_FS)
    .attr('fill', ink)
    .attr('opacity', 0.75)
    .text(valStr);
}

/** Clip to a pixel width with a trailing ellipsis (measured bold: the name is
 *  drawn at 600 or 700, both of which resolve to the Bold face). */
function clipLabel(s: string, maxWidth: number, fs: number): string {
  if (maxWidth <= 0) return '';
  if (measureText(s, fs, { bold: true }) <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(s.slice(0, mid) + '…', fs, { bold: true }) <= maxWidth)
      lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : s.slice(0, lo) + '…';
}
