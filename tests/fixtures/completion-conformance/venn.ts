import type { ConformanceFixture } from './_types';

// Spec §17 / §16.4. Sets are declared with the universal `as` alias syntax
// (§2A); intersections via `Set + Set`. the fill family saturates the set fills.
export const fixture: ConformanceFixture = {
  chartType: 'venn',
  specSection: '17',
  firstLineKeyword: 'venn',
  directives: ['fill-tint', 'fill-solid', 'fill-outline'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
