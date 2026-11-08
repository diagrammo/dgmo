// Cylinder cap sizes for c4 cards, whiteboard shapes and sequence participants. A leaf
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
 * Depth of a whiteboard file's wavy bottom edge, before clamping to a quarter
 * of its height — the flowchart document symbol's `DOC_WAVE_HEIGHT`.
 */
export const FILE_WAVE = 10;

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
