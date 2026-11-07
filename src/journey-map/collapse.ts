// ============================================================
// journey-map/collapse.ts — the source `collapsed` marker as a phase set (#1741).
// ============================================================

import type { ParsedJourneyMap } from './types';

/**
 * Names of every phase the SOURCE marks collapsed (`[Phase] collapsed`),
 * unioned with an optional runtime set (share link `viewState.cg`, the app).
 * The static export folds from this; the app seeds its own `collapsedPhases`
 * state from it so a click can still expand.
 */
export function collapsedJourneyPhasesFromSource(
  parsed: ParsedJourneyMap,
  interactive?: Iterable<string>
): Set<string> {
  const names = new Set<string>(interactive ?? []);
  for (const phase of parsed.phases) {
    if (phase.collapsed) names.add(phase.name);
  }
  return names;
}
