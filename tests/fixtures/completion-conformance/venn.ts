import type { ConformanceFixture } from './_types';

// Spec §17 / §16.4. Sets are declared with the universal `as` alias syntax
// (§2A); intersections via `Set + Set`. `solid-fill` saturates the set fills.
export const fixture: ConformanceFixture = {
  chartType: 'venn',
  specSection: '17',
  firstLineKeyword: 'venn',
  directives: ['solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
