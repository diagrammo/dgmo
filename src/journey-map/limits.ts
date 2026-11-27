// ============================================================
// journey-map — the step limit (#2448, owner's decision 2026-11-26)
// ============================================================
//
// The canvas grows one card column per step, so a long journey becomes a
// strip thousands of pixels wide and the preview scales it to a hairline.
// The parser keeps the first JOURNEY_MAX_STEPS steps in source order (a phase
// cut mid-way keeps its header; phases after the cut are dropped) and raises
// an error naming the count. A journey is read left to right, so the first
// steps are still a valid journey. Not author-tunable: crowding is the
// renderer's decision (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/** Most steps one journey map draws, counted across all phases. */
export const JOURNEY_MAX_STEPS = 30;

export const JOURNEY_DX = {
  TOO_MANY_STEPS: {
    code: 'E_JOURNEY_TOO_MANY_STEPS',
    severity: 'error',
    chartType: 'journey-map',
    title: 'Too many steps',
    message: (p) =>
      `This journey map has ${(p.count as number) ?? 'too many'} steps; only the first ${JOURNEY_MAX_STEPS} are drawn. Split the journey into several maps, or merge small steps into one.`,
    hint: `Keep a journey map to ${JOURNEY_MAX_STEPS} steps or fewer: split it into several maps (one per stage of the journey), or merge small steps into one.`,
    example: `journey-map Onboarding\n\n[Signup]\n  Create account score: 4\n[Activation]\n  First project score: 5`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const JOURNEY_DIAGNOSTICS: DiagnosticSpec[] = Object.values(JOURNEY_DX);
