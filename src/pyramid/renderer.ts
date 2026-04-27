// ============================================================
// Pyramid Diagram — D3 SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { contrastText, getSeriesColors, mix } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { renderInlineText } from '../utils/inline-markdown';
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedPyramid, PyramidLayer } from './types';

// ── Constants ────────────────────────────────────────────────
const TITLE_AREA_HEIGHT = 50;
/** Side margin as fraction of viewport. */
const H_MARGIN_FRAC = 0.03;
/** Vertical breathing room above/below the pyramid body. */
const V_MARGIN = 16;
/** Max base-width fraction when no descriptions. */
const BASE_WIDTH_FRAC_NO_DESC = 0.78;
/** Pyramid width share when descriptions are on one side. */
const PYRAMID_SHARE_WITH_DESC = 0.58;
/** Pyramid width share when descriptions alternate sides. */
const PYRAMID_SHARE_ALTERNATE = 0.42;
/** Height-to-base-width ratio for the pyramid. Taller = more dramatic. */
const PITCH_RATIO = 0.85;
/** Gap between pyramid edge and description accent bar. */
const DESC_GAP = 28;
/** Width of the colored accent bar on the left of each description. */
const DESC_ACCENT_WIDTH = 3;
/** Gap between accent bar and description text. */
const DESC_ACCENT_GAP = 12;
/** Approximate ratio of average glyph width to font size (sans-serif). */
const CHAR_WIDTH_RATIO = 0.55;
/** Pixel offset between bullet glyph column and body-text column. */
const BULLET_BODY_INDENT = 10;

const LABEL_FONT_MIN = 12;
const LABEL_FONT_MAX = 22;
const DESC_FONT_MIN = 11;
const DESC_FONT_MAX = 15;

type Side = 'left' | 'right';

interface WrappedDescription {
  /** All wrapped lines, full content. */
  allLines: WrappedDescLine[];
  /** Whether the wrapped content exceeds the layer's band cap. */
  overflows: boolean;
  /** Visible line count for the short (truncated) variant. */
  shortLineCount: number;
}

/**
 * Render a pyramid diagram into the given container.
 */
export function renderPyramid(
  container: HTMLDivElement,
  parsed: ParsedPyramid,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  if (parsed.layers.length === 0) return;

  // Clear previous render
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const hasAnyDescription = parsed.layers.some((l) => l.description.length > 0);

  // ── Geometry (baseline, single-column layout) ───────────────
  const titleH = parsed.title ? TITLE_AREA_HEIGHT : 0;
  const bodyTop = titleH + V_MARGIN;
  const bodyBottom = height - V_MARGIN;
  const bodyHeight = Math.max(60, bodyBottom - bodyTop);
  const sideMargin = width * H_MARGIN_FRAC;
  const usableWidth = width - sideMargin * 2;

  const N = parsed.layers.length;

  // Probe layout: single-column first. If any description would overflow its
  // band at single-column width, flip to alternating to buy wider columns.
  const singleProbe = computeLayout({
    width,
    usableWidth,
    sideMargin,
    bodyTop,
    bodyHeight,
    layers: parsed.layers,
    hasDescription: hasAnyDescription,
    alternate: false,
  });

  const anyOverflow = singleProbe.wraps.some((w) => w.overflows);
  const useAlternate = anyOverflow && hasAnyDescription && N >= 2;

  const layout = useAlternate
    ? computeLayout({
        width,
        usableWidth,
        sideMargin,
        bodyTop,
        bodyHeight,
        layers: parsed.layers,
        hasDescription: true,
        alternate: true,
      })
    : singleProbe;

  // ── SVG root ────────────────────────────────────────────────
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  // Inline default: short description visible, full hidden. Highlight state
  // in the app overrides with higher specificity (`.dgmo-pyramid-layer-highlight.pyramid-desc-full`).
  svg
    .append('style')
    .text(
      '.pyramid-desc-full{display:none}.dgmo-pyramid-layer-highlight.pyramid-desc-short{display:none}.dgmo-pyramid-layer-highlight.pyramid-desc-full{display:inline}.dgmo-pyramid-hidden{display:none}'
    );

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', palette.bg);

  // Title
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

  // ── Layer colors ────────────────────────────────────────────
  const seriesColors = getSeriesColors(palette);
  const layerBase = isDark ? palette.surface : palette.bg;
  const resolveSolid = (layer: PyramidLayer, i: number): string => {
    if (layer.color) {
      const named = resolveColor(layer.color, palette);
      if (named) return named;
    }
    return seriesColors[i % seriesColors.length];
  };

  // ── Render layers ───────────────────────────────────────────
  const diagramG = svg.append('g').attr('class', 'pyramid-body');

  for (let i = 0; i < N; i++) {
    const layer = parsed.layers[i];
    const topEdgeY = layout.pyramidTop + i * layout.layerH;
    const botEdgeY = topEdgeY + layout.layerH;
    const topHalf = halfWidthAt(i, N, layout.baseWidth, parsed.inverted);
    const botHalf = halfWidthAt(i + 1, N, layout.baseWidth, parsed.inverted);

    const polyPoints = [
      [layout.pyramidCx - topHalf, topEdgeY],
      [layout.pyramidCx + topHalf, topEdgeY],
      [layout.pyramidCx + botHalf, botEdgeY],
      [layout.pyramidCx - botHalf, botEdgeY],
    ]
      .map((p) => `${p[0]},${p[1]}`)
      .join(' ');

    const solidColor = resolveSolid(layer, i);
    const fillColor = mix(solidColor, layerBase, 30);

    const layerG = diagramG
      .append('g')
      .attr('class', 'pyramid-layer')
      .attr('data-line-number', layer.lineNumber);

    if (onClickItem) {
      const ln = layer.lineNumber;
      layerG.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }

    layerG
      .append('polygon')
      .attr('points', polyPoints)
      .attr('fill', fillColor)
      .attr('stroke', solidColor)
      .attr('stroke-width', 2);

    const midY = (topEdgeY + botEdgeY) / 2;
    const labelFitsInside =
      Math.min(topHalf, botHalf) * 2 > layout.labelFont * 4;
    const textColor = labelFitsInside
      ? contrastText(fillColor, '#eceff4', '#2e3440')
      : palette.text;

    const labelText = layerG
      .append('text')
      .attr('x', layout.pyramidCx)
      .attr('y', midY)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', layout.labelFont)
      .attr('font-weight', 600);
    renderInlineText(labelText, layer.label, palette);

    // Description: render both short (truncated) and full variants.
    // CSS toggles visibility during highlight.
    if (layer.description.length > 0) {
      const side: Side = useAlternate
        ? i % 2 === 0
          ? 'right'
          : 'left'
        : 'right';
      const wrap = layout.wraps[i];
      renderLayerDescriptions(
        diagramG,
        layer,
        side,
        wrap,
        layout,
        midY,
        solidColor,
        palette,
        titleH + V_MARGIN,
        height - V_MARGIN,
        onClickItem
      );
    }
  }
}

/**
 * Render for CLI/export (no click handlers).
 */
export function renderPyramidForExport(
  container: HTMLDivElement,
  parsed: ParsedPyramid,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderPyramid(container, parsed, palette, isDark, undefined, exportDims);
}

// ============================================================
// Layout
// ============================================================

interface LayoutInput {
  width: number;
  usableWidth: number;
  sideMargin: number;
  bodyTop: number;
  bodyHeight: number;
  layers: PyramidLayer[];
  hasDescription: boolean;
  alternate: boolean;
}

interface PyramidLayout {
  alternate: boolean;
  baseWidth: number;
  pyramidCx: number;
  pyramidTop: number;
  pyramidH: number;
  layerH: number;
  labelFont: number;
  descFont: number;
  descLineHeight: number;
  /** Column widths: text-wrap budget, per side. */
  rightTextX: number;
  rightTextWidth: number;
  leftTextX: number;
  leftTextWidth: number;
  rightAccentX: number;
  leftAccentX: number;
  wraps: WrappedDescription[];
}

function computeLayout(input: LayoutInput): PyramidLayout {
  const {
    width,
    usableWidth,
    sideMargin,
    bodyTop,
    bodyHeight,
    layers,
    hasDescription,
    alternate,
  } = input;
  const N = layers.length;

  const pyramidShareFrac = hasDescription
    ? alternate
      ? PYRAMID_SHARE_ALTERNATE
      : PYRAMID_SHARE_WITH_DESC
    : BASE_WIDTH_FRAC_NO_DESC;
  const pyramidBandWidth = usableWidth * pyramidShareFrac;

  const maxBaseByHeight = bodyHeight / PITCH_RATIO;
  const baseWidth = Math.min(pyramidBandWidth, maxBaseByHeight);
  const pyramidH = baseWidth * PITCH_RATIO;

  let pyramidCx: number;
  if (!hasDescription) {
    pyramidCx = width / 2;
  } else if (alternate) {
    pyramidCx = width / 2;
  } else {
    pyramidCx = sideMargin + pyramidBandWidth / 2;
  }

  const pyramidTop = bodyTop + (bodyHeight - pyramidH) / 2;
  const layerH = pyramidH / N;

  // Font sizes scale with layer height.
  const labelFont = clamp(
    Math.round(layerH * 0.38),
    LABEL_FONT_MIN,
    LABEL_FONT_MAX
  );
  const descFont = clamp(
    Math.round(layerH * 0.22),
    DESC_FONT_MIN,
    DESC_FONT_MAX
  );
  const descLineHeight = Math.round(descFont * 1.35);

  // Description columns.
  // Right column: from right edge of pyramid (+ DESC_GAP) to (width - sideMargin).
  // Left column (alternate only): from sideMargin to left edge of pyramid (- DESC_GAP).
  const pyramidRightEdge = pyramidCx + baseWidth / 2;
  const pyramidLeftEdge = pyramidCx - baseWidth / 2;

  const rightAccentX = pyramidRightEdge + DESC_GAP;
  const rightTextX = rightAccentX + DESC_ACCENT_WIDTH + DESC_ACCENT_GAP;
  const rightTextWidth = Math.max(80, width - sideMargin - rightTextX);

  const leftAccentX = pyramidLeftEdge - DESC_GAP - DESC_ACCENT_WIDTH;
  const leftTextWidth = Math.max(
    80,
    leftAccentX - DESC_ACCENT_GAP - sideMargin
  );
  const leftTextX = sideMargin;

  // Per-layer wrapping (measurement pass).
  const wraps: WrappedDescription[] = layers.map((layer, i) => {
    if (layer.description.length === 0) {
      return { allLines: [], overflows: false, shortLineCount: 0 };
    }
    const side: Side = alternate ? (i % 2 === 0 ? 'right' : 'left') : 'right';
    const colWidth = side === 'right' ? rightTextWidth : leftTextWidth;
    const wrapped = wrapDescription(layer.description, colWidth, descFont);
    // Visible cap: lines that fit the layer band with a little breathing room.
    const bandCap = Math.max(1, Math.floor(layerH / descLineHeight) - 0);
    const overflows = wrapped.length > bandCap;
    const shortLineCount = overflows ? bandCap : wrapped.length;
    return { allLines: wrapped, overflows, shortLineCount };
  });

  return {
    alternate,
    baseWidth,
    pyramidCx,
    pyramidTop,
    pyramidH,
    layerH,
    labelFont,
    descFont,
    descLineHeight,
    rightTextX,
    rightTextWidth,
    leftTextX,
    leftTextWidth,
    rightAccentX,
    leftAccentX,
    wraps,
  };
}

function halfWidthAt(
  edgeIdx: number,
  n: number,
  baseWidth: number,
  inverted: boolean
): number {
  const topNarrow = !inverted;
  const frac = topNarrow ? edgeIdx / n : (n - edgeIdx) / n;
  return (frac * baseWidth) / 2;
}

// ============================================================
// Descriptions
// ============================================================

function renderLayerDescriptions(
  parentG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  layer: PyramidLayer,
  side: Side,
  wrap: WrappedDescription,
  layout: PyramidLayout,
  midY: number,
  accentColor: string,
  palette: PaletteColors,
  topBound: number,
  bottomBound: number,
  onClickItem?: (lineNumber: number) => void
): void {
  const { descFont, descLineHeight } = layout;
  const accentX = side === 'right' ? layout.rightAccentX : layout.leftAccentX;
  const textX = side === 'right' ? layout.rightTextX : layout.leftTextX;
  const textAnchor: 'start' | 'end' = side === 'right' ? 'start' : 'end';
  // For right-anchored (left-column) text, x is the right edge of the column.
  const textLineX =
    side === 'right' ? textX : layout.leftAccentX - DESC_ACCENT_GAP;
  // For right-side bullets, anchor the glyph at the column's left edge and
  // let body text flow rightward. For left-side bullets, the column sits to
  // the LEFT of the bar and plain text right-aligns to the bar — to keep
  // the visual block tight against the bar (rather than floating at the
  // canvas margin), measure the widest bullet line per variant and
  // right-anchor the bullet block as a whole. Hanging indent is preserved
  // because all bullet rows still share the same body-column x.
  const bulletColRightEdge = layout.leftAccentX - DESC_ACCENT_GAP;
  const computeBulletColLeftX = (lines: WrappedDescLine[]): number => {
    if (side === 'right') return layout.rightTextX;
    const charW = descFont * CHAR_WIDTH_RATIO;
    let maxBodyW = 0;
    for (const l of lines) {
      if (l.kind === 'bullet-first' || l.kind === 'bullet-cont') {
        maxBodyW = Math.max(maxBodyW, l.text.length * charW);
      }
    }
    return bulletColRightEdge - maxBodyW - BULLET_BODY_INDENT;
  };

  // Full-reveal budget: how many wrapped lines can fit between title and
  // bottom margin. Truncate beyond that.
  const availableH = bottomBound - topBound;
  const fullMaxLines = Math.max(1, Math.floor(availableH / descLineHeight));
  const fullLines = truncateWithEllipsis(wrap.allLines, fullMaxLines);

  // If the whole (full-budget) content fits the layer band, render once.
  if (!wrap.overflows) {
    renderDescriptionVariant({
      parentG,
      layer,
      lines: wrap.allLines,
      className: 'pyramid-desc',
      accentX,
      accentColor,
      textX: textLineX,
      textAnchor,
      side,
      bulletColLeftX: computeBulletColLeftX(wrap.allLines),
      midY,
      descFont,
      descLineHeight,
      palette,
      topBound,
      bottomBound,
      onClickItem,
      variant: 'short',
    });
    return;
  }

  // Overflow case: render short (visible by default) + full (revealed on highlight).
  const shortLines = buildShortLines(wrap);
  renderDescriptionVariant({
    parentG,
    layer,
    lines: shortLines,
    className: 'pyramid-desc pyramid-desc-short',
    accentX,
    accentColor,
    textX: textLineX,
    textAnchor,
    side,
    bulletColLeftX: computeBulletColLeftX(shortLines),
    midY,
    descFont,
    descLineHeight,
    palette,
    topBound,
    bottomBound,
    onClickItem,
    variant: 'short',
  });

  renderDescriptionVariant({
    parentG,
    layer,
    lines: fullLines,
    className: 'pyramid-desc pyramid-desc-full',
    accentX,
    accentColor,
    textX: textLineX,
    textAnchor,
    side,
    bulletColLeftX: computeBulletColLeftX(fullLines),
    midY,
    descFont,
    descLineHeight,
    palette,
    topBound,
    bottomBound,
    onClickItem,
    variant: 'full',
  });
}

function truncateWithEllipsis(
  lines: WrappedDescLine[],
  maxLines: number
): WrappedDescLine[] {
  if (lines.length <= maxLines) return lines.slice();
  const visible = lines.slice(0, maxLines);
  if (visible.length === 0) return visible;
  const last = visible[visible.length - 1];
  visible[visible.length - 1] = {
    ...last,
    text: last.text.endsWith('…') ? last.text : `${last.text} …`,
  };
  return visible;
}

function buildShortLines(wrap: WrappedDescription): WrappedDescLine[] {
  if (!wrap.overflows) return wrap.allLines.slice();
  const visible = wrap.allLines.slice(0, wrap.shortLineCount);
  if (visible.length === 0) return [];
  const last = visible[visible.length - 1];
  visible[visible.length - 1] = {
    ...last,
    text: last.text.endsWith('…') ? last.text : `${last.text} …`,
  };
  return visible;
}

interface RenderVariantArgs {
  parentG: d3Selection.Selection<SVGGElement, unknown, null, undefined>;
  layer: PyramidLayer;
  lines: WrappedDescLine[];
  className: string;
  accentX: number;
  accentColor: string;
  textX: number;
  textAnchor: 'start' | 'end';
  /**
   * Side of the pyramid the description sits on. Bullet lines are always
   * laid out left-to-right with the glyph at the column's left edge so
   * continuation lines align under the body — regardless of which side
   * the column is on.
   */
  side: Side;
  bulletColLeftX: number;
  midY: number;
  descFont: number;
  descLineHeight: number;
  palette: PaletteColors;
  topBound: number;
  bottomBound: number;
  onClickItem?: (lineNumber: number) => void;
  variant: 'short' | 'full';
}

function renderDescriptionVariant(args: RenderVariantArgs): void {
  const {
    parentG,
    layer,
    lines,
    className,
    accentX,
    accentColor,
    textX,
    textAnchor,
    bulletColLeftX,
    midY,
    descFont,
    descLineHeight,
    palette,
    topBound,
    bottomBound,
    onClickItem,
    variant,
  } = args;
  if (lines.length === 0) return;

  // Center the block on midY, but clamp so it stays between topBound/bottomBound.
  const totalH = lines.length * descLineHeight;
  let startY = midY - totalH / 2 + descLineHeight / 2;
  const accentPad = Math.max(4, Math.round(descFont * 0.3));
  const blockTop = startY - descLineHeight / 2 - accentPad;
  const blockBottom =
    startY +
    (lines.length - 1) * descLineHeight +
    descLineHeight / 2 +
    accentPad;

  let shift = 0;
  if (blockTop < topBound) shift = topBound - blockTop;
  else if (blockBottom > bottomBound) shift = bottomBound - blockBottom;
  startY += shift;

  const accentTop = startY - descLineHeight / 2 - accentPad;
  const accentH = totalH + accentPad * 2;

  const descG = parentG
    .append('g')
    .attr('class', className)
    .attr('data-line-number', layer.lineNumber)
    .attr('data-variant', variant);

  if (onClickItem) {
    const ln = layer.lineNumber;
    descG.style('cursor', 'pointer').on('click', () => onClickItem(ln));
  }

  descG
    .append('rect')
    .attr('x', accentX)
    .attr('y', accentTop)
    .attr('width', DESC_ACCENT_WIDTH)
    .attr('height', accentH)
    .attr('rx', DESC_ACCENT_WIDTH / 2)
    .attr('fill', accentColor);

  for (let j = 0; j < lines.length; j++) {
    const line = lines[j];
    const y = startY + j * descLineHeight;
    const isBullet =
      line.kind === 'bullet-first' || line.kind === 'bullet-cont';
    if (line.kind === 'bullet-first') {
      descG
        .append('text')
        .attr('x', bulletColLeftX)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', palette.text)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', descFont)
        .attr('font-weight', j === 0 ? 500 : 400)
        .text('•');
    }
    const t = descG
      .append('text')
      .attr('x', isBullet ? bulletColLeftX + BULLET_BODY_INDENT : textX)
      .attr('y', y)
      .attr('dy', '0.35em')
      .attr('text-anchor', isBullet ? 'start' : textAnchor)
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', descFont)
      .attr('font-weight', j === 0 ? 500 : 400);
    renderInlineText(t, line.text, palette);
  }
}

// ============================================================
// Text wrapping
// ============================================================

/**
 * Wrap a layer's description. Bullet lines (leading "- " or "• ") are split
 * by the shared helper into bullet-first / bullet-cont rows so the renderer
 * can place the glyph at the column edge and align continuation lines under
 * the body. Empty source lines render as a blank "plain" row to preserve
 * paragraph spacing.
 */
function wrapDescription(
  lines: string[],
  maxWidth: number,
  fontSize: number
): WrappedDescLine[] {
  const avgCharW = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(8, Math.floor(maxWidth / avgCharW));
  const normalized = lines.map((l) =>
    l.startsWith('- ') ? '• ' + l.slice(2) : l
  );
  const out: WrappedDescLine[] = [];
  for (const line of normalized) {
    if (line === '') {
      out.push({ text: '', kind: 'plain' });
      continue;
    }
    out.push(...wrapDescriptionLines([line], maxChars));
  }
  return out;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
