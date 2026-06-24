// ============================================================
// Treemap — D3 SVG Renderer
// ============================================================
//
// Emits a static, full-tree treemap. Interactive chrome (drill breadcrumb,
// tooltips, the runtime color-mode switcher) lives app-side; the only
// interactive affordance drawn here is the scope/target focus icon, marked
// `data-export-ignore` so `finalizeSvgExport` strips it on export.

import * as d3Selection from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { FONT_FAMILY } from '../fonts';
import { resolveColor } from '../colors';
import { contrastText, getSeriesColors, mix } from '../palettes/color-utils';
import { resolveTagColor, tagAttrKey } from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import type { LegendGroupData, LegendPosition } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedTreemap, TreemapColorMode, TreemapNode } from './types';
import { layoutTreemap, type TreemapCell } from './layout';

const PADDING = 12;
const HEADER_H = 18;
const TITLE_BAND = 36;
const MUTED_FILL = '#cbd5e1';

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
  void isDark; // colors derive from the palette; kept for handler-signature parity.

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const mode = resolveColorMode(parsed, options.colorMode);
  const opts = parsed.options;
  const exportMode = options.exportMode ?? false;
  const seriesColorsTop = getSeriesColors(palette);
  const showTitle = !!parsed.title;
  const titleH = showTitle ? TITLE_BAND : 0;

  const heat = buildHeatScale(parsed, palette);
  const legend = !opts.noLegend
    ? buildLegend(mode, parsed, heat, seriesColorsTop)
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
    ...(opts.otherBelow !== undefined && { otherBelow: opts.otherBelow }),
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

  // Hatch pattern for the aggregated Other bucket.
  const hatchId = 'dgmo-treemap-hatch';
  const hatch = svg
    .append('defs')
    .append('pattern')
    .attr('id', hatchId)
    .attr('width', 7)
    .attr('height', 7)
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('patternTransform', 'rotate(45)');
  hatch
    .append('line')
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', 7)
    .attr('stroke', palette.text)
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.22);

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
  const activeGroup =
    parsed.tagGroups.length > 0 ? parsed.tagGroups[0]!.name : null;

  // Branch hue is keyed off the top-level branch's SOURCE order (not d3's
  // value-sorted order) so the cell colors match the legend, which lists roots
  // in source order.
  const rootIndexByLabel = new Map(parsed.roots.map((r, i) => [r.label, i]));

  const colorOf = (cell: TreemapCell): string => {
    if (mode === 'heat') {
      return cell.heat !== undefined && heat
        ? heat.scale(cell.heat)
        : MUTED_FILL;
    }
    if (mode === 'tag') {
      if (cell.isOther || !cell.node) return MUTED_FILL;
      return (
        resolveTagColor(cell.node.metadata, parsed.tagGroups, activeGroup) ??
        MUTED_FILL
      );
    }
    // branch: top-level hue, lightened slightly with depth. `mix` takes a
    // PERCENTAGE of the first color to keep (0–100), so deeper cells retain less
    // hue. Floor at 55% so leaves stay clearly saturated, not washed out.
    if (cell.isOther) return MUTED_FILL;
    const topLabel = cell.path[0] ?? cell.label;
    const idx = rootIndexByLabel.get(topLabel) ?? cell.topIndex;
    const hue = seriesColors[idx % seriesColors.length]!;
    if (cell.depth <= 1) return hue;
    const keepPct = Math.max(55, 100 - (cell.depth - 1) * 18);
    return mix(hue, palette.bg, keepPct);
  };

  // ── Cells ──────────────────────────────────────────────────
  for (const cell of layout.cells) {
    const w = Math.max(0, cell.x1 - cell.x0);
    const h = Math.max(0, cell.y1 - cell.y0);
    if (w <= 0 || h <= 0) continue;

    const fill = colorOf(cell);
    // The synthetic Other bucket is a terminal aggregate — it is NOT in the
    // navigable parsed tree, so it must not advertise a drill affordance.
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
      .attr('fill-opacity', cell.isContainer ? 0.35 : 0.95)
      .attr('stroke', palette.bg)
      .attr('stroke-width', 1);

    if (drillable && options.onClickItem && cell.lineNumber !== undefined) {
      const ln = cell.lineNumber;
      rect
        .style('cursor', 'pointer')
        .on('click', () => options.onClickItem!(ln));
    }

    const ink = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

    // Header bar: group name (left) + its aggregate value/% (right) so a
    // container's share is readable without drilling. The value is suppressed on
    // narrow headers and by no-values / no-percent.
    if (cell.isContainer && headerH > 0 && w > 34 && h > headerH) {
      const valParts: string[] = [];
      if (!opts.noValues) valParts.push(compactNumber(cell.value));
      if (!opts.noPercent) valParts.push(formatPct(cell.pctOfRoot));
      const valStr = valParts.join(' · ');
      const ICON_RESERVE = 16; // keep clear of the focus icon at far right
      const showVal = valStr.length > 0 && w > 110;
      const valW = showVal ? measureText(valStr, 10.5) : 0;
      const labelMax = w - 8 - ICON_RESERVE - (showVal ? valW + 10 : 0);

      g.append('text')
        .attr('class', 'dgmo-treemap-header')
        .attr('x', 5)
        .attr('y', 13)
        .attr('font-size', 11)
        .attr('font-weight', 700)
        .attr('fill', palette.text)
        .text(clipLabel(cell.label, Math.max(0, labelMax), 11));

      if (showVal) {
        g.append('text')
          .attr('class', 'dgmo-treemap-header-value')
          .attr('x', w - ICON_RESERVE - 4)
          .attr('y', 13)
          .attr('text-anchor', 'end')
          .attr('font-size', 10.5)
          .attr('fill', palette.textMuted)
          .text(valStr);
      }
    }

    // Leaf / collapsed-block labels — proportional.
    if (!cell.isContainer && w >= 32 && h >= 22) {
      const fs = clamp(Math.floor(Math.min(w / 5.5, h / 2.8)), 11, 26);
      let y = fs + 4;
      g.append('text')
        .attr('class', 'dgmo-treemap-label')
        .attr('x', 6)
        .attr('y', y)
        .attr('font-size', fs)
        .attr('font-weight', 600)
        .attr('fill', ink)
        .text(clipLabel(cell.label, w - 12, fs));

      const vfs = Math.max(10, Math.round(fs * 0.72));
      if (!opts.noValues && h > y + vfs + 6) {
        y += vfs + 6;
        g.append('text')
          .attr('class', 'dgmo-treemap-value')
          .attr('x', 6)
          .attr('y', y)
          .attr('font-size', vfs)
          .attr('fill', ink)
          .attr('opacity', 0.92)
          .text(compactNumber(cell.value));
      }
      if (!opts.noPercent && h > y + 15) {
        y += 15;
        g.append('text')
          .attr('class', 'dgmo-treemap-pct')
          .attr('x', 6)
          .attr('y', y)
          .attr('font-size', Math.max(9, vfs - 1))
          .attr('fill', ink)
          .attr('opacity', 0.7)
          .text(`${formatPct(cell.pctOfRoot)} of root`);
      }
    }

    // Hatch overlay on the Other bucket.
    if (cell.isOther) {
      g.append('rect')
        .attr('width', w)
        .attr('height', h)
        .attr('rx', 2)
        .attr('fill', `url(#${hatchId})`)
        .attr('pointer-events', 'none');
    }

    // Scope/target focus icon on drillable cells (interactive-only).
    if (drillable && w > 30 && h > 22) {
      drawFocusIcon(g, w, ink);
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
// Legend group assembly — reuse the standard tag-group / gradient framework.
// ============================================================

interface TreemapLegend {
  groups: LegendGroupData[];
  activeGroup: string | null;
  /** Legend group name → the color mode it selects (for the click callback). */
  modeByName: Map<string, TreemapColorMode>;
}

/**
 * Build one legend group per APPLICABLE color mode (tag if tags exist, heat if
 * heat data exists, branch always). The active mode's group renders as the open
 * capsule; the others render as clickable pills that switch mode — i.e. the
 * mode switcher IS the legend (the active-group pattern used elsewhere).
 */
function buildLegend(
  activeMode: TreemapColorMode,
  parsed: ParsedTreemap,
  heat: HeatScale | null,
  seriesColors: string[]
): TreemapLegend {
  const groups: LegendGroupData[] = [];
  const modeByName = new Map<string, TreemapColorMode>();
  let activeGroup: string | null = null;

  // ── Tag ──────────────────────────────────────────────────
  if (parsed.tagGroups.length > 0) {
    const tg = parsed.tagGroups[0]!;
    const used = new Set<string>();
    const collect = (nodes: readonly TreemapNode[]): void => {
      for (const n of nodes) {
        const v = n.metadata[tagAttrKey(tg.name)];
        if (v) used.add(v.toLowerCase());
        collect(n.children);
      }
    };
    collect(parsed.roots);
    groups.push({
      name: tg.name,
      entries: tg.entries
        .filter((e) => used.has(e.value.toLowerCase()))
        .map((e) => ({ value: e.value, color: e.color })),
    });
    modeByName.set(tg.name, 'tag');
    if (activeMode === 'tag') activeGroup = tg.name;
  }

  // ── Heat ─────────────────────────────────────────────────
  if (heat) {
    const name = parsed.options.heatLabel ?? 'Value';
    groups.push({
      name,
      entries: [],
      gradient: {
        min: heat.min,
        max: heat.max,
        low: heat.stops[0]!,
        high: heat.stops[heat.stops.length - 1]!,
      },
    });
    modeByName.set(name, 'heat');
    if (activeMode === 'heat') activeGroup = name;
  }

  // ── Branch (always) ──────────────────────────────────────
  groups.push({
    name: 'Branch',
    entries: parsed.roots.map((r, i) => ({
      value: r.label,
      color: seriesColors[i % seriesColors.length]!,
    })),
  });
  modeByName.set('Branch', 'branch');
  if (activeMode === 'branch' || activeGroup === null) activeGroup = 'Branch';

  return { groups, activeGroup, modeByName };
}

// ============================================================
// Color scale (F1 — built here, not in the parser)
// ============================================================

interface HeatScale {
  scale: (v: number) => string;
  min: number;
  max: number;
  stops: string[];
  signed: boolean;
}

function buildHeatScale(
  parsed: ParsedTreemap,
  palette: PaletteColors
): HeatScale | null {
  if (!parsed.hasHeat) return null;
  const values: number[] = [];
  const collect = (nodes: readonly TreemapNode[]): void => {
    for (const n of nodes) {
      if (typeof n.heat === 'number') values.push(n.heat);
      collect(n.children);
    }
  };
  collect(parsed.roots);
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const signed = min < 0 && max > 0;

  const neutral = palette.surface;
  const explicit = parsed.options.heatColors
    .map((c) => resolveColor(c, palette) ?? c)
    .filter((c): c is string => !!c);

  let stops: string[];
  let domain: number[];

  if (explicit.length >= 2) {
    // Two endpoints → low · neutral · high (wide-hue auto-midpoint).
    stops = [explicit[0]!, neutral, explicit[1]!];
    const mid = signed ? 0 : (min + max) / 2;
    domain = [min, mid, max];
  } else if (explicit.length === 1) {
    stops = [neutral, explicit[0]!];
    domain = [min, max];
  } else if (signed) {
    // Data-aware default: diverging, midpoint pinned at 0.
    stops = [palette.colors.red, neutral, palette.colors.green];
    domain = [min, 0, max];
  } else {
    // Data-aware default: sequential neutral → accent.
    stops = [neutral, palette.primary];
    domain = [min, max];
  }

  // Guard against a degenerate (single-value) domain.
  if (domain[0] === domain[domain.length - 1]) {
    const last = stops[stops.length - 1]!;
    return { scale: () => last, min, max, stops, signed };
  }

  const linear = scaleLinear<string, string>()
    .domain(domain)
    .range(stops)
    .clamp(true);
  return { scale: (v: number) => linear(v), min, max, stops, signed };
}

function resolveColorMode(
  parsed: ParsedTreemap,
  override?: TreemapColorMode
): TreemapColorMode {
  let mode = override ?? parsed.defaultColorMode;
  if (mode === 'tag' && parsed.tagGroups.length === 0) {
    mode = parsed.hasHeat ? 'heat' : 'branch';
  }
  if (mode === 'heat' && !parsed.hasHeat) mode = 'branch';
  return mode;
}

// ============================================================
// Helpers
// ============================================================

function drawFocusIcon(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  w: number,
  ink: string
): void {
  // Small, subtle scope/target ring that sits inside the ~18px header band.
  // Opacity is driven by the SVG <style> (faint by default, clearer on cell
  // hover). A generous transparent rect keeps it easy to click.
  const r = 4.5;
  const cx = w - r - 5;
  const cy = 9;
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

/** Auto-compact like the map (1.2M, 940k); plain for small numbers. */
export function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return strip(v / 1e9) + 'B';
  if (abs >= 1e6) return strip(v / 1e6) + 'M';
  if (abs >= 1e3) return strip(v / 1e3) + 'k';
  return strip(Math.round(v * 100) / 100);
}

function strip(n: number): string {
  return parseFloat(
    n.toFixed(n < 10 && !Number.isInteger(n) ? 1 : 0)
  ).toString();
}

function formatPct(frac: number): string {
  const pct = frac * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}
