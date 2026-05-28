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
import { contrastText, shapeFill } from '../palettes/color-utils';
import type { ParsedMindmap } from './types';
import type { MindmapLayoutResult } from './types';
import { parseMindmap } from './parser';
import { layoutMindmap } from './layout';
import { computeNodeText } from './text-wrap';
import { renderInlineText } from '../utils/inline-markdown';
import { preprocessDescriptionLine } from '../utils/description-helpers';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';
import { ScaleContext } from '../utils/scaling';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const TITLE_HEIGHT = 30;
const SINGLE_LABEL_HEIGHT = 28;
const LABEL_LINE_HEIGHT = 18;
const DESC_LINE_HEIGHT = 14;
const NODE_RADIUS = 6;
const ROOT_STROKE_WIDTH = 2.5;
const NODE_STROKE_WIDTH = 1.5;
const EDGE_STROKE_WIDTH = 1.5;
const COLLAPSE_BAR_HEIGHT = 6;

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

/** Depth color sequence — ROYGBIV-ish from the palette's named colors */
const DEPTH_COLOR_KEYS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'teal',
  'cyan',
];

function depthColor(depth: number, palette: PaletteColors): string {
  const key = DEPTH_COLOR_KEYS[depth] as
    | keyof typeof palette.colors
    | undefined;
  if (key && key in palette.colors) {
    return palette.colors[key];
  }
  return palette.colors.gray;
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
  activeTagGroup?: string | null,
  options?: {
    colorByDepth?: boolean;
    onToggleColorByDepth?: (active: boolean) => void;
    onToggleDescriptions?: (active: boolean) => void;
    controlsExpanded?: boolean;
    onToggleControlsExpand?: () => void;
    exportMode?: boolean;
  }
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
    .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('font-family', FONT_FAMILY);

  const hasControls =
    !!options?.onToggleColorByDepth || !!options?.onToggleDescriptions;
  const hasLegend = parsed.tagGroups.length > 0 || hasControls;
  const fixedLegend = !isExport && hasLegend;
  const legendReserve = fixedLegend
    ? getMaxLegendReservedHeight(
        {
          groups: parsed.tagGroups,
          position: { placement: 'top-center', titleRelation: 'below-title' },
          mode: 'preview',
        },
        containerWidth
      ) + LEGEND_GROUP_GAP
    : 0;
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const fixedTitle = !isExport && showTitle;
  const titleReserve = fixedTitle ? TITLE_HEIGHT : 0;

  const availWidth = containerWidth;
  const availHeight =
    containerHeight - DIAGRAM_PADDING * 2 - legendReserve - titleReserve;

  const ctx = isExport
    ? ScaleContext.identity()
    : ScaleContext.from(availWidth, layout.width);

  let renderLayout = layout;
  if (ctx.factor < 1) {
    const hiddenCounts = new Map<string, number>();
    for (const n of layout.nodes) {
      if (n.hiddenCount != null && n.hiddenCount > 0) {
        hiddenCounts.set(n.id, n.hiddenCount);
      }
    }
    renderLayout = layoutMindmap(parsed, palette, {
      interactive: !isExport,
      ...(hiddenCounts.size > 0 && { hiddenCounts }),
      activeTagGroup: activeTagGroup ?? null,
      ...(hideDescriptions !== undefined && { hideDescriptions }),
      ctx,
    });
  }

  const offsetX = Math.max(0, (availWidth - renderLayout.width) / 2);
  const offsetY =
    DIAGRAM_PADDING +
    legendReserve +
    titleReserve +
    Math.max(0, (availHeight - renderLayout.height) / 2);

  const mainG = svg
    .append('g')
    .attr('transform', `translate(${offsetX}, ${offsetY})`);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // Title — fixed at top in app mode (above legend), inside scaled group in export
  if (showTitle) {
    const titleParent = fixedTitle ? svg : mainG;
    const titleX = fixedTitle ? containerWidth / 2 : renderLayout.width / 2;
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
    for (const node of renderLayout.nodes) {
      for (const tg of parsed.tagGroups) {
        const key = tg.name.toLowerCase();
        const val = node.metadata[key];
        if (val) {
          if (!usedValues.has(key)) usedValues.set(key, new Set());
          usedValues.get(key)!.add(val.toLowerCase());
        }
      }
    }

    // Build controls toggles
    const toggles: import('../utils/legend-types').ControlsGroupToggle[] = [];
    if (options?.onToggleDescriptions) {
      toggles.push({
        id: 'descriptions',
        type: 'toggle' as const,
        label: 'Descriptions',
        active: !hideDescriptions,
        onToggle: (active) => options.onToggleDescriptions!(active),
      });
    }
    if (options?.onToggleColorByDepth) {
      toggles.push({
        id: 'depth-colors',
        type: 'toggle' as const,
        label: 'Depth Colors',
        active: options.colorByDepth ?? false,
        onToggle: options.onToggleColorByDepth,
      });
    }
    const controlsToggles: LegendConfig['controlsGroup'] =
      toggles.length > 0 ? { toggles } : undefined;

    const legendConfig: LegendConfig = {
      groups: parsed.tagGroups.map((tg) => {
        const used = usedValues.get(tg.name.toLowerCase());
        return {
          name: tg.name,
          ...(tg.alias !== undefined && { alias: tg.alias }),
          entries: tg.entries
            .filter((e) => used?.has(e.value.toLowerCase()))
            .map((e) => ({ value: e.value, color: e.color })),
        };
      }),
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: options?.exportMode ? 'export' : 'preview',
      ...(controlsToggles !== undefined && { controlsGroup: controlsToggles }),
    };
    const legendState: LegendState = {
      activeGroup: options?.colorByDepth
        ? null
        : activeTagGroup !== undefined
          ? activeTagGroup
          : (parsed.options['active-tag'] ?? null),
      hiddenAttributes: new Set(),
      ...(options?.controlsExpanded !== undefined && {
        controlsExpanded: options.controlsExpanded,
      }),
    };
    const legendPalette = {
      text: palette.text,
      textMuted: palette.textMuted,
      bg: palette.bg,
      surface: palette.surface,
      primary: palette.primary,
    };
    const legendCallbacks: import('../utils/legend-types').LegendCallbacks = {
      ...(options?.onToggleControlsExpand !== undefined && {
        onControlsExpand: options.onToggleControlsExpand,
      }),
      onControlsToggle: (id, active) => {
        if (id === 'depth-colors' && options?.onToggleColorByDepth) {
          options.onToggleColorByDepth(active);
        }
        if (id === 'descriptions' && options?.onToggleDescriptions) {
          options.onToggleDescriptions(active);
        }
      },
    };
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      legendPalette,
      isDark,
      legendCallbacks,
      containerWidth
    );
  }

  // Render edges (background layer)
  for (const edge of renderLayout.edges) {
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
  for (const node of renderLayout.nodes) {
    const isRoot = node.radius === 0 && renderLayout.nodes.indexOf(node) === 0;
    const strokeW = isRoot ? ROOT_STROKE_WIDTH : NODE_STROKE_WIDTH;
    const effectiveColor = options?.colorByDepth
      ? depthColor(node.depth, palette)
      : node.color;
    const fill = nodeFill(
      palette,
      isDark,
      effectiveColor,
      parsed.options['solid-fill'] === 'on'
    );
    const stroke = nodeStroke(palette, effectiveColor);
    const onFillText = contrastText(
      fill,
      palette.textOnFillLight,
      palette.textOnFillDark
    );

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

    // Determine if description is visible (needed for label centering)
    const collapsed = node.hiddenCount != null && node.hiddenCount > 0;
    const showDesc = !hideDescriptions && !!node.description && !collapsed;

    // Compute wrapped text layout (same logic as layout.ts for sizing agreement)
    const textLayout = computeNodeText(
      node.label,
      node.description,
      node.depth,
      node.width,
      hideDescriptions || collapsed
    );
    const {
      labelLines,
      labelFontSize: fontSize,
      descLines,
      descFontSize,
    } = textLayout;

    // Label zone height
    const labelLineCount = labelLines.length;
    const labelZoneH =
      labelLineCount <= 1
        ? SINGLE_LABEL_HEIGHT
        : LABEL_LINE_HEIGHT * labelLineCount;
    const labelZoneHeight = showDesc ? labelZoneH : node.height;

    // Label text — vertically centered in the label zone
    const centerX = node.x + node.width / 2;
    if (labelLineCount <= 1) {
      // Single line — simple centering
      const labelY = node.y + labelZoneHeight / 2 + fontSize * 0.35;
      nodeG
        .append('text')
        .attr('x', centerX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('font-size', fontSize)
        .attr('font-weight', isRoot ? 'bold' : 'normal')
        .attr('fill', onFillText)
        // labelLineCount <= 1 implies labelLines has exactly one element here.
        .text(labelLines[0]!);
    } else {
      // Multi-line — use tspan elements
      // Visual text block spans from first baseline to last baseline:
      //   blockH = (lineCount - 1) * lineHeight
      // Center that block in the zone, then offset each baseline by fontSize * 0.35
      const blockH = LABEL_LINE_HEIGHT * (labelLineCount - 1);
      const firstBaselineY =
        node.y + labelZoneHeight / 2 - blockH / 2 + fontSize * 0.35;
      const textEl = nodeG
        .append('text')
        .attr('x', centerX)
        .attr('text-anchor', 'middle')
        .attr('font-size', fontSize)
        .attr('font-weight', isRoot ? 'bold' : 'normal')
        .attr('fill', onFillText);

      for (let i = 0; i < labelLines.length; i++) {
        textEl
          .append('tspan')
          .attr('x', centerX)
          .attr('y', firstBaselineY + i * LABEL_LINE_HEIGHT)
          // In-bounds by loop guard (i < labelLines.length).
          .text(labelLines[i]!);
      }
    }

    // Hover tooltip for truncated/wrapped labels — on the <g>, not on <text>
    if (labelLines.length > 1 || labelLines[0] !== node.label) {
      nodeG.append('title').text(node.label);
    }

    // Description — separator line + muted text below label
    if (showDesc && descLines.length > 0) {
      const separatorY = node.y + labelZoneH;

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

      // Description text (with inline markdown + preprocessing)
      if (descLines.length <= 1) {
        const descY = separatorY + 4 + descFontSize;
        // descLines.length > 0 from outer guard and <= 1 here means exactly one.
        const processed = preprocessDescriptionLine(descLines[0]!);
        const textEl = nodeG
          .append('text')
          .attr('x', centerX)
          .attr('y', descY)
          .attr('text-anchor', 'middle')
          .attr('font-size', descFontSize)
          .attr('fill', onFillText);
        renderInlineText(textEl, processed, palette, descFontSize);
      } else {
        const descStartY = separatorY + 4 + descFontSize;
        for (let i = 0; i < descLines.length; i++) {
          // In-bounds by loop guard (i < descLines.length).
          const processed = preprocessDescriptionLine(descLines[i]!);
          const textEl = nodeG
            .append('text')
            .attr('x', centerX)
            .attr('y', descStartY + i * DESC_LINE_HEIGHT)
            .attr('text-anchor', 'middle')
            .attr('font-size', descFontSize)
            .attr('fill', onFillText);
          renderInlineText(textEl, processed, palette, descFontSize);
        }
      }
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
  const hideDescriptions = parsed.options['no-descriptions'] === 'true';

  const layout = layoutMindmap(parsed, palette, {
    interactive: false,
    hideDescriptions,
  });

  const titleOffset =
    parsed.title && parsed.options['no-title'] !== 'on' ? TITLE_HEIGHT : 0;
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
