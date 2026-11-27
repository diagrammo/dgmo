// ============================================================
// funnel — the stage limit (#2439, owner's decision 2026-11-26)
// ============================================================
//
// Past FUNNEL_MAX_STAGES a funnel's bands are thinner than one label line and
// its names, values and percentages overprint. The parser keeps the first
// FUNNEL_MAX_STAGES stages (a funnel is ordered top to bottom, so they are a
// valid funnel) and raises an error naming the count. Not author-tunable:
// crowding is the renderer's decision (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/**
 * Most stages one funnel draws. At the default canvas (EXPORT_HEIGHT 800, a
 * titled chart) the band area is 710px, so 20 stages give 35.5px bands —
 * taller than one side-label line even at the largest side font (21px, a
 * 25px line).
 */
export const FUNNEL_MAX_STAGES = 20;

export const FUNNEL_DX = {
  TOO_MANY_STAGES: {
    code: 'E_FUNNEL_TOO_MANY_STAGES',
    severity: 'error',
    chartType: 'funnel',
    title: 'Too many stages',
    message: (p) =>
      `This funnel has ${(p.count as number) ?? 'too many'} stages; only the first ${FUNNEL_MAX_STAGES} are drawn. Split it into several funnels, or merge small stages.`,
    hint: `Keep a funnel to ${FUNNEL_MAX_STAGES} stages or fewer: split it into several funnels, or merge neighbouring stages.`,
    example: `funnel Signups\n\nVisitors 1000\nTrials 300\nPaid 80`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const FUNNEL_DIAGNOSTICS: DiagnosticSpec[] = Object.values(FUNNEL_DX);
