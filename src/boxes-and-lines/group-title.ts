// ============================================================
// Expanded group title: fit to the frame (#2423)
// ============================================================
//
// The title of an expanded group is drawn bold at GROUP_TITLE_FONT_SIZE,
// centred, first baseline GROUP_TITLE_LINE_H below the frame top
// (renderer.ts). A title wider than the frame wraps to at most
// GROUP_TITLE_MAX_LINES lines, then the last line is cut with "…" (the shared
// label engine, utils/fit-label.ts). Each line past the first needs
// GROUP_TITLE_LINE_H more room above the group's contents; the layout
// reserves it (reserveGroupTitleRoom in layout.ts). A title that fits on one
// line is returned as typed, so short names draw exactly as before.

import { fitLabel, type FittedLabel } from '../utils/fit-label';
import { measureText } from '../utils/text-measure';

export const GROUP_TITLE_FONT_SIZE = 14;
/** Baseline of the first line below the frame top, and the line pitch. */
export const GROUP_TITLE_LINE_H = 18;
/** Room kept between the title and each side of the frame. */
export const GROUP_TITLE_INSET = 8;
export const GROUP_TITLE_MAX_LINES = 3;

const BOLD = { bold: true } as const;

/** The lines an expanded group of `frameWidth` draws for `label`. */
export function fitGroupTitle(label: string, frameWidth: number): FittedLabel {
  return fitLabel(
    label,
    GROUP_TITLE_FONT_SIZE,
    Math.max(1, frameWidth - 2 * GROUP_TITLE_INSET),
    GROUP_TITLE_MAX_LINES,
    BOLD
  );
}

/** Height the wrapped title needs past the first line's (0 for one line). */
export function groupTitleExtraHeight(title: FittedLabel): number {
  return (title.lines.length - 1) * GROUP_TITLE_LINE_H;
}

/** Widest drawn line of the title, in px (bold). */
export function groupTitleWidth(title: FittedLabel): number {
  return Math.max(
    0,
    ...title.lines.map((l) => measureText(l, GROUP_TITLE_FONT_SIZE, BOLD))
  );
}
