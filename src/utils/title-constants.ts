// ============================================================
// Shared chart title constants
// All renderers import from here to stay in sync.
// ============================================================

export const TITLE_FONT_SIZE = 20;
export const TITLE_FONT_WEIGHT = 'bold';
export const TITLE_Y = 30;
export const TITLE_OFFSET = 40;

// Caption — supplementary banner text. In pert these size the header
// bands and inner padding of the analysis blocks (Field labels, Tornado,
// S-curve). Pixel `dy` (not `'1.2em'`) so layout math and rendered text
// never drift between JSDOM and resvg.
export const CAPTION_FONT_SIZE = 13;
export const CAPTION_FONT_WEIGHT = 'normal';
export const CAPTION_LINE_HEIGHT = 18;
export const CAPTION_TOP_GAP = 12;
// Inner padding for the caption rectangle. X = horizontal inset from
// rect edge to bullet glyph; Y = vertical inset from rect top to first
// baseline.
export const CAPTION_BOX_PADDING_X = 16;
export const CAPTION_BOX_PADDING_Y = 12;
