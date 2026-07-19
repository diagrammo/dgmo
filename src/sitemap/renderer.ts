// ============================================================
// Sitemap Diagram SVG Renderer
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import { fillModeFromOptions, legendSuppressed } from '../utils/parsing';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import type { ParsedSitemap } from './types';
import type { SitemapLayoutResult, SitemapLegendGroup } from './layout';
import { renderInlineText } from '../utils/inline-markdown';
import { preprocessDescriptionLine } from '../utils/description-helpers';
import { measureText } from '../utils/text-measure';
import {
  LEGEND_HEIGHT,
  LEGEND_GROUP_GAP,
  LEGEND_EYE_SIZE,
  LEGEND_EYE_GAP,
  EYE_OPEN_PATH,
  EYE_CLOSED_PATH,
} from '../utils/legend-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { ScaleContext } from '../utils/scaling';
import { renderNodeCard } from '../utils/card';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';
const TITLE_HEIGHT = 30;
// Shared card / group / collapse constants (Story 111.1). sitemap matches every
// convention default, so it imports the full set.
import {
  LABEL_FONT_SIZE,
  META_FONT_SIZE,
  META_LINE_HEIGHT,
  HEADER_HEIGHT,
  SEPARATOR_GAP,
  EDGE_STROKE_WIDTH,
  NODE_STROKE_WIDTH,
  CARD_RADIUS,
  CONTAINER_RADIUS,
  CONTAINER_LABEL_FONT_SIZE,
  CONTAINER_META_FONT_SIZE,
  CONTAINER_META_LINE_HEIGHT,
  CONTAINER_HEADER_HEIGHT,
  COLLAPSE_BAR_HEIGHT,
} from '../utils/visual-conventions';
const ARROWHEAD_W = 10;
const ARROWHEAD_H = 7;
const EDGE_LABEL_FONT_SIZE = 11;

const LEGEND_FIXED_GAP = 8; // gap between fixed legend and scaled diagram — local, not shared

// ============================================================
// Color helpers
// ============================================================

function nodeFill(
  palette: PaletteColors,
  isDark: boolean,
  nodeColor?: string,
  fillMode?: 'solid' | 'outline'
): string {
  const color = nodeColor ?? palette.primary;
  return shapeFill(palette, color, isDark, { mode: fillMode });
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
    return mix(nodeColor, themeBaseBg(palette, isDark), 10);
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

  const ctx = ScaleContext.identity();

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
  const sLegendFixedGap = ctx.aesthetic(LEGEND_FIXED_GAP);

  const noLegend = legendSuppressed(parsed.options);
  const hasLegend = layout.legend.length > 0 && !noLegend;
  // Layout appends a legend band to its height whenever tag groups exist; with
  // `no-legend` nothing renders there, so drop the band from the fit box too.
  const suppressedLegendBand = layout.legend.length > 0 && noLegend;

  const layoutLegendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP;
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const fixedLegend = !exportDims && hasLegend;
  const fixedTitle = fixedLegend && showTitle;
  const fixedTitleH = fixedTitle ? sTitleHeight : 0;
  const sLegendHeight = ctx.structural(
    fixedLegend
      ? getMaxLegendReservedHeight(
          {
            groups: parsed.tagGroups,
            position: {
              placement: 'top-center',
              titleRelation: 'below-title',
            },
            mode: 'preview',
            capsulePillAddonWidth: LEGEND_EYE_SIZE + LEGEND_EYE_GAP,
          },
          width
        )
      : LEGEND_HEIGHT
  );
  const legendReserveH = fixedLegend ? sLegendHeight + sLegendFixedGap : 0;
  const fixedReserveTop = fixedTitleH + legendReserveH;
  const fixedReserveBottom = 0;
  const titleOffset = !fixedTitle && showTitle ? sTitleHeight : 0;

  const diagramW = layout.width;
  let diagramH = layout.height + titleOffset;
  if (fixedLegend || suppressedLegendBand) {
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
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
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
    displayNames.set(tagAttrKey(group.name), group.name);
    for (const entry of group.entries) {
      tagColors.set(
        `${tagAttrKey(group.name)}:${entry.value.toLowerCase()}`,
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
      const tagKey = tagAttrKey(activeTagGroup);
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
      const maxKeyWidth = Math.max(
        ...metaDisplayKeys.map((k) =>
          measureText(`${k}: `, sContainerMetaFontSize)
        )
      );
      const valueX = 10 + maxKeyWidth;
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
        .attr('fill', stroke)
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'sitemap-collapse-bar');
    }
  }

  // --- Render edges (middle layer) ---
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const edgeG = contentG
      .append('g')
      .attr('class', 'sitemap-edge-group')
      .attr('data-line-number', String(edge.lineNumber))
      // Endpoint node ids for baked-CSS connection-highlight (hover-styles.ts).
      .attr('data-from', edge.sourceId)
      .attr('data-to', edge.targetId);

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
      const labelW = measureText(edge.label, sEdgeLabelFontSize) + 10;
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
      .attr('data-line-number', String(node.lineNumber))
      .attr('data-node-id', node.id) as GSelection;

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
      const tagKey = tagAttrKey(activeTagGroup);
      const tagVal = node.tagMetadata[tagKey];
      if (tagVal) nodeG.attr(`data-tag-${tagKey}`, tagVal.toLowerCase());
    }

    const fillMode = fillModeFromOptions(parsed.options);
    const fill = nodeFill(palette, isDark, node.color, fillMode);
    const stroke = nodeStroke(palette, node.color);

    // Card background + label via the shared card door (Story 111.1). sitemap's
    // metadata, description lines, and collapse bar diverge from the convention
    // (different meta baseline; semi-transparent collapse bar + "+N" badge), so
    // they stay inline below — see conventions §1/§3 deviations log.
    const labelColor = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );
    renderNodeCard(nodeG, {
      width: node.width,
      height: node.height,
      rx: CARD_RADIUS,
      fill,
      stroke,
      strokeWidth: sNodeStrokeWidth,
      label: node.label,
      labelColor,
      labelFontSize: sLabelFontSize,
      headerHeight: sHeaderHeight,
    });

    const metaEntries = Object.entries(node.metadata);
    if (metaEntries.length > 0) {
      nodeG
        .append('line')
        .attr('x1', 0)
        .attr('y1', sHeaderHeight)
        .attr('x2', node.width)
        .attr('y2', sHeaderHeight)
        .attr('stroke', fillMode === 'solid' ? labelColor : stroke)
        .attr('stroke-opacity', 0.3);

      const metaDisplayKeys = metaEntries.map(
        ([k]) => displayNames.get(k) ?? k
      );
      const maxKeyWidth = Math.max(
        ...metaDisplayKeys.map((k) => measureText(`${k}: `, sMetaFontSize))
      );
      const valueX = 10 + maxKeyWidth;

      for (let i = 0; i < metaEntries.length; i++) {
        // In-bounds by loop guard.
        const [key, value] = metaEntries[i]!;
        const displayKey = metaDisplayKeys[i];
        const rowY =
          sHeaderHeight + sSeparatorGap + (i + 1) * sMetaLineHeight - 4;
        const tagColor = tagColors.get(`${key}:${value.toLowerCase()}`);
        const valColor =
          fillMode === 'solid' ? labelColor : (tagColor ?? labelColor);

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
        .attr('stroke', fillMode === 'solid' ? labelColor : stroke)
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
        .attr(
          'fill',
          fillMode === 'solid' ? labelColor : (node.color ?? palette.primary)
        )
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
      legendParent.attr('data-legend-active', tagAttrKey(activeTagGroup));
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

  const containerWidth =
    // In-bounds by length === 0 early return at top of function.
    fixedWidth ?? legendGroups[0]!.x + (legendGroups[0]!.width ?? 200);

  const legendHandle = renderIntegratedLegend(parent, {
    groups,
    activeGroup: activeTagGroup ?? null,
    mode: exportMode ? 'export' : 'preview',
    capsulePillAddonWidth: eyeAddonWidth,
    palette,
    isDark,
    width: containerWidth,
  });

  parent.selectAll('[data-legend-group]').classed('sitemap-legend-group', true);

  // Inject eye icons into active group capsules (fixed/app mode only)
  if (isFixedMode) {
    const computedLayout = legendHandle.getLayout();
    if (computedLayout.activeCapsule?.addonX != null) {
      const capsule = computedLayout.activeCapsule;
      const groupKey = tagAttrKey(capsule.groupName);
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
