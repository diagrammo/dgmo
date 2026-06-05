// ============================================================
// Org Chart SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  runInExportContainer,
  extractExportSvg,
} from '../utils/export-container';
import { ScaleContext } from '../utils/scaling';
import type { PaletteColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { resolveTagColor } from '../utils/tag-groups';
import type { ParsedOrg } from './parser';
import type { OrgLayoutResult } from './layout';
import type { AncestorInfo } from './collapse';
import { parseOrg } from './parser';
import { layoutOrg } from './layout';
import {
  LEGEND_HEIGHT,
  LEGEND_GROUP_GAP,
  LEGEND_EYE_SIZE,
  LEGEND_EYE_GAP,
  EYE_OPEN_PATH,
  EYE_CLOSED_PATH,
} from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import { measureText } from '../utils/text-measure';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import type { LegendConfig, LegendState } from '../utils/legend-types';

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

// Collapsed-node accent bar
const COLLAPSE_BAR_HEIGHT = 6;
const COLLAPSE_BAR_INSET = 0;

// Ancestor breadcrumb trail (focus mode)
const ANCESTOR_DOT_R = 4;
const ANCESTOR_LABEL_FONT_SIZE = 11;
const ANCESTOR_ROW_HEIGHT = 22;
const ANCESTOR_TRAIL_BOTTOM_GAP = 16;

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

function nodeStroke(palette: PaletteColors, nodeColor?: string): string {
  return nodeColor ?? palette.primary;
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
// Main Renderer
// ============================================================

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

export function renderOrg(
  container: HTMLDivElement,
  parsed: ParsedOrg,
  layout: OrgLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  activeTagGroup?: string | null,
  hiddenAttributes?: Set<string>,
  ancestorPath?: AncestorInfo[],
  exportMode?: boolean
): void {
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const ctx = ScaleContext.identity();

  const sDiagramPadding = ctx.aesthetic(DIAGRAM_PADDING);
  const sTitleHeight = ctx.structural(TITLE_HEIGHT);
  const sLabelFontSize = ctx.text(LABEL_FONT_SIZE);
  const sMetaFontSize = ctx.text(META_FONT_SIZE);
  const sMetaLineHeight = ctx.structural(META_LINE_HEIGHT);
  const sHeaderHeight = ctx.structural(HEADER_HEIGHT);
  const sSeparatorGap = ctx.structural(SEPARATOR_GAP);
  const sEdgeStrokeWidth = ctx.structural(EDGE_STROKE_WIDTH);
  const sNodeStrokeWidth = ctx.structural(NODE_STROKE_WIDTH);
  const sCardRadius = ctx.structural(CARD_RADIUS);
  const sContainerRadius = ctx.structural(CONTAINER_RADIUS);
  const sContainerLabelFontSize = ctx.text(CONTAINER_LABEL_FONT_SIZE);
  const sContainerMetaFontSize = ctx.text(CONTAINER_META_FONT_SIZE);
  const sContainerMetaLineHeight = ctx.structural(CONTAINER_META_LINE_HEIGHT);
  const sContainerHeaderHeight = ctx.structural(CONTAINER_HEADER_HEIGHT);
  const sCollapseBarHeight = ctx.structural(COLLAPSE_BAR_HEIGHT);
  const sCollapseBarInset = ctx.structural(COLLAPSE_BAR_INSET);
  const sAncestorDotR = ctx.structural(ANCESTOR_DOT_R);
  const sAncestorLabelFontSize = ctx.text(ANCESTOR_LABEL_FONT_SIZE);
  const sAncestorRowHeight = ctx.structural(ANCESTOR_ROW_HEIGHT);
  const sAncestorTrailBottomGap = ctx.structural(ANCESTOR_TRAIL_BOTTOM_GAP);
  const sLegendFixedGap = ctx.aesthetic(LEGEND_FIXED_GAP);

  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const titleOffset = showTitle ? sTitleHeight : 0;
  const legendOnly = layout.nodes.length === 0;
  const hasLegend = layout.legend.length > 0;

  const layoutLegendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP;
  const fixedLegend = !exportDims && hasLegend && !legendOnly;
  const legendReserve = fixedLegend
    ? getMaxLegendReservedHeight(
        {
          groups: parsed.tagGroups,
          position: { placement: 'top-center', titleRelation: 'below-title' },
          mode: 'preview',
          capsulePillAddonWidth: LEGEND_EYE_SIZE + LEGEND_EYE_GAP,
        },
        width
      ) + sLegendFixedGap
    : 0;

  const fixedTitle = !exportDims && showTitle;
  const titleReserve = fixedTitle ? sTitleHeight : 0;

  const hasAncestorTrail =
    !exportDims && ancestorPath && ancestorPath.length > 0;
  const ancestorTrailHeight = hasAncestorTrail
    ? ancestorPath.length * sAncestorRowHeight + sAncestorTrailBottomGap
    : 0;

  const diagramW = layout.width;
  let diagramH =
    layout.height + (fixedTitle ? 0 : titleOffset) + ancestorTrailHeight;
  if (fixedLegend) {
    diagramH -= layoutLegendShift;
  }
  const availH = height - sDiagramPadding * 2 - legendReserve - titleReserve;
  const scaleX = (width - sDiagramPadding * 2) / diagramW;
  const scaleY = availH / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = fixedLegend
    ? sDiagramPadding + legendReserve + titleReserve
    : sDiagramPadding + titleReserve;

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

  const mainG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Title
  // In non-export mode (fixedTitle), render at native size directly on the SVG
  // so it stays legible regardless of chart scale. In export mode, render inside
  // mainG so it scales with the diagram to match the exported dimensions.
  if (showTitle) {
    const titleParent = fixedTitle ? svg : mainG;
    const titleX = fixedTitle ? width / 2 : diagramW / 2;
    const titleY = fixedTitle
      ? sDiagramPadding + TITLE_FONT_SIZE
      : TITLE_FONT_SIZE;
    const titleEl = titleParent
      .append('text')
      .attr('x', titleX)
      .attr('y', titleY)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('class', 'org-title chart-title')
      .style(
        'cursor',
        onClickItem && parsed.titleLineNumber ? 'pointer' : 'default'
      )
      .text(parsed.title);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
      if (onClickItem) {
        titleEl
          .on('click', () => onClickItem(parsed.titleLineNumber!))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      }
    }
  }

  // Content group (offset by title + ancestor trail height)
  const contentYShift = (fixedTitle ? 0 : titleOffset) + ancestorTrailHeight;
  const contentG = mainG
    .append('g')
    .attr('transform', `translate(0, ${contentYShift})`);

  // Build display name map from tag groups (lowercase key → original casing)
  const displayNames = new Map<string, string>();
  for (const group of parsed.tagGroups) {
    displayNames.set(group.name.toLowerCase(), group.name);
  }

  // Root node IDs — focus icon is suppressed on these (already the tree root)
  const rootNodeIds = new Set(parsed.roots.map((r) => r.id));

  // Render container backgrounds (bottom layer)
  const colorOff = parsed.options?.['color'] === 'off';
  for (const c of layout.containers) {
    const cG = contentG
      .append('g')
      .attr('transform', `translate(${c.x}, ${c.y})`)
      .attr('class', 'org-container')
      .attr('data-line-number', String(c.lineNumber)) as GSelection;

    // Expose active tag group value for legend-entry hover dimming
    // Use tagMetadata (unfiltered) so hover-highlight works even when the
    // active tag group is hidden from the visible card body via the eye toggle.
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const metaValue = c.tagMetadata[tagKey];
      if (metaValue) {
        cG.attr(`data-tag-${tagKey}`, metaValue.toLowerCase());
      }
    }

    // Toggle attribute for containers that have (or had) children
    if (c.hasChildren) {
      cG.attr('data-node-toggle', c.nodeId)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', String(!c.hiddenCount))
        .attr('aria-label', c.label);
    }

    if (onClickItem) {
      cG.style('cursor', 'pointer').on('click', () => {
        onClickItem(c.lineNumber);
      });
    }

    const fill = containerFill(palette, isDark, colorOff ? undefined : c.color);
    const stroke = containerStroke(palette, colorOff ? undefined : c.color);

    cG.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', c.width)
      .attr('height', c.height)
      .attr('rx', sContainerRadius)
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
        const [, value] = metaEntries[i]!;
        const displayKey = metaDisplayKeys[i]!;
        const rowY = metaStartY + i * sContainerMetaLineHeight;

        cG.append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', sContainerMetaFontSize)
          .text(`${displayKey}: `);

        cG.append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', palette.text)
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
        .attr('rx', sContainerRadius);
      cG.append('rect')
        .attr('x', sCollapseBarInset)
        .attr('y', c.height - sCollapseBarHeight)
        .attr('width', c.width - sCollapseBarInset * 2)
        .attr('height', sCollapseBarHeight)
        .attr('fill', containerStroke(palette, colorOff ? undefined : c.color))
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'org-collapse-bar');
    }

    // Focus icon (hover-reveal, interactive only) — for non-root containers with children
    if (!exportDims && c.hasChildren && !rootNodeIds.has(c.nodeId)) {
      const iconSize = 14;
      const iconPad = 5;
      const iconX = c.width - iconSize - iconPad;
      const iconY = iconPad;

      const focusG = cG
        .append('g')
        .attr('class', 'org-focus-icon')
        .attr('data-focus-node', c.nodeId)
        .attr('data-export-ignore', 'true')
        .attr('transform', `translate(${iconX}, ${iconY})`);

      focusG
        .append('rect')
        .attr('x', -3)
        .attr('y', -3)
        .attr('width', iconSize + 6)
        .attr('height', iconSize + 6)
        .attr('fill', 'transparent');

      const cx = iconSize / 2;
      const cy = iconSize / 2;
      focusG
        .append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', iconSize / 2 - 1)
        .attr('fill', 'none')
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1.5);
      focusG
        .append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 2)
        .attr('fill', palette.textMuted);
    }
  }

  // Render edges
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const pathParts: string[] = [];
    // In-bounds by length >= 2 guard above.
    pathParts.push(`M ${edge.points[0]!.x} ${edge.points[0]!.y}`);
    for (let i = 1; i < edge.points.length; i++) {
      // In-bounds by loop guard.
      pathParts.push(`L ${edge.points[i]!.x} ${edge.points[i]!.y}`);
    }

    contentG
      .append('path')
      .attr('d', pathParts.join(' '))
      .attr('fill', 'none')
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', sEdgeStrokeWidth)
      .attr('class', 'org-edge');
  }

  // Collect container node IDs so we can skip them in card rendering
  const containerNodeIds = new Set(layout.containers.map((c) => c.nodeId));

  // Render node cards (top layer) — skip containers (already drawn as background boxes)
  for (const node of layout.nodes) {
    if (containerNodeIds.has(node.id)) continue;

    const nodeG = contentG
      .append('g')
      .attr('transform', `translate(${node.x - node.width / 2}, ${node.y})`)
      .attr('class', 'org-node')
      .attr('data-line-number', String(node.lineNumber)) as GSelection;

    // Expose active tag group value for legend-entry hover dimming
    // Use tagMetadata (unfiltered) so hover-highlight works even when the
    // active tag group is hidden from the visible card body via the eye toggle.
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const metaValue = node.tagMetadata[tagKey];
      if (metaValue) {
        nodeG.attr(`data-tag-${tagKey}`, metaValue.toLowerCase());
      }
    }

    // Toggle attribute for nodes that have (or had) children
    if (node.hasChildren) {
      nodeG
        .attr('data-node-toggle', node.id)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', String(!node.hiddenCount))
        .attr('aria-label', node.label);
    }

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => {
        onClickItem(node.lineNumber);
      });
    }

    // Card background
    const solid = parsed.options['solid-fill'] === 'on';
    const fill = nodeFill(
      palette,
      isDark,
      colorOff ? undefined : node.color,
      solid
    );
    const stroke = nodeStroke(palette, colorOff ? undefined : node.color);

    const rect = nodeG
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', sCardRadius)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', sNodeStrokeWidth);

    if (node.isContainer) {
      rect.attr('stroke-dasharray', '6 3');
    }

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
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);

      const metaDisplayKeys = metaEntries.map(
        ([k]) => displayNames.get(k) ?? k
      );
      const maxKeyWidth = Math.max(
        ...metaDisplayKeys.map((k) => measureText(`${k}: `, sMetaFontSize))
      );
      const valueX = 10 + maxKeyWidth;

      const metaStartY = sHeaderHeight + sSeparatorGap + sMetaFontSize;
      for (let i = 0; i < metaEntries.length; i++) {
        const [, value] = metaEntries[i]!;
        const displayKey = metaDisplayKeys[i]!;
        const rowY = metaStartY + i * sMetaLineHeight;

        nodeG
          .append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', labelColor)
          .attr('font-size', sMetaFontSize)
          .text(`${displayKey}: `);

        nodeG
          .append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', labelColor)
          .attr('font-size', sMetaFontSize)
          .text(value);
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
        .attr('rx', sCardRadius);
      nodeG
        .append('rect')
        .attr('x', sCollapseBarInset)
        .attr('y', node.height - sCollapseBarHeight)
        .attr('width', node.width - sCollapseBarInset * 2)
        .attr('height', sCollapseBarHeight)
        .attr(
          'fill',
          solid
            ? labelColor
            : nodeStroke(palette, colorOff ? undefined : node.color)
        )
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'org-collapse-bar');
    }

    // Focus icon (hover-reveal, interactive only) — for non-root nodes with children
    if (!exportDims && node.hasChildren && !rootNodeIds.has(node.id)) {
      const iconSize = 14;
      const iconPad = 5;
      const iconX = node.width - iconSize - iconPad;
      const iconY = iconPad;

      const focusG = nodeG
        .append('g')
        .attr('class', 'org-focus-icon')
        .attr('data-focus-node', node.id)
        .attr('data-export-ignore', 'true')
        .attr('transform', `translate(${iconX}, ${iconY})`);

      // Hit area
      focusG
        .append('rect')
        .attr('x', -3)
        .attr('y', -3)
        .attr('width', iconSize + 6)
        .attr('height', iconSize + 6)
        .attr('fill', 'transparent');

      // Scope/target icon: outer circle + inner dot
      const cx = iconSize / 2;
      const cy = iconSize / 2;
      focusG
        .append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', iconSize / 2 - 1)
        .attr('fill', 'none')
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1.5);
      focusG
        .append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 2)
        .attr('fill', palette.textMuted);
    }
  }

  // Render ancestor breadcrumb trail (focus mode) — inside scaled group,
  // centered on and connected to the root node
  if (hasAncestorTrail) {
    // Find the root node/container position in the layout
    const rootNode = layout.nodes.find((n) => rootNodeIds.has(n.id));
    const rootContainer = !rootNode
      ? layout.containers.find((c) => rootNodeIds.has(c.nodeId))
      : null;
    // Nodes: x is center. Containers: x is left edge, so center = x + width/2
    const rootCenterX = rootNode
      ? rootNode.x
      : rootContainer
        ? rootContainer.x + rootContainer.width / 2
        : null;
    const rootTopY = rootNode
      ? rootNode.y
      : rootContainer
        ? rootContainer.y
        : null;
    if (rootCenterX !== null && rootTopY !== null) {
      // Trail connects directly to the top edge of the root node.
      // The last ancestor dot sits ANCESTOR_TRAIL_BOTTOM_GAP above the root.
      const trailBottomY = rootTopY - sAncestorTrailBottomGap;

      const trailG = contentG.append('g').attr('class', 'org-ancestor-trail');

      const count = ancestorPath!.length;

      const dotPositions: number[] = [];
      for (let i = 0; i < count; i++) {
        const fromBottom = count - 1 - i;
        dotPositions.push(trailBottomY - fromBottom * sAncestorRowHeight);
      }

      // Single continuous line from topmost dot to root node top edge — in-bounds because hasAncestorTrail implies count >= 1.
      const lineTopY = dotPositions[0]!;
      trailG
        .append('line')
        .attr('x1', rootCenterX)
        .attr('y1', lineTopY)
        .attr('x2', rootCenterX)
        .attr('y2', rootTopY)
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.4);

      // Dots and labels on top of the line
      for (let i = 0; i < count; i++) {
        // In-bounds: count === ancestorPath.length; dotPositions parallel by construction.
        const ancestor = ancestorPath![i]!;
        const dotY = dotPositions[i]!;

        // Resolve color from tag groups (same logic as node cards)
        const resolvedColor =
          ancestor.color ??
          resolveTagColor(
            ancestor.metadata,
            [...parsed.tagGroups],
            activeTagGroup ?? null,
            ancestor.isContainer
          );
        const dotColor = resolvedColor ?? palette.textMuted;

        const rowG = trailG
          .append('g')
          .attr('class', 'org-ancestor-node')
          .attr('data-focus-ancestor', ancestor.id)
          .style('cursor', 'pointer')
          .attr('transform', `translate(${rootCenterX}, ${dotY})`);

        rowG
          .append('rect')
          .attr('x', -sAncestorDotR - 2)
          .attr('y', -sAncestorDotR - 2)
          .attr('width', 120)
          .attr('height', sAncestorDotR * 2 + 4)
          .attr('fill', 'transparent');

        rowG
          .append('circle')
          .attr('cx', 0)
          .attr('cy', 0)
          .attr('r', sAncestorDotR)
          .attr('fill', dotColor);

        rowG
          .append('text')
          .attr('x', sAncestorDotR + 6)
          .attr('y', sAncestorLabelFontSize * 0.35)
          .attr('fill', palette.textMuted)
          .attr('font-size', sAncestorLabelFontSize)
          .text(ancestor.label);

        rowG
          .on('mouseenter', function () {
            d3Selection
              .select(this)
              .select('circle')
              .attr('r', sAncestorDotR + 1);
            d3Selection.select(this).select('text').attr('fill', palette.text);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).select('circle').attr('r', sAncestorDotR);
            d3Selection
              .select(this)
              .select('text')
              .attr('fill', palette.textMuted);
          });
      }
    }
  }

  // Render legend — capsule pills.
  // In app mode (fixedLegend): render at native size outside the scaled group.
  // In export mode: skip legend (unless legend-only chart).
  // Legend-only (no nodes): all groups rendered as expanded capsules inside scaled group.
  if (fixedLegend || legendOnly || (exportDims && hasLegend)) {
    const groups = layout.legend.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
    }));

    const eyeAddonWidth = fixedLegend ? LEGEND_EYE_SIZE + LEGEND_EYE_GAP : 0;

    // Choose parent: unscaled group for fixedLegend, contentG for legend-only
    const legendParentBase = fixedLegend
      ? svg
          .append('g')
          .attr('class', 'org-legend-fixed')
          .attr('transform', `translate(0, ${sDiagramPadding + titleReserve})`)
      : contentG.append('g');

    let legendHandle;
    if (legendOnly) {
      // Legend-only mode: render each group expanded individually at layout positions
      for (const lg of layout.legend) {
        const singleConfig: LegendConfig = {
          groups: [
            {
              name: lg.name,
              entries: lg.entries.map((e) => ({
                value: e.value,
                color: e.color,
              })),
            },
          ],
          position: { placement: 'top-center', titleRelation: 'below-title' },
          mode: exportMode ? 'export' : 'preview',
        };
        const singleState: LegendState = { activeGroup: lg.name };
        const groupG = legendParentBase
          .append('g')
          .attr('transform', `translate(${lg.x}, ${lg.y})`);
        renderLegendD3(
          groupG,
          singleConfig,
          singleState,
          palette,
          isDark,
          undefined,
          lg.width
        );
        groupG
          .selectAll('[data-legend-group]')
          .classed('org-legend-group', true);
      }
      legendHandle = null;
    } else {
      const legendConfig: LegendConfig = {
        groups,
        position: { placement: 'top-center', titleRelation: 'below-title' },
        mode: exportMode ? 'export' : 'preview',
        capsulePillAddonWidth: eyeAddonWidth,
      };
      const legendState: LegendState = { activeGroup: activeTagGroup ?? null };
      legendHandle = renderLegendD3(
        legendParentBase,
        legendConfig,
        legendState,
        palette,
        isDark,
        undefined,
        fixedLegend ? width : layout.width
      );
      legendParentBase
        .selectAll('[data-legend-group]')
        .classed('org-legend-group', true);
    }

    // Inject eye icons into active group capsules (app mode only)
    if (fixedLegend && legendHandle) {
      const computedLayout = legendHandle.getLayout();
      if (computedLayout.activeCapsule?.addonX != null) {
        const capsule = computedLayout.activeCapsule;
        const groupKey = capsule.groupName.toLowerCase();
        const isHidden = hiddenAttributes?.has(groupKey) ?? false;

        // Find the rendered active group <g> and append eye icon
        const activeGroupEl = legendParentBase.select(
          `[data-legend-group="${groupKey}"]`
        );
        if (!activeGroupEl.empty()) {
          const eyeX = capsule.addonX!;
          const eyeY = (LEGEND_HEIGHT - LEGEND_EYE_SIZE) / 2;
          const hitPad = 6;

          const eyeG = activeGroupEl
            .append('g')
            .attr('class', 'org-legend-eye')
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
}

// ============================================================
// Export convenience function
// ============================================================

export function renderOrgForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseOrg(content, palette);
  if (parsed.error) return '';

  // Extract hide option for export: cards sized without hidden attributes
  const hideOption = parsed.options?.['hide'];
  const exportHidden = hideOption
    ? new Set(hideOption.split(',').map((s) => s.trim().toLowerCase()))
    : undefined;

  const layout = layoutOrg(parsed, undefined, undefined, exportHidden);
  const isDark = theme === 'dark';

  const titleOffset =
    parsed.title && parsed.options['no-title'] !== 'on' ? TITLE_HEIGHT : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  // No hiddenAttributes passed to renderOrg — export never shows eye icons
  return runInExportContainer(exportWidth, exportHeight, (container) => {
    renderOrg(container, parsed, layout, palette, isDark, undefined, {
      width: exportWidth,
      height: exportHeight,
    });
    return extractExportSvg(container, theme);
  });
}
