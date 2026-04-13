// ============================================================
// Mindmap SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  runInExportContainer,
  extractExportSvg,
} from '../utils/export-container';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import type { ParsedMindmap } from './types';
import type { MindmapLayoutResult } from './types';
import { parseMindmap } from './parser';
import { layoutMindmap } from './layout';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import { LEGEND_HEIGHT, LEGEND_GROUP_GAP } from '../utils/legend-constants';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const MAX_SCALE = 3;
const TITLE_HEIGHT = 30;
const LABEL_FONT_SIZE = 13;
const LABEL_HEIGHT = 28;
const DESC_FONT_SIZE = 10;
const NODE_RADIUS = 6;
const ROOT_STROKE_WIDTH = 2.5;
const NODE_STROKE_WIDTH = 1.5;
const EDGE_STROKE_WIDTH = 1.5;
const COLLAPSE_BAR_HEIGHT = 6;

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

// ============================================================
// Main renderer
// ============================================================

export function renderMindmap(
  container: HTMLDivElement,
  parsed: ParsedMindmap,
  layout: MindmapLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: { width?: number; height?: number },
  onToggleNode?: (nodeId: string) => void,
  hideDescriptions?: boolean,
  activeTagGroup?: string | null
): void {
  const isExport = !!exportDims;
  const containerWidth =
    exportDims?.width ?? (container.getBoundingClientRect().width || 800);
  const containerHeight =
    exportDims?.height ?? (container.getBoundingClientRect().height || 600);

  // Clear existing content
  d3Selection.select(container).selectAll('*').remove();

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', containerWidth)
    .attr('height', containerHeight)
    .style('font-family', FONT_FAMILY);

  // Reserve space for fixed elements (legend, title) in interactive mode
  const hasLegend = parsed.tagGroups.length > 0;
  const fixedLegend = !isExport && hasLegend;
  const legendReserve = fixedLegend ? LEGEND_HEIGHT + LEGEND_GROUP_GAP : 0;
  const fixedTitle = !isExport && !!parsed.title;
  const titleReserve = fixedTitle ? TITLE_HEIGHT : 0;

  // Compute scale to fit diagram in available space
  const availWidth = containerWidth;
  const availHeight =
    containerHeight - DIAGRAM_PADDING * 2 - legendReserve - titleReserve;

  let scale: number;
  if (isExport) {
    scale = 1;
  } else {
    const scaleX = layout.width > 0 ? availWidth / layout.width : 1;
    const scaleY = layout.height > 0 ? availHeight / layout.height : 1;
    scale = Math.min(scaleX, scaleY, MAX_SCALE);
  }

  const scaledWidth = layout.width * scale;
  const scaledHeight = layout.height * scale;
  const offsetX = (availWidth - scaledWidth) / 2;
  const offsetY =
    DIAGRAM_PADDING +
    legendReserve +
    titleReserve +
    (availHeight - scaledHeight) / 2;

  // Main group with scale transform (created early so title can reference it in export mode)
  const mainG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY}) scale(${scale})`);

  // Title — fixed at top in app mode (above legend), inside scaled group in export
  if (parsed.title) {
    const titleParent = fixedTitle ? svg : mainG;
    const titleX = fixedTitle ? containerWidth / 2 : layout.width / 2;
    const titleY = fixedTitle
      ? DIAGRAM_PADDING + TITLE_FONT_SIZE
      : TITLE_FONT_SIZE;
    const titleText = titleParent
      .append('text')
      .attr('x', titleX)
      .attr('y', titleY)
      .attr('text-anchor', 'middle')
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .attr('class', 'chart-title')
      .text(parsed.title);

    if (parsed.titleLineNumber) {
      titleText.attr('data-line-number', parsed.titleLineNumber);
    }
    if (onClickItem && parsed.titleLineNumber) {
      titleText
        .style('cursor', 'pointer')
        .on('click', () => onClickItem(parsed.titleLineNumber!));
    }
  }

  // Legend — fixed below title, outside scaled group, in interactive mode
  if (fixedLegend) {
    const legendG = svg
      .append('g')
      .attr('class', 'mindmap-legend-fixed')
      .attr('transform', `translate(0, ${DIAGRAM_PADDING + titleReserve})`);

    // Collect used tag values from all nodes to filter legend entries
    const usedValues = new Map<string, Set<string>>(); // groupName → set of used values
    for (const node of layout.nodes) {
      for (const tg of parsed.tagGroups) {
        const key = tg.name.toLowerCase();
        const val = node.metadata[key];
        if (val) {
          if (!usedValues.has(key)) usedValues.set(key, new Set());
          usedValues.get(key)!.add(val.toLowerCase());
        }
      }
    }

    const legendConfig: LegendConfig = {
      groups: parsed.tagGroups.map((tg) => {
        const used = usedValues.get(tg.name.toLowerCase());
        return {
          name: tg.name,
          alias: tg.alias,
          entries: tg.entries
            .filter((e) => used?.has(e.value.toLowerCase()))
            .map((e) => ({ value: e.value, color: e.color })),
        };
      }),
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: 'fixed',
    };
    const legendState: LegendState = {
      activeGroup: activeTagGroup ?? parsed.options['active-tag'] ?? null,
      hiddenAttributes: new Set(),
    };
    const legendPalette = {
      text: palette.text,
      textMuted: palette.textMuted,
      bg: palette.bg,
      surface: palette.surface,
      primary: palette.primary,
    };
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      legendPalette,
      isDark,
      undefined,
      containerWidth
    );
  }

  // Render edges (background layer)
  for (const edge of layout.edges) {
    mainG
      .append('path')
      .attr('class', 'mindmap-edge')
      .attr('d', edge.path)
      .attr('fill', 'none')
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', EDGE_STROKE_WIDTH)
      .attr('stroke-opacity', 0.5);
  }

  // Render nodes (foreground layer)
  for (const node of layout.nodes) {
    const isRoot = node.radius === 0 && layout.nodes.indexOf(node) === 0;
    const strokeW = isRoot ? ROOT_STROKE_WIDTH : NODE_STROKE_WIDTH;
    const fill = nodeFill(palette, isDark, node.color);
    const stroke = nodeStroke(palette, node.color);

    const nodeG = mainG
      .append('g')
      .attr('class', 'mindmap-node')
      .attr('data-line-number', node.lineNumber);

    // Expose active tag group value for legend-entry hover dimming
    if (activeTagGroup) {
      const tagKey = activeTagGroup.toLowerCase();
      const metaValue = node.metadata[tagKey];
      if (metaValue) {
        nodeG.attr(`data-tag-${tagKey}`, metaValue.toLowerCase());
      }
    }

    // Add collapse toggle attributes for nodes with children
    if (node.hasChildren) {
      nodeG
        .attr('data-node-toggle', node.id)
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr(
          'aria-expanded',
          node.hiddenCount != null && node.hiddenCount > 0 ? 'false' : 'true'
        )
        .attr('aria-label', node.label);
    }

    // Node rectangle
    nodeG
      .append('rect')
      .attr('x', node.x)
      .attr('y', node.y)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', NODE_RADIUS)
      .attr('ry', NODE_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', strokeW);

    // Label text
    const labelY = node.y + 18;
    const maxChars = Math.floor((node.width - 16) / 7);
    const displayLabel =
      node.label.length > maxChars
        ? node.label.substring(0, maxChars - 1) + '\u2026'
        : node.label;

    nodeG
      .append('text')
      .attr('x', node.x + node.width / 2)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('font-weight', isRoot ? 'bold' : 'normal')
      .attr('fill', palette.text)
      .text(displayLabel);

    // Hover tooltip for truncated labels — on the <g>, not on <text>
    if (node.label.length > maxChars) {
      nodeG.append('title').text(node.label);
    }

    // Description — separator line + muted text below label (org chart pattern)
    const showDesc =
      !hideDescriptions &&
      node.description &&
      !(node.hiddenCount != null && node.hiddenCount > 0);
    if (showDesc) {
      const separatorY = node.y + LABEL_HEIGHT;

      // Separator line
      nodeG
        .append('line')
        .attr('x1', node.x)
        .attr('y1', separatorY)
        .attr('x2', node.x + node.width)
        .attr('y2', separatorY)
        .attr('stroke', stroke)
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);

      // Description text
      const descY = separatorY + 4 + DESC_FONT_SIZE;
      const descMaxChars = Math.floor((node.width - 16) / 6);
      const displayDesc =
        node.description!.length > descMaxChars
          ? node.description!.substring(0, descMaxChars - 1) + '\u2026'
          : node.description!;

      nodeG
        .append('text')
        .attr('x', node.x + node.width / 2)
        .attr('y', descY)
        .attr('text-anchor', 'middle')
        .attr('font-size', DESC_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(displayDesc);
    }

    // Collapse drill-bar (interactive mode only)
    if (!isExport && node.hiddenCount != null && node.hiddenCount > 0) {
      // Clip path for rounded bottom
      const clipId = `collapse-clip-${node.id}`;
      const defs = mainG.append('defs');
      defs
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', node.x)
        .attr('y', node.y)
        .attr('width', node.width)
        .attr('height', node.height)
        .attr('rx', NODE_RADIUS)
        .attr('ry', NODE_RADIUS);

      nodeG
        .append('rect')
        .attr('class', 'collapse-bar')
        .attr('x', node.x)
        .attr('y', node.y + node.height - COLLAPSE_BAR_HEIGHT)
        .attr('width', node.width)
        .attr('height', COLLAPSE_BAR_HEIGHT)
        .attr('fill', stroke)
        .attr('clip-path', `url(#${clipId})`);
    }

    // Click handler
    if (onClickItem) {
      nodeG.style('cursor', 'pointer').on('click', (event: Event) => {
        // If this node has a toggle and the toggle callback exists,
        // use toggle behavior instead of navigation
        if (node.hasChildren && onToggleNode) {
          event.stopPropagation();
          onToggleNode(node.id);
        } else {
          onClickItem(node.lineNumber);
        }
      });
    }

    // Hover opacity
    if (!isExport) {
      nodeG
        .on('mouseenter', function () {
          d3Selection.select(this).attr('opacity', 0.7);
        })
        .on('mouseleave', function () {
          d3Selection.select(this).attr('opacity', 1);
        });
    }
  }
}

// ============================================================
// Export convenience function
// ============================================================

export function renderMindmapForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette: PaletteColors
): string {
  const parsed = parseMindmap(content, palette);
  if (parsed.error) return '';

  const isDark = theme === 'dark';
  const hideDescriptions = parsed.options['hide-descriptions'] === 'true';

  const layout = layoutMindmap(parsed, palette, {
    interactive: false,
    hideDescriptions,
  });

  const titleOffset = parsed.title ? TITLE_HEIGHT : 0;
  const exportWidth = layout.width + DIAGRAM_PADDING * 2;
  const exportHeight = layout.height + DIAGRAM_PADDING * 2 + titleOffset;

  return runInExportContainer(exportWidth, exportHeight, (container) => {
    renderMindmap(
      container,
      parsed,
      layout,
      palette,
      isDark,
      undefined,
      { width: exportWidth, height: exportHeight },
      undefined,
      hideDescriptions
    );
    return extractExportSvg(container, theme);
  });
}
