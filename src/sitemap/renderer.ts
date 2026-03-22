// ============================================================
// Sitemap Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import type { ParsedSitemap } from './types';
import type {
  SitemapLayoutResult,
  SitemapLegendGroup,
} from './layout';
import {
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_PILL_FONT_W,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_FONT_W,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  LEGEND_EYE_SIZE,
  LEGEND_EYE_GAP,
  EYE_OPEN_PATH,
  EYE_CLOSED_PATH,
} from '../utils/legend-constants';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const TITLE_HEIGHT = 30;
const TITLE_FONT_SIZE = 18;
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

function nodeFill(palette: PaletteColors, isDark: boolean, nodeColor?: string): string {
  const color = nodeColor ?? palette.primary;
  return mix(color, isDark ? palette.surface : palette.bg, 25);
}

function nodeStroke(_palette: PaletteColors, nodeColor?: string): string {
  return nodeColor ?? _palette.primary;
}

function containerFill(palette: PaletteColors, isDark: boolean, nodeColor?: string): string {
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

const lineGenerator = d3Shape.line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

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
): void {
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const hasLegend = layout.legend.length > 0;

  // In app mode (not export), render the title at fixed size outside the scaled group
  // and legend at fixed size at the bottom.
  // Layout order: Title → Diagram content → Legend (bottom).
  const layoutLegendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP; // 40px — what layout added
  const fixedLegend = !exportDims && hasLegend;
  const fixedTitle = fixedLegend && !!parsed.title;
  const fixedTitleH = fixedTitle ? TITLE_HEIGHT : 0;
  const legendReserveH = fixedLegend ? LEGEND_HEIGHT + LEGEND_FIXED_GAP : 0;
  // Space reserved above content (title + legend)
  const fixedReserveTop = fixedTitleH + legendReserveH;
  const fixedReserveBottom = 0;
  // Title inside scaled group only when legend is NOT fixed
  const titleOffset = !fixedTitle && parsed.title ? TITLE_HEIGHT : 0;

  // Compute scale to fit diagram in viewport
  const diagramW = layout.width;
  let diagramH = layout.height + titleOffset;
  if (fixedLegend) {
    // Remove the legend space from diagram height — legend is rendered separately
    diagramH -= layoutLegendShift;
  }
  const availH = height - DIAGRAM_PADDING * 2 - fixedReserveTop - fixedReserveBottom;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = availH / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY = DIAGRAM_PADDING + fixedReserveTop;

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

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

  // Colored arrowheads
  const edgeColors = new Set<string>();
  for (const edge of layout.edges) {
    if (edge.color) edgeColors.add(edge.color);
  }
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

  // Title (scaled, only when legend is NOT fixed)
  if (!fixedTitle && parsed.title) {
    const titleEl = mainG
      .append('text')
      .attr('x', diagramW / 2)
      .attr('y', TITLE_FONT_SIZE)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', 'bold')
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
      tagColors.set(`${group.name.toLowerCase()}:${entry.value.toLowerCase()}`, entry.color);
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
      cG.style('cursor', 'pointer').on('click', () => onClickItem(c.lineNumber));
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
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Container label
    cG.append('text')
      .attr('x', c.width / 2)
      .attr('y', CONTAINER_HEADER_HEIGHT / 2 + CONTAINER_LABEL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', CONTAINER_LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(c.label);

    // Container metadata
    const metaEntries = Object.entries(c.metadata);
    if (metaEntries.length > 0) {
      const metaDisplayKeys = metaEntries.map(([k]) => displayNames.get(k) ?? k);
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (CONTAINER_META_FONT_SIZE * 0.6);
      const metaStartY = CONTAINER_HEADER_HEIGHT + CONTAINER_META_FONT_SIZE - 2;

      for (let i = 0; i < metaEntries.length; i++) {
        const [key, value] = metaEntries[i];
        const displayKey = metaDisplayKeys[i];
        const rowY = metaStartY + i * CONTAINER_META_LINE_HEIGHT;
        const valColor = tagColors.get(`${key}:${value.toLowerCase()}`) ?? palette.text;

        cG.append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(`${displayKey}: `);

        cG.append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', valColor)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(value);
      }
    }

    // Collapsed accent bar
    if (!exportDims && c.hiddenCount && c.hiddenCount > 0) {
      const clipId = `clip-${c.nodeId}`;
      cG.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('width', c.width).attr('height', c.height)
        .attr('rx', CONTAINER_RADIUS);
      cG.append('rect')
        .attr('y', c.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', c.width)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', c.color ?? palette.primary)
        .attr('opacity', 0.5)
        .attr('clip-path', `url(#${clipId})`);

      cG.append('text')
        .attr('x', c.width / 2)
        .attr('y', c.height - COLLAPSE_BAR_HEIGHT - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', palette.textMuted)
        .attr('font-size', META_FONT_SIZE)
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

    const edgeColor = edge.color ?? palette.textMuted;
    const markerId = edge.color
      ? `sm-arrow-${edge.color.replace('#', '')}`
      : 'sm-arrow';

    const pathD = lineGenerator(edge.points);
    if (pathD) {
      edgeG
        .append('path')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', edgeColor)
        .attr('stroke-width', EDGE_STROKE_WIDTH)
        .attr('marker-end', `url(#${markerId})`)
        .attr('class', 'sitemap-edge');
    }

    // Edge label with background badge
    if (edge.label && edge.points.length >= 2) {
      const mid = edge.points[Math.floor(edge.points.length / 2)];
      const labelW = edge.label.length * EDGE_LABEL_FONT_SIZE * 0.6 + 10;
      const labelH = EDGE_LABEL_FONT_SIZE + 6;

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
        .attr('font-size', EDGE_LABEL_FONT_SIZE)
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
      nodeG.attr('data-node-toggle', node.id)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', String(!node.hiddenCount));
    }

    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', () => onClickItem(node.lineNumber));
    }

    // Tag metadata for legend hover dimming
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const tagVal = node.tagMetadata[tagKey];
      if (tagVal) nodeG.attr(`data-tag-${tagKey}`, tagVal.toLowerCase());
    }

    const fill = nodeFill(palette, isDark, node.color);
    const stroke = nodeStroke(palette, node.color);

    // Card background
    nodeG.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', CARD_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Label
    nodeG.append('text')
      .attr('x', node.width / 2)
      .attr('y', HEADER_HEIGHT / 2 + LABEL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(node.label);

    // Separator and metadata
    const metaEntries = Object.entries(node.metadata);
    if (metaEntries.length > 0) {
      // Separator line
      nodeG.append('line')
        .attr('x1', 0)
        .attr('y1', HEADER_HEIGHT)
        .attr('x2', node.width)
        .attr('y2', HEADER_HEIGHT)
        .attr('stroke', stroke)
        .attr('stroke-opacity', 0.3);

      const metaDisplayKeys = metaEntries.map(([k]) => displayNames.get(k) ?? k);
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (META_FONT_SIZE * 0.6);

      for (let i = 0; i < metaEntries.length; i++) {
        const [key, value] = metaEntries[i];
        const displayKey = metaDisplayKeys[i];
        const rowY = HEADER_HEIGHT + SEPARATOR_GAP + (i + 1) * META_LINE_HEIGHT - 4;
        const valColor = tagColors.get(`${key}:${value.toLowerCase()}`) ?? palette.text;

        nodeG.append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', META_FONT_SIZE)
          .text(`${displayKey}:`);

        nodeG.append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', valColor)
          .attr('font-size', META_FONT_SIZE)
          .text(value);
      }
    }

    // Collapsed accent bar
    if (!exportDims && node.hiddenCount && node.hiddenCount > 0) {
      const clipId = `clip-${node.id}`;
      nodeG.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('width', node.width).attr('height', node.height)
        .attr('rx', CARD_RADIUS);
      nodeG.append('rect')
        .attr('y', node.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', node.width)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', node.color ?? palette.primary)
        .attr('opacity', 0.5)
        .attr('clip-path', `url(#${clipId})`);
    }
  }

  // --- Render legend ---
  if (exportDims && hasLegend) {
    // Export mode: render inside the scaled content group
    renderLegend(contentG, layout.legend, palette, isDark, activeTagGroup, undefined, hiddenAttributes);
  }

  // --- Fixed title + legend (appended AFTER mainG so they paint on top
  //     and receive pointer events without being blocked by scaled content) ---
  if (fixedTitle) {
    const titleEl = svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', DIAGRAM_PADDING + TITLE_FONT_SIZE)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', 'bold')
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
      .attr('transform', `translate(0, ${DIAGRAM_PADDING + fixedTitleH})`);
    if (activeTagGroup) {
      legendParent.attr('data-legend-active', activeTagGroup.toLowerCase());
    }
    renderLegend(legendParent, layout.legend, palette, isDark, activeTagGroup, width, hiddenAttributes);
  }
}

// ============================================================
// Legend rendering
// ============================================================

function renderLegend(
  parent: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  legendGroups: SitemapLegendGroup[],
  palette: PaletteColors,
  isDark: boolean,
  activeTagGroup?: string | null,
  fixedWidth?: number,
  hiddenAttributes?: Set<string>,
): void {
  if (legendGroups.length === 0) return;

  const visibleGroups = activeTagGroup != null
    ? legendGroups.filter((g) => g.name.toLowerCase() === activeTagGroup.toLowerCase())
    : legendGroups;

  const groupBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);

  // For fixed legend: compute pixel-space positions centered in SVG width
  let fixedPositions: Map<string, number> | undefined;
  if (fixedWidth != null && visibleGroups.length > 0) {
    fixedPositions = new Map();
    const effectiveW = (g: SitemapLegendGroup) =>
      activeTagGroup != null ? g.width : g.minifiedWidth;
    const totalW =
      visibleGroups.reduce((s, g) => s + effectiveW(g), 0) +
      (visibleGroups.length - 1) * LEGEND_GROUP_GAP;
    let cx = (fixedWidth - totalW) / 2;
    for (const g of visibleGroups) {
      fixedPositions.set(g.name, cx);
      cx += effectiveW(g) + LEGEND_GROUP_GAP;
    }
  }

  for (const group of visibleGroups) {
    const isActive = activeTagGroup != null;
    const pillW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;

    const gX = fixedPositions?.get(group.name) ?? group.x;
    const gY = fixedPositions ? 0 : group.y;

    const legendG = parent
      .append('g')
      .attr('transform', `translate(${gX}, ${gY})`)
      .attr('class', 'sitemap-legend-group')
      .attr('data-legend-group', group.name.toLowerCase())
      .style('cursor', 'pointer');

    // Outer capsule background (active/expanded only)
    if (isActive) {
      legendG.append('rect')
        .attr('width', group.width)
        .attr('height', LEGEND_HEIGHT)
        .attr('rx', LEGEND_HEIGHT / 2)
        .attr('fill', groupBg);
    }

    const pillXOff = isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillYOff = isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillH = LEGEND_HEIGHT - (isActive ? LEGEND_CAPSULE_PAD * 2 : 0);

    // Pill background
    legendG.append('rect')
      .attr('x', pillXOff)
      .attr('y', pillYOff)
      .attr('width', pillW)
      .attr('height', pillH)
      .attr('rx', pillH / 2)
      .attr('fill', isActive ? palette.bg : groupBg);

    // Active pill border
    if (isActive) {
      legendG.append('rect')
        .attr('x', pillXOff)
        .attr('y', pillYOff)
        .attr('width', pillW)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', 'none')
        .attr('stroke', mix(palette.textMuted, palette.bg, 50))
        .attr('stroke-width', 0.75);
    }

    // Pill text
    legendG.append('text')
      .attr('x', pillXOff + pillW / 2)
      .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('font-weight', '500')
      .attr('fill', isActive ? palette.text : palette.textMuted)
      .attr('text-anchor', 'middle')
      .text(group.name);

    // Eye icon for visibility toggle (active only, app mode)
    if (isActive && fixedWidth != null) {
      const groupKey = group.name.toLowerCase();
      const isHidden = hiddenAttributes?.has(groupKey) ?? false;
      const eyeX = pillXOff + pillW + LEGEND_EYE_GAP;
      const eyeY = (LEGEND_HEIGHT - LEGEND_EYE_SIZE) / 2;
      const hitPad = 6;

      const eyeG = legendG.append('g')
        .attr('class', 'sitemap-legend-eye')
        .attr('data-legend-visibility', groupKey)
        .style('cursor', 'pointer')
        .attr('opacity', isHidden ? 0.4 : 0.7);

      // Transparent hit area for easier clicking
      eyeG.append('rect')
        .attr('x', eyeX - hitPad)
        .attr('y', eyeY - hitPad)
        .attr('width', LEGEND_EYE_SIZE + hitPad * 2)
        .attr('height', LEGEND_EYE_SIZE + hitPad * 2)
        .attr('fill', 'transparent')
        .attr('pointer-events', 'all');

      eyeG.append('path')
        .attr('d', isHidden ? EYE_CLOSED_PATH : EYE_OPEN_PATH)
        .attr('transform', `translate(${eyeX}, ${eyeY})`)
        .attr('fill', 'none')
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1.2)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');
    }

    // Entries (active/expanded only)
    if (isActive) {
      const eyeShift = fixedWidth != null ? LEGEND_EYE_SIZE + LEGEND_EYE_GAP : 0;
      let entryX = pillXOff + pillW + 4 + eyeShift;
      for (const entry of group.entries) {
        const entryG = legendG.append('g')
          .attr('data-legend-entry', entry.value.toLowerCase())
          .style('cursor', 'pointer');

        entryG.append('circle')
          .attr('cx', entryX + LEGEND_DOT_R)
          .attr('cy', LEGEND_HEIGHT / 2)
          .attr('r', LEGEND_DOT_R)
          .attr('fill', entry.color);

        const textX = entryX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
        entryG.append('text')
          .attr('x', textX)
          .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1)
          .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(entry.value);

        entryX = textX + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
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
  palette?: PaletteColors,
): Promise<string> {
  const { parseSitemap } = await import('./parser');
  const { layoutSitemap } = await import('./layout');
  const { getPalette } = await import('../palettes');
  const { injectBranding } = await import('../branding');

  const isDark = theme === 'dark';
  const effectivePalette = palette ?? (isDark ? getPalette('nord').dark : getPalette('nord').light);

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

  renderSitemap(container, parsed, sitemapLayout, effectivePalette, isDark, undefined, {
    width: exportWidth,
    height: exportHeight,
  });

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

  const brandColor = theme === 'transparent' ? '#888' : effectivePalette.textMuted;
  return injectBranding(svgHtml, brandColor);
}
