// Cylinder cap sizes shared by c4 cards and whiteboard shapes. A leaf
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
