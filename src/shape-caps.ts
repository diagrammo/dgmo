// Shape tuning sizes for c4 cards, flowchart nodes, whiteboard shapes and sequence participants. A leaf
// module, so pure geometry can import them without the c4 renderer.

/** A database's (cylinder's) cap, half-height. */
export const CYLINDER_RY = 8;

/**
 * Half-width of a queue's end caps — a cylinder on its side (#654).
 *
 * The same deal as `CLOUD_BUMP`, on the other axis:
 * `computeC4NodeDimensions` adds `QUEUE_CAP * 2` to the width, so the caps
 * never sit under the name.
 *
 * 🔴 It was 8 and that was too shallow to READ — measured by rendering it,
 * not by reasoning about it. `CARD_RADIUS` is 6, so an 8px cap on a 250px
 * card is within a couple of pixels of the rounding every plain card already
 * has, and the queue came out indistinguishable from a box with no override:
 * the exact defect this change exists to fix, reintroduced at a smaller
 * scale. A shape override has to be legible at a glance or it is not an
 * override.
 */
export const QUEUE_CAP = 16;

/**
 * Depth of a document's wavy bottom edge: the flowchart `document` node and
 * the whiteboard `file` shape (which clamps it to a quarter of its height).
 */
export const DOCUMENT_WAVE = 10;

/**
 * A sequence database or cache participant's cap, half-height — and a
 * sequence queue's end-cap half-width. Smaller than `CYLINDER_RY` and
 * `QUEUE_CAP`: a participant box (120 × 50) is a quarter of a c4 card's
 * area. They were literals in the sequence renderer until #1732, which moved
 * them here so every cap size sits in this one file; adopting the c4 values
 * would redraw every sequence snapshot that has a cylinder.
 */
export const SEQUENCE_CYLINDER_RY = 7;
export const SEQUENCE_QUEUE_CAP = 10;

/**
 * How far each cloud lobe bulges past the card's text box (#654).
 *
 * 🔴 The outline stays INSIDE `w × h`, exactly as `drawCardRect` does — the
 * lobes reach the card's own edges and the text box is inset by this much top
 * and bottom. A shape that drew outside its node would overlap its neighbours,
 * because dagre spaces nodes by the box it was given.
 *
 * `computeC4NodeDimensions` adds `CLOUD_BUMP * 2` to a cloud's height, so the
 * inset is paid for rather than taken out of the card's padding.
 */
export const CLOUD_BUMP = 7;
