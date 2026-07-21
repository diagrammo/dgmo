// ============================================================
// Shared one-line header geometry — §1.9 `legend-inline`, decision #50.
//
// Both the data-chart path (charts-d3/shared.ts, SVG-string legend) and the
// structured-diagram renderers (DOM legend via renderIntegratedLegend) collapse
// a two-row header — centered title over a stacked legend — into ONE row: title
// left-aligned, legend flushed to the right edge, vertically centered on the
// title. This module owns the DECISION (fit-or-fall-back) and the GEOMETRY so no
// renderer hand-rolls it. Rendering stays per-path; this is pure math.
// ============================================================

import { LEGEND_HEIGHT } from './legend-constants';
import { measureText } from './text-measure';
import { TITLE_FONT_SIZE, TITLE_Y } from './title-constants';

/** Left inset for the inline title; matches the legend band's own 8px. */
export const INLINE_HEADER_PAD = 8;
/** Minimum gap between the inline title and the legend. */
export const INLINE_HEADER_GAP = 16;
/** Bold titles measure ~6% wider than the Helvetica-regular glyph table. */
const BOLD_WIDTH_FACTOR = 1.06;
/** A legend narrower than this beside the title isn't worth inlining. */
const MIN_INLINE_LEGEND_W = 48;

/** Bold-adjusted rendered width of a banner title. */
export function measureTitleWidth(
  title: string,
  fontSize: number = TITLE_FONT_SIZE
): number {
  return measureText(title, fontSize) * BOLD_WIDTH_FACTOR;
}

export interface InlineHeaderInput {
  /** Did the author ask for `legend-inline`? */
  requested: boolean;
  title: string;
  /** Is there actually a legend to relocate? (false ⇒ always stacked/centered) */
  hasLegend: boolean;
  /** Natural content width of the legend at one row (px). */
  legendWidth: number;
  /** Legend height at the probed width (px); > LEGEND_HEIGHT ⇒ it wrapped. */
  legendHeight: number;
  containerWidth: number;
  /** Stacked-mode banner-title band height (the renderer's `titleOffset`). */
  titleBandHeight: number;
  /** Stacked-mode legend reserved height incl. any gap. */
  legendReserve: number;
  /** Title text baseline Y (for centering the inline legend on the title). */
  titleBaselineY?: number;
  titleFontSize?: number;
  pad?: number;
  gap?: number;
}

export interface InlineHeaderGeometry {
  /** True ⇒ one-line header; false ⇒ the classic stacked/centered header. */
  inline: boolean;
  /** Title x and text-anchor to apply. */
  titleX: number;
  titleAnchor: 'start' | 'middle';
  /** Legend wrapper `<g>` translate. In stacked mode this is (0, titleBand). */
  legendX: number;
  legendY: number;
  /** Vertical space the header occupies — replaces `titleOffset + legendReserve`
   *  in the renderer's content-offset math (one band when inline). */
  headerHeight: number;
}

/**
 * Decide inline vs stacked and return the geometry for BOTH the title and the
 * legend wrapper, plus the header height the renderer should reserve. Falls back
 * to the stacked/centered header whenever the legend can't fit on one row beside
 * the title — so the caller can apply the result unconditionally.
 */
export function layoutInlineHeader(
  input: InlineHeaderInput
): InlineHeaderGeometry {
  const pad = input.pad ?? INLINE_HEADER_PAD;
  const gap = input.gap ?? INLINE_HEADER_GAP;
  const fontSize = input.titleFontSize ?? TITLE_FONT_SIZE;
  const baselineY = input.titleBaselineY ?? TITLE_Y;

  const stacked: InlineHeaderGeometry = {
    inline: false,
    titleX: input.containerWidth / 2,
    titleAnchor: 'middle',
    legendX: 0,
    legendY: input.titleBandHeight,
    headerHeight:
      input.titleBandHeight + (input.hasLegend ? input.legendReserve : 0),
  };

  if (!input.requested || !input.hasLegend) return stacked;

  const titleW = measureTitleWidth(input.title, fontSize);
  const titleRight = pad + titleW + gap;
  const avail = input.containerWidth - titleRight - pad;
  const fits =
    avail >= MIN_INLINE_LEGEND_W &&
    input.legendHeight <= LEGEND_HEIGHT + 1 &&
    input.legendWidth <= avail + 0.5;
  if (!fits) return stacked;

  return {
    inline: true,
    titleX: pad,
    titleAnchor: 'start',
    // Flush to the right edge; the fit test guarantees this clears the title.
    legendX: input.containerWidth - pad - input.legendWidth,
    // Center the legend row on the title's visual middle (cap-center ≈ baseline
    // − 0.36·fontSize).
    legendY: baselineY - fontSize * 0.36 - input.legendHeight / 2,
    headerHeight: input.titleBandHeight,
  };
}
