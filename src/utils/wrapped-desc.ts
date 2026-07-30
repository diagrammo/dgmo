// ============================================================
// Wrapped Description — shared bullet-aware text wrapping
// ============================================================

import { stripInlineMarkdown } from './inline-markdown';

/**
 * One rendered description line. `kind` controls horizontal placement and
 * whether the renderer draws a bullet glyph:
 *  - `plain`        — flush left at the description's left edge
 *  - `bullet-first` — "•" drawn at the left edge, body text at the bullet column
 *  - `bullet-cont`  — body continuation at the bullet column (no glyph)
 *
 * Splitting first-line bullet rendering into separate text elements lets
 * continuation lines align exactly under the first word past the bullet,
 * regardless of font-width estimation drift.
 */
export interface WrappedDescLine {
  text: string;
  kind: 'plain' | 'bullet-first' | 'bullet-cont';
}

/** Bullet prefix that triggers split-rendering with a hanging body column. */
export const BULLET_PREFIX = '• ';
/** Equivalent body-column width in characters (subtracted from wrap width). */
export const BULLET_INDENT_CHARS = 2;

/**
 * Optional measurer — returns the *display* length of a string in characters.
 * Defaults to `s.length`. Pass a markdown-aware function (stripping link
 * targets, emphasis markers, etc.) when wrapping rich text so the wrap
 * boundary matches what the user will actually see.
 */
export type LengthFn = (s: string) => number;

/**
 * A reflowed run of source lines that renders as one visual paragraph or one
 * bullet. `segments` are the hard-break-separated pieces of that block: each
 * wraps on its own, with no blank line between them.
 */
export interface DescBlock {
  kind: 'plain' | 'bullet';
  segments: string[];
  /** A blank source line separated this block from the previous one. */
  gapBefore: boolean;
}

/** Trailing `\` on a source line — markdown's hard line break. */
const HARD_BREAK = '\\';

/**
 * Group source lines into paragraphs and bullets (CommonMark-lite).
 *
 * Source line breaks are *not* rendered breaks. Consecutive plain lines reflow
 * into one paragraph, so prose can be wrapped in the editor at whatever column
 * is comfortable without fracturing the rendered card. The breaks that survive
 * are the ones a reader can see a reason for:
 *  - a blank line starts a new paragraph (`gapBefore`)
 *  - a `• ` line always starts its own block
 *  - a trailing `\` forces a break without ending the paragraph
 *
 * A plain line following a bullet continues that bullet (lazy continuation),
 * matching CommonMark; a blank line is how you get back out to prose.
 */
export function reflowDescriptionLines(lines: readonly string[]): DescBlock[] {
  const blocks: DescBlock[] = [];
  let open: DescBlock | null = null;
  let gapPending = false;
  let breakPending = false;

  const openBlock = (kind: DescBlock['kind'], text: string): DescBlock => {
    const block: DescBlock = {
      kind,
      segments: [text],
      gapBefore: gapPending && blocks.length > 0,
    };
    blocks.push(block);
    gapPending = false;
    return block;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) {
      // Blank line: end the paragraph, and remember to space the next one off.
      open = null;
      breakPending = false;
      gapPending = blocks.length > 0;
      continue;
    }
    const hard = line.endsWith(HARD_BREAK);
    const text = hard ? line.slice(0, -1).trimEnd() : line;
    if (!text) {
      // A bare `\` — a break with nothing on it. Honour the break, add no text.
      breakPending = hard;
      continue;
    }
    if (text.startsWith(BULLET_PREFIX)) {
      open = openBlock('bullet', text.slice(BULLET_PREFIX.length));
    } else if (open) {
      if (breakPending) open.segments.push(text);
      else open.segments[open.segments.length - 1] += ` ${text}`;
    } else {
      open = openBlock('plain', text);
    }
    breakPending = hard;
  }
  return blocks;
}

/**
 * Reflow and word-wrap description lines. Bullet lines (starting with "• ")
 * are split so the renderer can place the "•" glyph at the description's left
 * edge and the body text at a fixed bullet-body column — continuation lines
 * align exactly under the first word past the bullet without depending on
 * font-width estimation.
 *
 * Source lines are reflowed first — see {@link reflowDescriptionLines} — so
 * where the author wrapped their prose does not decide where the card wraps
 * it. A paragraph break emits an empty `plain` line, which every consumer
 * already renders as one line of vertical space.
 */
export function wrapDescriptionLines(
  lines: string[],
  charsPerLine: number,
  lengthFn: LengthFn = (s) => s.length
): WrappedDescLine[] {
  // Measure what renders, not what was typed — markdown markers are invisible.
  const measure: LengthFn = (s) => lengthFn(stripInlineMarkdown(s));
  const result: WrappedDescLine[] = [];
  for (const block of reflowDescriptionLines(lines)) {
    if (block.gapBefore && result.length > 0)
      result.push({ text: '', kind: 'plain' });
    if (block.kind === 'plain') {
      for (const segment of block.segments)
        for (const w of wrapPlainLine(segment, charsPerLine, measure))
          result.push({ text: w, kind: 'plain' });
      continue;
    }
    // The renderer draws the bullet glyph; we only wrap the body text.
    const bodyLimit = Math.max(8, charsPerLine - BULLET_INDENT_CHARS);
    let first = true;
    for (const segment of block.segments) {
      for (const w of wrapPlainLine(segment, bodyLimit, measure)) {
        result.push({ text: w, kind: first ? 'bullet-first' : 'bullet-cont' });
        first = false;
      }
    }
  }
  return result;
}

/**
 * Greedy word-wrap of a single string at the given character limit.
 * Long words are kept whole even if they exceed the limit (no mid-word break).
 */
function wrapPlainLine(
  line: string,
  charsPerLine: number,
  lengthFn: LengthFn
): string[] {
  const words = line.split(/\s+/);
  const result: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (lengthFn(test) > charsPerLine && current) {
      result.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) result.push(current);
  return result;
}
