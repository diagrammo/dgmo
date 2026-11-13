// ============================================================
// Shared chart title constants
// All renderers import from here to stay in sync.
// ============================================================

export const TITLE_FONT_SIZE = 20;
export const TITLE_FONT_WEIGHT = 'bold';
export const TITLE_Y = 30;
export const TITLE_OFFSET = 40;

/**
 * Where the drawing starts under the title (#1838): the top of the first
 * thing drawn, in root units, when a chart has a title and no legend above
 * its drawing. Thirty under the title's baseline.
 */
export const FRAME_BODY_TOP = TITLE_Y + 30;

/**
 * The gap from the bottom of a legend drawn above the drawing to the top of
 * the drawing (#1838).
 */
export const LEGEND_BODY_GAP = 24;

/**
 * A drawing laid out with its own top margin `layoutTop`, placed at
 * `offsetY` and scaled by `scale`, starts at `offsetY + layoutTop * scale`.
 * This is how far to move it down, in the drawing's own units, so its top
 * lands on FRAME_BODY_TOP whatever the scale (#1838). Never negative.
 */
export function bodyBandShift(
  offsetY: number,
  scale: number,
  layoutTop: number
): number {
  return Math.max(0, (FRAME_BODY_TOP - offsetY) / scale - layoutTop);
}

/**
 * The largest scale at which a drawing `contentH` tall (its top margin
 * `layoutTop` included), placed at `offsetY`, fits a canvas `canvasBottom`
 * tall once `bodyBandShift` has moved its top onto FRAME_BODY_TOP.
 */
export function scaleUnderBand(
  canvasBottom: number,
  offsetY: number,
  contentH: number,
  layoutTop: number
): number {
  const room = canvasBottom - Math.max(FRAME_BODY_TOP, offsetY + layoutTop);
  return room / Math.max(1, contentH - layoutTop);
}
/**
 * The canvas edge a left- or right-aligned frame part sits in from (#1838):
 * title, subtitle, legend and footer share it.
 */
export const FRAME_INSET = 20;
/**
 * Chart types whose title is part of the face, drawn large and placed by the
 * chart itself. They keep it and ignore the alignment lines (owner,
 * 2026-11-13).
 */
export const HERO_TITLE_TYPES: readonly string[] = [
  'goal',
  'countdown',
  'body',
  'clock',
];
// A title wider than the canvas less this much a side wraps (#1718).
export const TITLE_SIDE_PAD = 12;
// Baseline-to-baseline step of a wrapped title's second line.
export const TITLE_LINE_HEIGHT = 24;

// Caption — supplementary banner text. In pert these size the header
// bands and inner padding of the analysis blocks (Field labels, Tornado,
// S-curve). Pixel `dy` (not `'1.2em'`) so layout math and rendered text
// never drift between JSDOM and resvg.
export const CAPTION_FONT_SIZE = 13;
export const CAPTION_LINE_HEIGHT = 18;
export const CAPTION_TOP_GAP = 12;
// Inner padding for the caption rectangle. X = horizontal inset from
// rect edge to bullet glyph; Y = vertical inset from rect top to first
// baseline.
export const CAPTION_BOX_PADDING_X = 16;
export const CAPTION_BOX_PADDING_Y = 12;
