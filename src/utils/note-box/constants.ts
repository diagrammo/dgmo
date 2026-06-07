// ============================================================
// Shared note-box primitive — constants
// ============================================================
//
// Lifted verbatim from the sequence renderer's note constants
// (sequence/renderer.ts) so any chart type can draw the same
// folded-corner annotation box. Pure values — no chart coupling.

/** Hard ceiling on a note box's width (px) before text wraps. */
export const NOTE_MAX_W = 200;
/** Size of the folded top-right corner (px). */
export const NOTE_FOLD = 10;
/** Horizontal padding inside the box (px). */
export const NOTE_PAD_H = 8;
/** Vertical padding inside the box (px). */
export const NOTE_PAD_V = 6;
/** Note body font size (px). */
export const NOTE_FONT_SIZE = 10;
/** Line height for wrapped body lines (px). */
export const NOTE_LINE_H = 14;
/** Gap between an anchor shape's edge and its floated note box (px). The
 *  note is tethered to its node with a solid connector across this gap. */
export const NOTE_GAP = 22;
/** Hanging-indent width for bullet body text past the "•" glyph (px). */
export const NOTE_BULLET_INDENT = 10;
