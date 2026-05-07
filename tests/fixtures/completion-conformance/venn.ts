import type { ConformanceFixture } from './_types';

// Spec §17 / §16.4. No chart-specific directives. Sets are declared with
// the universal `as` alias syntax (§2A); intersections via `Set + Set`.
export const fixture: ConformanceFixture = {
  chartType: 'venn',
  specSection: '17',
  firstLineKeyword: 'venn',
  directives: [],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
