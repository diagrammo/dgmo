// ============================================================
// Whiteboard diagram — shape label wrapping (spec §39)
// ============================================================
//
// A shape's label, and a sticky note's text, wraps to its inner width. Manual
// lines (indented body lines) are kept, and each wraps on its own. Arrow, line
// and free-text labels never wrap — they have no box to wrap to.
//
// What is DRAWN is the fit (#1225): the font steps down until the wrapped
// block fits the inner box, long words break only at the floor, and what
// still does not fit is cut at the last line that does, ending in an ellipsis.
//
// Pure, no DOM: the renderer draws these lines, and the app canvas draws the
// same lines by calling the same function, so the CLI render and the canvas
// break a label at the same words.

import { CYLINDER_RY, QUEUE_CAP } from '../shape-caps';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import type { WhiteboardNote, WhiteboardShape } from './types';

/** Shape label font size, px. */
export const WHITEBOARD_LABEL_FONT = 14;
/** Sticky note text font size, px — smaller than a shape label. */
export const WHITEBOARD_NOTE_FONT = 12;
/** Shape label line height, as a multiple of the font size. */
export const WHITEBOARD_LABEL_LINE = 1.25;
/** Space between a shape's side and its label, px. */
const LABEL_PAD = 8;
/** Space between a sticky note's edge and its text, px. */
export const WHITEBOARD_NOTE_PAD = 12;
/** An ellipse loses this share of its width on each side to its curve. */
const ELLIPSE_INSET = 0.15;
/** Narrowest wrap width, px — a tiny shape still puts a word on a line. */
const MIN_WRAP = 20;
/** Smallest font a label shrinks to before it is cut, px. */
export const WHITEBOARD_LABEL_MIN_FONT = 9;

/**
 * What the wrap needs to know about a shape or sticky note: its kind and its
 * width. A whole `WhiteboardShape` or `WhiteboardNote` fits.
 */
export type WhiteboardLabelBox =
  | Pick<WhiteboardShape, 'shape' | 'width'>
  | Pick<WhiteboardNote, 'kind' | 'width'>;

/** Width a label wraps to inside `box`, px. */
export function whiteboardLabelWidth(box: WhiteboardLabelBox): number {
  if ('kind' in box && box.kind === 'note') {
    return Math.max(box.width - 2 * WHITEBOARD_NOTE_PAD, MIN_WRAP);
  }
  if ('shape' in box && box.shape === 'queue') {
    // The body between the two caps: the back cap bulges QUEUE_CAP past the
    // left end, but the front cap is a whole ellipse, 2 × QUEUE_CAP wide, at
    // the right — text there runs under its outline.
    return Math.max(box.width - 2 * LABEL_PAD - 3 * QUEUE_CAP, MIN_WRAP);
  }
  const inset =
    'shape' in box && box.shape === 'ellipse' ? box.width * ELLIPSE_INSET : 0;
  return Math.max(box.width - 2 * (LABEL_PAD + inset), MIN_WRAP);
}

/**
 * How far a label's centre sits right of its box's centre, px (negative is
 * left). A queue's readable body is off-centre — its front cap takes twice the
 * room its back cap does — so its label moves left by half a cap. Every other
 * shape's label is centred.
 */
export function whiteboardLabelShift(box: WhiteboardLabelBox): number {
  return 'shape' in box && box.shape === 'queue' ? -QUEUE_CAP / 2 : 0;
}

/** What the fit needs: a label box plus its height. */
export type WhiteboardFitBox = WhiteboardLabelBox &
  Pick<WhiteboardShape, 'height'>;

/** Height a label fits inside `box`, px — the box less its padding, an
 *  ellipse's curve and a database's two caps. Never below zero. */
export function whiteboardLabelHeight(box: WhiteboardFitBox): number {
  if ('kind' in box && box.kind === 'note') {
    return Math.max(box.height - 2 * WHITEBOARD_NOTE_PAD, 0);
  }
  const shape = 'shape' in box ? box.shape : 'rectangle';
  const inset =
    shape === 'ellipse'
      ? box.height * ELLIPSE_INSET
      : shape === 'database'
        ? 2 * CYLINDER_RY
        : 0;
  return Math.max(box.height - 2 * (LABEL_PAD + inset), 0);
}

/**
 * The lines a shape label or a sticky note's text is drawn as: each written
 * line wrapped to the inner width at its font — the label font for a shape,
 * `WHITEBOARD_NOTE_FONT` for a note. An empty written line stays one empty
 * drawn line. `''` gives `[]`.
 */
export function wrapWhiteboardLabel(
  label: string,
  box: WhiteboardLabelBox
): string[] {
  if (!label) return [];
  const width = whiteboardLabelWidth(box);
  const font =
    'kind' in box && box.kind === 'note'
      ? WHITEBOARD_NOTE_FONT
      : WHITEBOARD_LABEL_FONT;
  return label
    .split('\n')
    .flatMap((line) => (line ? wrapTextToWidth(line, font, width) : ['']));
}

/**
 * The lines a shape label or a sticky note's text is DRAWN as, and the font
 * they are drawn at. From the full size (`WHITEBOARD_LABEL_FONT`, a note's
 * `WHITEBOARD_NOTE_FONT`) down to `WHITEBOARD_LABEL_MIN_FONT`, the first size
 * whose wrap fits the inner box in both width and height wins. At the floor,
 * a word wider than the box breaks inside itself, and lines past the last one
 * that fits are dropped, the last kept line ending in `…`. At least one line
 * is always kept. `''` gives no lines.
 */
export function fitWhiteboardLabel(
  label: string,
  box: WhiteboardFitBox
): { lines: string[]; font: number } {
  const isNote = 'kind' in box && box.kind === 'note';
  const full = isNote ? WHITEBOARD_NOTE_FONT : WHITEBOARD_LABEL_FONT;
  if (!label) return { lines: [], font: full };
  const width = whiteboardLabelWidth(box);
  const height = whiteboardLabelHeight(box);
  const wrap = (font: number, hardBreak: boolean): string[] =>
    label
      .split('\n')
      .flatMap((line) =>
        line ? wrapTextToWidth(line, font, width, { hardBreak }) : ['']
      );
  const tall = (n: number, font: number): boolean =>
    n * font * WHITEBOARD_LABEL_LINE > height;
  for (let font = full; font >= WHITEBOARD_LABEL_MIN_FONT; font--) {
    const lines = wrap(font, false);
    if (
      !tall(lines.length, font) &&
      lines.every((l) => measureText(l, font) <= width)
    )
      return { lines, font };
  }
  const font = WHITEBOARD_LABEL_MIN_FONT;
  const lines = wrap(font, true);
  const room = Math.max(1, Math.floor(height / (font * WHITEBOARD_LABEL_LINE)));
  if (lines.length <= room) return { lines, font };
  const kept = lines.slice(0, room);
  let last = kept[room - 1]!;
  while (last && measureText(`${last}\u2026`, font) > width)
    last = [...last].slice(0, -1).join('');
  kept[room - 1] = `${last.trimEnd()}\u2026`;
  return { lines: kept, font };
}
