// ============================================================
// sankey alluvial mode — parse half (#1858).
//
// A `period` line switches `sankey` into alluvial mode and names its
// columns, as on `slope` (§16.1). Each row is then one full path with its
// count — `Free -> Free -> Pro 80`, one category per period. Bare lines
// (`Free blue`) declare a category once, with its colour. The same name in
// every column is the same category.
//
// The main sankey loop (data-chart-parser.ts) hands each line to
// `readAlluvialLine` first, and calls `settleAlluvial` once the file is read.
// ============================================================

import type { DgmoError, DiagnosticSpec } from '../diagnostics';
import { emit, makeDgmoError, NEGATIVE_VALUE_DX } from '../diagnostics';
import { normalizeNumericToken } from '../utils/parsing';

/** One path row: one category per period, and its count. */
export interface AlluvialPath {
  steps: string[];
  value: number;
  lineNumber: number;
}

/** A sankey drawn in alluvial mode. */
export interface SankeyAlluvial {
  /** The column labels, in order. */
  periods: string[];
  periodLineNumber: number;
  /** Every category, declaration order first, then first appearance. */
  categories: string[];
  paths: AlluvialPath[];
}

export const ALLUVIAL_DX = {
  PATH_LENGTH: {
    code: 'E_SANKEY_PATH_LENGTH',
    severity: 'error',
    chartType: 'sankey',
    title: 'Path length does not match the periods',
    message: (p) =>
      `This path names ${(p.steps as number) ?? 'a different number of'} categories, but the period line names ${(p.periods as number) ?? 'another number of'} columns. The row is not drawn.`,
    hint: 'Write one category for each period, then the count: Free -> Free -> Pro 80 for three periods.',
    example: 'sankey Plans\nperiod Q1 Q2 Q3\nFree -> Pro 80',
  },
  MIXED_ROWS: {
    code: 'E_SANKEY_MIXED_ROWS',
    severity: 'error',
    chartType: 'sankey',
    title: 'Sankey flows in an alluvial chart',
    message:
      'A sankey with a period line takes path rows only (Free -> Pro -> Pro 80). This flow is written in the sankey tree or link form, so it is not drawn.',
    hint: 'Write each flow as one path through every period, or remove the period line to draw an ordinary sankey.',
    example: 'sankey Plans\nperiod Q1 Q2\nFree\n  Pro 80',
  },
  NO_PERIOD: {
    code: 'E_SANKEY_PATH_NO_PERIOD',
    severity: 'error',
    chartType: 'sankey',
    title: 'Path row without a period line',
    message:
      'A path through several columns needs a period line that names the columns. The row is not drawn.',
    hint: 'Add a period line above the rows: period Q1 Q2 Q3.',
    example: 'sankey Plans\nFree -> Free -> Pro 80',
  },
  FEW_PERIODS: {
    code: 'E_SANKEY_FEW_PERIODS',
    severity: 'error',
    chartType: 'sankey',
    title: 'Fewer than two periods',
    message:
      'The period line needs at least two columns for the flows to run between.',
    hint: 'Name two or more columns: period Q1 Q2.',
    example: 'sankey Plans\nperiod Q1\nFree 80',
  },
  DUPLICATE_PERIOD: {
    code: 'W_SANKEY_DUPLICATE_PERIOD',
    severity: 'warning',
    chartType: 'sankey',
    title: 'Second period line',
    message:
      'The periods are already defined. This period line is ignored and the first one is used.',
    hint: 'Keep one period line.',
    example: 'sankey Plans\nperiod Q1 Q2\nperiod Q3 Q4\nFree -> Pro 80',
  },
} satisfies Record<string, DiagnosticSpec>;

export const ALLUVIAL_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(ALLUVIAL_DX);

/** What the sankey loop collects for alluvial mode while it reads. */
export interface AlluvialState {
  periods: string[] | null;
  periodLine: number;
  /** Reading the indented lines of a bare `period` block. */
  block: 'read' | 'skip' | null;
  rows: AlluvialPath[];
  /** Lines holding a one-arrow `A -> B n` flow — a two-period path. */
  arrowLines: Set<number>;
  /** Bare category lines at column 1, in order. */
  declared: string[];
}

export function newAlluvialState(): AlluvialState {
  return {
    periods: null,
    periodLine: 0,
    block: null,
    rows: [],
    arrowLines: new Set(),
    declared: [],
  };
}

const PATH_ROW = /^(.+?)(?<!\s)\s+(-?[\d,_]+(?:\.\d+)?)\s*$/;

/** `A -> B -> C 80` → its steps and count; null when the line is no path. */
function matchPath(trimmed: string): { steps: string[]; value: number } | null {
  const m = trimmed.match(PATH_ROW);
  if (!m) return null;
  const steps = m[1]!.split(/(?<!\s)\s*->\s*/).map((s) => s.trim());
  if (steps.length < 3 || steps.some((s) => !s || s.includes('--')))
    return null;
  const value = parseFloat(normalizeNumericToken(m[2]!) ?? m[2]!);
  if (!isFinite(value)) return null;
  return { steps, value };
}

/**
 * Reads a `period` line, a line of a `period` block, or a path through three
 * or more columns. Returns true when the line was consumed. A one-arrow flow
 * is left to the sankey link form and claimed later by `settleAlluvial`.
 */
export function readAlluvialLine(
  trimmed: string,
  indent: number,
  lineNumber: number,
  st: AlluvialState,
  diagnostics: DgmoError[]
): boolean {
  if (st.block) {
    if (indent > 0) {
      if (st.block === 'read') st.periods!.push(trimmed);
      return true;
    }
    st.block = null;
  }
  if (indent === 0) {
    const pm = trimmed.match(/^period(?:\s+(.*))?$/);
    if (pm) {
      const rest = pm[1]?.trim() ?? '';
      if (st.periods) {
        diagnostics.push(emit(ALLUVIAL_DX.DUPLICATE_PERIOD, lineNumber));
        st.block = rest ? null : 'skip';
        return true;
      }
      st.periods = rest ? rest.split(/\s+/) : [];
      st.periodLine = lineNumber;
      st.block = rest ? null : 'read';
      return true;
    }
  }
  const path = matchPath(trimmed);
  if (!path) return false;
  if (path.value < 0) {
    diagnostics.push(
      emit(NEGATIVE_VALUE_DX, lineNumber, {
        value: path.value,
        label: path.steps.join(' -> '),
        channel: 'flow widths',
      })
    );
    return true;
  }
  st.rows.push({ ...path, lineNumber });
  return true;
}

/**
 * Settles alluvial mode once the file is read. Without a period line the
 * chart is an ordinary sankey, and any multi-column path is reported. With
 * one, the one-arrow flows become two-column paths, every other flow is
 * reported, and the links are handed back empty.
 */
export function settleAlluvial(
  st: AlluvialState,
  links:
    | {
        source: string;
        target: string;
        value: number;
        directed?: boolean;
        lineNumber: number;
      }[]
    | undefined,
  diagnostics: DgmoError[]
): SankeyAlluvial | undefined {
  if (st.periods === null) {
    for (const r of st.rows)
      diagnostics.push(emit(ALLUVIAL_DX.NO_PERIOD, r.lineNumber));
    return undefined;
  }
  const rows = [...st.rows];
  const mixed = new Set<number>();
  for (const l of links ?? []) {
    if (l.directed && st.arrowLines.has(l.lineNumber))
      rows.push({
        steps: [l.source, l.target],
        value: l.value,
        lineNumber: l.lineNumber,
      });
    else mixed.add(l.lineNumber);
  }
  for (const line of [...mixed].sort((a, b) => a - b))
    diagnostics.push(emit(ALLUVIAL_DX.MIXED_ROWS, line));
  const periods = st.periods;
  if (periods.length < 2) {
    diagnostics.push(emit(ALLUVIAL_DX.FEW_PERIODS, st.periodLine));
    return undefined;
  }
  rows.sort((a, b) => a.lineNumber - b.lineNumber);
  const paths: AlluvialPath[] = [];
  for (const r of rows) {
    if (r.steps.length !== periods.length) {
      diagnostics.push(
        emit(ALLUVIAL_DX.PATH_LENGTH, r.lineNumber, {
          steps: r.steps.length,
          periods: periods.length,
        })
      );
      continue;
    }
    paths.push(r);
  }
  if (paths.length === 0)
    diagnostics.push(
      makeDgmoError(
        st.periodLine,
        `No paths found. Add one row per path, one category for each period: ${periods.map(() => 'Free').join(' -> ')} 80`,
        'warning'
      )
    );
  const categories = [
    ...new Set([...st.declared, ...paths.flatMap((p) => p.steps)]),
  ];
  return {
    periods,
    periodLineNumber: st.periodLine,
    categories,
    paths,
  };
}
