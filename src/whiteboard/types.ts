// ============================================================
// Whiteboard diagram — Types (spec §39)
// ============================================================
//
// Free placement on an infinite canvas: shapes, free arrows and lines, free
// text, images and freehand ink. Every element carries absolute integer canvas pixels; the
// renderer crops to the content. Element order IS z-order (later draws on top),
// so the model keeps one ordered list rather than one list per kind.

import type { DgmoError } from '../diagnostics';
import type { InkPoint } from './ink-codec';

/**
 * Colour NAMES — never values. `ink` is the palette's text colour, so it flips
 * near-black ↔ near-white with the theme; every other name takes the palette's
 * own light or dark shade of that hue. `ink` is the default and never written
 * on a shape, arrow or text line.
 */
export const WHITEBOARD_COLORS = [
  'ink',
  'red',
  'green',
  'blue',
  'teal',
  'purple',
  'orange',
  'yellow',
  'cyan',
  'gray',
] as const;

export type WhiteboardColor = (typeof WHITEBOARD_COLORS)[number];

/** Boxed shapes — position + size + optional centred label. */
export const WHITEBOARD_SHAPE_KINDS = [
  'rectangle',
  'ellipse',
  'database',
  'queue',
] as const;

export type WhiteboardShapeKind = (typeof WHITEBOARD_SHAPE_KINDS)[number];

/** Every line-leading element keyword, in spec order. */
export const WHITEBOARD_ELEMENT_KEYWORDS = [
  ...WHITEBOARD_SHAPE_KINDS,
  'note',
  'arrow',
  'line',
  'text',
  'image',
  'ink',
] as const;

/**
 * Stroke styles for arrows and lines. `solid` is the default and never
 * written; `style:` in source accepts only the other values.
 */
export const WHITEBOARD_STROKE_STYLES = ['solid', 'dashed'] as const;

export type WhiteboardStrokeStyle = (typeof WHITEBOARD_STROKE_STYLES)[number];

export interface WhiteboardShape {
  readonly kind: 'shape';
  readonly shape: WhiteboardShapeKind;
  /** Top-left corner, canvas px. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Centred label; '' for none. */
  readonly label: string;
  readonly color: WhiteboardColor;
  readonly lineNumber: number;
}

/** A sticky note's size when `size:` is left off, px. */
export const WHITEBOARD_NOTE_WIDTH = 160;
export const WHITEBOARD_NOTE_HEIGHT = 99;
/** A sticky note's colour when `color:` is left off. */
export const WHITEBOARD_NOTE_COLOR: WhiteboardColor = 'yellow';

/**
 * A sticky note: a tinted card with its text top-left, wrapped to the card.
 * Notes are an overlay layer — `no-notes` (or the `showNotes` render option)
 * hides every one. An arrow or line end inside a note attaches to it.
 */
export interface WhiteboardNote {
  readonly kind: 'note';
  /** Top-left corner, canvas px. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The note's text; '' for an empty note. */
  readonly text: string;
  readonly color: WhiteboardColor;
  readonly lineNumber: number;
}

/** An arrow, point to point. Head at `to`. An end inside a shape attaches to it (`./geometry`). */
export interface WhiteboardArrow {
  readonly kind: 'arrow';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Label at the midpoint; '' for none. */
  readonly label: string;
  readonly color: WhiteboardColor;
  readonly style: WhiteboardStrokeStyle;
  readonly lineNumber: number;
}

/** A free line: an arrow without a head. */
export interface WhiteboardLine {
  readonly kind: 'line';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Label at the midpoint; '' for none. */
  readonly label: string;
  readonly color: WhiteboardColor;
  readonly style: WhiteboardStrokeStyle;
  readonly lineNumber: number;
}

/** Free text. `x`/`y` is the top-left of its first line. */
export interface WhiteboardText {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color: WhiteboardColor;
  readonly lineNumber: number;
}

/**
 * A pasted picture. `ref` is a relative path (`<diagram>.assets/<hash>.webp`)
 * or an `https://` URL; the renderer asks the host to resolve it and draws a
 * placeholder box when nobody can.
 */
export interface WhiteboardImage {
  readonly kind: 'image';
  readonly ref: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lineNumber: number;
}

/** One freehand stroke. `encoded` is kept verbatim so emit is byte-stable. */
export interface WhiteboardInk {
  readonly kind: 'ink';
  readonly color: WhiteboardColor;
  /** Nominal pen diameter, px (may be fractional). */
  readonly width: number;
  readonly encoded: string;
  readonly points: readonly InkPoint[];
  readonly lineNumber: number;
}

export type WhiteboardElement =
  | WhiteboardShape
  | WhiteboardNote
  | WhiteboardArrow
  | WhiteboardLine
  | WhiteboardText
  | WhiteboardImage
  | WhiteboardInk;

export interface WhiteboardOptions {
  /** §1.9 `no-title` — keep the title in the source, do not draw it. */
  readonly noTitle: boolean;
  /** `no-notes` — keep the sticky notes in the source, do not draw them. */
  readonly noNotes: boolean;
}

export interface ParsedWhiteboard {
  readonly type: 'whiteboard';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  /** Source order = draw order. */
  readonly elements: readonly WhiteboardElement[];
  readonly options: WhiteboardOptions;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

export function isWhiteboardColor(value: string): value is WhiteboardColor {
  return (WHITEBOARD_COLORS as readonly string[]).includes(value);
}

export function isWhiteboardShapeKind(
  value: string
): value is WhiteboardShapeKind {
  return (WHITEBOARD_SHAPE_KINDS as readonly string[]).includes(value);
}
