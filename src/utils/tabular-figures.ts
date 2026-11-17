// ============================================================
// Tabular figures for chart number labels (#2035)
// ============================================================
// A column of numbers lines up only when every digit has the same advance.
// The font cannot be trusted to do it: resvg ignores `font-variant-numeric:
// tabular-nums` and the font-feature-settings spelling (three spellings
// rasterised byte-identical to the plain render, 2026-11-16), and Safari
// drops the flag on SVG `<text>`. So the label is laid out as cells, the way
// the clock already does it (`fixedTimeCells` in clock/resolve.ts): every
// digit gets one uniform cell and is centred in it, and each run of other
// characters keeps its own measured width. One `<tspan x>` per cell, under a
// `text-anchor="middle"` parent, renders the same in every browser, in resvg
// (PNG) and in the PDF path.
//
// The cell is the widest digit of the face actually drawn, read from Inter's
// generated advance table, so a cell never squeezes a digit.

import { INTER_BOLD_W, INTER_REGULAR_W } from './inter-metrics';
import { measureText, type MeasureOpts } from './text-measure';

const DIGITS = '0123456789';

function widestDigit(table: Record<string, number>): number {
  let w = 0;
  for (const d of DIGITS) w = Math.max(w, table[d] ?? 0);
  return w;
}

/** Tabular digit cell width, as a fraction of font size. */
export const TABULAR_DIGIT_EM = widestDigit(INTER_REGULAR_W);
/** The same for the Bold face (weights 600 and above). */
export const TABULAR_DIGIT_EM_BOLD = widestDigit(INTER_BOLD_W);

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

export interface TabularCell {
  /** One digit, or a run of non-digit characters. */
  readonly ch: string;
  /** The cell's centre. */
  readonly x: number;
}

/** Split `text` into digit cells and non-digit runs, left edge at `x0`. */
export function tabularCells(
  text: string,
  x0: number,
  fontSize: number,
  opts?: MeasureOpts
): { cells: TabularCell[]; width: number } {
  const digit =
    (opts?.bold ? TABULAR_DIGIT_EM_BOLD : TABULAR_DIGIT_EM) * fontSize;
  const cells: TabularCell[] = [];
  let x = x0;
  let run = '';
  const flush = () => {
    if (!run) return;
    const w = measureText(run, fontSize, opts);
    cells.push({ ch: run, x: x + w / 2 });
    x += w;
    run = '';
  };
  for (const ch of text) {
    if (!isDigit(ch)) {
      run += ch;
      continue;
    }
    flush();
    cells.push({ ch, x: x + digit / 2 });
    x += digit;
  }
  flush();
  return { cells, width: x - x0 };
}

/** Width of `text` when drawn with tabular figures. */
export function measureTabular(
  text: string,
  fontSize: number,
  opts?: MeasureOpts
): number {
  return tabularCells(text, 0, fontSize, opts).width;
}

/** The d3-selection surface `setTabularText` needs. */
interface TextSel {
  attr(name: string): string | null;
  attr(name: string, value: string | number): unknown;
  text(value: string): unknown;
  append(name: 'tspan'): {
    attr(name: string, value: string | number): { text(v: string): unknown };
  };
}

/**
 * Set `text` on a `<text>` element that already carries its `x` and
 * `text-anchor`, drawing its digits in tabular cells. A string with no digit
 * is set as plain text. The element's `x` moves to the label's centre and its
 * anchor becomes `middle`, because each cell is centred on its own `x`.
 * `textContent` is the string unchanged.
 */
export function setTabularText<S extends TextSel>(
  sel: S,
  text: string,
  fontSize: number,
  opts?: MeasureOpts
): S {
  if (!/[0-9]/.test(text)) {
    sel.text(text);
    return sel;
  }
  const x = Number(sel.attr('x') ?? 0);
  const anchor = sel.attr('text-anchor') ?? 'start';
  const width = measureTabular(text, fontSize, opts);
  const x0 =
    anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  sel.text('');
  // Anchor and x describe the whole label (its centre), so anything reading
  // the element's box — label lint, hit tests — sees where it is drawn.
  sel.attr('x', x0 + width / 2);
  sel.attr('text-anchor', 'middle');
  for (const c of tabularCells(text, x0, fontSize, opts).cells)
    sel.append('tspan').attr('x', round2(c.x)).text(c.ch);
  return sel;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** `setTabularText` for d3's `.call()`: `.call(tabularText(label, 12))`. */
export function tabularText(
  text: string,
  fontSize: number,
  opts?: MeasureOpts
): <S extends TextSel>(sel: S) => void {
  return (sel) => {
    setTabularText(sel, text, fontSize, opts);
  };
}
