// ============================================================
// Whiteboard diagram — shape label wrapping (spec §39)
// ============================================================
//
// A shape's label wraps to the shape's inner width. Manual lines (indented
// body lines) are kept, and each wraps on its own. Arrow, line and free-text
// labels never wrap — they have no box to wrap to.
//
// Pure, no DOM: the renderer draws these lines, and the app canvas draws the
// same lines by calling the same function, so the CLI render and the canvas
// break a label at the same words.

import { wrapTextToWidth } from '../utils/text-measure';
import type { WhiteboardShape } from './types';

/** Shape label font size, px. */
export const WHITEBOARD_LABEL_FONT = 14;
/** Shape label line height, as a multiple of the font size. */
export const WHITEBOARD_LABEL_LINE = 1.25;
/** Space between a shape's side and its label, px. */
const LABEL_PAD = 8;
/** An ellipse loses this share of its width on each side to its curve. */
const ELLIPSE_INSET = 0.15;
/** Narrowest wrap width, px — a tiny shape still puts a word on a line. */
const MIN_WRAP = 20;

/** What the wrap needs to know about a shape: its kind and its width. */
export type WhiteboardLabelBox = Pick<WhiteboardShape, 'shape' | 'width'>;

/** Width a label wraps to inside `box`, px. */
export function whiteboardLabelWidth(box: WhiteboardLabelBox): number {
  const inset = box.shape === 'ellipse' ? box.width * ELLIPSE_INSET : 0;
  return Math.max(box.width - 2 * (LABEL_PAD + inset), MIN_WRAP);
}

/**
 * The lines a shape label is drawn as: each written line wrapped to the
 * shape's inner width at the label font. An empty written line stays one
 * empty drawn line. `''` gives `[]`.
 */
export function wrapWhiteboardLabel(
  label: string,
  box: WhiteboardLabelBox
): string[] {
  if (!label) return [];
  const width = whiteboardLabelWidth(box);
  return label
    .split('\n')
    .flatMap((line) =>
      line ? wrapTextToWidth(line, WHITEBOARD_LABEL_FONT, width) : ['']
    );
}
