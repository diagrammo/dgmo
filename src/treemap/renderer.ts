// ============================================================
// Treemap — D3 SVG Renderer
// ============================================================
//
// Emits a static, full-tree treemap. Interactive chrome (drill breadcrumb,
// tooltips, the runtime color-mode switcher) lives app-side; the only
// interactive affordance drawn here is the scope/target focus icon, marked
// `data-export-ignore` so `finalizeSvgExport` strips it on export.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { growChartFrame } from '../utils/chart-frame';
import {
  contrastText,
  getSeriesColors,
  mix,
  themeBaseBg,
} from '../palettes/color-utils';
import { tagAttrKey } from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import { fitLabel, type FittedLabel } from '../utils/fit-label';
import { FULL_TEXT_ATTR } from '../utils/full-text';
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
import { layoutTreemap } from './layout';
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
const HEADER_H = 18;
const TITLE_BAND = 36;
/** Percent of a leaf's own color kept when muting it toward the background. */
const LEAF_MUTE_PCT = 50;

/** Standard placement every dgmo legend uses: centered, under the title. */
const LEGEND_POSITION: LegendPosition = {
  placement: 'top-center',
  titleRelation: 'below-title',
};

export interface TreemapRenderOptions {
  /** Color mode override (app's runtime switcher). Defaults to source. */
  colorMode?: TreemapColorMode;
  /** Render budget (interactive only). Export omits it → full tree. */
  maxDepth?: number;
  /** Shift the branch-hue index so a drilled-into view keeps the color it had
   *  when expanded (the re-rooted node would otherwise become index 0 = the
   *  first hue). Set to the drilled branch's original top-level index. */
  colorOffset?: number;
  /** Click handler for drillable cells (app interactivity). */
  onClickItem?: (lineNumber: number) => void;
  /** Color-mode switch fired when a legend pill is clicked (app interactivity).
   *  The mode switcher is baked into the legend (clickable group pills), so the
   *  app no longer renders a separate overlay control. */
  onSelectMode?: (mode: TreemapColorMode) => void;
  exportMode?: boolean;
}

/** Render for CLI/export (full tree, no drill chrome). */
export function renderTreemapForExport(
  container: HTMLDivElement,
  parsed: ParsedTreemap,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options?: TreemapRenderOptions
): void {
  renderTreemap(container, parsed, palette, isDark, exportDims, {
    exportMode: true,
    ...options,
  });
}

export function renderTreemap(
  container: HTMLDivElement,
  parsed: ParsedTreemap,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options: TreemapRenderOptions = {}
): void {
  if (parsed.error || parsed.roots.length === 0) return;

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const mode = resolveColorMode(parsed, options.colorMode);
  const opts = parsed.options;
  const fillMode = opts.fillMode;
  const exportMode = options.exportMode ?? false;
  const seriesColorsTop = getSeriesColors(palette);
  const showTitle = !!parsed.title;
  const titleH = showTitle ? TITLE_BAND : 0;

  const heat = buildHeatScale(parsed, palette);
  const legend = !opts.noLegend
    ? buildLegend(mode, parsed, heat, seriesColorsTop, options.colorOffset ?? 0)
    : null;
  // Legends follow the drawing under story view (#2046).
  if (legend)
    legend.groups = storyLegend(
      legend.groups,
      parsed.emphasis,
      palette,
      isDark
    );

  // Reserve a band below the title for the standardized legend, exactly like
  // mindmap/org/map (top-center, below-title). The treemap fills the rest.
  const legendReserve = legend
    ? getMaxLegendReservedHeight(
        {
          groups: legend.groups,
          position: LEGEND_POSITION,
          // The draw's own mode: a static key wraps past the row cap (#1826).
          mode: exportMode ? 'export' : 'preview',
        },
        width
      ) + LEGEND_GROUP_GAP
    : 0;

  // §1.9 `legend-inline` (decision #50): try a one-line header (title left,
  // legend flushed right). Falls back to the stacked band when it can't fit.
  // NOTE: treemap's parser exposes a structured `TreemapOptions`, not the raw
  // `Record<string,string>` this shared helper reads, and `handleDirective`
  // doesn't yet recognize `legend-inline` — so this is currently always false
  // (stacked). Once the parser records the directive, drop the cast.
  const inlineRequested = parsed.options.legendInline === true;
  const legendExtent =
    inlineRequested && legend
      ? getLegendExtent(
          {
            groups: legend.groups,
            position: {
              placement: 'top-center',
              titleRelation: 'inline-with-title',
            },
            mode: exportMode ? 'export' : 'preview',
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

  const headerH = opts.noHeaders ? 0 : HEADER_H;
  const areaX = PADDING;
  // Inline → one band (title only); stacked → title + legend band.
  // With a title the cells start at a fixed line (#1838): the shared body top,
  // or LEGEND_BODY_GAP under the legend's bottom (its text reaches 0.71 em
  // below the row's midline).
  const areaY = !showTitle
    ? (header.inline ? titleH : titleH + legendReserve) + PADDING
    : legend && !header.inline
      ? titleH +
        legendInkBottom(legendReserve - LEGEND_GROUP_GAP) +
        LEGEND_BODY_GAP
      : FRAME_BODY_TOP;
  const areaW = Math.max(1, width - PADDING * 2);
  const areaH = Math.max(1, height - areaY - PADDING);

  const layoutOpts = {
    width: areaW,
    headerH,
    ...(options.maxDepth !== undefined && { maxDepth: options.maxDepth }),
  };
  let layout = layoutTreemap(parsed.roots, { ...layoutOpts, height: areaH });
  // The root's own top gutter leaves the first cell below the area's top. With
  // a title, lift the area by that gutter and grow it to match, so the cells
  // start at areaY and still end where they did.
  let rootTop = 0;
  if (showTitle) {
    rootTop = layout.cells.reduce((m, c) => Math.min(m, c.y0), Infinity);
    if (!Number.isFinite(rootTop) || rootTop < 0) rootTop = 0;
    if (rootTop > 0)
      layout = layoutTreemap(parsed.roots, {
        ...layoutOpts,
        height: areaH + rootTop,
      });
  }

  // ── SVG root ───────────────────────────────────────────────
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('class', 'dgmo-treemap')
    .style('font-family', FONT_FAMILY);

  // Drill icon: faint by default, a touch clearer when its cell is hovered.
  svg
    .append('style')
    .text(
      '.dgmo-treemap-focus{opacity:.3;transition:opacity .12s}' +
        '.dgmo-treemap-cell:hover .dgmo-treemap-focus{opacity:.7}'
    );

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

  const root = svg
    .append('g')
    .attr('class', 'dgmo-treemap-cells')
    .attr('transform', `translate(${areaX},${areaY - rootTop})`);

  const seriesColors = seriesColorsTop;
  const colorOffset = options.colorOffset ?? 0;
  const activeGroup = activeTagGroupOf(parsed)?.name ?? null;

  // Branch hue is keyed off the top-level branch's SOURCE order (not d3's
  // value-sorted order) so the cell colors match the legend, which lists roots
  // in source order. `colorOffset` shifts the index so a drilled-into branch
  // keeps the hue it had at the top level.
  const rootIndexByLabel = new Map(parsed.roots.map((r, i) => [r.label, i]));

  const colorCtx: CellColorContext = {
    mode,
    heat,
    tagGroups: parsed.tagGroups,
    activeGroup,
    rootIndexByLabel,
    seriesColors,
    colorOffset,
    bg: palette.bg,
    muted: mutedFill(palette),
  };

  // ── Cells ──────────────────────────────────────────────────
  const recedes = treemapRecedes(parsed);
  // Story view (#2046): lit cells solid, the rest one grey ground.
  const story = treemapStory(parsed, palette, isDark);
  for (const cell of layout.cells) {
    const w = Math.max(0, cell.x1 - cell.x0);
    const h = Math.max(0, cell.y1 - cell.y0);
    if (w <= 0 || h <= 0) continue;

    // Emphasis: the containing box (header band) is pure color; the internal
    // leaf cells are muted (mixed toward the background). Both are opaque so the
    // pure container behind a leaf doesn't bleed through.
    const recede = recedes(cell);
    const own = resolveCellColor(cell, colorCtx);
    const baseColor = !story.active
      ? own
      : recede
        ? story.groundStroke
        : story.subject(own);
    // fill-outline (§1.9): background cells, color rides the cell stroke.
    const fill = story.active
      ? recede && !cell.isContainer
        ? story.groundFill
        : baseColor
      : fillMode === 'outline'
        ? themeBaseBg(palette, isDark)
        : cell.isContainer
          ? baseColor
          : fillMode === 'solid'
            ? baseColor
            : mix(baseColor, palette.bg, LEAF_MUTE_PCT);
    const drillable = cell.isContainer || cell.isCollapsed;

    const g = root
      .append('g')
      .attr('class', 'dgmo-treemap-cell')
      .attr('transform', `translate(${cell.x0},${cell.y0})`)
      .attr('data-node-path', cell.path.join(' / '))
      // The top-level branch, which the branch legend names — the baked
      // legend hover pairs on it (diagrammo/diagrammo#1215).
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
    // §1.11 emphasis (#1829): a receded cell keeps its paint and fades whole,
    // label included — the family chart's card treatment.
    // Story view bakes the grey into the paint instead.
    if (recede && !story.active) g.attr('opacity', EMPHASIS_DIM_OPACITY);

    const rect = g
      .append('rect')
      .attr(
        'class',
        cell.isContainer ? 'dgmo-treemap-rect branch' : 'dgmo-treemap-rect'
      )
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 2)
      .attr('fill', fill)
      .attr('fill-opacity', 1)
      .attr('stroke', fillMode === 'outline' ? baseColor : palette.bg)
      // No stroke on internal leaf shapes — the paddingInner gap already
      // separates them; only the containing box keeps a frame. In outline
      // mode every cell keeps a colored frame — the stroke IS the color.
      .attr(
        'stroke-width',
        fillMode === 'outline' ? 1 : cell.isContainer ? 1 : 0
      );

    if (drillable && options.onClickItem && cell.lineNumber !== undefined) {
      const ln = cell.lineNumber;
      rect
        .style('cursor', 'pointer')
        .on('click', () => options.onClickItem!(ln));
    }

    const ink =
      fillMode === 'outline'
        ? baseColor
        : contrastText(fill, palette.textOnFillLight, palette.textOnFillDark);

    // Header bar: group name (left) + its aggregate value/% (right) so a
    // container's share is readable without drilling.
    if (cell.isContainer && headerH > 0 && w > 34 && h > headerH) {
      const valParts: string[] = [];
      if (!opts.noValues) valParts.push(compactNumber(cell.value));
      if (!opts.noPercent) valParts.push(formatPct(cell.pctOfRoot));
      const valStr = valParts.join(' · ');
      // Only reserve space for the focus icon when one is actually drawn (a
      // non-drillable container's header value sits flush right).
      const ICON_RESERVE = drillable ? 16 : 4;
      const showVal = valStr.length > 0 && w > 110;
      const valW = showVal ? measureText(valStr, 10.5) : 0;
      const labelMax = w - 8 - ICON_RESERVE - (showVal ? valW + 10 : 0);

      g.append('text')
        .attr('class', 'dgmo-treemap-header')
        .attr('x', 6)
        .attr('y', 13)
        .attr('font-size', 11)
        .attr('font-weight', 'bold')
        .attr('fill', ink)
        .text(clipLabel(cell.label, Math.max(0, labelMax), 11));

      if (showVal) {
        g.append('text')
          .attr('class', 'dgmo-treemap-header-value')
          .attr('x', w - ICON_RESERVE - 4)
          .attr('y', 13)
          .attr('text-anchor', 'end')
          .attr('font-size', 10.5)
          .attr('fill', ink)
          .attr('opacity', 0.75)
          .text(valStr);
      }
    }

    // Leaf / collapsed-block labels. The name scales with the cell so a big
    // shape fills its space; the bigger the label, the more it's muted — a soft
    // watermark on large cells, crisp on small ones. A name that fits one line
    // at a comfortable size stays one line; a long one wraps to fill the cell
    // (#2466) at the largest size whose lines all fit, down to the
    // TREEMAP_LABEL_MIN_FS floor. Only then is the last line cut with "…", and
    // the cell keeps the full name in FULL_TEXT_ATTR.
    // Pad scales down on small cells so a tight label still fits; big cells
    // keep the roomy 14px gutter.
    const PAD = Math.max(4, Math.min(14, Math.floor(Math.min(w, h) / 5)));
    const MIN_FS = TREEMAP_LABEL_MIN_FS;
    if (!cell.isContainer && w >= 2 * PAD + 8 && h >= 2 * PAD + 8) {
      const maxW = w - 2 * PAD;
      const fs0 = clamp(
        Math.round(Math.min(w / 3.6, h / 3.4)),
        MIN_FS,
        TREEMAP_LABEL_MAX_FS
      );
      const fit = fitLeafLabel(cell.label, maxW, h - 2 * PAD, fs0, MIN_FS);

      // Vertical fallback: only when the wrapped horizontal name cannot fit
      // even at the floor, the cell is clearly taller than wide, and running
      // the name down the cell shows more of it. Value/% are dropped in this
      // mode — showing the name is the point.
      if (fit.label.truncated && h > w * 1.25) {
        const verticalFit = fitLeafLabel(
          cell.label,
          h - 2 * PAD,
          w - 2 * PAD,
          Math.min(fs0, 22),
          MIN_FS
        );
        if (
          verticalFit.fits &&
          shownChars(verticalFit.label) > shownChars(fit.label)
        ) {
          drawVerticalLabel(g, verticalFit, w, h, ink);
          if (verticalFit.label.truncated) g.attr(FULL_TEXT_ATTR, cell.label);
          if (drillable && w > 30 && h > 22) drawFocusIcon(g, w, ink, 9);
          continue;
        }
      }
      if (fit.label.truncated) g.attr(FULL_TEXT_ATTR, cell.label);

      const fs = fit.fs;
      // The muting ramp keeps its original 7px origin, so a name's opacity
      // does not move with the floor.
      const tg = clamp((fs - 7) / (TREEMAP_LABEL_MAX_FS - 7), 0, 1);
      const nameOpacity = 0.95 - tg * 0.5; // 0.95 small → 0.45 large
      const vfs = clamp(Math.round(fs * 0.42), 11, 28);
      const valOpacity = Math.max(0.45, nameOpacity - 0.1);

      // Top PAD above the cap height; a big name's ascenders (an accented
      // capital reaches a full em) stay inside its cell all the same (#2117).
      let y = labelFirstBaseline(fs, PAD);
      const lineH = labelLineHeight(fs);
      const nameText = g
        .append('text')
        .attr('class', 'dgmo-treemap-label')
        .attr('x', PAD)
        .attr('y', y)
        .attr('font-size', fs)
        .attr('font-weight', 'bold')
        .attr('fill', ink)
        .attr('opacity', nameOpacity);
      if (fit.label.lines.length === 1) {
        nameText.text(fit.label.lines[0]!);
      } else {
        fit.label.lines.forEach((line, i) => {
          nameText
            .append('tspan')
            .attr('x', PAD)
            .attr('y', y + i * lineH)
            .text(line);
        });
      }
      // Value lines hang off the last name line.
      y += (fit.label.lines.length - 1) * lineH;

      const valParts = [
        opts.noValues ? '' : compactNumber(cell.value),
        opts.noPercent ? '' : formatPct(cell.pctOfRoot),
      ].filter(Boolean);
      const combined = valParts.join(' · ');
      const nameBaseY = y;
      const addLineAt = (
        text: string,
        yy: number,
        size: number,
        opacity: number
      ): void => {
        g.append('text')
          .attr('class', 'dgmo-treemap-value')
          .attr('x', PAD)
          .attr('y', yy)
          .attr('font-size', size)
          .attr('fill', ink)
          .attr('opacity', opacity)
          .text(text);
      };

      if (combined) {
        const fitsW = measureText(combined, vfs) <= maxW;
        const valY = y + lineDrop(fs, vfs);
        const roomBelow = valY + descent(vfs) <= h - PAD;
        if (fitsW && roomBelow) {
          // Preferred: value · % on its own line under the name.
          addLineAt(combined, valY, vfs, valOpacity);
        } else if (fitsW) {
          // Short cell: no room below → trail the value after the name,
          // smaller, on the same line (if it fits the width).
          const ivfs = clamp(Math.round(fs * 0.5), 11, Math.max(11, vfs));
          const rendered = fit.label.lines[fit.label.lines.length - 1] ?? '';
          // Measured in the bold face the name is drawn in — this used to pad
          // the regular width by 12% to keep the value off the name's end
          // (e.g. "Hardtack70"); the real advances make the guess unnecessary.
          const nW = measureText(rendered, fs, { bold: true });
          const gap = Math.max(12, Math.round(fs * 0.25));
          if (PAD + nW + gap + measureText(combined, ivfs) <= w - PAD) {
            g.append('text')
              .attr('class', 'dgmo-treemap-value')
              .attr('x', PAD + nW + gap)
              .attr('y', nameBaseY)
              .attr('font-size', ivfs)
              .attr('fill', ink)
              .attr('opacity', valOpacity)
              .text(combined);
          }
        } else if (valParts.length === 2) {
          // Tall-narrow cell: combined too wide → stack value then % below.
          const d1 = lineDrop(fs, vfs);
          if (y + d1 + descent(vfs) <= h - PAD) {
            y += d1;
            addLineAt(valParts[0]!, y, vfs, valOpacity);
          }
          const pfs = Math.max(10, Math.round(vfs * 0.9));
          const d2 = lineDrop(vfs, pfs);
          if (y + d2 + descent(pfs) <= h - PAD) {
            y += d2;
            addLineAt(valParts[1]!, y, pfs, valOpacity);
          }
        } else {
          const onlyY = y + lineDrop(fs, vfs);
          if (onlyY + descent(vfs) <= h - PAD) {
            addLineAt(combined, onlyY, vfs, valOpacity);
          }
        }
      }
    }

    // Scope/target focus icon on drillable cells (interactive-only).
    if (drillable && w > 30 && h > 22) {
      drawFocusIcon(g, w, ink, 9);
    }
  }

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
      mode: exportMode ? 'export' : 'preview',
      // Inline → left-origin so the wrapper's right-flush translate lands the
      // legend at the chart's right edge; stacked → centered below the title.
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      activeGroup: legend.activeGroup,
      // The color-mode switcher is the legend itself: each applicable mode is a
      // group pill; the active one is the open capsule, the rest are clickable
      // pills that switch mode. Export shows only the active group.
      showInactivePills: !exportMode,
      showEmptyGroups: !exportMode,
      ...(options.onSelectMode !== undefined && {
        callbacks: {
          onGroupToggle: (name: string) => {
            const m = legend.modeByName.get(name);
            if (m) options.onSelectMode!(m);
          },
        },
      }),
    });
  }

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });
}

// ============================================================
// Helpers
// ============================================================

function drawFocusIcon(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  w: number,
  ink: string,
  cy: number
): void {
  // Small, subtle scope/target ring centered vertically at `cy` (the header
  // band's middle). Opacity is driven by the SVG <style> (faint by default,
  // clearer on cell hover). A generous transparent rect keeps it easy to click.
  const r = 4.5;
  const cx = w - r - 5;
  const fi = g
    .append('g')
    .attr('class', 'dgmo-treemap-focus')
    .attr('data-export-ignore', 'true');
  fi.append('rect')
    .attr('x', cx - 9)
    .attr('y', cy - 9)
    .attr('width', 18)
    .attr('height', 18)
    .attr('fill', 'transparent');
  fi.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', r)
    .attr('fill', 'none')
    .attr('stroke', ink)
    .attr('stroke-width', 1.25);
  fi.append('circle')
    .attr('cx', cx)
    .attr('cy', cy)
    .attr('r', 1.4)
    .attr('fill', ink);
}

/**
 * Run a leaf's name vertically (reads bottom-to-top) down a tall-narrow cell.
 * `fit` was computed with the cell HEIGHT as the line length and the cell
 * WIDTH as the stack depth, so its lines sit side by side across the cell.
 * No value/% — the caller only reaches here when the cell is too narrow.
 */
function drawVerticalLabel(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  fit: LeafLabelFit,
  w: number,
  h: number,
  ink: string
): void {
  const { fs, label } = fit;
  const lineH = labelLineHeight(fs);
  const n = label.lines.length;
  const text = g
    .append('text')
    .attr('class', 'dgmo-treemap-label')
    // Center on the cell, rotate -90 so the string runs upward; the small y
    // offset recenters the glyph's cap height across the cell width (resvg has
    // no reliable dominant-baseline, so it's done by hand like the H labels).
    .attr('transform', `translate(${w / 2},${h / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('font-size', fs)
    .attr('font-weight', 'bold')
    .attr('fill', ink)
    .attr('opacity', 0.95);
  label.lines.forEach((line, i) => {
    text
      .append('tspan')
      .attr('x', 0)
      .attr('y', Math.round(fs * 0.28 + (i - (n - 1) / 2) * lineH))
      .text(line);
  });
}

/** Smallest font a leaf name is drawn at before its last line is cut (#2466). */
export const TREEMAP_LABEL_MIN_FS = 10;
/** A cell too short for one floor-size line shrinks its one line to this. */
const TREEMAP_LABEL_TINY_FS = 7;
/** Largest font a leaf name grows to in a big cell. */
export const TREEMAP_LABEL_MAX_FS = 72;
/** Text-measure under-estimates bold glyph widths; keep this much spare. */
const LABEL_WIDTH_SAFETY = 1.06;

/** Baseline of a leaf name's first line, `pad` below the cell top. */
function labelFirstBaseline(fs: number, pad: number): number {
  return Math.max(pad + Math.round(fs * 0.78), Math.ceil(fs));
}

/** Baseline-to-baseline pitch between wrapped name lines. */
function labelLineHeight(fs: number): number {
  return Math.round(fs * 1.15);
}

interface LeafLabelFit {
  fs: number;
  label: FittedLabel;
  /** False when even one line at the floor does not fit the depth. */
  fits: boolean;
}

/** Lines of `depth` px that fit at `fs`, first line's cap height included. */
function linesThatFit(fs: number, depth: number): number {
  const first = Math.round(fs * 0.78) + descent(fs);
  if (depth < first) return 0;
  return 1 + Math.floor((depth - first) / labelLineHeight(fs));
}

/**
 * Fit a leaf name into a `length` × `depth` box. A name that fits one line at
 * a comfortable size (half the cell's size, at least 12px) keeps one line, as
 * it always has. Otherwise it takes the largest size from `fs0` down to
 * `minFs` at which every word fits the lines the depth allows; failing that,
 * the floor size with its last line cut.
 */
function fitLeafLabel(
  name: string,
  length: number,
  depth: number,
  fs0: number,
  minFs: number
): LeafLabelFit {
  const width = length / LABEL_WIDTH_SAFETY;
  // The one-line test keeps its original regular-face measure (with the
  // safety factor), so a name that always fit on one line draws as before.
  const oneLineW = measureText(name, fs0);
  const oneLineFs =
    oneLineW <= width ? fs0 : Math.floor((fs0 * width) / oneLineW);
  if (oneLineFs >= Math.max(12, minFs, Math.round(fs0 / 2))) {
    return {
      fs: oneLineFs,
      label: { lines: [name], truncated: false },
      fits: linesThatFit(oneLineFs, depth) >= 1,
    };
  }
  for (let fs = fs0; fs >= minFs; fs--) {
    const maxLines = linesThatFit(fs, depth);
    if (maxLines < 1) continue;
    const label = fitLabel(name, fs, width, maxLines, BOLD);
    if (label.truncated) continue;
    // Wrapping bought nothing: keep the one-line size as measured above.
    if (label.lines.length === 1 && oneLineFs >= minFs) {
      return {
        fs: oneLineFs,
        label: { lines: [name], truncated: false },
        fits: linesThatFit(oneLineFs, depth) >= 1,
      };
    }
    return { fs, label, fits: true };
  }
  // A cell too short for one line at the floor still names itself, smaller,
  // on one cut line — down to TREEMAP_LABEL_TINY_FS.
  let fs = minFs;
  while (fs > TREEMAP_LABEL_TINY_FS && linesThatFit(fs, depth) < 1) fs--;
  const maxLines = linesThatFit(fs, depth);
  return {
    fs,
    label: fitLabel(name, fs, width, Math.max(1, maxLines), BOLD),
    fits: maxLines >= 1,
  };
}

/** Characters a fitted label shows, ellipsis excluded. */
function shownChars(label: FittedLabel): number {
  return label.lines.join('').replace(/…/g, '').replace(/\s+/g, '').length;
}

const BOLD = { bold: true } as const;

/** Depth a glyph's descender (p, q, g, y, j) drops below the baseline. Inter's
 *  deepest descenders sit at ~0.24em; round up so a big `g`/`y` tail never grazes
 *  the line beneath it. */
function descent(fs: number): number {
  return Math.ceil(fs * 0.26);
}

/**
 * Baseline-to-baseline drop from a line at `prevFs` to the next at `nextFs`:
 * clear the previous line's descender, leave a small gap, then drop by the next
 * line's cap height. Without the descender term, a large name's `p`/`g`/`y`
 * tails collide with the value line beneath it.
 */
function lineDrop(prevFs: number, nextFs: number, gap = 4): number {
  return descent(prevFs) + gap + Math.round(nextFs * 0.72);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Clip to a pixel width with a trailing ellipsis. Measured bold because every
 * caller draws at 600 or 700, and with only Regular and Bold shipped, CSS font
 * matching resolves both of those to the Bold face (verified by rasterising:
 * 600 and 700 are byte-identical, 500 and 400 are byte-identical).
 */
function clipLabel(s: string, maxWidth: number, fs: number): string {
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
