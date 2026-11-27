// ============================================================
// gantt — the task limit (#2442, owner's decision 2026-11-26)
// ============================================================
//
// A gantt is read row by row. At the renderer's BAR_H + ROW_GAP row pitch
// (28 px) GANTT_MAX_TASKS rows are already about 2,800 px, a long scroll; past it the
// preview scales the chart to fit and the rows turn to hairlines. The parser
// keeps the first GANTT_MAX_TASKS tasks in source order, with their groups,
// drops dependencies onto tasks it did not keep, and raises an error naming
// the count. Not author-tunable: crowding is the renderer's decision
// (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/** Most tasks one gantt draws, counted across all groups. */
export const GANTT_MAX_TASKS = 100;

export const GANTT_DX = {
  TOO_MANY_TASKS: {
    code: 'E_GANTT_TOO_MANY_TASKS',
    severity: 'error',
    chartType: 'gantt',
    title: 'Too many tasks',
    message: (p) =>
      `This gantt has ${(p.count as number) ?? 'too many'} tasks; only the first ${GANTT_MAX_TASKS} are drawn. Split the plan into several charts, or roll small tasks up into one.`,
    hint: `Keep a gantt to ${GANTT_MAX_TASKS} tasks or fewer: split the plan into several charts (one per phase or team), or roll small tasks up into one.`,
    example: `gantt Launch\nstart 2026-01-05\n\nDesign 5d\n  -> Build\nBuild 10d`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const GANTT_DIAGNOSTICS: DiagnosticSpec[] = Object.values(GANTT_DX);
