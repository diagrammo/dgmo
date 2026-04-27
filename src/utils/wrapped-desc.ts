// ============================================================
// Wrapped Description — shared bullet-aware text wrapping
// ============================================================

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
 * Word-wrap description lines. Bullet lines (starting with "• ") are split
 * so the renderer can place the "•" glyph at the description's left edge and
 * the body text at a fixed bullet-body column — continuation lines align
 * exactly under the first word past the bullet without depending on
 * font-width estimation.
 */
export function wrapDescriptionLines(
  lines: string[],
  charsPerLine: number
): WrappedDescLine[] {
  const result: WrappedDescLine[] = [];
  for (const line of lines) {
    if (!line.startsWith(BULLET_PREFIX)) {
      const wrapped = wrapPlainLine(line, charsPerLine);
      for (const w of wrapped) result.push({ text: w, kind: 'plain' });
      continue;
    }
    // Strip "• " — the renderer draws the bullet glyph; we only wrap the body.
    const body = line.slice(BULLET_PREFIX.length);
    const bodyLimit = Math.max(8, charsPerLine - BULLET_INDENT_CHARS);
    const wrapped = wrapPlainLine(body, bodyLimit);
    wrapped.forEach((w, i) => {
      result.push({ text: w, kind: i === 0 ? 'bullet-first' : 'bullet-cont' });
    });
  }
  return result;
}

/**
 * Greedy word-wrap of a single string at the given character limit.
 * Long words are kept whole even if they exceed the limit (no mid-word break).
 */
function wrapPlainLine(line: string, charsPerLine: number): string[] {
  const words = line.split(/\s+/);
  const result: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > charsPerLine && current) {
      result.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) result.push(current);
  return result;
}
