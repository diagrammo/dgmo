// ============================================================
// Shared note-box primitive — geometry / wrapping
// ============================================================
//
// Pure measurement: turns a note body string into wrapped lines and
// a box width/height. Layout-agnostic — used both to reserve space
// pre-layout and to draw the box. Reuses the canonical text measurer
// and the bullet-aware wrapper so note text wraps identically to
// every other rich-text field in the library.

import { wrapDescriptionLines, type WrappedDescLine } from '../wrapped-desc';
import { measureText } from '../text-measure';
import {
  NOTE_MAX_W,
  NOTE_PAD_H,
  NOTE_PAD_V,
  NOTE_FOLD,
  NOTE_FONT_SIZE,
  NOTE_LINE_H,
  NOTE_BULLET_INDENT,
} from './constants';

export interface NoteBoxSize {
  /** Box width in px (clamped to `maxW`). */
  readonly width: number;
  /** Box height in px. */
  readonly height: number;
  /** Wrapped, bullet-classified body lines ready for drawing. */
  readonly lines: WrappedDescLine[];
}

export interface NoteBoxSizeOptions {
  readonly fontSize?: number;
  readonly maxW?: number;
}

/**
 * Normalize a source body line's leading bullet marker (`- ` / `* `) to
 * the canonical `• ` that {@link wrapDescriptionLines} recognizes for
 * hanging-indent rendering.
 */
function normalizeBulletLine(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '• ');
}

/**
 * Wrap a note body (lines joined by `\n`) into bullet-classified display
 * lines. Wrapping happens in pixel space via {@link measureText} so the
 * boundary matches the rendered glyph widths.
 */
export function wrapNoteBody(
  body: string,
  textMaxWidth: number,
  fontSize: number = NOTE_FONT_SIZE
): WrappedDescLine[] {
  const sourceLines = body.split('\n').map(normalizeBulletLine);
  return wrapDescriptionLines(sourceLines, textMaxWidth, (s) =>
    measureText(s, fontSize)
  );
}

/**
 * Compute a note box's wrapped lines and outer dimensions.
 *
 * width  = min(maxW, max(80, longestLine + padH*2 + fold))
 * height = lineCount * lineH + padV*2
 */
export function noteBoxSize(
  body: string,
  opts: NoteBoxSizeOptions = {}
): NoteBoxSize {
  const fontSize = opts.fontSize ?? NOTE_FONT_SIZE;
  const maxW = opts.maxW ?? NOTE_MAX_W;
  const textMaxWidth = maxW - NOTE_PAD_H * 2;
  const lines = wrapNoteBody(body, textMaxWidth, fontSize);

  let maxLineW = 0;
  for (const line of lines) {
    const indent = line.kind === 'plain' ? 0 : NOTE_BULLET_INDENT;
    const w = measureText(line.text, fontSize) + indent;
    if (w > maxLineW) maxLineW = w;
  }

  const width = Math.min(
    maxW,
    Math.max(80, maxLineW + NOTE_PAD_H * 2 + NOTE_FOLD)
  );
  const height = Math.max(1, lines.length) * NOTE_LINE_H + NOTE_PAD_V * 2;
  return { width, height, lines };
}
