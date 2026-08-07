// ============================================================
// The `internal` filter — one implementation, three callers.
// ============================================================
//
// `ChartTypeMeta.internal` means "routable but never OFFERED". Honouring it is
// a cross-lookup, because the surfaces that enumerate types read structures
// carrying no metadata at all: `CHART_TYPE_DESCRIPTIONS` is a bare
// `Record<string, string>` and `ALL_CHART_TYPES` is a bare `Set<string>`.
//
// That cross-lookup was written out three times before this file existed, which
// is exactly the shape a later refactor drops one of. It lives here so
// `internal-chart-types.test.ts` can assert on the thing the callers actually
// use, rather than on a CLI binary that may not have been built yet.
//
// 🔴 Deliberately NOT exported from `index.ts` or `advanced.ts`. The public
// answer to "what chart types exist" is `getAllChartTypes()`, which keeps
// meaning "everything routable" — a test pins it to `chartTypes` exactly.

import { chartTypes } from '../chart-types';

/** Ids of every chart type that routes but is never offered. */
export const INTERNAL_CHART_TYPE_IDS: ReadonlySet<string> = new Set(
  chartTypes.filter((c) => c.internal).map((c) => c.id)
);

/** `ids` with every internal type removed, order preserved. */
export function withoutInternalChartTypes(ids: readonly string[]): string[] {
  return ids.filter((id) => !INTERNAL_CHART_TYPE_IDS.has(id));
}
