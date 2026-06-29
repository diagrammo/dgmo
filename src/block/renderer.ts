// ============================================================
// Block diagram — D3 SVG Renderer
// ============================================================
//
// Draws the deterministic grid from layout.ts. The intrinsic block is scaled to
// fit (never upscaled) and centered in the canvas, under the title + tag legend.
// Containers nest a sub-grid; a collapsed container shows the shared collapse-bar
// signal (org/sitemap/mindmap). Collapse/expand + click are app-side; export
// renders the authored state. Colours come from the tag group (cascaded in the
// parser), resolved here via the shared tag-color helper.

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import { resolveTagColor, tagAttrKey } from '../utils/tag-groups';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import type { LegendGroupData, LegendPosition } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { measureText } from '../utils/text-measure';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedBlock, BlockNode } from './types';
import { isBlockNode } from './types';
import {
  layoutBlock,
  type BlockLayoutItem,
  BLOCK_BAR_H,
  BLOCK_HEADER_H,
} from './layout';

const PADDING = 12;
const TITLE_BAND = 36;
// Floor for export width so a narrow block still has room for its title/legend.
const MIN_EXPORT_WIDTH = 220;

const LEGEND_POSITION: LegendPosition = {
  placement: 'top-center',
  titleRelation: 'below-title',
};

export interface BlockRenderOptions {
  /** Block ids to render folded (app runtime collapse on top of authored). */
  collapsed?: ReadonlySet<string>;
  /** Click handler for a container header (app collapse/expand). */
  onToggle?: (id: string, lineNumber: number) => void;
  exportMode?: boolean;
}

export function renderBlockForExport(
  container: HTMLDivElement,
  parsed: ParsedBlock,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options?: BlockRenderOptions
): void {
  renderBlock(container, parsed, palette, isDark, exportDims, {
    exportMode: true,
    ...options,
  });
}

export function renderBlock(
  container: HTMLDivElement,
  parsed: ParsedBlock,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  options: BlockRenderOptions = {}
): void {
  if (parsed.error || parsed.top.rows.length === 0) return;

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const opts = parsed.options;
  const showTitle = !!parsed.title;
  const titleH = showTitle ? TITLE_BAND : 0;

  // The app owns the live collapsed set (seeded once from authored flags via
  // `authoredCollapsedIds`), so when it passes one it is AUTHORITATIVE — that's
  // what lets a user expand an authored-`collapsed` container. Headless export
  // (no set passed) derives the folds straight from the source.
  const collapsed: ReadonlySet<string> =
    options.collapsed ?? authoredCollapsedIds(parsed);
  const layout = layoutBlock(parsed.top, { collapsed });

  const legend = !opts.noLegend ? buildBlockLegend(parsed) : null;

  // Canvas size. Live preview fills the host container and scales the block to
  // fit. Export sizes the canvas to the block's intrinsic dimensions (+ title,
  // legend, padding) so the SVG carries no dead whitespace.
  let width: number;
  let height: number;
  if (options.exportMode) {
    width = Math.max(layout.width, MIN_EXPORT_WIDTH) + PADDING * 2;
  } else {
    width = exportDims?.width ?? container.clientWidth;
  }

  const legendReserve = legend
    ? getMaxLegendReservedHeight(
        { groups: legend.groups, position: LEGEND_POSITION, mode: 'preview' },
        width
      ) + LEGEND_GROUP_GAP
    : 0;

  const areaY = titleH + legendReserve + PADDING;
  if (options.exportMode) {
    height = areaY + layout.height + PADDING;
  } else {
    height = exportDims?.height ?? container.clientHeight;
  }
  if (width <= 0 || height <= 0) return;

  const areaX = PADDING;
  const areaW = Math.max(1, width - PADDING * 2);
  const areaH = Math.max(1, height - areaY - PADDING);

  const scale = Math.min(1, areaW / layout.width, areaH / layout.height);
  const offsetX = areaX + (areaW - layout.width * scale) / 2;
  // Top-align under the title/legend (a block reads top-down); only center
  // horizontally. Centering vertically would float a short diagram mid-canvas.
  const offsetY = areaY;

  // ── SVG root ───────────────────────────────────────────────
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('class', 'dgmo-block')
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

  const activeGroup =
    parsed.tagGroups.length > 0 ? parsed.tagGroups[0]!.name : null;
  const neutral = mix(palette.text, palette.bg, 22);

  const root = svg
    .append('g')
    .attr('class', 'dgmo-block-cells')
    .attr('transform', `translate(${offsetX},${offsetY}) scale(${scale})`);

  drawItems(root, layout.items, {
    palette,
    tagGroups: parsed.tagGroups,
    activeGroup,
    activeKey: activeGroup ? tagAttrKey(activeGroup) : null,
    neutral,
    solidFill: opts.solidFill,
    onToggle: options.onToggle,
  });

  if (legend) {
    const legendG = svg
      .append('g')
      .attr('class', 'dgmo-block-legend')
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
      mode: options.exportMode ? 'export' : 'preview',
      position: LEGEND_POSITION,
      activeGroup: legend.activeGroup,
    });
  }
}

// ============================================================
// Drawing
// ============================================================

interface DrawCtx {
  palette: PaletteColors;
  tagGroups: ParsedBlock['tagGroups'];
  activeGroup: string | null;
  /** `tagAttrKey(activeGroup)` — the `data-tag-<key>` suffix for legend hover. */
  activeKey: string | null;
  neutral: string;
  /** `solid-fill` — render node fills at full saturation instead of a tint. */
  solidFill: boolean;
  onToggle: ((id: string, lineNumber: number) => void) | undefined;
}

type GSel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

function colorOf(node: BlockNode | undefined, ctx: DrawCtx): string | null {
  if (!node || !ctx.activeGroup) return null;
  return resolveTagColor(node.metadata, ctx.tagGroups, ctx.activeGroup) ?? null;
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

let clipCounter = 0;

function drawItems(
  g: GSel,
  items: BlockLayoutItem[],
  ctx: DrawCtx,
  path: string[] = []
): void {
  const { palette, solidFill: solid } = ctx;
  for (const it of items) {
    if (it.type === 'empty') {
      g.append('rect')
        .attr('x', it.x)
        .attr('y', it.y)
        .attr('width', it.w)
        .attr('height', it.h)
        .attr('rx', 7)
        .attr('fill', 'none')
        .attr('stroke', ctx.neutral)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3 4')
        .attr('opacity', 0.7);
      continue;
    }

    const node = it.node!;
    const itemPath = [...path, node.id];
    const color = colorOf(node, ctx);
    const stroke = color ?? ctx.neutral;

    // Every block is its own `.dgmo-block-cell` group (a FLAT sibling — children
    // are not nested in their container's group, so opacity dimming for the
    // editor↔diagram sync and hover spotlight never compounds). `data-block-path`
    // = the ancestor-id chain (subtree highlight), `data-tag-<key>` = the tag
    // value (legend hover), `data-line-number` = the source line (cursor sync).
    const cell = g
      .append('g')
      .attr('class', 'dgmo-block-cell')
      .attr('data-block-id', node.id)
      .attr('data-block-path', itemPath.join(' / '));
    if (it.lineNumber !== undefined)
      cell.attr('data-line-number', it.lineNumber);
    if (ctx.activeKey) {
      const v = node.metadata[ctx.activeKey];
      if (v) cell.attr(`data-tag-${ctx.activeKey}`, v);
    }

    if (it.type === 'collapsed') {
      const fill = color
        ? solid
          ? color
          : mix(color, palette.bg, 12)
        : palette.surface;
      const cid = `dgmo-block-clip-${clipCounter++}`;
      cell
        .append('clipPath')
        .attr('id', cid)
        .append('rect')
        .attr('x', it.x)
        .attr('y', it.y)
        .attr('width', it.w)
        .attr('height', it.h)
        .attr('rx', 10);
      cell
        .append('rect')
        .attr('x', it.x)
        .attr('y', it.y)
        .attr('width', it.w)
        .attr('height', it.h)
        .attr('rx', 10)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 1.5);
      cell
        .append('text')
        .attr('x', it.x + it.w / 2)
        .attr('y', it.y + it.h / 2 + 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', 12.5)
        .attr('font-weight', 700)
        .attr('fill', palette.text)
        .text(clipLabel(it.label ?? '', it.w - 24, 12.5));
      // Collapse-bar (org / sitemap / mindmap precedent).
      cell
        .append('rect')
        .attr('x', it.x)
        .attr('y', it.y + it.h - BLOCK_BAR_H)
        .attr('width', it.w)
        .attr('height', BLOCK_BAR_H)
        // §3 convention: solid bar = card stroke; in solid-fill mode the stroke
        // equals the fill, so fall back to the label color to keep the bar visible.
        .attr('fill', solid && color ? palette.text : stroke)
        .attr('clip-path', `url(#${cid})`);
      bindToggle(cell, it, ctx, it.h);
      continue;
    }

    if (it.type === 'container') {
      const fill = color
        ? solid
          ? color
          : mix(color, palette.bg, 7)
        : palette.surface;
      cell
        .append('rect')
        .attr('x', it.x)
        .attr('y', it.y)
        .attr('width', it.w)
        .attr('height', it.h)
        .attr('rx', 10)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 1.5);
      // An expanded container's header scales (subtly) with the box size and
      // fades as it grows — a soft section watermark on big regions, crisp on
      // small ones (the treemap leaf-label treatment, applied to headers).
      const sizeMetric = Math.min(it.w, it.h * 2.5);
      const headerFs = Math.max(
        13,
        Math.min(20, Math.round(13 + (sizeMetric - 220) / 70))
      );
      const grow = (headerFs - 13) / (20 - 13); // 0 (small) → 1 (large)
      const headerOpacity = 0.92 - grow * 0.3; // 0.92 → 0.62
      const headerY = it.y + Math.round(headerFs * 0.7) + 7;
      cell
        .append('text')
        .attr('x', it.x + it.w / 2)
        .attr('y', headerY)
        .attr('text-anchor', 'middle')
        .attr('font-size', headerFs)
        .attr('font-weight', 700)
        .attr('fill', palette.text)
        .attr('opacity', headerOpacity)
        .text(clipLabel(it.label ?? '', it.w - 24, headerFs));
      bindToggle(cell, it, ctx, BLOCK_HEADER_H);
      // Children are flat siblings in `g` (drawn after → painted on top of the
      // container background), each carrying this container's id in their path.
      if (it.inner) drawItems(g, it.inner, ctx, itemPath);
      continue;
    }

    // leaf
    const fill = color
      ? solid
        ? color
        : mix(color, palette.bg, 14)
      : palette.bg;
    cell.attr('data-leaf', 'true');
    cell
      .append('rect')
      .attr('x', it.x)
      .attr('y', it.y)
      .attr('width', it.w)
      .attr('height', it.h)
      .attr('rx', 8)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 1.25);
    cell
      .append('text')
      .attr('x', it.x + it.w / 2)
      .attr('y', it.y + it.h / 2 + 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', 13)
      .attr('font-weight', 600)
      .attr('fill', palette.text)
      .text(clipLabel(it.label ?? '', it.w - 16, 13));
  }
}

function bindToggle(
  cell: GSel,
  it: BlockLayoutItem,
  ctx: DrawCtx,
  hitH: number
): void {
  if (!ctx.onToggle || !it.node || it.lineNumber === undefined) return;
  const id = it.node.id;
  const ln = it.lineNumber;
  cell
    .append('rect')
    .attr('x', it.x)
    .attr('y', it.y)
    .attr('width', it.w)
    .attr('height', hitH)
    .attr('rx', 10)
    .attr('fill', 'transparent')
    .style('cursor', 'pointer')
    .on('click', () => ctx.onToggle!(id, ln));
}

// ============================================================
// Collapsed set + legend
// ============================================================

/** The ids of containers authored with the `collapsed` flag — the app seeds its
 *  live collapsed set from this so authored folds are the initial state yet stay
 *  user-toggleable. */
export function authoredCollapsedIds(parsed: ParsedBlock): Set<string> {
  const into = new Set<string>();
  collectCollapsed(parsed, into);
  return into;
}

function collectCollapsed(parsed: ParsedBlock, into: Set<string>): void {
  const walk = (grid: ParsedBlock['top']): void => {
    for (const row of grid.rows)
      for (const c of row)
        if (isBlockNode(c)) {
          if (c.collapsed && c.grid) into.add(c.id);
          if (c.grid) walk(c.grid);
        }
  };
  walk(parsed.top);
}

interface BlockLegend {
  groups: LegendGroupData[];
  activeGroup: string | null;
}

/** One legend group from the first tag group, listing only the values actually
 *  used in the diagram — the shared tag-group framework. */
function buildBlockLegend(parsed: ParsedBlock): BlockLegend | null {
  if (parsed.tagGroups.length === 0) return null;
  const tg = parsed.tagGroups[0]!;
  const key = tagAttrKey(tg.name);
  const used = new Set<string>();
  const walk = (grid: ParsedBlock['top']): void => {
    for (const row of grid.rows)
      for (const c of row)
        if (isBlockNode(c)) {
          const v = c.metadata[key];
          if (v) used.add(v.toLowerCase());
          if (c.grid) walk(c.grid);
        }
  };
  walk(parsed.top);
  const entries = tg.entries
    .filter((e) => used.has(e.value.toLowerCase()))
    .map((e) => ({ value: e.value, color: e.color }));
  if (entries.length === 0) return null;
  return { groups: [{ name: tg.name, entries }], activeGroup: tg.name };
}
