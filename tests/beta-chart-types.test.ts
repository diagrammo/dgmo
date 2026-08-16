// The `beta` flag's specification.
//
// 🔴 This file IS the flag, the same way `internal-chart-types.test.ts` is that
// one. A maturity mark is only worth anything if it reaches every surface that
// names a chart type; the failure it exists to prevent is a surface quietly
// dropping out and going back to presenting an unfinished type as finished.
//
// That already happened, which is why the flag moved here (issue #221): the app
// and the marketing site each held a hand-written id set kept in step by a
// comment, and neither reached the CLI, the MCP server, the guides or the
// language reference. `sketch` was marked in two places and unmarked in the
// rest for four days.
//
// Two edges live in other repos and are asserted there:
//   · MCP `list_chart_types` → dgmo-mcp/tests/tools.test.ts
//   · the app's picker + docs → diagrammo-app/tests/...
//
// ⚠️ Deliberately NOT asserting WHICH types are beta beyond the fact that the
// derived set matches the flag. That list is a product decision and will move;
// pinning it here would make every future promotion a test edit in a repo that
// does not own the decision.

import { describe, it, expect } from 'vitest';

import { chartTypes } from '../src/chart-types';
import { getAllChartTypes } from '../src/dgmo-router';
import {
  BETA_CHART_TYPE_IDS,
  INTERNAL_CHART_TYPE_IDS,
  isBetaChartType,
} from '../src/utils/offered-types';

describe('beta chart types', () => {
  it('the derived set matches the flag on chartTypes', () => {
    expect([...BETA_CHART_TYPE_IDS].sort()).toEqual(
      chartTypes
        .filter((c) => c.beta)
        .map((c) => c.id)
        .sort()
    );
  });

  it('is a mark, never a filter — every beta type is still routable', () => {
    // 🔴 The whole difference from `internal`. If something ever starts
    // REMOVING beta types from a list, this is where it gets caught: a beta
    // type is offered, it just says what it is.
    const routable = new Set(getAllChartTypes());
    for (const id of BETA_CHART_TYPE_IDS) {
      expect(routable.has(id)).toBe(true);
    }
  });

  it('never overlaps the internal set', () => {
    // A type nobody may be offered cannot also be a type offered with a
    // warning — that combination has no meaning and would render a mark on a
    // row no surface draws.
    for (const id of BETA_CHART_TYPE_IDS) {
      expect(INTERNAL_CHART_TYPE_IDS.has(id)).toBe(false);
    }
  });

  it('answers for an id that is not a chart type at all', () => {
    // Callers pass bare strings out of bare id lists; an unknown id is a
    // "no", not a crash.
    expect(isBetaChartType('definitely-not-a-chart-type')).toBe(false);
  });

  it('marks at least one type, so the plumbing cannot pass while dead', () => {
    // Every edge below reads an empty set happily. If the flag is ever removed
    // from the data, this fails rather than every surface silently agreeing
    // that nothing is beta.
    expect(BETA_CHART_TYPE_IDS.size).toBeGreaterThan(0);
  });
});
