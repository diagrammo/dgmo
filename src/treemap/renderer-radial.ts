// ============================================================
// Treemap — Radial (sunburst) D3 SVG Renderer
// ============================================================
//
// Emits a static, full-tree sunburst: concentric rings (one per depth level)
// around a solid center disc that holds the CHART TITLE + grand total (the
// synthetic root — NOT a node label; works uniformly for single- and multi-root
// sources). Color reuses the treemap color engine (`treemap-shared.ts`): branch
// base hue at the inner ring, tinted outward by depth (floored so the outer ring
// stays legible), or tag / heat modes.
//
// Static export only — no interactive chrome (no drill breadcrumb / tooltip /
// mode switcher). References `charts-d3/pie.ts` for the arc() + mid-angle label
// math, but does not import it (different data model: hierarchy vs flat chart).

import * as d3Selection from 'd3-selection';
import { arc as d3arc } from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import {
  contrastText,
  contrastRatio,
  relativeLuminance,
  hexToHSL,
  hslToHex,
  getSeriesColors,
} from '../palettes/color-utils';
import { tagAttrKey } from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import type { LegendPosition } from '../utils/legend-types';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedTreemap, TreemapColorMode } from './types';
import { layoutTreemapRadial, type RadialCell } from './layout-radial';
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
} from './treemap-shared';

const PADDING = 12;

/** Standard placement every dgmo legend uses: centered, under the title. */
const LEGEND_POSITION: LegendPosition = {
  placement: 'top-center',
  titleRelation: 'below-title',
};

/** Small-arc dropout threshold (ADR-5/AC7): drop inline labels below 6°. */
const MIN_LABEL_SWEEP = (6 * Math.PI) / 180; // ≈ 0.105 rad

/** Floor for shrink-to-fit label text — below this it's ellipsized instead. */
const MIN_LABEL_FS = 8;

/** Preferred name-line size; shrinks to fit the ring thickness / arc length. */
const LABEL_BASE_FS = 16;

export interface TreemapRadialRenderOptions {
  /** Color mode override (app's runtime switcher). Defaults to source. */
  colorMode?: TreemapColorMode;
  /** Interactive render budget. Export omits it → full tree. */
  maxDepth?: number;
  /** Shift the branch-hue index (drilled-into view keeps its expanded hue). */
  colorOffset?: number;
  exportMode?: boolean;
}

/** Render for CLI/export (full tree, no interactive chrome). */
export function renderTreemapRadialForExport(
  container: HTMLDivElement,
  parsed: ParsedTreemap,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options?: TreemapRadialRenderOptions
): void {
  renderTreemapRadial(container, parsed, palette, isDark, exportDims, {
    exportMode: true,
    ...options,
  });
}

export function renderTreemapRadial(
  container: HTMLDivElement,
  parsed: ParsedTreemap,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options: TreemapRadialRenderOptions = {}
): void {
  if (parsed.error || parsed.roots.length === 0) return;
  void isDark;

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const mode = resolveColorMode(parsed, options.colorMode);
  const opts = parsed.options;
  const exportMode = options.exportMode ?? false;
  const seriesColors = getSeriesColors(palette);

  const heat = buildHeatScale(parsed, palette);
  const legend = !opts.noLegend
    ? buildLegend(mode, parsed, heat, seriesColors, options.colorOffset ?? 0)
    : null;

  const legendReserve = legend
    ? getMaxLegendReservedHeight(
        { groups: legend.groups, position: LEGEND_POSITION, mode: 'preview' },
        width
      ) + LEGEND_GROUP_GAP
    : 0;

  // Plot area below the (optional) legend band. The chart title lives in the
  // center disc for radial mode, so no top title band is reserved.
  const areaY = legendReserve + PADDING;
  const areaW = Math.max(1, width - PADDING * 2);
  const areaH = Math.max(1, height - areaY - PADDING);
  const radius = Math.max(1, Math.min(areaW, areaH) / 2 - PADDING);
  const cx = width / 2;
  const cy = areaY + areaH / 2;

  const layout = layoutTreemapRadial(parsed.roots, {
    radius,
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
    .attr('class', 'dgmo-treemap dgmo-treemap-radial')
    .style('font-family', FONT_FAMILY);

  // Curved arc labels reference per-arc paths kept in <defs> (via <textPath>).
  const defs = svg.append('defs');

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  const plot = svg
    .append('g')
    .attr('class', 'dgmo-treemap-cells')
    .attr('transform', `translate(${cx},${cy})`);

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

  const arcGen = d3arc<RadialCell>()
    .startAngle((c) => c.startAngle)
    .endAngle((c) => c.endAngle)
    .innerRadius((c) => c.innerR)
    .outerRadius((c) => c.outerR)
    .padAngle(0.004)
    .padRadius(radius);

  // ── Arcs ───────────────────────────────────────────────────
  let labelSeq = 0;
  if (!layout.isEmpty) {
    for (const cell of layout.cells) {
      const fill = resolveCellColor(cell, colorCtx);
      const g = plot
        .append('g')
        .attr('class', 'dgmo-treemap-cell')
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

      g.append('path')
        .attr(
          'class',
          cell.isContainer ? 'dgmo-treemap-arc branch' : 'dgmo-treemap-arc'
        )
        .attr('d', arcGen(cell) ?? '')
        .attr('fill', fill)
        .attr('stroke', palette.bg)
        .attr('stroke-width', 1);

      drawArcLabel(
        g,
        defs,
        `dgmo-arc-lbl-${labelSeq++}`,
        cell,
        opts,
        palette,
        fill
      );
    }
  }

  // ── Center disc: chart title + grand total (or empty-state) ─
  drawCenterDisc(
    plot,
    parsed,
    layout.discRadius,
    layout.total,
    layout.isEmpty,
    palette
  );

  // ── Legend ─────────────────────────────────────────────────
  if (legend) {
    const legendG = svg
      .append('g')
      .attr('class', 'dgmo-treemap-legend')
      .attr('transform', 'translate(0, 0)');
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
      showInactivePills: !exportMode,
      showEmptyGroups: !exportMode,
    });
  }
}

// ============================================================
// Center disc
// ============================================================

function drawCenterDisc(
  plot: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  parsed: ParsedTreemap,
  discRadius: number,
  total: number,
  isEmpty: boolean,
  palette: PaletteColors
): void {
  const disc = plot.append('g').attr('class', 'dgmo-treemap-disc');
  disc
    .append('circle')
    .attr('r', discRadius)
    .attr('fill', palette.surface)
    .attr('stroke', palette.bg)
    .attr('stroke-width', 1);

  const ink = contrastText(
    palette.surface,
    palette.textOnFillLight,
    palette.textOnFillDark
  );
  const maxW = discRadius * 1.7;

  if (isEmpty) {
    disc
      .append('text')
      .attr('class', 'dgmo-treemap-empty')
      .attr('text-anchor', 'middle')
      .attr('y', 4)
      .attr('fill', ink)
      .attr('font-size', clampFs(13, discRadius))
      .text(clip('No values to chart', maxW, 13));
    return;
  }

  const title = parsed.title ?? '';
  // The grand total shows in full with thousand-separators (e.g. "1,040") — the
  // disc has room and compacting it ("1k") is imprecise and reads as a unit
  // (doubly so under a "$k"-style title). Shrink-to-fit keeps big totals inside.
  const totalStr = groupedNumber(total);
  const titleFs = clampFs(15, discRadius);
  const totalFs = fitFs(totalStr, clampFs(22, discRadius), maxW);

  if (title) {
    const t = disc
      .append('text')
      .attr('class', 'dgmo-treemap-disc-title')
      .attr('text-anchor', 'middle')
      .attr('y', -4)
      .attr('fill', ink)
      .attr('font-size', titleFs)
      .attr('font-weight', 'bold')
      .text(clip(title, maxW, titleFs));
    if (parsed.titleLineNumber !== null) {
      t.attr('data-line-number', parsed.titleLineNumber);
    }
  }

  disc
    .append('text')
    .attr('class', 'dgmo-treemap-disc-total')
    .attr('text-anchor', 'middle')
    .attr('y', title ? titleFs : 8)
    .attr('fill', ink)
    .attr('font-size', totalFs)
    .attr('font-weight', 'bold')
    .text(totalStr);
}

/** Full integer-ish number with thousand separators ("1040" → "1,040"),
 *  deterministic (no locale). Keeps up to 2 decimals if present. */
function groupedNumber(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  const neg = rounded < 0 ? '-' : '';
  const [int, frac] = String(Math.abs(rounded)).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${neg}${grouped}.${frac}` : `${neg}${grouped}`;
}

// ============================================================
// Arc labels — curved along the ring (<textPath>) + small-arc dropout
// ============================================================

function drawArcLabel(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  defs: d3Selection.Selection<SVGDefsElement, unknown, null, undefined>,
  pathId: string,
  cell: RadialCell,
  opts: ParsedTreemap['options'],
  palette: PaletteColors,
  fill: string
): void {
  const sweep = cell.endAngle - cell.startAngle;
  // AC7 small-arc dropout: no inline label below the threshold.
  if (sweep < MIN_LABEL_SWEEP) return;

  const ringThickness = cell.outerR - cell.innerR;
  if (ringThickness < 10) return;

  const ink = tonalInk(fill, palette.textOnFillLight, palette.textOnFillDark);

  const rMid = (cell.innerR + cell.outerR) / 2;
  const maxFs = clampFs(LABEL_BASE_FS, ringThickness);

  const name = cell.label;
  const valParts = [
    opts.noValues ? '' : compactNumber(cell.value),
    opts.noPercent ? '' : formatPct(cell.pctOfRoot),
  ].filter(Boolean);
  const valStr = valParts.join(' · ');

  // Two-line layout: the name and the value · % ride parallel concentric arcs
  // that straddle the ring centre-line. Two shorter curved lines read as
  // sitting "on the ring" far more clearly than one long string, and keep the
  // value legible. Falls back to one line when the ring is too thin to stack.
  const valFsBase = Math.max(MIN_LABEL_FS, Math.round(maxFs * 0.82));
  const lineGap = Math.round((maxFs + valFsBase) * 0.6); // baseline separation
  const blockExtent = lineGap + 0.35 * maxFs + 0.35 * valFsBase + 4;

  if (valStr && ringThickness >= blockExtent) {
    // Name is the upper line as read: outer on the top half, inner on the
    // (reversed) bottom half, so it always sits above the value.
    const nameOuter = !isBottomHalf(cell);
    const rName = rMid + (nameOuter ? 1 : -1) * (lineGap / 2);
    const rVal = rMid + (nameOuter ? -1 : 1) * (lineGap / 2);

    const nameAvail = sweep * rName * 0.94;
    const nameFs = fitFs(name, maxFs, nameAvail);
    const nameText = clip(name, nameAvail, nameFs);
    if (nameText) {
      drawCurvedLine(
        g,
        defs,
        `${pathId}-n`,
        cell,
        rName,
        nameFs,
        'bold',
        nameText,
        ink
      );
      const valAvail = sweep * rVal * 0.94;
      const valFs = fitFs(valStr, valFsBase, valAvail);
      const valText = clip(valStr, valAvail, valFs);
      if (valText) {
        drawCurvedLine(
          g,
          defs,
          `${pathId}-v`,
          cell,
          rVal,
          valFs,
          'normal',
          valText,
          ink
        );
      }
      return;
    }
  }

  // Single-line fallback: thin rings, or a name with no value string.
  const full = valStr ? `${name} ${valStr}` : name;
  const availLen = sweep * rMid * 0.94;
  const fs = fitFs(full, maxFs, availLen);
  const text = clip(full, availLen, fs);
  if (!text) return;
  drawCurvedLine(g, defs, pathId, cell, rMid, fs, 'bold', text, ink);
}

/** Is the cell's mid-angle on the lower half (where the baseline path must be
 *  reversed so the text reads upright)? */
function isBottomHalf(cell: RadialCell): boolean {
  const mid = (cell.startAngle + cell.endAngle) / 2;
  return mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;
}

/** Shrink-to-fit: drop the font size proportionally to the overflow so `text`
 *  fits `availLen`, floored at MIN_LABEL_FS. Width scales ~linearly with fs. */
function fitFs(text: string, maxFs: number, availLen: number): number {
  // Every run on this chart is drawn at 600 or 700, both of which resolve to
  // the Bold face.
  const w = measureText(text, maxFs, { bold: true });
  if (w <= availLen) return maxFs;
  return Math.max(MIN_LABEL_FS, Math.floor((maxFs * availLen) / w));
}

/** One curved line of text flowing along the ring on a per-arc <textPath>,
 *  optically centred on `centerR`. On the bottom half the path is reversed so
 *  the text is never upside-down. */
function drawCurvedLine(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  defs: d3Selection.Selection<SVGDefsElement, unknown, null, undefined>,
  pathId: string,
  cell: RadialCell,
  centerR: number,
  fs: number,
  weight: string,
  text: string,
  ink: string
): void {
  const bottom = isBottomHalf(cell);

  // Baseline sits ON the path; nudge the path radius so the text's optical
  // centre lands on centerR (glyphs grow outward on top, inward on the reversed
  // bottom path — opposite radial offsets keep both visually centred).
  const rPath = bottom ? centerR + fs * 0.32 : centerR - fs * 0.32;

  // SVG polar: 0 rad = 12 o'clock, clockwise. Reverse endpoints + sweep-flag on
  // the bottom half to flip the baseline upright.
  const [a0, a1] = bottom
    ? [cell.endAngle, cell.startAngle]
    : [cell.startAngle, cell.endAngle];
  const p0x = Math.sin(a0) * rPath;
  const p0y = -Math.cos(a0) * rPath;
  const p1x = Math.sin(a1) * rPath;
  const p1y = -Math.cos(a1) * rPath;
  const sweepFlag = bottom ? 0 : 1;
  // Large-arc flag: segments wider than 180° need the major arc, else SVG draws
  // the minor arc on the OPPOSITE side and the text lands outside its segment.
  const largeArc = cell.endAngle - cell.startAngle > Math.PI ? 1 : 0;
  const d = `M ${p0x.toFixed(2)} ${p0y.toFixed(2)} A ${rPath.toFixed(2)} ${rPath.toFixed(2)} 0 ${largeArc} ${sweepFlag} ${p1x.toFixed(2)} ${p1y.toFixed(2)}`;

  defs.append('path').attr('id', pathId).attr('d', d);

  g.append('text')
    .attr('class', 'dgmo-treemap-label')
    .attr('font-size', fs)
    .attr('font-weight', weight)
    .attr('fill', ink)
    .append('textPath')
    .attr('href', `#${pathId}`)
    .attr('startOffset', '50%')
    .attr('text-anchor', 'middle')
    .text(text);
}

// ============================================================
// Small helpers
// ============================================================

/**
 * Label ink toned from the segment's own fill — a monochromatic look instead of
 * flat black/white. The labels are large (bold ≥14px), so the WCAG-AA "large
 * text" 3:1 threshold applies. We build both a deep saturated shade and a bright
 * saturated tint of the fill hue, step each toward its extreme only as far as
 * contrast needs, and keep whichever clears 3:1 (preferring the direction away
 * from the fill's own lightness — light ink on dark fills, dark on light). A
 * near-grey fill where neither stays colourful enough falls back to the
 * palette's plain on-fill ink.
 */
const INK_MIN_CONTRAST = 3;

function tonedCandidate(
  h: number,
  s: number,
  fill: string,
  dark: boolean
): { ink: string; ok: boolean } {
  const sat = dark
    ? Math.min(85, Math.max(s, 55))
    : Math.min(72, Math.max(42, s));
  let l = dark ? 34 : 80;
  let ink = hslToHex(h, sat, l);
  for (let i = 0; i < 30 && contrastRatio(ink, fill) < INK_MIN_CONTRAST; i++) {
    l += dark ? -3 : 3;
    if (l <= 3 || l >= 97) break;
    ink = hslToHex(h, sat, l);
  }
  return { ink, ok: contrastRatio(ink, fill) >= INK_MIN_CONTRAST };
}

function tonalInk(fill: string, onLight: string, onDark: string): string {
  const { h, s } = hexToHSL(fill);
  const dark = tonedCandidate(h, s, fill, true);
  const light = tonedCandidate(h, s, fill, false);
  const preferLight = relativeLuminance(fill) <= 0.45; // dark fill → light ink
  if (dark.ok && light.ok) return preferLight ? light.ink : dark.ink;
  if (dark.ok) return dark.ink;
  if (light.ok) return light.ink;
  return contrastText(fill, onLight, onDark);
}

function clampFs(base: number, thickness: number): number {
  return Math.max(8, Math.min(base, Math.round(thickness * 0.9)));
}

function clip(s: string, maxWidth: number, fs: number): string {
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
