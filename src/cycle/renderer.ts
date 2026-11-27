// ============================================================
// Cycle Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { fillModeFromOptions } from '../utils/parsing';
import { FONT_FAMILY } from '../fonts';
import { growChartFrame } from '../utils/chart-frame';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
  FRAME_BODY_TOP,
  LEGEND_BODY_GAP,
} from '../utils/title-constants';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { ARROWHEAD_HEIGHT, ARROWHEAD_WIDTH } from '../utils/visual-conventions';
import { renderIntegratedLegend } from '../utils/legend-integration';
import type {
  LegendCallbacks,
  ControlsGroupToggle,
  LegendGroupData,
} from '../utils/legend-types';
import {
  keepUsedTagValues,
  resolveActiveTagGroup,
  resolveTagColor,
  tagAttrKey,
  UNTAGGED_TAG_COLOR,
  type TagGroup,
} from '../utils/tag-groups';
import { contrastText, shapeFill } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { renderInlineText } from '../utils/inline-markdown';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { CompactViewState } from '../sharing';
import {
  DEFAULT_EDGE_WIDTH,
  MIN_EDGE_WIDTH,
  arrowHeadLength,
  type ParsedCycle,
} from './types';
import {
  DESC_MAX_LINES,
  circleLabelFont,
  computeCycleLayout,
  fitCenterText,
  headerHeight,
  labelLineHeight,
  rectLabelFont,
  wrapEdgeLabelText,
} from './layout';
import type { WrappedDescLine } from './types';
import { FULL_TEXT_ATTR, fullNodeText, isCutShort } from '../utils/full-text';
import { ScaleContext } from '../utils/scaling';
import { measureText, truncateText } from '../utils/text-measure';
import { measureSvgContent } from '../utils/export-fit';

// ── Constants ────────────────────────────────────────────────
const DESC_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 13;
const DESC_LINE_HEIGHT = 15;
const TITLE_AREA_HEIGHT = 50;
/** Least room the drawn body keeps from the canvas edges (#2429). */
const BODY_EDGE_PAD = 6;
/** Re-layouts tried before the body is drawn as it stands. */
const MAX_FIT_PASSES = 6;
/** Smallest layout box a re-layout may ask for. */
const MIN_FIT_BOX = 120;
/** Least room text keeps from a rect step's edge (#2431). */
const RECT_TEXT_INSET = 3;
/** Least room text keeps from a circle step's outline (#2431). */
const CIRCLE_TEXT_INSET = 3;

export interface CycleRenderOptions {
  onClickItem?: (lineNumber: number) => void;
  exportDims?: D3ExportDimensions;
  viewState?: CompactViewState;
  hideDescriptions?: boolean;
  controlsExpanded?: boolean;
  onToggleDescriptions?: (active: boolean) => void;
  onToggleControlsExpand?: () => void;
  exportMode?: boolean;
  /** When 'app', the description toggle is hosted by the app overlay strip:
   *  the inline gear is suppressed and a controls row + anchor are reserved.
   *  Default (inline) renders the gear as before. */
  controlsHost?: 'app' | 'inline';
  /** The app's runtime tag switcher: names the tag group to colour by. Wins
   *  over a source `active-tag` line; `'none'` / empty turns colouring off. */
  tagOverride?: string;
}

/**
 * Render a cycle diagram into the given container.
 */
export function renderCycle(
  container: HTMLDivElement,
  parsed: ParsedCycle,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  viewState?: CompactViewState,
  renderOptions?: CycleRenderOptions
): void {
  if (parsed.nodes.length === 0) return;
  const fillMode = fillModeFromOptions(parsed.options ?? {});

  // Clear previous render
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const idealWidth = width;
  const sctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sTitleFontSize = sctx.text(TITLE_FONT_SIZE);
  const sTitleY = sctx.structural(TITLE_Y);
  const sTitleAreaHeight = sctx.structural(TITLE_AREA_HEIGHT);
  const sLegendHeight = sctx.structural(LEGEND_HEIGHT);

  const hideDescriptions =
    (renderOptions?.hideDescriptions ?? false) ||
    parsed.options['no-descriptions'] === 'true' ||
    viewState?.hd === true;
  const showDescriptions = !hideDescriptions;

  // Check if descriptions exist in the diagram
  const hasDescriptions =
    parsed.nodes.some((n) => n.description.length > 0) ||
    parsed.edges.some((e) => e.description.length > 0);
  // Tag legend (§1.3): one group pill per declared tag group; `no-legend` hides it.
  const activeGroup = resolveActiveTagGroup(
    parsed.tagGroups,
    parsed.options['active-tag'],
    renderOptions?.tagOverride
  );
  const hasTagLegend =
    parsed.tagGroups.length > 0 && parsed.options['no-legend'] !== 'on';
  // App-hosted: the descriptions toggle lives in the app overlay strip, so the
  // in-SVG controls row is only drawn inline.
  const appHostedControls = renderOptions?.controlsHost === 'app';
  const hasControlsLegend =
    !appHostedControls &&
    hasDescriptions &&
    !!renderOptions?.onToggleDescriptions;
  const hasLegend = hasControlsLegend || hasTagLegend;

  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const legendOffset = hasLegend ? sLegendHeight : 0;
  const layoutHeight =
    height - (showTitle ? sTitleAreaHeight : 0) - legendOffset;

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  if (sctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  let titleNode: SVGTextElement | null = null;
  if (showTitle) {
    const titleText = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', sTitleY)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber)
      .text(parsed.title)
      .style('cursor', onClickItem ? 'pointer' : 'default');
    titleNode = titleText.node();
    if (onClickItem) {
      titleText.on('click', () => onClickItem(parsed.titleLineNumber));
    }
  }

  // Legend (controls toggle for descriptions)
  if (hasLegend) {
    const controlsGroup: { toggles: ControlsGroupToggle[] } = {
      toggles: [
        {
          id: 'descriptions',
          type: 'toggle',
          label: 'Descriptions',
          active: !hideDescriptions,
          onToggle: () => {},
        },
      ],
    };
    const tagLegendGroups: LegendGroupData[] = hasTagLegend
      ? keepUsedTagValues(
          parsed.tagGroups.map((g) => ({
            name: g.name,
            entries: g.entries.map((e) => ({
              value: e.value,
              color: resolveColor(e.color, palette) ?? e.color,
            })),
          })),
          parsed.tagGroups,
          [...parsed.nodes, ...parsed.edges].map((x) => x.metadata)
        )
      : [];
    const legendCallbacks: LegendCallbacks = {
      ...(renderOptions?.onToggleControlsExpand !== undefined && {
        onControlsExpand: renderOptions.onToggleControlsExpand,
      }),
      onControlsToggle: (toggleId, active) => {
        if (
          toggleId === 'descriptions' &&
          renderOptions?.onToggleDescriptions
        ) {
          renderOptions.onToggleDescriptions(active);
        }
      },
    };
    const titleOffsetForLegend = showTitle ? sTitleAreaHeight : 0;
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0, ${titleOffsetForLegend + 4})`);
    renderIntegratedLegend(legendG, {
      frame: parsed.frame,
      groups: tagLegendGroups,
      activeGroup: hasTagLegend ? activeGroup : null,
      mode: renderOptions?.exportMode ? 'export' : 'preview',
      // Every other group as a pill beside the active capsule, so a click can
      // switch to it, as swot, family and c4 do. Export shows only the active
      // group (legend-layout drops the rest).
      showInactivePills: true,
      ...(hasControlsLegend && { controlsGroup }),
      ...(hasControlsLegend &&
        renderOptions?.controlsHost !== undefined && {
          controlsHost: renderOptions.controlsHost,
        }),
      ...(hasControlsLegend &&
        renderOptions?.controlsExpanded !== undefined && {
          controlsExpanded: renderOptions.controlsExpanded,
        }),
      callbacks: legendCallbacks,
      palette,
      isDark,
      width,
    });
  }

  // The body is drawn, measured, and drawn again in a smaller box while any
  // of it (ring, arrowheads, nodes, badges, labels) leaves the canvas (#2429).
  // A layout that already fits is drawn once, exactly as before.
  const drawBody = (layout: ReturnType<typeof computeCycleLayout>) => {
    // With a title the first thing drawn starts at a fixed line (#1838): the
    // shared body top, or the legend's bottom plus the shared gap. The layout
    // centres the circle in its box, so lift the group by the room above it.
    let diagramTop = (showTitle ? sTitleAreaHeight : 0) + legendOffset;
    if (showTitle) {
      let contentTop = Infinity;
      for (const n of layout.nodes)
        contentTop = Math.min(contentTop, n.y - n.height / 2);
      for (const le of layout.edges)
        if (le.label) contentTop = Math.min(contentTop, le.labelY - 12);
      if (Number.isFinite(contentTop))
        diagramTop =
          (hasLegend
            ? sTitleAreaHeight + 4 + sLegendHeight + LEGEND_BODY_GAP
            : FRAME_BODY_TOP) - contentTop;
    }
    const g = svg
      .append('g')
      .attr(
        'transform',
        `translate(${(width - layout.width) / 2}, ${diagramTop})`
      );

    // Defs for arrowheads
    const defs = svg.append('defs');

    // Resolve default node color: first palette color (uniform)
    const defaultNodeColor = palette.primary;

    // ── Arrowhead markers (per color+width, markerUnits=strokeWidth) ──
    const markerKeys = new Set<string>();
    for (const edge of parsed.edges) {
      const color = resolveEdgeColor(
        edge,
        parsed,
        palette,
        defaultNodeColor,
        activeGroup
      );
      const sw = Math.max(edge.width ?? DEFAULT_EDGE_WIDTH, MIN_EDGE_WIDTH);
      const key = `${color}|${sw}`;
      if (!markerKeys.has(key)) {
        markerKeys.add(key);
        ensureArrowMarker(defs, color, sw);
      }
    }

    // ── Render edges paths (below nodes); labels rendered later, on top ──
    const edgeLabelInfo: Array<{
      le: (typeof layout.edges)[number];
      edge: (typeof parsed.edges)[number];
    }> = [];
    for (let i = 0; i < layout.edges.length; i++) {
      // In-bounds by loop guard; layout.edges and parsed.edges are parallel arrays.
      const le = layout.edges[i]!;
      const edge = parsed.edges[i]!;
      const color = resolveEdgeColor(
        edge,
        parsed,
        palette,
        defaultNodeColor,
        activeGroup
      );
      const strokeWidth = Math.max(
        edge.width ?? DEFAULT_EDGE_WIDTH,
        MIN_EDGE_WIDTH
      );
      const markerId = arrowMarkerId(color, strokeWidth);

      const edgeG = g.append('g').attr('class', 'cycle-edge');

      if (edge.lineNumber) {
        edgeG.attr('data-line-number', edge.lineNumber);
      }
      // Endpoint node indices for baked-CSS connection-highlight.
      edgeG
        .attr('data-from', String(edge.sourceIndex))
        .attr('data-to', String(edge.targetIndex));

      const pathEl = edgeG
        .append('path')
        .attr('d', le.path)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeWidth)
        .attr('marker-end', `url(#${markerId})`);
      // A back edge (#2342) is dashed, so it reads as the way back rather than
      // the ring's own flow.
      if (edge.back) {
        edgeG.classed('cycle-back-edge', true);
        pathEl.attr(
          'stroke-dasharray',
          `${strokeWidth * BACK_EDGE_DASH} ${strokeWidth * BACK_EDGE_GAP}`
        );
      }

      if (onClickItem && edge.lineNumber) {
        const ln = edge.lineNumber;
        pathEl.style('cursor', 'pointer').on('click', () => onClickItem(ln));
      }

      edgeLabelInfo.push({ le, edge });
    }

    // ── Render nodes ──
    // Font floors are intentionally low (≈ half the natural size) so text keeps
    // shrinking alongside the shrinking nodes when the canvas is small. Higher
    // floors decouple text from shape scale, causing labels to overflow node
    // boundaries at small canvas sizes.
    const scaledNodeFont = rectLabelFont(layout.scale);
    const scaledEdgeLabelFont = Math.max(
      6,
      Math.round(EDGE_LABEL_FONT_SIZE * layout.scale)
    );
    const scaledCircleLabelFont = circleLabelFont(layout.scale);
    const scaledDescFont = Math.max(
      5,
      Math.round(DESC_FONT_SIZE * layout.scale)
    );
    const scaledDescLineH = Math.max(
      7,
      Math.round(DESC_LINE_HEIGHT * layout.scale)
    );
    const scaledEdgeLineH = Math.max(
      8,
      Math.round(DESC_LINE_HEIGHT * layout.scale)
    );

    for (let i = 0; i < layout.nodes.length; i++) {
      // In-bounds by loop guard; layout.nodes and parsed.nodes are parallel arrays.
      const ln = layout.nodes[i]!;
      const node = parsed.nodes[i]!;
      const solidColor = resolveStepColor(
        node,
        parsed.tagGroups,
        activeGroup,
        palette,
        defaultNodeColor
      );
      // Canonical 25% tinted fill via shapeFill() (or full intent when solid-fill is on).
      const fillColor = shapeFill(palette, solidColor, isDark, {
        mode: fillMode,
      });
      const textColor = contrastText(
        fillColor,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      // Description text sits on top of the node fill — must follow the same
      // contrast rule as the title, NOT use a fixed `palette.textMuted` gray
      // (which is only legible against bg/surface, not against saturated fills).
      const descColor = textColor;
      const nodeW = ln.width;
      const nodeH = ln.height;
      const wrappedDesc = ln.wrappedDesc;
      const hasDesc = showDescriptions && wrappedDesc.length > 0;

      const nodeG = g
        .append('g')
        .attr('class', 'cycle-node')
        .attr('data-line-number', node.lineNumber)
        // Node index for baked-CSS connection-highlight (cycle nodes have no
        // string id; edges key on the same index).
        .attr('data-node-index', String(i))
        .style('cursor', onClickItem ? 'pointer' : 'default');

      // `data-tag-<group>` mirrors the legend's `data-legend-entry`, so a legend
      // hover can light the steps of one value (the shared hover CSS pairs them).
      for (const [k, v] of Object.entries(node.metadata)) {
        if (parsed.tagGroups.some((g) => tagAttrKey(g.name) === k)) {
          nodeG.attr(`data-tag-${k}`, v.toLowerCase());
        }
      }

      if (onClickItem) {
        const lineNum = node.lineNumber;
        nodeG.on('click', () => onClickItem(lineNum));
      }

      // Text never leaves its shape (#2431): every line is fitted to the
      // width it has where it is drawn, and a cut line ends in `…`.
      let cut = isCutShort(ln.labelLines, [node.label]);
      const fitLine = (
        text: string,
        font: number,
        maxW: number,
        bold = false
      ): string => {
        const out = truncateText(text, font, Math.max(0, maxW), { bold });
        if (out !== text) cut = true;
        return out;
      };
      const appendLine = (
        x: number,
        y: number,
        anchor: 'start' | 'middle',
        font: number,
        color: string,
        text: string,
        markdownFont: number,
        bold: boolean
      ) => {
        const el = nodeG
          .append('text')
          .attr('x', x)
          .attr('y', y)
          .attr('text-anchor', anchor)
          .attr('fill', color)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', font);
        if (bold) el.attr('font-weight', 'bold');
        renderInlineText(el, text, palette, markdownFont);
      };

      if (ln.isCircle) {
        // ── Circle node shape ──
        const r = nodeW / 2;
        nodeG
          .append('circle')
          .attr('cx', ln.x)
          .attr('cy', ln.y)
          .attr('r', r)
          .attr('fill', fillColor)
          .attr('stroke', solidColor)
          .attr('stroke-width', 2);

        // The chord a line of text may use at baseline y: the circle's width
        // at the line's top or bottom, whichever is narrower. Null once the
        // line would leave the circle.
        const chordAt = (y: number, font: number): number | null => {
          const dy = Math.max(
            Math.abs(y - font * 0.8 - ln.y),
            Math.abs(y + font * 0.25 - ln.y)
          );
          if (dy >= r - CIRCLE_TEXT_INSET) return null;
          return 2 * Math.sqrt(r * r - dy * dy) - 2 * CIRCLE_TEXT_INSET;
        };
        const labelFont = scaledCircleLabelFont;
        const nameLineH = labelLineHeight(labelFont);
        const nameLines = ln.labelLines.length;

        if (hasDesc) {
          // Label + descriptions vertically centered in circle. The name
          // always draws; description lines past the circle's height are
          // dropped, the last kept one cut with `…`.
          const nameBlockH = labelFont + (nameLines - 1) * nameLineH + 4;
          const roomH = 2 * (r - CIRCLE_TEXT_INSET) * 0.85 - nameBlockH;
          const maxDesc = Math.max(0, Math.floor(roomH / scaledDescLineH));
          const descLines =
            wrappedDesc.length <= maxDesc
              ? wrappedDesc.map((l) => l.text)
              : wrappedDesc
                  .slice(0, maxDesc)
                  .map((l, li) => (li === maxDesc - 1 ? `${l.text}…` : l.text));
          if (descLines.length < wrappedDesc.length) cut = true;
          const blockH = nameBlockH + descLines.length * scaledDescLineH;
          const startY = ln.y - blockH / 2 + labelFont;

          ln.labelLines.forEach((line, li) => {
            const y = startY + li * nameLineH;
            const w = chordAt(y, labelFont);
            if (w === null) {
              cut = true;
              return;
            }
            appendLine(
              ln.x,
              y,
              'middle',
              labelFont,
              textColor,
              fitLine(line, labelFont, w, true),
              labelFont,
              true
            );
          });

          let descY =
            startY + (nameLines - 1) * nameLineH + scaledDescLineH + 4;
          for (const line of descLines) {
            const w = chordAt(descY, scaledDescFont);
            if (w === null) {
              cut = true;
              break;
            }
            appendLine(
              ln.x,
              descY,
              'middle',
              scaledDescFont,
              descColor,
              fitLine(line, scaledDescFont, w),
              DESC_FONT_SIZE,
              false
            );
            descY += scaledDescLineH;
          }
        } else {
          // Label centered in circle
          const firstY =
            ln.y - ((nameLines - 1) * nameLineH) / 2 + labelFont / 3;
          ln.labelLines.forEach((line, li) => {
            const y = firstY + li * nameLineH;
            const w = chordAt(y, labelFont);
            if (w === null) {
              cut = true;
              return;
            }
            appendLine(
              ln.x,
              y,
              'middle',
              labelFont,
              textColor,
              fitLine(line, labelFont, w, true),
              labelFont,
              true
            );
          });
        }
      } else {
        // ── Rectangular node shape ──
        const rx = 6;
        nodeG
          .append('rect')
          .attr('x', ln.x - nodeW / 2)
          .attr('y', ln.y - nodeH / 2)
          .attr('width', nodeW)
          .attr('height', nodeH)
          .attr('rx', rx)
          .attr('ry', rx)
          .attr('fill', fillColor)
          .attr('stroke', solidColor)
          .attr('stroke-width', 2);

        const nameLineH = labelLineHeight(scaledNodeFont);
        const nameLines = ln.labelLines.length;
        const nameW = nodeW - 2 * RECT_TEXT_INSET;
        const drawName = (centerY: number) => {
          const firstY =
            centerY - ((nameLines - 1) * nameLineH) / 2 + scaledNodeFont / 3;
          ln.labelLines.forEach((line, li) =>
            appendLine(
              ln.x,
              firstY + li * nameLineH,
              'middle',
              scaledNodeFont,
              textColor,
              fitLine(line, scaledNodeFont, nameW, true),
              scaledNodeFont,
              true
            )
          );
        };

        if (hasDesc) {
          // ── Described node: header + separator + description ──
          const headerH = headerHeight(nameLines, layout.scale);
          drawName(ln.y - nodeH / 2 + headerH / 2);

          const sepY = ln.y - nodeH / 2 + headerH;
          nodeG
            .append('line')
            .attr('x1', ln.x - nodeW / 2)
            .attr('y1', sepY)
            .attr('x2', ln.x + nodeW / 2)
            .attr('y2', sepY)
            .attr('stroke', fillMode === 'solid' ? descColor : solidColor)
            .attr('stroke-opacity', 0.3)
            .attr('stroke-width', 1);

          const descStartY = sepY + 4 + scaledDescFont;
          const descPadX = Math.max(8, 12 * layout.scale);
          const descX = ln.x - nodeW / 2 + descPadX;
          const descRight = ln.x + nodeW / 2 - RECT_TEXT_INSET;
          const descBottom = ln.y + nodeH / 2 - RECT_TEXT_INSET;
          // Bullet body column — body of bullet items + their continuations
          // share this x so wrapped text aligns under the first word past "•".
          const bulletBodyX = descX + Math.max(8, 12 * layout.scale);
          const fits = (li: number) =>
            descStartY + li * scaledDescLineH + scaledDescFont * 0.25 <=
            descBottom;
          for (let li = 0; li < wrappedDesc.length; li++) {
            if (!fits(li)) {
              cut = true;
              break;
            }
            const line = wrappedDesc[li]!;
            const more = li < wrappedDesc.length - 1 && !fits(li + 1);
            const lineY = descStartY + li * scaledDescLineH;
            const x =
              line.kind === 'bullet-first' || line.kind === 'bullet-cont'
                ? bulletBodyX
                : descX;
            const text = fitLine(
              more ? `${line.text}…` : line.text,
              scaledDescFont,
              descRight - x
            );
            if (line.kind === 'bullet-first') {
              // Bullet glyph as its own text element at descX
              nodeG
                .append('text')
                .attr('x', descX)
                .attr('y', lineY)
                .attr('text-anchor', 'start')
                .attr('fill', descColor)
                .attr('font-family', FONT_FAMILY)
                .attr('font-size', scaledDescFont)
                .text('•');
            }
            appendLine(
              x,
              lineY,
              'start',
              scaledDescFont,
              descColor,
              text,
              DESC_FONT_SIZE,
              false
            );
          }
        } else {
          // ── Plain node: label centered ──
          drawName(ln.y);
        }
      }

      // A cut name or description keeps its full text for hover and screen
      // readers (utils/full-text.ts); a node drawn in full carries none.
      if (cut || isDescCut(wrappedDesc, node.description, hasDesc))
        nodeG.attr(FULL_TEXT_ATTR, fullNodeText(node.label, node.description));
    }

    // ── Step numbers (autonumber): a badge on each node's outer edge ──
    if (parsed.options['autonumber'] === 'on') {
      const badgeR = Math.max(7, 10 * layout.scale);
      const badgeFont = Math.max(7, Math.round(11 * layout.scale));
      const badgeLayer = g.append('g').attr('class', 'cycle-step-numbers');
      for (let i = 0; i < layout.nodes.length; i++) {
        const ln = layout.nodes[i]!;
        const node = parsed.nodes[i]!;
        const solidColor = resolveStepColor(
          node,
          parsed.tagGroups,
          activeGroup,
          palette,
          defaultNodeColor
        );
        // The badge sits on the node's outline, on the side facing away from
        // the ring's centre. The ring's arrows leave and enter along the
        // tangent, so that side is the one place they never cross.
        const ux = Math.cos(ln.angle);
        const uy = Math.sin(ln.angle);
        const reach = ln.isCircle
          ? ln.width / 2
          : Math.min(
              ux === 0 ? Infinity : ln.width / 2 / Math.abs(ux),
              uy === 0 ? Infinity : ln.height / 2 / Math.abs(uy)
            );
        const bx = ln.x + ux * (reach + badgeR * 0.4);
        const by = ln.y + uy * (reach + badgeR * 0.4);
        badgeLayer
          .append('circle')
          .attr('cx', bx)
          .attr('cy', by)
          .attr('r', badgeR)
          .attr('fill', solidColor)
          .attr('stroke', palette.bg)
          .attr('stroke-width', 2);
        badgeLayer
          .append('text')
          .attr('x', bx)
          .attr('y', by + badgeFont / 3)
          .attr('text-anchor', 'middle')
          .attr('fill', contrastText(solidColor, '#ffffff', '#000000'))
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', badgeFont)
          .attr('font-weight', 'bold')
          .text(String(i + 1));
      }
    }

    // ── Centre text: in the middle of the ring, inside its clearance ──
    const centerText = parsed.options['center'];
    if (centerText) {
      const fit = fitCenterText(centerText, layout.nodes, layout.radius);
      const { font, lines, lineHeight } = fit;
      const drawCenterLine = (parent: typeof g, y: number, text: string) =>
        parent
          .append('text')
          .attr('class', 'cycle-center')
          .attr('x', layout.cx)
          .attr('y', y)
          .attr('text-anchor', 'middle')
          .attr('fill', palette.text)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', font)
          .attr('font-weight', 'bold')
          .text(text);
      if (lines.length === 1 && !fit.truncated) {
        drawCenterLine(g, layout.cy + font / 3, lines[0]!);
      } else {
        // Wrapped (#2431): one text per line, the block centred on the ring.
        const block = g.append('g').attr('class', 'cycle-center-block');
        if (fit.truncated) block.attr(FULL_TEXT_ATTR, centerText);
        const firstY =
          layout.cy - ((lines.length - 1) * lineHeight) / 2 + font / 3;
        lines.forEach((line, li) =>
          drawCenterLine(block, firstY + li * lineHeight, line)
        );
      }
    }

    // ── Render edge labels (in a new group appended after nodes so they sit
    // on top of nodes in document order, regardless of append-time ordering). ──
    const labelLayer = g.append('g').attr('class', 'cycle-edge-labels');
    for (const { le, edge } of edgeLabelInfo) {
      const hasEdgeLabel = !!le.label;
      const hasEdgeDesc = showDescriptions && edge.description.length > 0;
      const { labelLines, descLines } = wrapEdgeLabelText(
        hasEdgeLabel ? le.label : undefined,
        hasEdgeDesc ? edge.description : []
      );
      if (labelLines.length === 0 && descLines.length === 0) continue;
      const edgeG = labelLayer.append('g').attr('class', 'cycle-edge');
      if (edge.lineNumber) {
        edgeG.attr('data-line-number', edge.lineNumber);
      }

      const normAngle =
        ((le.labelAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const isRight = normAngle < Math.PI * 0.4 || normAngle > Math.PI * 1.6;
      const isLeft = normAngle > Math.PI * 0.6 && normAngle < Math.PI * 1.4;
      const anchor = isRight ? 'start' : isLeft ? 'end' : 'middle';

      const lineCount = labelLines.length + descLines.length;
      // Measure the widest rendered line in pixels at the scaled edge-label font
      // so the background box matches the actual ink (same measurer the layout
      // uses to size + place the label).
      let maxLineW = 0;
      for (const l of labelLines)
        maxLineW = Math.max(
          maxLineW,
          // The label block is drawn at 600, the description lines below at the
          // default weight — so only these measure bold.
          measureText(l, scaledEdgeLabelFont, { bold: true })
        );
      for (const l of descLines)
        maxLineW = Math.max(maxLineW, measureText(l, scaledDescFont));

      const bgW = maxLineW + 12;
      const bgH = lineCount * scaledEdgeLineH + 6;
      const bgX = isRight
        ? le.labelX - 4
        : isLeft
          ? le.labelX - bgW + 4
          : le.labelX - bgW / 2;
      const bgY = le.labelY - scaledEdgeLabelFont - 2;

      edgeG
        .append('rect')
        .attr('x', bgX)
        .attr('y', bgY)
        .attr('width', bgW)
        .attr('height', bgH)
        .attr('rx', 3)
        .attr('fill', palette.bg)
        .attr('fill-opacity', 0.85);

      let textY = le.labelY;
      for (const line of labelLines) {
        const labelText = edgeG
          .append('text')
          .attr('x', le.labelX)
          .attr('y', textY)
          .attr('text-anchor', anchor)
          .attr('fill', palette.text)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', scaledEdgeLabelFont)
          .attr('font-weight', 'bold');
        renderInlineText(labelText, line, palette, scaledEdgeLabelFont);
        textY += scaledEdgeLineH;
      }
      for (const line of descLines) {
        const descText = edgeG
          .append('text')
          .attr('x', le.labelX)
          .attr('y', textY)
          .attr('text-anchor', anchor)
          .attr('fill', palette.textMuted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', scaledDescFont);
        renderInlineText(descText, line, palette, scaledDescFont);
        textY += scaledEdgeLineH;
      }
    }
    return { g, defs };
  };

  // A titled body hangs from its fixed top line (#1838), so only the canvas
  // edge bounds its top; an untitled one stays below the legend.
  const minTop = showTitle
    ? BODY_EDGE_PAD
    : Math.max(BODY_EDGE_PAD, legendOffset);
  let boxW = width;
  let boxH = layoutHeight;
  for (let pass = 0; ; pass++) {
    const layout = computeCycleLayout(parsed, {
      width: boxW,
      height: boxH,
      hideDescriptions,
    });
    const drawn = drawBody(layout);
    if (pass === MAX_FIT_PASSES) break;
    const ext = measureSvgContent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${drawn.g.node()!.outerHTML}</svg>`
    ).box;
    if (!ext) break;
    const over = {
      top: Math.max(0, minTop - ext.y0),
      bottom: Math.max(0, ext.y1 - (height - BODY_EDGE_PAD)),
      left: Math.max(0, BODY_EDGE_PAD - ext.x0),
      right: Math.max(0, ext.x1 - (width - BODY_EDGE_PAD)),
    };
    const overY = over.top + over.bottom;
    const overX = Math.max(over.left, over.right);
    if (overY <= 0 && overX <= 0) break;
    const nextH =
      overY > 0
        ? // A titled body hangs from its top line, so a cut of the box lifts
          // the bottom by the same amount; an untitled one stays centred and
          // has to lose twice its worse side.
          boxH - (showTitle ? overY : 2 * Math.max(over.top, over.bottom)) - 1
        : boxH;
    const nextW = overX > 0 ? boxW - 2 * overX - 1 : boxW;
    if (nextH < MIN_FIT_BOX || nextW < MIN_FIT_BOX) break;
    drawn.g.remove();
    drawn.defs.remove();
    boxH = nextH;
    boxW = nextW;
  }

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportDims ? 'grow' : 'fit',
    title: titleNode,
  });
}

/**
 * Did the layout cut a rect step's description at DESC_MAX_LINES? Its last
 * kept line then ends in `…` that the author did not write.
 */
function isDescCut(
  wrapped: readonly WrappedDescLine[],
  description: readonly string[],
  hasDesc: boolean
): boolean {
  if (!hasDesc || wrapped.length !== DESC_MAX_LINES) return false;
  return (
    wrapped[wrapped.length - 1]!.text.endsWith('…') &&
    !description.join('').trimEnd().endsWith('…')
  );
}

/**
 * Render for CLI/export (no click handlers).
 */
export function renderCycleForExport(
  container: HTMLDivElement,
  parsed: ParsedCycle,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  viewState?: CompactViewState,
  exportMode?: boolean,
  tagOverride?: string
): void {
  renderCycle(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims,
    viewState,
    {
      ...(exportMode !== undefined && { exportMode }),
      ...(tagOverride !== undefined && { tagOverride }),
    }
  );
}

// ── Helpers ──────────────────────────────────────────────────

/** A step's solid colour: its own `color` wins, then the active tag group's
 *  colour for its value, then the palette default. */
function resolveStepColor(
  node: ParsedCycle['nodes'][0],
  tagGroups: readonly TagGroup[],
  activeGroup: string | null,
  palette: PaletteColors,
  defaultColor: string
): string {
  if (node.color) return resolveColor(node.color, palette) ?? defaultColor;
  const tagColor = resolveTagColor(
    { ...node.metadata },
    [...tagGroups],
    activeGroup
  );
  if (tagColor && tagColor !== UNTAGGED_TAG_COLOR) {
    return resolveColor(tagColor, palette) ?? tagColor;
  }
  return defaultColor;
}

function resolveEdgeColor(
  edge: ParsedCycle['edges'][0],
  parsed: ParsedCycle,
  palette: PaletteColors,
  defaultNodeColor: string,
  activeGroup: string | null
): string {
  if (edge.color) {
    return resolveColor(edge.color, palette) ?? defaultNodeColor;
  }
  // Inherit from source node (its own colour, else its tag colour)
  const sourceNode = parsed.nodes[edge.sourceIndex];
  if (sourceNode) {
    return resolveStepColor(
      sourceNode,
      parsed.tagGroups,
      activeGroup,
      palette,
      defaultNodeColor
    );
  }
  return defaultNodeColor;
}

/** Back-edge dash and gap, in multiples of the stroke width (#2342). */
const BACK_EDGE_DASH = 2.5;
const BACK_EDGE_GAP = 1.5;

/** Stable marker ID for a (color, strokeWidth) pair. */
function arrowMarkerId(color: string, strokeWidth: number): string {
  return `cycle-arrow-${color.replace('#', '')}-w${strokeWidth}`;
}

/**
 * Create an arrowhead marker using markerUnits="strokeWidth" (SVG default)
 * with per-edge dimensions.  The marker base automatically equals the stroke
 * width — no gaps or lollipop effects.  Marker dimensions are computed so
 * the rendered arrowhead length follows a sublinear formula:
 *
 *   rendered length = markerWidth × strokeWidth = arrowHeadLength(sw)
 *   → markerWidth = arrowHeadLength(sw) / sw
 *
 * The height is fixed at 1 strokeWidth unit so the base = stroke width.
 */
function ensureArrowMarker(
  defs: d3Selection.Selection<SVGDefsElement, unknown, null, undefined>,
  color: string,
  strokeWidth: number
): void {
  const id = arrowMarkerId(color, strokeWidth);
  // Marker dimensions in strokeWidth units.
  // Rendered size = mw × sw  (length)  and  mh × sw  (height).
  const mw = arrowHeadLength(strokeWidth) / strokeWidth;
  // Height follows the SHARED arrowhead's aspect ratio, floored at 1.5× the
  // stroke width so the head is always visibly wider than the line. It was a
  // flat ½ until 2026-08-28, which drew cycle's head a third slimmer than
  // every other chart's at the same stroke width.
  const mh = Math.max(1.5, mw * (ARROWHEAD_HEIGHT / ARROWHEAD_WIDTH));

  defs
    .append('marker')
    .attr('id', id)
    .attr('viewBox', `0 0 ${mw} ${mh}`)
    .attr('refX', mw * 0.1)
    .attr('refY', mh / 2)
    .attr('markerWidth', mw)
    .attr('markerHeight', mh)
    .attr('orient', 'auto')
    .append('polygon')
    .attr('points', `0,0 ${mw},${mh / 2} 0,${mh}`)
    .attr('fill', color);
}
