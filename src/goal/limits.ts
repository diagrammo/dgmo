// ============================================================
// goal — the measure limit (#2444, owner's decision 2026-11-26)
// ============================================================
//
// Every drawn goal fits the canvas, so each measure past a point shrinks all
// of them. The limits keep the smallest row text at or above
// MIN_READABLE_TYPE_PX on the default 1200x800 canvas (measured 2026-11-27):
//   - bar rows: the 18px values read at 11.5px with 20 rows, 9.7px with 24;
//   - cells (thermometer, gauge): the 22px readouts read at 14.6px with 8
//     thermometers and 9.9px with 12; gauges are width-bound and read 11.5px
//     up to 12, so the thermometer sets the one cell number.
// Past a limit the parser keeps the first N measures and raises an error
// naming the count. Not author-tunable: crowding is the renderer's decision
// (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/** Most measures one goal draws as bar rows (the bullet chart). */
export const GOAL_MAX_MEASURES = 20;
/** Most measures one goal draws as thermometer or gauge cells. */
export const GOAL_MAX_CELLS = 8;

export const GOAL_DX = {
  TOO_MANY_MEASURES: {
    code: 'E_GOAL_TOO_MANY_MEASURES',
    severity: 'error',
    chartType: 'goal',
    title: 'Too many measures',
    message: (p) =>
      `This goal has ${(p.count as number) ?? 'too many'} measures; only the first ${(p.limit as number) ?? GOAL_MAX_MEASURES} are drawn. Split the measures into several goals.`,
    hint: `Keep a goal to ${GOAL_MAX_MEASURES} bar measures, or ${GOAL_MAX_CELLS} thermometer or gauge measures: split them into several goals.`,
    example: `goal Q3 Report\n\n[Revenue]\nactual 760\ntarget 900\n\n[Recruits]\nactual 41\ntarget 45`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const GOAL_DIAGNOSTICS: DiagnosticSpec[] = Object.values(GOAL_DX);
