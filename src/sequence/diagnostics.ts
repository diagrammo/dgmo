// ============================================================
// Sequence diagram — Diagnostic codes (spec §2.3)
// ============================================================

import type { DiagnosticSpec } from '../diagnostics';

export const SEQUENCE_DIAGNOSTIC_CODES = {
  GROUP_DEPTH: 'E_SEQ_GROUP_DEPTH',
} as const;

export const SEQUENCE_DIAGNOSTICS: DiagnosticSpec[] = [
  {
    code: SEQUENCE_DIAGNOSTIC_CODES.GROUP_DEPTH,
    severity: 'error',
    chartType: 'sequence',
    title: 'Group nested too deep',
    message: (p) =>
      `Group "${String(p.label ?? '?')}" is nested ${String(p.depth ?? '?')} levels deep — participant groups nest to depth ${String(p.max ?? '?')}; its participants join the group above it`,
    hint: 'Move the inner [Group] up a level — two levels of bracket is the bound.',
    example: 'sequence\n[Monolith]\n  [Linux]\n    [Container]\n      App',
  },
];
