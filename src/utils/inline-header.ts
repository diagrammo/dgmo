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

/**
 * Chart types that actually honour `legend-inline` (render title-left /
 * legend-right). Any other type gets a "not supported" warning (decision #50)
 * so the directive never silently misrepresents that it did something. Includes
 * kanban / journey-map (which pioneered the one-line header) and sitemap /
 * mindmap (inline in export; app-hosted header in preview).
 */
export const LEGEND_INLINE_SUPPORTED: ReadonlySet<string> = new Set([
  // data charts
  'bar',
  'line',
  'radar',
  'scatter',
  'function',
  // structured
  'state',
  'treemap',
  'block',
  'event-line',
  'boxes-and-lines',
  'er',
  'class',
  'family',
  'infra',
  'sequence',
  'sketch',
  'bracket',
  'gantt',
  'pert',
  'sitemap',
  'mindmap',
  'kanban',
  'journey-map',
]);

/** True when `<type>` renders `legend-inline` (else callers should warn). */
export function legendInlineSupported(type: string): boolean {
  return LEGEND_INLINE_SUPPORTED.has(type.toLowerCase());
}

/** Left inset for the inline title; matches the legend band's own 8px. */
export const INLINE_HEADER_PAD = 8;
/** Minimum gap between the inline title and the legend. */
export const INLINE_HEADER_GAP = 16;
/** A legend narrower than this beside the title isn't worth inlining. */
const MIN_INLINE_LEGEND_W = 48;

/**
 * Rendered width of a banner title, measured in the face it is drawn in.
 *
 * Every renderer draws the title at TITLE_FONT_WEIGHT (700), so this
 * measures against Inter Bold. It used to scale the Regular width by a flat
 * 1.06 guess, back when the glyph table was Helvetica and no bold advances
 * existed; the real Inter Bold/Regular ratio is ~1.034 and now comes from the
 * shipped TTFs (issue 167).
 */
export function measureTitleWidth(
  title: string,
  fontSize: number = TITLE_FONT_SIZE
): number {
  return measureText(title, fontSize, { bold: true });
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
