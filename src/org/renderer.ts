// ============================================================
// Org Chart SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import type { ParsedOrg } from './parser';
import type { OrgLayoutResult } from './layout';
import { parseOrg } from './parser';
import { layoutOrg } from './layout';
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

// Collapsed-node accent bar
const COLLAPSE_BAR_HEIGHT = 6;
const COLLAPSE_BAR_INSET = 0;

const LEGEND_FIXED_GAP = 8; // gap between fixed legend and scaled diagram — local, not shared

// ============================================================
// Color helpers
// ============================================================

function nodeFill(
  palette: PaletteColors,
  isDark: boolean,
  nodeColor?: string
): string {
  const color = nodeColor ?? palette.primary;
  return mix(color, isDark ? palette.surface : palette.bg, 25);
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
  hiddenAttributes?: Set<string>
): void {
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleOffset = parsed.title ? TITLE_HEIGHT : 0;
  const legendOnly = layout.nodes.length === 0;
  const legendPosition = parsed.options?.['legend-position'] ?? 'bottom';
  const hasLegend = layout.legend.length > 0;

  // In app mode (not export), render the legend at a fixed size outside the
  // scaled diagram group so it stays legible on large org charts.
  // The layout already shifted chart content down by legendShift for top legends
  // (LEGEND_HEIGHT + LEGEND_GROUP_GAP = 40px). We subtract that from the
  // diagram height so the scale is computed on chart content only, then
  // reserve fixed pixel space for the legend above or below.
  const layoutLegendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP; // 40px — what layout added
  const fixedLegend = !exportDims && hasLegend && !legendOnly;
  const legendReserve = fixedLegend ? LEGEND_HEIGHT + LEGEND_FIXED_GAP : 0;

  // Similarly, render the title at fixed size outside the scaled group in
  // non-export mode so it stays legible regardless of how small the chart scale is.
  const fixedTitle = !exportDims && !!parsed.title;
  const titleReserve = fixedTitle ? TITLE_HEIGHT : 0;

  // Compute scale to fit diagram in viewport
  const diagramW = layout.width;
  let diagramH = layout.height + (fixedTitle ? 0 : titleOffset);
  if (fixedLegend) {
    // Remove the legend space from diagram height — legend is rendered separately
    diagramH -= layoutLegendShift;
  }
  const availH = height - DIAGRAM_PADDING * 2 - legendReserve - titleReserve;
  const scaleX = (width - DIAGRAM_PADDING * 2) / diagramW;
  const scaleY = availH / diagramH;
  const scale = Math.min(MAX_SCALE, scaleX, scaleY);

  // Center the diagram
  const scaledW = diagramW * scale;
  const offsetX = (width - scaledW) / 2;
  const offsetY =
    legendPosition === 'top' && fixedLegend
      ? DIAGRAM_PADDING + legendReserve + titleReserve
      : DIAGRAM_PADDING + titleReserve;

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('font-family', FONT_FAMILY);

  // Main content group with scale/translate
  const mainG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Title
  // In non-export mode (fixedTitle), render at native size directly on the SVG
  // so it stays legible regardless of chart scale. In export mode, render inside
  // mainG so it scales with the diagram to match the exported dimensions.
  if (parsed.title) {
    const titleParent = fixedTitle ? svg : mainG;
    const titleX = fixedTitle ? width / 2 : diagramW / 2;
    const titleY = fixedTitle ? DIAGRAM_PADDING + TITLE_FONT_SIZE : TITLE_FONT_SIZE;
    const titleEl = titleParent
      .append('text')
      .attr('x', titleX)
      .attr('y', titleY)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', 'bold')
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

  // Content group (offset by title — only when title is inside the scaled group)
  const contentG = mainG
    .append('g')
    .attr('transform', `translate(0, ${fixedTitle ? 0 : titleOffset})`);

  // Build display name map from tag groups (lowercase key → original casing)
  const displayNames = new Map<string, string>();
  for (const group of parsed.tagGroups) {
    displayNames.set(group.name.toLowerCase(), group.name);
  }

  // Render container backgrounds (bottom layer)
  const colorOff = parsed.options?.color === 'off';
  for (const c of layout.containers) {
    const cG = contentG
      .append('g')
      .attr('transform', `translate(${c.x}, ${c.y})`)
      .attr('class', 'org-container')
      .attr('data-line-number', String(c.lineNumber)) as GSelection;

    // Expose active tag group value for legend-entry hover dimming
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const metaValue = c.metadata[tagKey];
      if (metaValue) {
        cG.attr(`data-tag-${tagKey}`, metaValue.toLowerCase());
      }
    }

    // Toggle attribute for containers that have (or had) children
    if (c.hasChildren) {
      cG.attr('data-node-toggle', c.nodeId)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr(
          'aria-expanded',
          String(!c.hiddenCount)
        )
        .attr('aria-label', c.label);
    }

    if (onClickItem) {
      cG.style('cursor', 'pointer').on('click', () => {
        onClickItem(c.lineNumber);
      });
    }

    const fill = containerFill(palette, isDark, colorOff ? undefined : c.color);
    const stroke = containerStroke(palette, colorOff ? undefined : c.color);

    // Background rect
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

    // Container label (bold, at top)
    cG.append('text')
      .attr('x', c.width / 2)
      .attr('y', CONTAINER_HEADER_HEIGHT / 2 + CONTAINER_LABEL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', CONTAINER_LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(c.label);

    // Container metadata (below label)
    const metaEntries = Object.entries(c.metadata);
    if (metaEntries.length > 0) {
      // Compute max key width so values align vertically
      const metaDisplayKeys = metaEntries.map(([k]) => displayNames.get(k) ?? k);
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (CONTAINER_META_FONT_SIZE * 0.6);

      const metaStartY = CONTAINER_HEADER_HEIGHT + CONTAINER_META_FONT_SIZE - 2;
      for (let i = 0; i < metaEntries.length; i++) {
        const [, value] = metaEntries[i];
        const displayKey = metaDisplayKeys[i];
        const rowY = metaStartY + i * CONTAINER_META_LINE_HEIGHT;

        cG.append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(`${displayKey}: `);

        cG.append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', palette.text)
          .attr('font-size', CONTAINER_META_FONT_SIZE)
          .text(value);
      }
    }

    // Collapsed accent bar (interactive only), clipped to card shape
    if (!exportDims && c.hiddenCount && c.hiddenCount > 0) {
      const clipId = `clip-${c.nodeId}`;
      cG.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('width', c.width).attr('height', c.height)
        .attr('rx', CONTAINER_RADIUS);
      cG.append('rect')
        .attr('x', COLLAPSE_BAR_INSET)
        .attr('y', c.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', c.width - COLLAPSE_BAR_INSET * 2)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', containerStroke(palette, colorOff ? undefined : c.color))
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'org-collapse-bar');
    }

  }

  // Render edges
  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;

    const pathParts: string[] = [];
    pathParts.push(`M ${edge.points[0].x} ${edge.points[0].y}`);
    for (let i = 1; i < edge.points.length; i++) {
      pathParts.push(`L ${edge.points[i].x} ${edge.points[i].y}`);
    }

    contentG
      .append('path')
      .attr('d', pathParts.join(' '))
      .attr('fill', 'none')
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('class', 'org-edge');
  }

  // Collect container node IDs so we can skip them in card rendering
  const containerNodeIds = new Set(layout.containers.map((c) => c.nodeId));

  // Render node cards (top layer) — skip containers (already drawn as background boxes)
  for (const node of layout.nodes) {
    if (containerNodeIds.has(node.id)) continue;

    const nodeG = contentG
      .append('g')
      .attr(
        'transform',
        `translate(${node.x - node.width / 2}, ${node.y})`
      )
      .attr('class', 'org-node')
      .attr('data-line-number', String(node.lineNumber)) as GSelection;

    // Expose active tag group value for legend-entry hover dimming
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const metaValue = node.metadata[tagKey];
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
    const fill = nodeFill(palette, isDark, colorOff ? undefined : node.color);
    const stroke = nodeStroke(palette, colorOff ? undefined : node.color);

    const rect = nodeG
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', CARD_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', NODE_STROKE_WIDTH);

    // Container nodes: dashed border
    if (node.isContainer) {
      rect.attr('stroke-dasharray', '6 3');
    }

    // Label
    nodeG
      .append('text')
      .attr('x', node.width / 2)
      .attr('y', HEADER_HEIGHT / 2 + LABEL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(node.label);

    // Metadata
    const metaEntries = Object.entries(node.metadata);
    if (metaEntries.length > 0) {
      // Header separator line
      nodeG
        .append('line')
        .attr('x1', 0)
        .attr('y1', HEADER_HEIGHT)
        .attr('x2', node.width)
        .attr('y2', HEADER_HEIGHT)
        .attr('stroke', stroke)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);

      // Metadata rows — compute max key width so values align vertically
      const metaDisplayKeys = metaEntries.map(([k]) => displayNames.get(k) ?? k);
      const maxKeyLen = Math.max(...metaDisplayKeys.map((k) => k.length));
      const valueX = 10 + (maxKeyLen + 2) * (META_FONT_SIZE * 0.6);

      const metaStartY = HEADER_HEIGHT + SEPARATOR_GAP + META_FONT_SIZE;
      for (let i = 0; i < metaEntries.length; i++) {
        const [, value] = metaEntries[i];
        const displayKey = metaDisplayKeys[i];
        const rowY = metaStartY + i * META_LINE_HEIGHT;

        // Key (muted)
        nodeG
          .append('text')
          .attr('x', 10)
          .attr('y', rowY)
          .attr('fill', palette.textMuted)
          .attr('font-size', META_FONT_SIZE)
          .text(`${displayKey}: `);

        // Value (normal)
        nodeG
          .append('text')
          .attr('x', valueX)
          .attr('y', rowY)
          .attr('fill', palette.text)
          .attr('font-size', META_FONT_SIZE)
          .text(value);
      }
    }

    // Collapsed accent bar (interactive only), clipped to card shape
    if (!exportDims && node.hiddenCount && node.hiddenCount > 0) {
      const clipId = `clip-${node.id}`;
      nodeG.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('width', node.width).attr('height', node.height)
        .attr('rx', CARD_RADIUS);
      nodeG
        .append('rect')
        .attr('x', COLLAPSE_BAR_INSET)
        .attr('y', node.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', node.width - COLLAPSE_BAR_INSET * 2)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', nodeStroke(palette, colorOff ? undefined : node.color))
        .attr('clip-path', `url(#${clipId})`)
        .attr('class', 'org-collapse-bar');
    }

  }

  // Render legend — kanban-style pills.
  // In app mode (fixedLegend): render at native size outside the scaled group.
  // In export mode: skip legend (unless legend-only chart).
  // Legend-only (no nodes): all groups rendered as expanded capsules inside scaled group.
  if (fixedLegend || legendOnly || (exportDims && hasLegend)) {
    // Determine which groups to render
    const visibleGroups = layout.legend.filter((group) => {
      if (legendOnly) return true;
      if (activeTagGroup == null) return true;
      return group.name.toLowerCase() === activeTagGroup.toLowerCase();
    });

    // For fixedLegend: compute positions in pixel space, centered in SVG
    let fixedPositions: Map<string, number> | undefined;
    if (fixedLegend && visibleGroups.length > 0) {
      fixedPositions = new Map();
      const effectiveW = (g: typeof visibleGroups[0]) =>
        activeTagGroup != null ? g.width : g.minifiedWidth;
      const totalW =
        visibleGroups.reduce((s, g) => s + effectiveW(g), 0) +
        (visibleGroups.length - 1) * LEGEND_GROUP_GAP;
      let cx = (width - totalW) / 2;
      for (const g of visibleGroups) {
        fixedPositions.set(g.name, cx);
        cx += effectiveW(g) + LEGEND_GROUP_GAP;
      }
    }

    // Choose parent: unscaled group for fixedLegend, contentG for legend-only
    const legendParentBase = fixedLegend
      ? svg
          .append('g')
          .attr('class', 'org-legend-fixed')
          .attr(
            'transform',
            legendPosition === 'bottom'
              ? `translate(0, ${height - DIAGRAM_PADDING - LEGEND_HEIGHT})`
              : `translate(0, ${DIAGRAM_PADDING + titleReserve})`
          )
      : contentG;
    const legendParent = legendParentBase;
    if (fixedLegend && activeTagGroup) {
      legendParentBase.attr('data-legend-active', activeTagGroup.toLowerCase());
    }

    for (const group of visibleGroups) {
      const isActive =
        legendOnly ||
        (activeTagGroup != null &&
          group.name.toLowerCase() === activeTagGroup.toLowerCase());

      const groupBg = isDark
        ? mix(palette.surface, palette.bg, 50)
        : mix(palette.surface, palette.bg, 30);

      const pillLabel = group.name;
      const pillWidth =
        pillLabel.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;

      const gX = fixedPositions?.get(group.name) ?? group.x;
      const gY = fixedPositions ? 0 : group.y;

      const gEl = legendParent
        .append('g')
        .attr('transform', `translate(${gX}, ${gY})`)
        .attr('class', 'org-legend-group')
        .attr('data-legend-group', group.name.toLowerCase())
        .style('cursor', legendOnly ? 'default' : 'pointer');

      // Outer capsule background (active only)
      if (isActive) {
        gEl
          .append('rect')
          .attr('width', group.width)
          .attr('height', LEGEND_HEIGHT)
          .attr('rx', LEGEND_HEIGHT / 2)
          .attr('fill', groupBg);
      }

      const pillXOff = isActive ? LEGEND_CAPSULE_PAD : 0;
      const pillYOff = isActive ? LEGEND_CAPSULE_PAD : 0;
      const pillH = LEGEND_HEIGHT - (isActive ? LEGEND_CAPSULE_PAD * 2 : 0);

      // Pill background
      gEl
        .append('rect')
        .attr('x', pillXOff)
        .attr('y', pillYOff)
        .attr('width', pillWidth)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', isActive ? palette.bg : groupBg);

      // Active pill border
      if (isActive) {
        gEl
          .append('rect')
          .attr('x', pillXOff)
          .attr('y', pillYOff)
          .attr('width', pillWidth)
          .attr('height', pillH)
          .attr('rx', pillH / 2)
          .attr('fill', 'none')
          .attr('stroke', mix(palette.textMuted, palette.bg, 50))
          .attr('stroke-width', 0.75);
      }

      // Pill text
      gEl
        .append('text')
        .attr('x', pillXOff + pillWidth / 2)
        .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
        .attr('font-size', LEGEND_PILL_FONT_SIZE)
        .attr('font-weight', '500')
        .attr('fill', isActive ? palette.text : palette.textMuted)
        .attr('text-anchor', 'middle')
        .text(pillLabel);

      // Eye icon for visibility toggle (active only, app mode)
      if (isActive && fixedLegend) {
        const groupKey = group.name.toLowerCase();
        const isHidden = hiddenAttributes?.has(groupKey) ?? false;
        const eyeX = pillXOff + pillWidth + LEGEND_EYE_GAP;
        const eyeY = (LEGEND_HEIGHT - LEGEND_EYE_SIZE) / 2;
        const hitPad = 6;

        const eyeG = gEl
          .append('g')
          .attr('class', 'org-legend-eye')
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

      // Entries inside capsule (active only)
      if (isActive) {
        const eyeShift = fixedLegend ? LEGEND_EYE_SIZE + LEGEND_EYE_GAP : 0;
        let entryX = pillXOff + pillWidth + 4 + eyeShift;
        for (const entry of group.entries) {
          const entryG = gEl
            .append('g')
            .attr('data-legend-entry', entry.value.toLowerCase())
            .style('cursor', 'pointer');

          entryG
            .append('circle')
            .attr('cx', entryX + LEGEND_DOT_R)
            .attr('cy', LEGEND_HEIGHT / 2)
            .attr('r', LEGEND_DOT_R)
            .attr('fill', entry.color);

          const textX = entryX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
          const entryLabel = entry.value;
          entryG
            .append('text')
            .attr('x', textX)
            .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1)
            .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
            .attr('fill', palette.textMuted)
            .text(entryLabel);

          entryX = textX + entryLabel.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
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

  // Create offscreen container
  const container = document.createElement('div');
  const titleOffset = parsed.title ? TITLE_HEIGHT : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight =
    layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  container.style.width = `${exportWidth}px`;
  container.style.height = `${exportHeight}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  try {
    // No hiddenAttributes passed to renderOrg — export never shows eye icons
    renderOrg(container, parsed, layout, palette, isDark, undefined, {
      width: exportWidth,
      height: exportHeight,
    });

    const svgEl = container.querySelector('svg');
    if (!svgEl) return '';

    if (theme === 'transparent') {
      svgEl.style.background = 'none';
    }

    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(container);
  }
}
