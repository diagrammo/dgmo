// ============================================================
// Full text of a node whose drawn text was cut short
// ============================================================
//
// A renderer that truncates a label or description draws only part of the
// author's words. The node's `[data-line-number]` element then carries the
// whole of them in FULL_TEXT_ATTR, so a reader of the SVG (the app's preview
// navigation and its live region) can say the full text without guessing
// which drawn lines it stands for. A node drawn in full carries no attribute.

/** Attribute on a node's `[data-line-number]` element holding its full text. */
export const FULL_TEXT_ATTR = 'data-full-text';

const stripSpace = (s: string): string => s.replace(/\s+/g, '');

/**
 * True when `drawn` (the lines a renderer drew for `source`) leaves out any of
 * its characters. Wrapping at spaces, dashes or camelCase boundaries only moves
 * characters between lines, so whitespace is ignored; an ellipsis or a dropped
 * line changes the remaining characters and counts as cut.
 */
export function isCutShort(
  drawn: readonly string[],
  source: readonly string[]
): boolean {
  return stripSpace(drawn.join('')) !== stripSpace(source.join(''));
}

/** The node's full text: its label, then each description line, one a line. */
export function fullNodeText(
  label: string,
  description: readonly string[] = []
): string {
  return [label, ...description].join('\n');
}
