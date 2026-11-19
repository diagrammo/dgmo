// ============================================================
// Histogram — row parsing, settling and diagnostics (#1847)
// ============================================================
//
// The histogram rides the extended data-chart parser (frame, axes, number
// format, groups, fill family, legend flags). This file holds what only the
// histogram reads: bare-number rows, pre-counted `lo-hi count` rows, the bin
// directives and `percent`.

import type { DgmoError, DiagnosticSpec } from '../diagnostics';
import { emit } from '../diagnostics';
import { normalizeNumericToken } from '../utils/parsing';

export const HISTOGRAM_DX = {
  NOT_A_NUMBER: {
    code: 'E_HISTOGRAM_NOT_A_NUMBER',
    severity: 'error',
    chartType: 'histogram',
    title: 'Histogram value is not a number',
    message: (p) =>
      `'${(p.token as string) ?? 'value'}' is not a number. A histogram row holds only numbers; the word is left out.`,
    hint: 'Write the values as bare numbers, separated by spaces or commas: 12 15.5 17. A histogram takes no labels.',
    example: 'histogram Delivery time\n12 15.5 late 17',
  },
  MIXED_ROWS: {
    code: 'E_HISTOGRAM_MIXED_ROWS',
    severity: 'error',
    chartType: 'histogram',
    title: 'Raw values mixed with pre-counted rows',
    message: (p) =>
      `This line is ${(p.found as string) ?? 'a pre-counted row'}, but the chart started with ${(p.first as string) ?? 'raw values'}. A histogram takes one or the other; the line is left out.`,
    hint: 'Use raw values (12 15 17) or pre-counted ranges (10-20 31) throughout, not both.',
    example: 'histogram Tickets\n12 15 17\n10-20 31',
  },
  RANGE_OVERLAP: {
    code: 'E_HISTOGRAM_RANGE_OVERLAP',
    severity: 'error',
    chartType: 'histogram',
    title: 'Pre-counted ranges overlap',
    message: (p) =>
      `The range ${(p.range as string) ?? 'here'} overlaps ${(p.other as string) ?? 'an earlier range'}; the line is left out.`,
    hint: 'Make each range start where the one before it ends: 0-10, 10-20, 20-30.',
    example: 'histogram Tickets\n0-10 4\n5-20 31',
  },
  BAD_RANGE: {
    code: 'E_HISTOGRAM_BAD_RANGE',
    severity: 'error',
    chartType: 'histogram',
    title: 'Pre-counted range runs backwards or has a bad count',
    message: (p) =>
      `'${(p.row as string) ?? 'row'}': ${(p.reason as string) ?? 'the low end must come first'}. The line is left out.`,
    hint: 'Write the low end, a dash, the high end, then the count: 10-20 31.',
    example: 'histogram Tickets\n20-10 31',
  },
  BAD_BIN_WIDTH: {
    code: 'E_HISTOGRAM_BAD_BIN_WIDTH',
    severity: 'error',
    chartType: 'histogram',
    title: 'bin-width is not a number above 0',
    message: (p) =>
      `bin-width needs a number above 0, not '${(p.value as string) ?? ''}'. The automatic width is used.`,
    hint: 'Write the width of each bin in the units of the values: bin-width 5.',
    example: 'histogram Delivery time\nbin-width 0\n12 15 17',
  },
  BAD_BINS: {
    code: 'E_HISTOGRAM_BAD_BINS',
    severity: 'error',
    chartType: 'histogram',
    title: 'bins is not a whole number of 1 or more',
    message: (p) =>
      `bins needs a whole number of 1 or more, not '${(p.value as string) ?? ''}'. The automatic width is used.`,
    hint: 'Write about how many bins to draw: bins 10. For an exact width, use bin-width.',
    example: 'histogram Delivery time\nbins 0\n12 15 17',
  },
  BAD_BIN_START: {
    code: 'E_HISTOGRAM_BAD_BIN_START',
    severity: 'error',
    chartType: 'histogram',
    title: 'bin-start is not a number',
    message: (p) =>
      `bin-start needs a number, not '${(p.value as string) ?? ''}'. The line is ignored.`,
    hint: 'Write where the first bin starts: bin-start 0.',
    example: 'histogram Delivery time\nbin-start soon\n12 15 17',
  },
  BINS_AND_WIDTH: {
    code: 'E_HISTOGRAM_BINS_AND_WIDTH',
    severity: 'error',
    chartType: 'histogram',
    title: 'Both bins and bin-width',
    message:
      'The chart sets both `bins` and `bin-width`. bin-width is the exact one, so it is used and `bins` is ignored.',
    hint: 'Keep one: bin-width for an exact width, bins for about that many bins.',
    example: 'histogram Delivery time\nbins 10\nbin-width 5\n12 15 17',
  },
  EMPTY_GROUP: {
    code: 'W_HISTOGRAM_EMPTY_GROUP',
    severity: 'warning',
    chartType: 'histogram',
    title: 'Histogram group has no values',
    message: (p) =>
      `The group [${(p.group as string) ?? 'Group'}] has no values, so it draws nothing.`,
    hint: 'Put the group’s numbers on the lines under its header, or remove the header.',
    example: 'histogram Delivery time\n[Downtown]\n[Suburbs]\n26 31 22',
  },
  BELOW_START: {
    code: 'W_HISTOGRAM_BELOW_START',
    severity: 'warning',
    chartType: 'histogram',
    title: 'Values below bin-start',
    message: (p) =>
      `${(p.count as number) ?? 'Some'} value(s) fall below bin-start ${(p.start as string) ?? ''} and are not counted.`,
    hint: 'Lower bin-start to the smallest value, or remove it.',
    example: 'histogram Delivery time\nbin-start 10\n4 12 15',
  },
} satisfies Record<string, DiagnosticSpec>;

export const HISTOGRAM_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(HISTOGRAM_DX);

/** One pre-counted row: `lo-hi count`. */
export interface HistogramRange {
  readonly x0: number;
  readonly x1: number;
  readonly count: number;
  readonly lineNumber: number;
}

/** One `[Name color]` group, or the unnamed group before the first header. */
export interface HistogramGroup {
  /** '' for the unnamed group. */
  readonly name: string;
  color?: string;
  readonly lineNumber: number;
  readonly values: number[];
  readonly ranges: HistogramRange[];
}

/** The bin directives as written. */
export interface HistogramBinSpec {
  width?: number;
  count?: number;
  start?: number;
  widthLine?: number;
  countLine?: number;
  startLine?: number;
}

/** What the histogram adds to the extended parse state. */
export interface HistogramState {
  groups: HistogramGroup[];
  bins: HistogramBinSpec;
  percent?: boolean;
  /** Which row form the chart started with. */
  form?: 'raw' | 'counted';
}

const NUM = String.raw`(?:\d[\d,_]*(?:\.\d+)?|\.\d+)`;
const RANGE_RE = new RegExp(
  String.raw`^(-?${NUM})[-–](-?${NUM}),?\s+(${NUM})$`
);

/** A number as DGMO writes one: `1,000`, `1_000`, `-2.5`. Null otherwise. */
export function readNumber(tok: string): number | null {
  const norm = normalizeNumericToken(tok) ?? tok;
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(norm)) return null;
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

/**
 * Split a row into number tokens: spaces separate values, and so do commas
 * except inside a thousands group (`1,000`).
 */
export function rowTokens(line: string): string[] {
  const out: string[] = [];
  for (const raw of line.split(/\s+/)) {
    const tok = raw.replace(/,+$/, '').replace(/^,+/, '');
    if (!tok) continue;
    if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(tok)) out.push(tok);
    else out.push(...tok.split(',').filter(Boolean));
  }
  return out;
}

function currentGroup(
  state: HistogramState,
  lineNumber: number
): HistogramGroup {
  let g = state.groups.at(-1);
  if (!g) {
    g = { name: '', lineNumber, values: [], ranges: [] };
    state.groups.push(g);
  }
  return g;
}

/** Open a `[Name color]` group. */
export function openHistogramGroup(
  state: HistogramState,
  name: string,
  color: string | undefined,
  lineNumber: number
): void {
  state.groups.push({
    name,
    ...(color && { color }),
    lineNumber,
    values: [],
    ranges: [],
  });
}

/**
 * Read one histogram line. Returns true when the line was the histogram's
 * (a value row, a pre-counted row, a bin directive or `percent`); false
 * lets the shared parser try it.
 */
export function parseHistogramLine(
  trimmed: string,
  lineNumber: number,
  state: HistogramState,
  diagnostics: DgmoError[]
): boolean {
  const head = trimmed.split(/\s+/)[0]!;

  if (head === 'percent' && trimmed === 'percent') {
    state.percent = true;
    return true;
  }
  if (head === 'bin-width' || head === 'bins' || head === 'bin-start') {
    const rest = trimmed.slice(head.length).trim();
    const v = readNumber(rest);
    if (head === 'bin-width') {
      if (v === null || v <= 0) {
        diagnostics.push(
          emit(HISTOGRAM_DX.BAD_BIN_WIDTH, lineNumber, { value: rest })
        );
        return true;
      }
      state.bins.width = v;
      state.bins.widthLine = lineNumber;
    } else if (head === 'bins') {
      if (v === null || v < 1 || !Number.isInteger(v)) {
        diagnostics.push(
          emit(HISTOGRAM_DX.BAD_BINS, lineNumber, { value: rest })
        );
        return true;
      }
      state.bins.count = v;
      state.bins.countLine = lineNumber;
    } else {
      if (v === null) {
        diagnostics.push(
          emit(HISTOGRAM_DX.BAD_BIN_START, lineNumber, { value: rest })
        );
        return true;
      }
      state.bins.start = v;
      state.bins.startLine = lineNumber;
    }
    return true;
  }

  const range = trimmed.match(RANGE_RE);
  if (range) {
    if (!claimForm(state, 'counted', lineNumber, diagnostics)) return true;
    const x0 = readNumber(range[1]!);
    const x1 = readNumber(range[2]!);
    const count = readNumber(range[3]!);
    if (x0 === null || x1 === null || count === null) {
      diagnostics.push(
        emit(HISTOGRAM_DX.BAD_RANGE, lineNumber, {
          row: trimmed,
          reason: 'a number cannot be read',
        })
      );
      return true;
    }
    if (!(x1 > x0)) {
      diagnostics.push(
        emit(HISTOGRAM_DX.BAD_RANGE, lineNumber, {
          row: trimmed,
          reason: 'the low end must come first',
        })
      );
      return true;
    }
    currentGroup(state, lineNumber).ranges.push({ x0, x1, count, lineNumber });
    return true;
  }

  const tokens = rowTokens(trimmed);
  if (tokens.length === 0 || readNumber(tokens[0]!) === null) return false;
  if (!claimForm(state, 'raw', lineNumber, diagnostics)) return true;
  pushValues(tokens, lineNumber, state, diagnostics);
  return true;
}

/**
 * A line no rule took. When it holds any number it is a value row with a
 * bad word in it: each word that is not a number errors, and the numbers
 * still count. Returns false when the line holds no number at all.
 */
export function histogramStrayLine(
  trimmed: string,
  lineNumber: number,
  state: HistogramState,
  diagnostics: DgmoError[]
): boolean {
  const tokens = rowTokens(trimmed);
  if (!tokens.some((t) => readNumber(t) !== null)) return false;
  if (!claimForm(state, 'raw', lineNumber, diagnostics)) return true;
  pushValues(tokens, lineNumber, state, diagnostics);
  return true;
}

function pushValues(
  tokens: readonly string[],
  lineNumber: number,
  state: HistogramState,
  diagnostics: DgmoError[]
): void {
  const g = currentGroup(state, lineNumber);
  for (const t of tokens) {
    const v = readNumber(t);
    if (v === null)
      diagnostics.push(
        emit(HISTOGRAM_DX.NOT_A_NUMBER, lineNumber, { token: t })
      );
    else g.values.push(v);
  }
}

function claimForm(
  state: HistogramState,
  form: 'raw' | 'counted',
  lineNumber: number,
  diagnostics: DgmoError[]
): boolean {
  if (!state.form) {
    state.form = form;
    return true;
  }
  if (state.form === form) return true;
  const say = (f: 'raw' | 'counted') =>
    f === 'raw' ? 'raw values' : 'pre-counted rows';
  diagnostics.push(
    emit(HISTOGRAM_DX.MIXED_ROWS, lineNumber, {
      found: form === 'raw' ? 'a row of raw values' : 'a pre-counted row',
      first: say(state.form),
    })
  );
  return false;
}

/**
 * Settle the histogram once every line is read: drop overlapping ranges,
 * warn on empty groups, and resolve `bins` against `bin-width`.
 */
export function settleHistogram(
  state: HistogramState,
  diagnostics: DgmoError[],
  fmt: (v: number) => string = String
): void {
  const { bins } = state;
  if (bins.width !== undefined && bins.count !== undefined) {
    diagnostics.push(
      emit(
        HISTOGRAM_DX.BINS_AND_WIDTH,
        Math.max(bins.widthLine ?? 1, bins.countLine ?? 1)
      )
    );
    delete bins.count;
    delete bins.countLine;
  }
  for (const g of state.groups) {
    if (g.ranges.length > 1) {
      // Written order: a range that overlaps an earlier one is the fault.
      const keep: HistogramRange[] = [];
      for (const r of g.ranges) {
        const clash = keep.find((k) => r.x0 < k.x1 && k.x0 < r.x1);
        if (clash) {
          diagnostics.push(
            emit(HISTOGRAM_DX.RANGE_OVERLAP, r.lineNumber, {
              range: `${fmt(r.x0)}-${fmt(r.x1)}`,
              other: `${fmt(clash.x0)}-${fmt(clash.x1)}`,
            })
          );
          continue;
        }
        keep.push(r);
      }
      g.ranges.splice(0, g.ranges.length, ...keep);
    }
    if (g.name && g.values.length === 0 && g.ranges.length === 0)
      diagnostics.push(
        emit(HISTOGRAM_DX.EMPTY_GROUP, g.lineNumber, { group: g.name })
      );
  }
  state.groups = state.groups.filter(
    (g) => g.values.length > 0 || g.ranges.length > 0
  );
  if (bins.start !== undefined) {
    const below = state.groups
      .flatMap((g) => g.values)
      .filter((v) => v < bins.start!).length;
    if (below > 0)
      diagnostics.push(
        emit(HISTOGRAM_DX.BELOW_START, bins.startLine ?? 1, {
          count: below,
          start: fmt(bins.start),
        })
      );
  }
}
