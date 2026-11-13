import type { DiagnosticSpec } from '../diagnostics';

/**
 * An unquoted `|` in a box name (#1974). Pipe metadata was retired in 0.18.0
 * and its guard deleted in 0.43.0 (#28), after which `Shell | s:doing` drew a
 * box named "Shell |" and `AuthMS | doing` a box named the whole string — so
 * an edge to `AuthMS` silently made a SECOND box outside every group. A
 * regular boxes-and-lines diagnostic, not a resurrected `E_*_REMOVED` guard:
 * the parser recovers by cutting the name at the pipe, and quoting keeps a
 * literal pipe (`"Order | Items"`).
 */
export const BL_PIPE_IN_NAME_DX: DiagnosticSpec = {
  code: 'E_BL_PIPE_IN_NAME',
  severity: 'error',
  chartType: 'boxes-and-lines',
  title: 'Pipe in a box name',
  message: (p) =>
    `"${String(p.label ?? 'Shell | s:doing')}" has a "|" in its name — metadata follows the name directly, with no pipe, so this draws a separate box named "${String(p.name ?? 'Shell')}" plus the text after the pipe.`,
  hint: 'Drop the pipe: write `Shell s:doing`, not `Shell | s:doing`. Quote the name to keep a literal pipe: `"Order | Items"`.',
  example: 'boxes-and-lines\nShell | s:doing',
};

export const BOXES_AND_LINES_DIAGNOSTICS: DiagnosticSpec[] = [
  BL_PIPE_IN_NAME_DX,
];
