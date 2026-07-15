import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Cartesian — `no-value` only.
export const fixture: ConformanceFixture = {
  chartType: 'radar',
  specSection: '16',
  firstLineKeyword: 'radar',
  directives: ['no-value', 'fill-tint', 'fill-solid', 'fill-outline'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
