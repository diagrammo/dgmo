// ============================================================
// Sitemap Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import type { ParsedSitemap } from './types';
import type { SitemapLayoutResult, SitemapLegendGroup } from './layout';
import { renderInlineText } from '../utils/inline-markdown';
import { preprocessDescriptionLine } from '../utils/description-helpers';
import {
  LEGEND_HEIGHT,
  LEGEND_GROUP_GAP,
  LEGEND_EYE_SIZE,
  LEGEND_EYE_GAP,
  EYE_OPEN_PATH,
  EYE_CLOSED_PATH,
} from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import { ScaleContext } from '../utils/scaling';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';
const TITLE_HEIGHT = 30;
const LABEL_FONT_SIZE = 13;
const META_FONT_SIZE = 11;
const META_LINE_HEIGHT = 16;
const HEADER_HEIGHT = 28;
const SEPARATOR_GAP = 6;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const CARD_RADIUS = 6;
const CONTAINER_RADIUS = 8;
const CONTAINER_LABEL_FONT_SIZE = 13;
const CONTAINER_META_FONT_SIZE = 11;
const CONTAINER_META_LINE_HEIGHT = 16;
const CONTAINER_HEADER_HEIGHT = 28;
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
const EDGE_LABEL_FONT_SIZE = 11;

// Collapsed-node accent bar
const COLLAPSE_BAR_HEIGHT = 6;

const LEGEND_FIXED_GAP = 8; // gap between fixed legend and scaled diagram — local, not shared

// ============================================================
// Color helpers
// ============================================================

function nodeFill(
  palette: PaletteColors,
  isDark: boolean,
  nodeColor?: string,
  solid?: boolean
): string {
  const color = nodeColor ?? palette.primary;
  return shapeFill(palette, color, isDark, {
    ...(solid !== undefined && { solid }),
  });
}

function nodeStroke(_palette: PaletteColors, nodeColor?: string): string {
  return nodeColor ?? _palette.primary;
}

function containerFill(
  palette: PaletteColors,
  isDark: boolean,
  nodeColor?: string
): string {
  if (nodeColor) {
    return mix(nodeColor, isDark ? palette.surface : palette.bg, 10);
  }
  return mix(palette.surface, palette.bg, 40);
}

function containerStroke(palette: PaletteColors, nodeColor?: string): string {
  return nodeColor ?? palette.textMuted;
}

// ============================================================
// Curve generator
// ============================================================

const lineGenerator = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

const lineGeneratorLinear = d3Shape
  .line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveLinear);

// ============================================================
// Main Renderer
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

export function renderSitemap(
  container: HTMLDivElement,
  parsed: ParsedSitemap,
  layout: SitemapLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  activeTagGroup?: string | null,
  hiddenAttributes?: Set<string>,
  exportMode?: boolean
): void {
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const idealWidth = layout.width + DIAGRAM_PADDING * 2;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sDiagramPadding = ctx.aesthetic(DIAGRAM_PADDING);
  const sLabelFontSize = ctx.text(LABEL_FONT_SIZE);
  const sMetaFontSize = ctx.text(META_FONT_SIZE);
  const sMetaLineHeight = ctx.structural(META_LINE_HEIGHT);
  const sHeaderHeight = ctx.structural(HEADER_HEIGHT);
  const sSeparatorGap = ctx.structural(SEPARATOR_GAP);
  const sEdgeStrokeWidth = ctx.structural(EDGE_STROKE_WIDTH);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sEdgeLabelFontSize = ctx.text(EDGE_LABEL_FONT_SIZE);
  const sContainerLabelFontSize = ctx.text(CONTAINER_LABEL_FONT_SIZE);
  const sContainerMetaFontSize = ctx.text(CONTAINER_META_FONT_SIZE);
  const sContainerMetaLineHeight = ctx.structural(CONTAINER_META_LINE_HEIGHT);
  const sContainerHeaderHeight = ctx.structural(CONTAINER_HEADER_HEIGHT);
  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sTitleHeight = ctx.structural(TITLE_HEIGHT);
  const sCollapseBarHeight = ctx.structural(COLLAPSE_BAR_HEIGHT);
  const sLegendHeight = ctx.structural(LEGEND_HEIGHT);
  const sLegendFixedGap = ctx.aesthetic(LEGEND_FIXED_GAP);

  const hasLegend = layout.legend.length > 0;

  const layoutLegendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP;
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const fixedLegend = !exportDims && hasLegend;
  const fixedTitle = fixedLegend && showTitle;
  const fixedTitleH = fixedTitle ? sTitleHeight : 0;
  const legendReserveH = fixedLegend ? sLegendHeight + sLegendFixedGap : 0;
  const fixedReserveTop = fixedTitleH + legendReserveH;
  const fixedReserveBottom = 0;
  const titleOffset = !fixedTitle && showTitle ? sTitleHeight : 0;

  const diagramW = layout.width;
  let diagramH = layout.height + titleOffset;
  if (fixedLegend) {
    diagramH -= layoutLegendShift;
  }
  const availH =
    height - sDiagramPadding * 2 - fixedReserveTop - fixedReserveBottom;
  const scaleX = (width - sDiagramPadding * 2) / diagramW;
  const scaleY = availH / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = sDiagramPadding + fixedReserveTop;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%').attr('viewBox', `0 0 ${width} ${height}`);
  }

  // Defs: arrowhead markers
  const defs = svg.append('defs');

  // Default arrowhead
  defs
    .append('marker')
    .attr('id', 'sm-arrow')
    .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
    .attr('refX', ARROWHEAD_W)
    .attr('refY', ARROWHEAD_H / 2)
    .attr('markerWidth', ARROWHEAD_W)
    .attr('markerHeight', ARROWHEAD_H)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
    .attr('fill', palette.textMuted);

  // Edges have no color slot (spec §1.7); keep empty set so the marker-setup
  // loop is a no-op but the symbol stays available for future color sources.
  const edgeColors = new Set<string>();
  for (const color of edgeColors) {
    const id = `sm-arrow-${color.replace('#', '')}`;
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${ARROWHEAD_W} ${ARROWHEAD_H}`)
      .attr('refX', ARROWHEAD_W)
      .attr('refY', ARROWHEAD_H / 2)
      .attr('markerWidth', ARROWHEAD_W)
      .attr('markerHeight', ARROWHEAD_H)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${ARROWHEAD_W},${ARROWHEAD_H / 2} 0,${ARROWHEAD_H}`)
      .attr('fill', color);
  }

  // Main content group with scale/translate
  const mainG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  if (!fixedTitle && showTitle) {
    const titleEl = mainG
      .append('text')
      .attr('x', diagramW / 2)
      .attr('y', sTitleFontSize)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('class', 'sitemap-title chart-title');

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .style('cursor', 'pointer')
          .on('click', () => onClickItem(parsed.titleLineNumber!));
      }
    }

    titleEl.text(parsed.title);
  }

  // Content group (offset by title; pull up by legendShift when legend is fixed)
  const contentShift = fixedLegend ? -layoutLegendShift : 0;
  const contentG = mainG
    .append('g')
    .attr('transform', `translate(0, ${titleOffset + contentShift})`);

  // Build display name map + tag color lookup from tag groups
  const displayNames = new Map<string, string>();
  // tagColors: "groupkey:valueLower" → hex color
  const tagColors = new Map<string, string>();
  for (const group of parsed.tagGroups) {
    displayNames.set(group.name.toLowerCase(), group.name);
    for (const entry of group.entries) {
      tagColors.set(
        `${group.name.toLowerCase()}:${entry.value.toLowerCase()}`,
        entry.color
      );
    }
  }

  // --- Render containers (bottom layer) ---
  for (const c of layout.containers) {
    const cG = contentG
      .append('g')
      .attr('transform', `translate(${c.x}, ${c.y})`)
      .attr('class', 'sitemap-container')
      .attr('data-line-number', String(c.lineNumber)) as GSelection;

    if (c.hasChildren) {
      cG.attr('data-node-toggle', c.nodeId)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', String(!c.hiddenCount))
        .attr('aria-label', c.label);
    }

    if (onClickItem) {
      cG.style('cursor', 'pointer').on('click', () =>
        onClickItem(c.lineNumber)
      );
    }

    // Tag metadata for legend hover dimming
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const tagVal = c.tagMetadata[tagKey];
      if (tagVal) cG.attr(`data-tag-${tagKey}`, tagVal.toLowerCase());
    }

    const fill = containerFill(palette, isDark, c.color);
    const stroke = containerStroke(palette, c.color);

    cG.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', c.width)
      .attr('height', c.height)
      .attr('rx', CONTAINER_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', sNodeStrokeWidth);

    cG.append('text')
      .attr('x', c.width / 2)
      .attr('y', sContainerHeaderHeight / 2 + sContainerLabelFontSize / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', sContainerLabelFontSize)
      .attr('font-weight', 'bold')
      .text(c.label);

    const metaEntries = Object.entries(c.metadata);
    if (metaEntries.length > 0) {
      const metaDisplayKeys = metaEntries.map(
        ([k]) => displayNames.get(k) ?? k
      );
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (sContainerMetaFontSize * 0.6);
      const metaStartY = sContainerHeaderHeight + sContainerMetaFontSize - 2;

      for (let i = 0; i < metaEntries.length; i++) {
        // In-bounds by loop guard.
        const [key, value] = metaEntries[i]!;
        const displayKey = metaDisplayKeys[i];
        const rowY = metaStartY + i * sContainerMetaLineHeight;
        const valColor =
          tagColors.get(`${key}:${value.toLowerCase()}`) ?? palette.text;

        cG.append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', sContainerMetaFontSize)
          .text(`${displayKey}: `);

        cG.append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', valColor)
          .attr('font-size', sContainerMetaFontSize)
          .text(value);
      }
    }

    if (!exportDims && c.hiddenCount && c.hiddenCount > 0) {
      const clipId = `clip-${c.nodeId}`;
      cG.append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('width', c.width)
        .attr('height', c.height)
        .attr('rx', CONTAINER_RADIUS);
      cG.append('rect')
        .attr('y', c.height - sCollapseBarHeight)
        .attr('width', c.width)
        .attr('height', sCollapseBarHeight)
        .attr('fill', c.color ?? palette.primary)
        .attr('opacity', 0.5)
        .attr('clip-path', `url(#${clipId})`);

      cG.append('text')
        .attr('x', c.width / 2)
        .attr('y', c.height - sCollapseBarHeight - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', palette.textMuted)
        .attr('font-size', sMetaFontSize)
        .text(`+${c.hiddenCount}`);
    }
  }

  // --- Render edges (middle layer) ---
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const edgeG = contentG
      .append('g')
      .attr('class', 'sitemap-edge-group')
      .attr('data-line-number', String(edge.lineNumber));

    const edgeColor = palette.textMuted;
    const markerId = 'sm-arrow';

    const gen = edge.deferred ? lineGeneratorLinear : lineGenerator;
    const pathD = gen(edge.points);
    if (pathD) {
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', sEdgeStrokeWidth)
        .attr('marker-end', `url(#${markerId})`)
        .attr('class', 'sitemap-edge');
    }

    // Edge label with background badge
    if (edge.label && edge.points.length >= 2) {
      const mid = edge.points[Math.floor(edge.points.length / 2)]!;
      const labelW = edge.label.length * sEdgeLabelFontSize * 0.6 + 10;
      const labelH = sEdgeLabelFontSize + 6;

      edgeG
        .append('rect')
        .attr('x', mid.x - labelW / 2)
        .attr('y', mid.y - labelH / 2 - 1)
        .attr('width', labelW)
        .attr('height', labelH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('opacity', 0.85)
        .attr('class', 'sitemap-edge-label-bg');

      edgeG
        .append('text')
        .attr('x', mid.x)
        .attr('y', mid.y + 4)
        .attr('text-anchor', 'middle')
        .attr('fill', edgeColor)
        .attr('font-size', sEdgeLabelFontSize)
        .attr('class', 'sitemap-edge-label')
        .text(edge.label);
    }
  }

  // --- Render page cards (top layer) ---
  for (const node of layout.nodes) {
    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x - node.width / 2}, ${node.y})`)
      .attr('class', 'sitemap-node')
      .attr('data-line-number', String(node.lineNumber)) as GSelection;

    if (node.hasChildren) {
      nodeG
        .attr('data-node-toggle', node.id)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', String(!node.hiddenCount));
    }

    if (onClickItem) {
      nodeG
        .style('cursor', 'pointer')
        .on('click', () => onClickItem(node.lineNumber));
    }

    // Tag metadata for legend hover dimming
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const tagVal = node.tagMetadata[tagKey];
      if (tagVal) nodeG.attr(`data-tag-${tagKey}`, tagVal.toLowerCase());
    }

    const solid = parsed.options['solid-fill'] === 'on';
    const fill = nodeFill(palette, isDark, node.color, solid);
    const stroke = nodeStroke(palette, node.color);

    // Card background
    nodeG
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', CARD_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', sNodeStrokeWidth);

    const labelColor = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    nodeG
      .append('text')
      .attr('x', node.width / 2)
      .attr('y', sHeaderHeight / 2 + sLabelFontSize / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
      .attr('font-size', sLabelFontSize)
      .attr('font-weight', 'bold')
      .text(node.label);

    const metaEntries = Object.entries(node.metadata);
    if (metaEntries.length > 0) {
      nodeG
        .append('line')
        .attr('x1', 0)
        .attr('y1', sHeaderHeight)
        .attr('x2', node.width)
        .attr('y2', sHeaderHeight)
        .attr('stroke', solid ? labelColor : stroke)
        .attr('stroke-opacity', 0.3);

      const metaDisplayKeys = metaEntries.map(
        ([k]) => displayNames.get(k) ?? k
      );
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (sMetaFontSize * 0.6);

      for (let i = 0; i < metaEntries.length; i++) {
        // In-bounds by loop guard.
        const [key, value] = metaEntries[i]!;
        const displayKey = metaDisplayKeys[i];
        const rowY =
          sHeaderHeight + sSeparatorGap + (i + 1) * sMetaLineHeight - 4;
        const tagColor = tagColors.get(`${key}:${value.toLowerCase()}`);
        const valColor = solid ? labelColor : (tagColor ?? labelColor);

        nodeG
          .append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', labelColor)
          .attr('font-size', sMetaFontSize)
          .text(`${displayKey}:`);

        nodeG
          .append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', valColor)
          .attr('font-size', sMetaFontSize)
          .text(value);
      }
    }

    // Description lines (after metadata)
    if (node.description && node.description.length > 0) {
      const metaCount = Object.keys(node.metadata).length;
      const sepY =
        metaCount > 0
          ? sHeaderHeight + sSeparatorGap + metaCount * sMetaLineHeight
          : sHeaderHeight;
      nodeG
        .append('line')
        .attr('x1', 0)
        .attr('y1', sepY)
        .attr('x2', node.width)
        .attr('y2', sepY)
        .attr('stroke', solid ? labelColor : stroke)
        .attr('stroke-opacity', 0.3);

      const descStartY =
        sHeaderHeight + sSeparatorGap + metaCount * sMetaLineHeight;
      for (let di = 0; di < node.description.length; di++) {
        const processed = preprocessDescriptionLine(node.description[di]!);
        const rowY = descStartY + (di + 1) * sMetaLineHeight - 4;
        const textEl = nodeG
          .append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', labelColor)
          .attr('font-size', sMetaFontSize);
        renderInlineText(textEl, processed, palette, sMetaFontSize);
      }
    }

    if (!exportDims && node.hiddenCount && node.hiddenCount > 0) {
      const clipId = `clip-${node.id}`;
      nodeG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('width', node.width)
        .attr('height', node.height)
        .attr('rx', CARD_RADIUS);
      nodeG
        .append('rect')
        .attr('y', node.height - sCollapseBarHeight)
        .attr('width', node.width)
        .attr('height', sCollapseBarHeight)
        .attr('fill', solid ? labelColor : (node.color ?? palette.primary))
        .attr('opacity', 0.5)
        .attr('clip-path', `url(#${clipId})`);
    }
  }

  // --- Render legend ---
  if (exportDims && hasLegend) {
    // Export mode: render inside the scaled content group
    renderLegend(
      contentG,
      layout.legend,
      palette,
      isDark,
      activeTagGroup,
      undefined,
      hiddenAttributes,
      exportMode
    );
  }

  // --- Fixed title + legend (appended AFTER mainG so they paint on top
  //     and receive pointer events without being blocked by scaled content) ---
  if (fixedTitle) {
    const titleEl = svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', sDiagramPadding + sTitleFontSize)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('class', 'sitemap-title chart-title')
      .style('font-family', FONT_FAMILY);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .style('cursor', 'pointer')
          .on('click', () => onClickItem(parsed.titleLineNumber!));
      }
    }

    titleEl.text(parsed.title!);
  }

  if (fixedLegend) {
    const legendParent = svg
      .append('g')
      .attr('class', 'sitemap-legend-fixed')
      .attr('transform', `translate(0, ${sDiagramPadding + fixedTitleH})`);
    if (activeTagGroup) {
      legendParent.attr('data-legend-active', activeTagGroup.toLowerCase());
    }
    renderLegend(
      legendParent,
      layout.legend,
      palette,
      isDark,
      activeTagGroup,
      width,
      hiddenAttributes,
      exportMode
    );
  }
}

// ============================================================
// Legend rendering
// ============================================================

function renderLegend(
  parent: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  legendGroups: readonly SitemapLegendGroup[],
  palette: PaletteColors,
  isDark: boolean,
  activeTagGroup?: string | null,
  fixedWidth?: number,
  hiddenAttributes?: Set<string>,
  exportMode?: boolean
): void {
  if (legendGroups.length === 0) return;

  const groups = legendGroups.map((g) => ({
    name: g.name,
    entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
  }));

  const isFixedMode = fixedWidth != null;
  const eyeAddonWidth = isFixedMode ? LEGEND_EYE_SIZE + LEGEND_EYE_GAP : 0;

  const legendConfig: LegendConfig = {
    groups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode: exportMode ? 'export' : 'preview',
    capsulePillAddonWidth: eyeAddonWidth,
  };
  const legendState: LegendState = { activeGroup: activeTagGroup ?? null };
  const containerWidth =
    // In-bounds by length === 0 early return at top of function.
    fixedWidth ?? legendGroups[0]!.x + (legendGroups[0]!.width ?? 200);

  const legendHandle = renderLegendD3(
    parent,
    legendConfig,
    legendState,
    palette,
    isDark,
    undefined,
    containerWidth
  );

  parent.selectAll('[data-legend-group]').classed('sitemap-legend-group', true);

  // Inject eye icons into active group capsules (fixed/app mode only)
  if (isFixedMode) {
    const computedLayout = legendHandle.getLayout();
    if (computedLayout.activeCapsule?.addonX != null) {
      const capsule = computedLayout.activeCapsule;
      const groupKey = capsule.groupName.toLowerCase();
      const isHidden = hiddenAttributes?.has(groupKey) ?? false;

      const activeGroupEl = parent.select(`[data-legend-group="${groupKey}"]`);
      if (!activeGroupEl.empty()) {
        const eyeX = capsule.addonX!;
        const eyeY = (LEGEND_HEIGHT - LEGEND_EYE_SIZE) / 2;
        const hitPad = 6;

        const eyeG = activeGroupEl
          .append('g')
          .attr('class', 'sitemap-legend-eye')
          .attr('data-legend-visibility', groupKey)
          .style('cursor', 'pointer')
          .attr('opacity', isHidden ? 0.4 : 0.7);

        eyeG
          .append('rect')
          .attr('x', eyeX - hitPad)
          .attr('y', eyeY - hitPad)
          .attr('width', LEGEND_EYE_SIZE + hitPad * 2)
          .attr('height', LEGEND_EYE_SIZE + hitPad * 2)
          .attr('fill', 'transparent')
          .attr('pointer-events', 'all');

        eyeG
          .append('path')
          .attr('d', isHidden ? EYE_CLOSED_PATH : EYE_OPEN_PATH)
          .attr('transform', `translate(${eyeX}, ${eyeY})`)
          .attr('fill', 'none')
          .attr('stroke', palette.textMuted)
          .attr('stroke-width', 1.2)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round');
      }
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export async function renderSitemapForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors
): Promise<string> {
  const { parseSitemap } = await import('./parser');
  const { layoutSitemap } = await import('./layout');
  const { getPalette } = await import('../palettes');
  const isDark = theme === 'dark';
  const effectivePalette =
    palette ?? (isDark ? getPalette('nord').dark : getPalette('nord').light);

  const parsed = parseSitemap(content, effectivePalette);
  if (parsed.error || parsed.roots.length === 0) return '';

  const sitemapLayout = layoutSitemap(parsed, undefined, null, undefined, true);

  const PADDING = 20;
  const titleOffset = parsed.title ? 30 : 0;
  const exportWidth = sitemapLayout.width + PADDING * 2;
  const exportHeight = sitemapLayout.height + PADDING * 2 + titleOffset;

  const container = document.createElement('div');
  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  renderSitemap(
    container,
    parsed,
    sitemapLayout,
    effectivePalette,
    isDark,
    undefined,
    {
      width: exportWidth,
      height: exportHeight,
    }
  );

  const svgEl = container.querySelector('svg');
  if (!svgEl) {
    document.body.removeChild(container);
    return '';
  }

  if (theme === 'transparent') {
    svgEl.style.background = 'none';
  } else if (!svgEl.style.background) {
    svgEl.style.background = effectivePalette.bg;
  }
  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgEl.style.fontFamily = FONT_FAMILY;

  const svgHtml = svgEl.outerHTML;
  document.body.removeChild(container);
  return svgHtml;
}
