import type { ConformanceFixture } from './_types';

// Spec §17 / §16.1. `period` is a required structural keyword (block or
// inline form) — not a directive. No chart-specific directives.
export const fixture: ConformanceFixture = {
  chartType: 'slope',
  specSection: '17',
  firstLineKeyword: 'slope',
  directives: [],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
