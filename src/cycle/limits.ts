// ============================================================
// cycle — the step limit (#2430, owner's decision 2026-11-26)
// ============================================================
//
// Every step keeps at least MIN_ARC_ANGLE of the ring, so the ring holds
// CYCLE_MAX_STEPS steps at that minimum. Past it the steps pile on top of
// each other. A cycle cut to its first N steps would not close, so unlike the
// bar limit nothing partial is drawn: the parser raises an error and the
// chart is withheld. Not author-tunable: crowding is the renderer's decision
// (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/** Least arc angle a step keeps on the ring, in radians (15°). */
export const MIN_ARC_ANGLE = (15 * Math.PI) / 180;

/** Most steps one cycle draws: the ring filled at MIN_ARC_ANGLE (24). */
export const CYCLE_MAX_STEPS = Math.floor((2 * Math.PI) / MIN_ARC_ANGLE);

export const CYCLE_DX = {
  TOO_MANY_STEPS: {
    code: 'E_CYCLE_TOO_MANY_STEPS',
    severity: 'error',
    chartType: 'cycle',
    title: 'Too many steps',
    message: (p) =>
      `This cycle has ${(p.count as number) ?? 'too many'} steps; a cycle can show at most ${CYCLE_MAX_STEPS}. Group steps into phases, or use a flowchart.`,
    hint: `Keep a cycle to ${CYCLE_MAX_STEPS} steps or fewer: group steps into phases, or draw it as a flowchart.`,
    example: `cycle Release\n\nPlan\nBuild\nShip`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const CYCLE_DIAGNOSTICS: DiagnosticSpec[] = Object.values(CYCLE_DX);
