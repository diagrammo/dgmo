// ============================================================
// Box plot — row parsing, settling and diagnostics (#1848)
// ============================================================
//
// The box plot rides the extended data-chart parser (frame, axes, number
// format, `[Name] color` groups, fill family, legend flags). This file holds
// what only the box plot reads: bare-number rows and the `points`, `mean`
// and `orientation-horizontal` flags. The input is the histogram's (#1847),
// so changing the first word switches between the two views of one dataset.

import type { DgmoError, DiagnosticSpec } from '../diagnostics';
import { emit } from '../diagnostics';
import { normalizeNumericToken } from '../utils/parsing';

/** Below this many values a box is drawn, with a warning. */
export const BOXPLOT_MIN_VALUES = 5;

export const BOXPLOT_DX = {
  NOT_A_NUMBER: {
    code: 'E_BOXPLOT_NOT_A_NUMBER',
    severity: 'error',
    chartType: 'boxplot',
    title: 'Box plot value is not a number',
    message: (p) =>
      `'${(p.token as string) ?? 'value'}' is not a number. A box plot row holds only numbers; the word is left out.`,
    hint: 'Write the values as bare numbers, separated by spaces or commas: 12 15.5 17. Name a group with a [Name] header line above its values.',
    example: 'boxplot Delivery time\n12 15.5 late 17',
  },
  EMPTY_GROUP: {
    code: 'W_BOXPLOT_EMPTY_GROUP',
    severity: 'warning',
    chartType: 'boxplot',
    title: 'Box plot group has no values',
    message: (p) =>
      `The group [${(p.group as string) ?? 'Group'}] has no values, so it draws no box.`,
    hint: 'Put the group’s numbers on the lines under its header, or remove the header.',
    example: 'boxplot Delivery time\n[Downtown]\n[Suburbs]\n26 31 22 24 29',
  },
  FEW_VALUES: {
    code: 'W_BOXPLOT_FEW_VALUES',
    severity: 'warning',
    chartType: 'boxplot',
    title: 'Too few values for a meaningful box',
    message: (p) =>
      `${(p.group as string) ? `The group [${p.group as string}]` : 'The chart'} has ${(p.count as number) ?? 'few'} value(s). Below ${BOXPLOT_MIN_VALUES}, the quartiles say little; the box is still drawn.`,
    hint: `Give each group at least ${BOXPLOT_MIN_VALUES} values, or show so few values as points on a scatter chart.`,
    example: 'boxplot Delivery time\n12 15 17',
  },
} satisfies Record<string, DiagnosticSpec>;

export const BOXPLOT_DIAGNOSTICS: DiagnosticSpec[] = Object.values(BOXPLOT_DX);

/** One `[Name] color` group, or the unnamed group before the first header. */
export interface BoxplotGroup {
  /** '' for the unnamed group. */
  readonly name: string;
  color?: string;
  readonly lineNumber: number;
  readonly values: number[];
  /** Source line of each value, for click-to-source. */
  readonly valueLines: number[];
}

/** What the box plot adds to the extended parse state. */
export interface BoxplotState {
  groups: BoxplotGroup[];
  points?: boolean;
  mean?: boolean;
  horizontal?: boolean;
}

/** A number as DGMO writes one: `1,000`, `1_000`, `-2.5`. Null otherwise. */
function readNumber(tok: string): number | null {
  const norm = normalizeNumericToken(tok) ?? tok;
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(norm)) return null;
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

/**
 * Split a row into value tokens: spaces separate values, and so do commas
 * except inside a thousands group (`1,000`).
 */
function valueTokens(line: string): string[] {
  const out: string[] = [];
  for (const raw of line.split(/\s+/)) {
    const tok = raw.replace(/,+$/, '').replace(/^,+/, '');
    if (!tok) continue;
    if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(tok)) out.push(tok);
    else out.push(...tok.split(',').filter(Boolean));
  }
  return out;
}

/** Open a `[Name] color` group. */
export function openBoxplotGroup(
  state: BoxplotState,
  name: string,
  color: string | undefined,
  lineNumber: number
): void {
  state.groups.push({
    name,
    ...(color && { color }),
    lineNumber,
    values: [],
    valueLines: [],
  });
}

/**
 * Read one box plot line. Returns true when the line was the box plot's (a
 * flag, or a row that holds any number); false lets the shared parser try
 * it. In a row with a number, every word that is not one errors and the
 * numbers still count.
 */
export function parseBoxplotLine(
  trimmed: string,
  lineNumber: number,
  state: BoxplotState,
  diagnostics: DgmoError[]
): boolean {
  if (trimmed === 'points') {
    state.points = true;
    return true;
  }
  if (trimmed === 'mean') {
    state.mean = true;
    return true;
  }
  if (trimmed === 'orientation-horizontal') {
    state.horizontal = true;
    return true;
  }

  const tokens = valueTokens(trimmed);
  if (!tokens.some((t) => readNumber(t) !== null)) return false;
  // A line that opens with a word is the shared parser's (an option, a
  // header) unless nothing else takes it; `boxplotStrayLine` comes back.
  if (readNumber(tokens[0]!) === null) return false;
  pushValues(tokens, lineNumber, state, diagnostics);
  return true;
}

/**
 * A line no rule took. When it holds any number it is a value row with a
 * bad word in it. Returns false when the line holds no number at all.
 */
export function boxplotStrayLine(
  trimmed: string,
  lineNumber: number,
  state: BoxplotState,
  diagnostics: DgmoError[]
): boolean {
  const tokens = valueTokens(trimmed);
  if (!tokens.some((t) => readNumber(t) !== null)) return false;
  pushValues(tokens, lineNumber, state, diagnostics);
  return true;
}

function pushValues(
  tokens: readonly string[],
  lineNumber: number,
  state: BoxplotState,
  diagnostics: DgmoError[]
): void {
  let g = state.groups.at(-1);
  if (!g) {
    g = { name: '', lineNumber, values: [], valueLines: [] };
    state.groups.push(g);
  }
  for (const t of tokens) {
    const v = readNumber(t);
    if (v === null)
      diagnostics.push(emit(BOXPLOT_DX.NOT_A_NUMBER, lineNumber, { token: t }));
    else {
      g.values.push(v);
      g.valueLines.push(lineNumber);
    }
  }
}

/** Settle once every line is read: warn on empty and thin groups. */
export function settleBoxplot(
  state: BoxplotState,
  diagnostics: DgmoError[]
): void {
  for (const g of state.groups) {
    if (g.values.length === 0) {
      if (g.name)
        diagnostics.push(
          emit(BOXPLOT_DX.EMPTY_GROUP, g.lineNumber, { group: g.name })
        );
    } else if (g.values.length < BOXPLOT_MIN_VALUES) {
      diagnostics.push(
        emit(BOXPLOT_DX.FEW_VALUES, g.lineNumber, {
          group: g.name,
          count: g.values.length,
        })
      );
    }
  }
  state.groups = state.groups.filter((g) => g.values.length > 0);
}
