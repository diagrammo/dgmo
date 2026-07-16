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
import {
  contrastText,
  getSeriesColors,
  mix,
  themeBaseBg,
} from '../palettes/color-utils';
import { tagAttrKey } from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import type { LegendPosition } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedTreemap, TreemapColorMode } from './types';
import { layoutTreemap } from './layout';
import {
  buildHeatScale,
  buildLegend,
  compactNumber,
  formatPct,
  resolveCellColor,
  resolveColorMode,
  type CellColorContext,
} from './treemap-shared';

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

  // Reserve a band below the title for the standardized legend, exactly like
  // mindmap/org/map (top-center, below-title). The treemap fills the rest.
  const legendReserve = legend
    ? getMaxLegendReservedHeight(
        { groups: legend.groups, position: LEGEND_POSITION, mode: 'preview' },
        width
      ) + LEGEND_GROUP_GAP
    : 0;

  const headerH = opts.noHeaders ? 0 : HEADER_H;
  const areaX = PADDING;
  const areaY = titleH + legendReserve + PADDING;
  const areaW = Math.max(1, width - PADDING * 2);
  const areaH = Math.max(1, height - areaY - PADDING);

  const layout = layoutTreemap(parsed.roots, {
    width: areaW,
    height: areaH,
    headerH,
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
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
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
    .attr('transform', `translate(${areaX},${areaY})`);

  const seriesColors = seriesColorsTop;
  const colorOffset = options.colorOffset ?? 0;
  const activeGroup =
    parsed.tagGroups.length > 0 ? parsed.tagGroups[0]!.name : null;

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
  };

  // ── Cells ──────────────────────────────────────────────────
  for (const cell of layout.cells) {
    const w = Math.max(0, cell.x1 - cell.x0);
    const h = Math.max(0, cell.y1 - cell.y0);
    if (w <= 0 || h <= 0) continue;

    // Emphasis: the containing box (header band) is pure color; the internal
    // leaf cells are muted (mixed toward the background). Both are opaque so the
    // pure container behind a leaf doesn't bleed through.
    const baseColor = resolveCellColor(cell, colorCtx);
    // fill-outline (§1.9): background cells, color rides the cell stroke.
    const fill =
      fillMode === 'outline'
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
      .attr('data-node-path', cell.path.join(' / '));
    if (cell.lineNumber !== undefined) {
      g.attr('data-line-number', cell.lineNumber);
    }
    if (cell.heat !== undefined) g.attr('data-heat', cell.heat);
    if (cell.node && activeGroup) {
      const key = tagAttrKey(activeGroup);
      const tagVal = cell.node.metadata[key];
      if (tagVal) g.attr(`data-tag-${key}`, tagVal);
    }

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
        .attr('font-weight', 700)
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
    // watermark on large cells, crisp on small ones. Fit-to-width so the name
    // never has to truncate just because it scaled up.
    // Pad scales down on small cells so a tight label (e.g. a rolled-up
    // "Trivia" leaf) still fits instead of truncating; big cells keep the roomy
    // 14px gutter. MIN_FS lets the name shrink well below the comfortable 12px
    // floor on cramped cells — readability yields to showing the whole word.
    const PAD = Math.max(4, Math.min(14, Math.floor(Math.min(w, h) / 5)));
    const MIN_FS = 7;
    if (!cell.isContainer && w >= 2 * PAD + 8 && h >= 2 * PAD + 8) {
      const maxW = w - 2 * PAD;

      // Vertical fallback: when the name can't fit horizontally even at the
      // floor font, the cell is clearly taller than wide, and rotating buys
      // real length (height beats the horizontal budget), run the name down the
      // cell instead of truncating it. Value/% are dropped in this mode — a
      // narrow tile has no room for a second column, and showing the whole name
      // is the point. Skips the horizontal block entirely when it fires.
      const horizMinW = measureText(cell.label, MIN_FS) * 1.06;
      if (horizMinW > maxW && h > w * 1.25 && h - 2 * PAD > maxW) {
        drawVerticalLabel(g, cell.label, w, h, PAD, ink);
        if (drillable && w > 30 && h > 22) drawFocusIcon(g, w, ink, 9);
        continue;
      }

      let fs = clamp(Math.round(Math.min(w / 3.6, h / 3.4)), MIN_FS, 72);
      // Safety factor: text-measure under-estimates bold glyph widths, so shrink
      // a touch more to guarantee the PAD gap from the right edge.
      const nameW = measureText(cell.label, fs) * 1.06;
      if (nameW > maxW) fs = Math.max(MIN_FS, Math.floor((fs * maxW) / nameW));
      const tg = clamp((fs - MIN_FS) / (72 - MIN_FS), 0, 1);
      const nameOpacity = 0.95 - tg * 0.5; // 0.95 small → 0.45 large
      const vfs = clamp(Math.round(fs * 0.42), 11, 28);
      const valOpacity = Math.max(0.45, nameOpacity - 0.1);

      let y = PAD + Math.round(fs * 0.78); // top PAD above the cap height
      g.append('text')
        .attr('class', 'dgmo-treemap-label')
        .attr('x', PAD)
        .attr('y', y)
        .attr('font-size', fs)
        .attr('font-weight', 600)
        .attr('fill', ink)
        .attr('opacity', nameOpacity)
        .text(clipLabel(cell.label, maxW, fs));

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
          const rendered = clipLabel(cell.label, maxW, fs);
          // Safety factor: text-measure under-estimates bold glyph width, so pad
          // it to the worst case (and add a real gap) or the value collides with
          // the name's end (e.g. "Hardtack70").
          const nW = measureText(rendered, fs) * 1.12;
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
      .attr('transform', `translate(0, ${titleH})`);
    renderIntegratedLegend(legendG, {
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
      position: LEGEND_POSITION,
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
 * Font is bound by the cell WIDTH (the rotated cap height) and the name length
 * by the cell HEIGHT; the name still clips if even rotated it can't fit. No
 * value/% — the caller only reaches here when the cell is too narrow for them.
 */
function drawVerticalLabel(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  label: string,
  w: number,
  h: number,
  pad: number,
  ink: string
): void {
  const MIN_FS = 6;
  const availLen = h - 2 * pad; // length budget, along the cell height
  const availThick = w - 2 * pad; // thickness budget, across the cell width
  // Thickness-bound first: cap the glyph height to the cell width (modest cap so
  // vertical names stay subtle), then shrink to fit the name into the length.
  let fs = clamp(Math.round(Math.min(availThick / 0.8, 14)), MIN_FS, 22);
  const nameW = measureText(label, fs) * 1.06;
  if (nameW > availLen)
    fs = Math.max(MIN_FS, Math.floor((fs * availLen) / nameW));
  const text = clipLabel(label, availLen, fs);
  if (!text) return;

  g.append('text')
    .attr('class', 'dgmo-treemap-label')
    // Center on the cell, rotate -90 so the string runs upward; the small y
    // offset recenters the glyph's cap height across the cell width (resvg has
    // no reliable dominant-baseline, so it's done by hand like the H labels).
    .attr('transform', `translate(${w / 2},${h / 2}) rotate(-90)`)
    .attr('y', Math.round(fs * 0.28))
    .attr('text-anchor', 'middle')
    .attr('font-size', fs)
    .attr('font-weight', 600)
    .attr('fill', ink)
    .attr('opacity', 0.95)
    .text(text);
}

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

function clipLabel(s: string, maxWidth: number, fs: number): string {
  if (measureText(s, fs) <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(s.slice(0, mid) + '…', fs) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '' : s.slice(0, lo) + '…';
}
