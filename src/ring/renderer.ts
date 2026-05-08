// ============================================================
// Ring Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import {
  contrastText,
  getSeriesColors,
  shapeFill,
} from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { renderInlineText } from '../utils/inline-markdown';
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedRing, RingLayer } from './types';

// ── Constants ────────────────────────────────────────────────
const TITLE_AREA_HEIGHT = 50;
/** Side margin as fraction of viewport. */
const H_MARGIN_FRAC = 0.03;
/** Vertical breathing room above/below the diagram body. */
const V_MARGIN = 16;
/** Diameter share of usable width when no descriptions are present. */
const RING_AREA_FRAC_NO_DESC = 0.78;
/** Diameter share of usable width when a side description list is present. */
const RING_AREA_FRAC_WITH_DESC = 0.58;
/** Gap between the ring outer edge and the side description list. */
const DESC_GAP = 28;
/** Width of the colored accent bar to the left of each description. */
const DESC_ACCENT_WIDTH = 3;
/** Gap between accent bar and description text. */
const DESC_ACCENT_GAP = 12;
/** Approximate ratio of average glyph width to font size (sans-serif). */
const CHAR_WIDTH_RATIO = 0.55;
/** Pixel offset between bullet glyph column and body-text column. */
const BULLET_BODY_INDENT = 10;
/** Outer-edge stroke width per ring (Decision 14 — adjacent-ring contrast). */
const RING_STROKE_WIDTH = 1;
/**
 * Stroke opacity. High enough to actually separate adjacent tints; low
 * enough not to read as a hard outline. Tuned against the bold and pastel
 * palettes — see Decision 14.
 */
const RING_STROKE_OPACITY = 0.4;
/** Cap on visible description lines per layer in the side list. */
const DESC_LINE_CAP = 4;

const LABEL_FONT_MIN = 12;
const LABEL_FONT_MAX = 22;
const DESC_FONT_MIN = 11;
const DESC_FONT_MAX = 15;

/**
 * Render a ring diagram into the given container.
 */
export function renderRing(
  container: HTMLDivElement,
  parsed: ParsedRing,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  if (parsed.layers.length === 0) return;

  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const N = parsed.layers.length;
  const hasAnyDescription = parsed.layers.some((l) => l.description.length > 0);

  // ── Geometry ────────────────────────────────────────────────
  const titleH = parsed.title ? TITLE_AREA_HEIGHT : 0;
  const bodyTop = titleH + V_MARGIN;
  const bodyBottom = height - V_MARGIN;
  const bodyHeight = Math.max(60, bodyBottom - bodyTop);
  const sideMargin = width * H_MARGIN_FRAC;
  const usableWidth = width - sideMargin * 2;

  const ringAreaFrac = hasAnyDescription
    ? RING_AREA_FRAC_WITH_DESC
    : RING_AREA_FRAC_NO_DESC;
  const ringDiameterByWidth = usableWidth * ringAreaFrac;
  const ringDiameterByHeight = bodyHeight;
  const ringDiameter = Math.min(ringDiameterByWidth, ringDiameterByHeight);
  const outerRadius = ringDiameter / 2;
  const thickness = outerRadius / N;

  const cy = bodyTop + bodyHeight / 2;
  const cx = hasAnyDescription
    ? sideMargin + (usableWidth * ringAreaFrac) / 2
    : width / 2;

  // Description column (right side).
  const descAccentX = cx + outerRadius + DESC_GAP;
  const descTextX = descAccentX + DESC_ACCENT_WIDTH + DESC_ACCENT_GAP;
  const descTextWidth = Math.max(80, width - sideMargin - descTextX);

  // Label font scales with band thickness. Per Decision 9, when the natural
  // font would fall below LABEL_FONT_MIN we skip in-band labels for *all*
  // rings (since each ring shares the same band thickness) and rely on the
  // side description list — clamping silently produces overlapping labels.
  const naturalLabelFont = Math.round(thickness * 0.45);
  const inBandLabelsVisible = naturalLabelFont >= LABEL_FONT_MIN;
  const labelFont = clamp(naturalLabelFont, LABEL_FONT_MIN, LABEL_FONT_MAX);
  // Description font scales with how much horizontal text budget the side
  // column has, capped to the readable range — bigger canvases get bigger
  // descriptions, narrow canvases shrink to the floor.
  const descFont = hasAnyDescription
    ? clamp(Math.round(descTextWidth / 30), DESC_FONT_MIN, DESC_FONT_MAX)
    : DESC_FONT_MIN;
  const descLineHeight = Math.round(descFont * 1.35);

  // ── SVG root ────────────────────────────────────────────────
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  // Title.
  if (parsed.title) {
    const titleText = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber)
      .text(parsed.title)
      .style('cursor', onClickItem ? 'pointer' : 'default');
    if (onClickItem) {
      titleText.on('click', () => onClickItem(parsed.titleLineNumber));
    }
  }

  // ── Color resolution per layer ──────────────────────────────
  const seriesColors = getSeriesColors(palette);
  const resolveLayerColor = (layer: RingLayer, i: number): string => {
    if (layer.color) {
      const named = resolveColor(layer.color, palette);
      if (named) return named;
    }
    return seriesColors[i % seriesColors.length];
  };
  const solid = parsed.options['solid-fill'] === 'on';
  const layerColors = parsed.layers.map((l, i) => resolveLayerColor(l, i));
  const layerFills = layerColors.map((c) =>
    shapeFill(palette, c, isDark, { solid })
  );

  // ── Render rings ────────────────────────────────────────────
  // Each ring is its own annular shape — innermost is a <circle>, outer
  // rings are <path>s with two arcs and fill-rule="evenodd" carving a
  // donut hole. This keeps bands non-overlapping so opacity-based dimming
  // doesn't bleed the active ring's color through dimmed siblings.
  //
  // Source order = render order (innermost first). DOM order doesn't change
  // visuals because the bands don't overlap; click handlers land on the
  // visible band the cursor is over.
  const diagramG = svg.append('g').attr('class', 'ring-body');
  const strokeColor = palette.text;

  for (let i = 0; i < N; i++) {
    const layer = parsed.layers[i];
    const rOuter = (i + 1) * thickness;
    const rInner = i * thickness;
    const fill = layerFills[i];

    const layerG = diagramG
      .append('g')
      .attr('class', 'ring-layer')
      .attr('data-line-number', layer.lineNumber);

    if (onClickItem) {
      const ln = layer.lineNumber;
      layerG.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }

    if (i === 0) {
      // Innermost: filled disc, no donut hole.
      layerG
        .append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', rOuter)
        .attr('fill', fill)
        .attr('stroke', strokeColor)
        .attr('stroke-width', RING_STROKE_WIDTH)
        .attr('stroke-opacity', RING_STROKE_OPACITY);
    } else {
      // Annular band: outer arc + inner arc with evenodd fill rule.
      const d =
        `M ${cx - rOuter} ${cy}` +
        ` A ${rOuter} ${rOuter} 0 1 0 ${cx + rOuter} ${cy}` +
        ` A ${rOuter} ${rOuter} 0 1 0 ${cx - rOuter} ${cy}` +
        ` M ${cx - rInner} ${cy}` +
        ` A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy}` +
        ` A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy}` +
        ` Z`;
      layerG
        .append('path')
        .attr('d', d)
        .attr('fill-rule', 'evenodd')
        .attr('fill', fill)
        .attr('stroke', strokeColor)
        .attr('stroke-width', RING_STROKE_WIDTH)
        .attr('stroke-opacity', RING_STROKE_OPACITY);
    }
  }

  // ── Render labels (separate top-level group) ────────────────
  // Labels live in their own group AFTER all ring shapes so they paint on
  // top of every band — otherwise an outer ring's path covers earlier-drawn
  // labels that horizontally spill into its band. Each label is wrapped in
  // a <g class="ring-label-group" data-line-number=N> so the sync adapter
  // can still dim it alongside its layer.
  if (inBandLabelsVisible) {
    const labelsG = svg.append('g').attr('class', 'ring-labels');
    for (let i = 0; i < N; i++) {
      const layer = parsed.layers[i];
      const fill = layerFills[i];
      const isInnermost = i === 0;
      const labelY = isInnermost ? cy : cy - (i + 0.5) * thickness;
      // Font is sized purely by band thickness; horizontal overflow into
      // adjacent bands is allowed so long labels still appear.
      const fittedFont = labelFont;
      const textColor = contrastText(
        fill,
        palette.textOnFillLight,
        palette.textOnFillDark
      );
      const labelG = labelsG
        .append('g')
        .attr('class', 'ring-label-group')
        .attr('data-line-number', layer.lineNumber);
      const label = labelG
        .append('text')
        .attr('class', 'ring-label')
        .attr('x', cx)
        .attr('y', labelY)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', fittedFont)
        .attr('font-weight', 600)
        .style('pointer-events', 'none');
      renderInlineText(label, layer.label, palette, fittedFont);
    }
  }

  // ── Side description list ───────────────────────────────────
  // Always render when descriptions exist. Also render (label-only) when
  // in-band labels were skipped due to thin bands — otherwise the user has
  // no way to see ring names.
  if (hasAnyDescription || !inBandLabelsVisible) {
    renderSideDescriptions({
      parentG: svg.append('g').attr('class', 'ring-descriptions'),
      layers: parsed.layers,
      colors: layerColors,
      accentX: descAccentX,
      textX: descTextX,
      textWidth: descTextWidth,
      topY: bodyTop,
      bottomY: bodyBottom,
      descFont,
      descLineHeight,
      palette,
      onClickItem,
    });
  }
}

/**
 * Render for CLI/export (no click handlers).
 */
export function renderRingForExport(
  container: HTMLDivElement,
  parsed: ParsedRing,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderRing(container, parsed, palette, isDark, undefined, exportDims);
}

// ============================================================
// Side description list
// ============================================================

interface SideDescArgs {
  parentG: d3Selection.Selection<SVGGElement, unknown, null, undefined>;
  layers: RingLayer[];
  colors: string[];
  accentX: number;
  textX: number;
  textWidth: number;
  topY: number;
  bottomY: number;
  descFont: number;
  descLineHeight: number;
  palette: PaletteColors;
  onClickItem?: (lineNumber: number) => void;
}

function renderSideDescriptions(args: SideDescArgs): void {
  const {
    parentG,
    layers,
    colors,
    accentX,
    textX,
    textWidth,
    topY,
    bottomY,
    descFont,
    descLineHeight,
    palette,
    onClickItem,
  } = args;

  // Wrap each layer's description independently, then divide vertical space.
  const charsPerLine = Math.max(
    8,
    Math.floor(textWidth / (descFont * CHAR_WIDTH_RATIO))
  );
  const labelRowH = Math.round(descFont * 1.3);
  const gutter = Math.max(8, Math.round(descFont * 0.6));
  const availableH = bottomY - topY;

  // Shrink per-block line cap until the whole stack fits, so the last
  // entries don't paint past `bottomY` when N is large.
  const computeStack = (
    cap: number
  ): { wraps: WrappedDescLine[][]; blockHeights: number[]; totalH: number } => {
    const wraps = layers.map((l) =>
      truncateWithEllipsis(
        wrapDescriptionLines(l.description, charsPerLine),
        cap
      )
    );
    const blockHeights = wraps.map(
      (lines) => labelRowH + lines.length * descLineHeight
    );
    const totalH =
      blockHeights.reduce((s, h) => s + h, 0) +
      gutter * Math.max(0, layers.length - 1);
    return { wraps, blockHeights, totalH };
  };

  let stack = computeStack(DESC_LINE_CAP);
  for (
    let cap = DESC_LINE_CAP - 1;
    cap >= 0 && stack.totalH > availableH;
    cap--
  ) {
    stack = computeStack(cap);
  }
  const { wraps, blockHeights, totalH } = stack;
  let cursorY = topY + Math.max(0, (availableH - totalH) / 2);

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const lines = wraps[i];
    const blockH = blockHeights[i];

    const blockG = parentG
      .append('g')
      .attr('class', 'ring-desc')
      .attr('data-line-number', layer.lineNumber);

    if (onClickItem) {
      const ln = layer.lineNumber;
      blockG.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }

    blockG
      .append('rect')
      .attr('x', accentX)
      .attr('y', cursorY)
      .attr('width', DESC_ACCENT_WIDTH)
      .attr('height', blockH)
      .attr('rx', DESC_ACCENT_WIDTH / 2)
      .attr('fill', colors[i]);

    // Layer name as the description block heading.
    const labelEl = blockG
      .append('text')
      .attr('x', textX)
      .attr('y', cursorY + Math.round(labelRowH * 0.7))
      .attr('text-anchor', 'start')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', descFont)
      .attr('font-weight', 600);
    renderInlineText(labelEl, layer.label, palette, descFont);

    let lineY = cursorY + labelRowH + Math.round(descLineHeight * 0.4);
    for (const line of lines) {
      const isBullet =
        line.kind === 'bullet-first' || line.kind === 'bullet-cont';
      if (line.kind === 'bullet-first') {
        blockG
          .append('text')
          .attr('x', textX)
          .attr('y', lineY)
          .attr('text-anchor', 'start')
          .attr('fill', palette.textMuted)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', descFont)
          .text('•');
      }
      const textEl = blockG
        .append('text')
        .attr('x', isBullet ? textX + BULLET_BODY_INDENT : textX)
        .attr('y', lineY)
        .attr('text-anchor', 'start')
        .attr('fill', palette.textMuted)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', descFont);
      renderInlineText(textEl, line.text, palette, descFont);
      lineY += descLineHeight;
    }

    cursorY += blockH + gutter;
  }
}

function truncateWithEllipsis(
  lines: WrappedDescLine[],
  cap: number
): WrappedDescLine[] {
  if (lines.length <= cap) return lines.slice();
  const visible = lines.slice(0, cap);
  if (visible.length === 0) return visible;
  const last = visible[visible.length - 1];
  visible[visible.length - 1] = {
    ...last,
    text: last.text.endsWith('…') ? last.text : `${last.text} …`,
  };
  return visible;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
