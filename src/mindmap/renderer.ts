// ============================================================
// Mindmap SVG Renderer
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import {
  fillModeFromOptions,
  legendSuppressed,
  legendInlineRequested,
} from '../utils/parsing';
import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  runInExportContainer,
  extractExportSvg,
} from '../utils/export-container';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  getSeriesColors,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import type { ParsedMindmap } from './types';
import type { MindmapLayoutResult } from './types';
import { parseMindmap, resolveMindmapHighlight } from './parser';
import { storyGround } from '../utils/emphasis';
import {
  BARE_LEAF_MID_EM,
  layoutMindmap,
  MARGIN as LAYOUT_MARGIN,
} from './layout';
import { computeNodeText } from './text-wrap';
import { renderInlineText } from '../utils/inline-markdown';
import { preprocessDescriptionLine } from '../utils/description-helpers';
import { renderIntegratedLegend } from '../utils/legend-integration';
import type {
  ControlsGroupToggle,
  LegendCallbacks,
  LegendConfig,
} from '../utils/legend-types';
import { LEGEND_GROUP_GAP } from '../utils/legend-constants';
import {
  getMaxLegendReservedHeight,
  getLegendExtent,
} from '../utils/legend-layout';
import { layoutInlineHeader } from '../utils/inline-header';
import { growChartFrame } from '../utils/chart-frame';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  FRAME_BODY_TOP,
} from '../utils/title-constants';
import { ScaleContext } from '../utils/scaling';
import { renderCollapseBar } from '../utils/card';
import { FULL_TEXT_ATTR, fullNodeText, isCutShort } from '../utils/full-text';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const TITLE_HEIGHT = 30;
/**
 * The band an exported title adds above the diagram (#1838). The layout's own
 * top MARGIN already carries the first node to the shared band, so a title
 * adds nothing. The fixed preview strip keeps TITLE_HEIGHT.
 */
export const EMBEDDED_TITLE_BAND =
  FRAME_BODY_TOP - DIAGRAM_PADDING - LAYOUT_MARGIN;
const LABEL_LINE_HEIGHT = 18;
const DESC_LINE_HEIGHT = 14;
const ROOT_STROKE_WIDTH = 2.5;
import {
  NODE_STROKE_WIDTH,
  EDGE_STROKE_WIDTH,
  HEADER_HEIGHT,
} from '../utils/visual-conventions'; // shared (Story 111.1)

/** Corner radius of a pill; a tall card keeps this, not a half-height arc. */
const PILL_MAX_RADIUS = 16;
/** Dot drawn at a leaf's parent-facing edge, two-sided layout (#2100). */
const LEAF_DOT_RADIUS = 3.5;
const LEAF_TEXT_INSET = 9;
/** Edge widths: root to branch, and every deeper edge. */
const BRANCH_EDGE_WIDTH = 2.5;
const EDGE_OPACITY = 0.7;

function pillRadius(height: number): number {
  return Math.min(height / 2, PILL_MAX_RADIUS);
}

/**
 * One hue per top-level branch, inherited by its whole subtree (#2100):
 * the palette's series rotation in source order, restarting nowhere, so
 * neighbouring trees of a forest differ too.
 */
function branchHues(
  layout: MindmapLayoutResult,
  palette: PaletteColors
): { parent: Map<string, string>; hue: Map<string, string> } {
  const parent = new Map<string, string>();
  for (const e of layout.edges) {
    if (e.sourceId !== e.targetId) parent.set(e.targetId, e.sourceId);
  }
  const series = getSeriesColors(palette);
  const hue = new Map<string, string>();
  let next = 0;
  for (const n of layout.nodes) {
    if (n.depth === 1) hue.set(n.id, series[next++ % series.length]!);
  }
  for (const n of layout.nodes) {
    if (n.depth < 2) continue;
    let up = parent.get(n.id);
    while (up !== undefined && !hue.has(up)) up = parent.get(up);
    if (up !== undefined) hue.set(n.id, hue.get(up)!);
  }
  return { parent, hue };
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
    /** When 'app', controls (Descriptions / Depth Colors) are hosted by the app
     *  overlay strip — inline gear suppressed, controls row + anchor reserved. */
    controlsHost?: 'app' | 'inline';
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

  const appHosted = options?.controlsHost === 'app';
  // App-hosted: Descriptions / Depth Colors move to the app overlay, so a
  // controls-only legend (no tag groups) has nothing left to render.
  const hasControls =
    !!options?.onToggleColorByDepth || !!options?.onToggleDescriptions;
  const hasLegend =
    (parsed.tagGroups.length > 0 || (hasControls && !appHosted)) &&
    !legendSuppressed(parsed.options);
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

  // §1.9 `legend-inline` (decision #50): try a one-line header (title left,
  // legend flushed right). Falls back to the stacked band when it can't fit.
  // The legend only renders in the fixed (preview) path, so the inline probe is
  // gated on `fixedLegend` — export stays stacked/centered and byte-identical.
  const inlineRequested = legendInlineRequested(parsed.options);
  const legendExtent =
    inlineRequested && fixedLegend
      ? getLegendExtent(
          {
            groups: parsed.tagGroups,
            position: {
              placement: 'top-center',
              titleRelation: 'inline-with-title',
            },
            mode: isExport ? 'export' : 'preview',
          },
          { activeGroup: activeTagGroup ?? null },
          containerWidth
        )
      : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: parsed.title ?? '',
    hasLegend: fixedLegend,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth,
    titleBandHeight: titleReserve,
    legendReserve,
    titleBaselineY: TITLE_Y,
    titleFontSize: TITLE_FONT_SIZE,
  });

  const availWidth = containerWidth;
  const availHeight =
    containerHeight -
    DIAGRAM_PADDING * 2 -
    (header.inline ? 0 : legendReserve) -
    titleReserve;

  // Fit to BOTH axes so a tall tree shrinks to fit a short canvas instead of
  // overflowing vertically (export sizes its own canvas, so it stays identity).
  let ctx = isExport
    ? ScaleContext.identity()
    : ScaleContext.fromBox(
        availWidth,
        layout.width,
        availHeight,
        layout.height
      );

  let renderLayout = layout;
  if (ctx.factor < 1) {
    const hiddenCounts = new Map<string, number>();
    for (const n of layout.nodes) {
      if (n.hiddenCount != null && n.hiddenCount > 0) {
        hiddenCounts.set(n.id, n.hiddenCount);
      }
    }
    const relayout = (c: ScaleContext): MindmapLayoutResult =>
      layoutMindmap(parsed, palette, {
        interactive: !isExport,
        ...(hiddenCounts.size > 0 && { hiddenCounts }),
        activeTagGroup: activeTagGroup ?? null,
        ...(hideDescriptions !== undefined && { hideDescriptions }),
        ctx: c,
      });
    renderLayout = relayout(ctx);
    // Scaling is non-linear, so one pass can still overflow. Re-measure the
    // laid-out result and tighten until it fits both axes or hits the floor.
    for (let i = 0; i < 3 && !ctx.isBelowFloor; i++) {
      const refit = Math.min(
        availWidth / renderLayout.width,
        availHeight / renderLayout.height
      );
      if (refit >= 0.999) break; // already fits
      ctx = ScaleContext.fromFactor(ctx.factor * refit);
      renderLayout = relayout(ctx);
    }
  }

  // Re-layout keeps text readable but is floor-limited, so a dense tree can
  // still exceed the canvas. Apply a final uniform scale as a hard guarantee
  // that the diagram always fits within the canvas (no overflow), regardless
  // of how small the canvas is. Export sizes its own canvas, so this is a no-op
  // there (fitScale === 1).
  const fitScale = isExport
    ? 1
    : Math.min(
        1,
        renderLayout.width > 0 ? availWidth / renderLayout.width : 1,
        renderLayout.height > 0 ? availHeight / renderLayout.height : 1
      );
  const scaledWidth = renderLayout.width * fitScale;
  const scaledHeight = renderLayout.height * fitScale;

  const offsetX = Math.max(0, (availWidth - scaledWidth) / 2);
  const offsetY =
    DIAGRAM_PADDING +
    (header.inline ? 0 : legendReserve) +
    titleReserve +
    Math.max(0, (availHeight - scaledHeight) / 2);

  const mainG = svg
    .append('g')
    .attr(
      'transform',
      `translate(${offsetX}, ${offsetY})${fitScale < 1 ? ` scale(${fitScale})` : ''}`
    );

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // Title — fixed at top in app mode (above legend), inside scaled group in export
  if (showTitle) {
    const titleParent = fixedTitle ? svg : mainG;
    const titleX = fixedTitle ? header.titleX : renderLayout.width / 2;
    const titleY = fixedTitle ? TITLE_Y : (TITLE_Y - offsetY) / fitScale; // mainG is translated by offsetY
    const titleText = titleParent
      .append('text')
      .attr('x', titleX)
      .attr('y', titleY)
      .attr('text-anchor', fixedTitle ? header.titleAnchor : 'middle')
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
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0, ${DIAGRAM_PADDING + titleReserve})`
      );

    // Collect used tag values from all nodes to filter legend entries
    const usedValues = new Map<string, Set<string>>(); // groupName → set of used values
    for (const node of renderLayout.nodes) {
      for (const tg of parsed.tagGroups) {
        const key = tagAttrKey(tg.name);
        const val = node.metadata[key];
        if (val) {
          if (!usedValues.has(key)) usedValues.set(key, new Set());
          usedValues.get(key)!.add(val.toLowerCase());
        }
      }
    }

    // Build controls toggles
    const toggles: ControlsGroupToggle[] = [];
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
        const used = usedValues.get(tagAttrKey(tg.name));
        return {
          name: tg.name,
          ...(tg.alias !== undefined && { alias: tg.alias }),
          entries: tg.entries
            .filter((e) => used?.has(e.value.toLowerCase()))
            .map((e) => ({ value: e.value, color: e.color })),
        };
      }),
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      mode: options?.exportMode ? 'export' : 'preview',
      ...(controlsToggles !== undefined && { controlsGroup: controlsToggles }),
      ...(options?.controlsHost !== undefined && {
        controlsHost: options.controlsHost,
      }),
    };
    const legendPalette = {
      text: palette.text,
      textMuted: palette.textMuted,
      bg: palette.bg,
      surface: palette.surface,
      primary: palette.primary,
    };
    const legendCallbacks: LegendCallbacks = {
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
    renderIntegratedLegend(legendG, {
      frame: parsed.frame,
      ...legendConfig,
      palette: legendPalette,
      isDark,
      width: containerWidth,
      activeGroup: options?.colorByDepth
        ? null
        : activeTagGroup !== undefined
          ? activeTagGroup
          : (parsed.options['active-tag'] ?? null),
      hiddenAttributes: new Set(),
      ...(options?.controlsExpanded !== undefined && {
        controlsExpanded: options.controlsExpanded,
      }),
      callbacks: legendCallbacks,
    });
  }

  // Story view (#2041): a `highlight` recedes everything not lit to the ground.
  const story = resolveMindmapHighlight(parsed);
  const ground = story.paths.active ? storyGround(palette, isDark) : null;

  // Branch hues and node shapes (#2100). Two-sided: branches are tinted
  // pills, deeper inner nodes pale pills, leaves plain text with a dot.
  // Radial: branches are solid pills, every deeper node a pale pill.
  const radial = parsed.options['radial'] === 'on';
  const { parent: parentOf, hue: branchHue } = branchHues(
    renderLayout,
    palette
  );
  const nodeById = new Map(renderLayout.nodes.map((n) => [n.id, n]));
  const base = themeBaseBg(palette, isDark);
  const fillMode = fillModeFromOptions(parsed.options);
  const hueOf = (n: (typeof renderLayout.nodes)[number]): string =>
    options?.colorByDepth
      ? depthColor(n.depth, palette)
      : (n.color ?? branchHue.get(n.id) ?? palette.primary);

  // Render edges (background layer)
  for (const edge of renderLayout.edges) {
    const edgeReceded =
      ground !== null &&
      !story.litEdges.has(`${edge.sourceId}>${edge.targetId}`);
    const child = nodeById.get(edge.targetId);
    const edgeHue =
      child && !options?.colorByDepth
        ? (branchHue.get(child.id) ?? palette.textMuted)
        : palette.textMuted;
    mainG
      .append('path')
      .attr('class', 'mindmap-edge')
      .attr('d', edge.path)
      .attr('fill', 'none')
      .attr('stroke', edgeReceded ? ground.groundStroke : edgeHue)
      .attr(
        'stroke-width',
        child?.depth === 1 ? BRANCH_EDGE_WIDTH : EDGE_STROKE_WIDTH
      )
      .attr('stroke-linecap', 'round')
      .attr('stroke-opacity', EDGE_OPACITY);
  }

  // Render nodes (foreground layer)
  for (const node of renderLayout.nodes) {
    const isRoot = node.depth === 0;
    const isLeaf = !radial && node.depth >= 2 && !node.hasChildren;
    const hue = hueOf(node);
    const receded = ground !== null && !story.litIds.has(node.id);
    let fill: string;
    let stroke: string;
    let strokeW = NODE_STROKE_WIDTH;
    if (isRoot) {
      // A dark pill — the text colour, so it inverts with the theme.
      fill = node.color ?? palette.text;
      stroke = fill;
      strokeW = ROOT_STROKE_WIDTH;
    } else if (node.depth === 1) {
      fill = radial ? hue : shapeFill(palette, hue, isDark, { mode: fillMode });
      stroke = hue;
    } else {
      fill = mix(hue, base, 12);
      stroke = mix(hue, base, 60);
      strokeW = 1;
    }
    if (receded) {
      fill = ground.groundFill;
      stroke = ground.groundStroke;
    }
    const onFillText = receded
      ? ground.groundText
      : isLeaf
        ? palette.text
        : contrastText(fill, palette.textOnFillLight, palette.textOnFillDark);
    const rx = pillRadius(node.height);
    // A leaf reads away from its parent: dot on the near edge, text beyond.
    const parentNode = nodeById.get(parentOf.get(node.id) ?? '');
    const leafOnLeft =
      isLeaf &&
      parentNode !== undefined &&
      parentNode.x + parentNode.width / 2 > node.x + node.width / 2;

    const nodeG = mainG
      .append('g')
      .attr('class', 'mindmap-node')
      .attr('data-line-number', node.lineNumber);

    // Expose active tag group value for legend-entry hover dimming
    if (activeTagGroup) {
      const tagKey = tagAttrKey(activeTagGroup);
      const metaValue = node.metadata[tagKey];
      if (metaValue) {
        nodeG.attr(`data-tag-${tagAttrKey(tagKey)}`, metaValue.toLowerCase());
      }
    }

    // Add collapse toggle attributes for nodes with children
    if (node.hasChildren) {
      nodeG
        .attr('data-node-toggle', node.id)
        .attr('role', 'button')
        .attr(
          'aria-expanded',
          node.hiddenCount != null && node.hiddenCount > 0 ? 'false' : 'true'
        )
        .attr('aria-label', node.label);
    }

    // Node pill — a leaf keeps an unpainted one as its hit area.
    nodeG
      .append('rect')
      .attr('x', node.x)
      .attr('y', node.y)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', rx)
      .attr('ry', rx)
      .attr('fill', isLeaf ? 'transparent' : fill)
      .attr('stroke', isLeaf ? 'none' : stroke)
      .attr('stroke-width', isLeaf ? 0 : strokeW);

    // Determine if description is visible (needed for label centering)
    const collapsed = node.hiddenCount != null && node.hiddenCount > 0;
    const showDesc = !hideDescriptions && !!node.description && !collapsed;

    // Compute wrapped text layout (same logic as layout.ts for sizing agreement)
    const textLayout = computeNodeText(
      node.label,
      node.description,
      node.depth,
      node.width,
      !!hideDescriptions || collapsed
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
      labelLineCount <= 1 && !isLeaf
        ? HEADER_HEIGHT
        : LABEL_LINE_HEIGHT * labelLineCount;
    const labelZoneHeight = showDesc ? labelZoneH : node.height;

    if (isLeaf) {
      nodeG
        .append('circle')
        .attr('class', 'mindmap-leaf-dot')
        .attr('cx', leafOnLeft ? node.x + node.width : node.x)
        .attr('cy', node.y + fontSize * BARE_LEAF_MID_EM)
        .attr('r', LEAF_DOT_RADIUS)
        .attr('fill', receded ? ground.groundStroke : hue);
    }

    // Label text — vertically centered in the label zone
    const centerX = !isLeaf
      ? node.x + node.width / 2
      : leafOnLeft
        ? node.x + node.width - LEAF_TEXT_INSET
        : node.x + LEAF_TEXT_INSET;
    const textAnchor = !isLeaf ? 'middle' : leafOnLeft ? 'end' : 'start';
    const fontWeight = isRoot ? 'bold' : node.depth === 1 ? '600' : 'normal';
    if (labelLineCount <= 1) {
      // Single line — simple centering
      // A bare leaf's ink starts on its top edge; a card centres its label.
      const labelY = isLeaf
        ? node.y + fontSize
        : node.y + labelZoneHeight / 2 + fontSize * 0.35;
      nodeG
        .append('text')
        .attr('x', centerX)
        .attr('y', labelY)
        .attr('text-anchor', textAnchor)
        .attr('font-size', fontSize)
        .attr('font-weight', fontWeight)
        .attr('fill', onFillText)
        // labelLineCount <= 1 implies labelLines has exactly one element here.
        .text(labelLines[0]!);
    } else {
      // Multi-line — use tspan elements
      // Visual text block spans from first baseline to last baseline:
      //   blockH = (lineCount - 1) * lineHeight
      // Center that block in the zone, then offset each baseline by fontSize * 0.35
      const blockH = LABEL_LINE_HEIGHT * (labelLineCount - 1);
      const firstBaselineY = isLeaf
        ? node.y + fontSize
        : node.y + labelZoneHeight / 2 - blockH / 2 + fontSize * 0.35;
      const textEl = nodeG
        .append('text')
        .attr('x', centerX)
        .attr('text-anchor', textAnchor)
        .attr('font-size', fontSize)
        .attr('font-weight', fontWeight)
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

    // Full text on the node when the label or description is cut short —
    // wrapping alone is not a cut.
    const drawnDesc = showDesc ? (node.description ?? []) : [];
    if (
      isCutShort(labelLines, [node.label]) ||
      isCutShort(descLines, drawnDesc.map(preprocessDescriptionLine))
    ) {
      nodeG.attr(FULL_TEXT_ATTR, fullNodeText(node.label, drawnDesc));
    }

    // Description — separator line + muted text below label
    if (showDesc && descLines.length > 0) {
      const separatorY = node.y + labelZoneH;

      // Separator line — a leaf has no card to divide
      if (!isLeaf)
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
          .attr('text-anchor', textAnchor)
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
            .attr('text-anchor', textAnchor)
            .attr('font-size', descFontSize)
            .attr('fill', onFillText);
          renderInlineText(textEl, processed, palette, descFontSize);
        }
      }
    }

    // Collapse bar — every render mode (conventions §3). An expanded node with
    // children carries its hover preview instead (#1741).
    if (node.hasChildren) {
      renderCollapseBar(nodeG, {
        expanded: !(node.hiddenCount != null && node.hiddenCount > 0),
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rx,
        fill: stroke,
        clipId: `collapse-clip-${node.id}`,
        prefix: 'mindmap',
        scale: ctx,
      });
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

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
  });
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
    parsed.title && parsed.options['no-title'] !== 'on'
      ? EMBEDDED_TITLE_BAND
      : 0;
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
    return extractExportSvg(container, theme, palette);
  });
}
