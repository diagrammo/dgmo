// ============================================================
// The shared label engine's first rule (#1828): wrap a label to a width
// before cutting it. Truncation is the last resort, and only the last line
// pays for it; the caller keeps the full text for hover.
// ============================================================

import { measureText, truncateText, wrapTextToWidth } from './text-measure';

export interface FittedLabel {
  /** The lines to draw, top to bottom; at least one. */
  lines: string[];
  /** True when some text was cut and ends in `…`. */
  truncated: boolean;
}

/**
 * Fit `text` into at most `maxLines` lines of `maxWidth` px at `fontSize`.
 * Words wrap first. When the words need more lines than allowed, the last
 * line carries the rest and is cut with `…`. A single word wider than the
 * width is cut on its own line.
 */
export function fitLabel(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number
): FittedLabel {
  const limit = Math.max(1, Math.floor(maxLines));
  if (measureText(text, fontSize) <= maxWidth) {
    return { lines: [text], truncated: false };
  }
  const wrapped = wrapTextToWidth(text, fontSize, maxWidth);
  const kept =
    wrapped.length <= limit
      ? wrapped
      : [
          ...wrapped.slice(0, limit - 1),
          // The rest, joined, so truncation keeps as much as fits.
          wrapped.slice(limit - 1).join(' '),
        ];
  let truncated = wrapped.length > limit;
  const lines = kept.map((line) => {
    const cut = truncateText(line, fontSize, maxWidth);
    if (cut !== line) truncated = true;
    return cut;
  });
  return { lines, truncated };
}

/** The widest line of a fitted label, in px. */
export function fittedWidth(label: FittedLabel, fontSize: number): number {
  return Math.max(0, ...label.lines.map((l) => measureText(l, fontSize)));
}
