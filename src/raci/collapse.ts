// ============================================================
// raci/collapse.ts — the source `collapsed` marker as a phase set (#1741).
// ============================================================

import type { ParsedRaci } from './types';

/**
 * Ids of every phase the SOURCE marks collapsed (`[Phase] collapsed`),
 * unioned with optional runtime phases given as header LINE NUMBERS — the
 * form a share link carries them in (`viewState.cs`). The static export folds
 * from this; the app seeds its own `collapsedPhases` state from it (no second
 * argument) so a click can still expand.
 */
export function collapsedRaciPhasesFromSource(
  parsed: ParsedRaci,
  interactiveLines?: Iterable<number>
): Set<string> {
  const lines = new Set<number>(interactiveLines ?? []);
  const ids = new Set<string>();
  for (const phase of parsed.phases) {
    if (phase.collapsed || lines.has(phase.lineNumber)) ids.add(phase.id);
  }
  return ids;
}
