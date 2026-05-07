import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Cartesian + supports `era` structural keyword.
export const fixture: ConformanceFixture = {
  chartType: 'area',
  specSection: '16',
  firstLineKeyword: 'area',
  directives: ['series', 'x-label', 'y-label', 'no-value'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
