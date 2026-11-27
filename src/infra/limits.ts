// ============================================================
// infra — the node limit (#2446, owner's decision 2026-11-26)
// ============================================================
//
// The preview fits the whole diagram to the pane. Even folded into bands
// (foldLongLayout in layout.ts), 100 nodes draw about 42 px wide in a
// 1000×700 pane, the same as a 100-node grid; 200 draw about 30 px, and a
// 200-node chain with skip links about 12 px. A diagram with nodes dropped
// would misstate the system and its computed load, so nothing partial is
// drawn: the parser raises an error and the chart is withheld. Not
// author-tunable: crowding is the renderer's decision (dgmo/CLAUDE.md →
// Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/** Most nodes one infra diagram draws, counting entry points and stubs. */
export const INFRA_MAX_NODES = 100;

export const INFRA_DX = {
  TOO_MANY_NODES: {
    code: 'E_INFRA_TOO_MANY_NODES',
    severity: 'error',
    chartType: 'infra',
    title: 'Too many nodes',
    message: (p) =>
      `This infra diagram has ${(p.count as number) ?? 'too many'} nodes; an infra diagram can show at most ${INFRA_MAX_NODES}. Split it into several diagrams, or merge nodes into [Group] blocks with instances.`,
    hint: `Keep an infra diagram to ${INFRA_MAX_NODES} nodes or fewer: split it by subsystem, or merge replicas into one node with instances.`,
    example: `infra Checkout\n\nedge\n  rps: 1000\n  -> API\n\nAPI\n  instances: 4`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const INFRA_DIAGNOSTICS: DiagnosticSpec[] = Object.values(INFRA_DX);
