// ============================================================
// C4 — fit names, relationship labels and the title (#2426)
// ============================================================
//
// Owner rule (2026-11-26): a label never leaves its shape or the canvas. It
// wraps first; only the last allowed line is cut with "…" (the shared label
// engine, utils/fit-label.ts). A cut label keeps its full text in
// FULL_TEXT_ATTR on its `[data-line-number]` element — never an `<svg><title>`.
//
// Layout (computeC4NodeDimensions) and both renderers call the same functions
// with the same widths, so the height the layout reserves for a wrapped name
// is the height the renderer draws. A label that fits on one line is returned
// as typed, so short labels draw exactly as before.

import { fitLabel, type FittedLabel } from '../utils/fit-label';
import { measureText } from '../utils/text-measure';
import { QUEUE_CAP } from '../shape-caps';
import { LABEL_FONT_SIZE } from '../utils/visual-conventions';
import { TITLE_FONT_SIZE, TITLE_SIDE_PAD } from '../utils/title-constants';

const BOLD = { bold: true } as const;

// ── Element names ──

/** Most lines an element name wraps to before its last line is cut. */
export const C4_NAME_MAX_LINES = 3;
/** Pitch between wrapped name lines; the first line keeps the card's NAME_HEIGHT. */
export const C4_NAME_LINE_H = 17;
/** Room a name keeps from each side of the card (the divider's inset). */
const NAME_SIDE_INSET = 10;
/** Person stick figure plus its gap before the name (renderer PERSON_ICON_W + 6). */
export const C4_PERSON_NAME_INDENT = 26;

/** Width a name may use on a card `cardWidth` wide (the box the layout hands dagre). */
export function c4NameWidth(
  cardWidth: number,
  shape: string | undefined,
  isPerson: boolean
): number {
  const caps = shape === 'queue' ? QUEUE_CAP * 3 : 0;
  return Math.max(
    1,
    cardWidth -
      caps -
      2 * NAME_SIDE_INSET -
      (isPerson ? C4_PERSON_NAME_INDENT : 0)
  );
}

/** The lines a card draws for `name`, bold at LABEL_FONT_SIZE. */
export function fitC4Name(
  name: string,
  cardWidth: number,
  shape: string | undefined,
  isPerson: boolean
): FittedLabel {
  return fitLabel(
    name,
    LABEL_FONT_SIZE,
    c4NameWidth(cardWidth, shape, isPerson),
    C4_NAME_MAX_LINES,
    BOLD
  );
}

/** Height a wrapped name needs past its first line (0 for one line). */
export function c4NameExtraHeight(name: FittedLabel): number {
  return (name.lines.length - 1) * C4_NAME_LINE_H;
}

/** Widest drawn line of a fitted name, in px (bold). */
export function c4NameDrawnWidth(name: FittedLabel): number {
  return Math.max(
    0,
    ...name.lines.map((l) => measureText(l, LABEL_FONT_SIZE, BOLD))
  );
}

// ── Relationship labels ──

export const C4_EDGE_LABEL_FONT_SIZE = 11;
export const C4_EDGE_TECH_FONT_SIZE = 10;
/** Widest a relationship label (or its technology) is drawn before wrapping. */
export const C4_EDGE_LABEL_MAX_WIDTH = 200;
/** Most lines a relationship label wraps to before its last line is cut. */
export const C4_EDGE_LABEL_MAX_LINES = 3;
/** Pitch between wrapped relationship-label lines. */
export const C4_EDGE_LABEL_LINE_H = 14;

/** A relationship label fitted to its cap, with its knockout box size. */
export interface C4EdgeLabelBox {
  lines: string[];
  techText: string;
  bgW: number;
  bgH: number;
  /** True when the label or the technology was cut. */
  truncated: boolean;
  /** The author's words, for FULL_TEXT_ATTR when cut. */
  fullText: string;
}

export function fitC4EdgeLabel(
  label: string | undefined,
  technology: string | undefined
): C4EdgeLabelBox {
  const labelText = label ?? '';
  const rawTech = technology ? `[${technology}]` : '';
  const fitted = labelText
    ? fitLabel(
        labelText,
        C4_EDGE_LABEL_FONT_SIZE,
        C4_EDGE_LABEL_MAX_WIDTH,
        C4_EDGE_LABEL_MAX_LINES
      )
    : { lines: [], truncated: false };
  const tech = rawTech
    ? fitLabel(rawTech, C4_EDGE_TECH_FONT_SIZE, C4_EDGE_LABEL_MAX_WIDTH, 1)
    : { lines: [''], truncated: false };
  const techText = tech.lines[0] ?? '';
  const textW = Math.max(
    0,
    ...fitted.lines.map((l) => measureText(l, C4_EDGE_LABEL_FONT_SIZE)),
    measureText(techText, C4_EDGE_TECH_FONT_SIZE)
  );
  const n = fitted.lines.length;
  return {
    lines: fitted.lines,
    techText,
    bgW: textW + 12,
    bgH:
      (n > 0 ? 16 + (n - 1) * C4_EDGE_LABEL_LINE_H : 0) +
      (techText ? 14 : 0) +
      4,
    truncated: fitted.truncated || tech.truncated,
    fullText: [labelText, rawTech].filter(Boolean).join('\n'),
  };
}

/** Baseline of each label line and of the technology line, centred on `cy`. */
export function c4EdgeLabelBaselines(
  box: C4EdgeLabelBox,
  cy: number
): { lineYs: number[]; techY: number } {
  const n = box.lines.length;
  const first =
    cy +
    4 -
    (n > 0 && box.techText ? 4 : 0) -
    (Math.max(0, n - 1) * C4_EDGE_LABEL_LINE_H) / 2;
  const lineYs = box.lines.map((_, i) => first + i * C4_EDGE_LABEL_LINE_H);
  const techY = n > 0 ? first + (n - 1) * C4_EDGE_LABEL_LINE_H + 14 : cy + 4;
  return { lineYs, techY };
}

// ── Title ──

/** Most lines the chart title wraps to before its last line is cut. */
export const C4_TITLE_MAX_LINES = 2;

/** The title's lines on a canvas `width` wide (renderChartTitle's rule). */
export function fitC4Title(title: string, width: number): FittedLabel {
  return fitLabel(
    title,
    TITLE_FONT_SIZE,
    Math.max(1, width - 2 * TITLE_SIDE_PAD),
    C4_TITLE_MAX_LINES,
    BOLD
  );
}
