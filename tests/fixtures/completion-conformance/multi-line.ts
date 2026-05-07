import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Cartesian — same shape as line.
export const fixture: ConformanceFixture = {
  chartType: 'multi-line',
  specSection: '16',
  firstLineKeyword: 'multi-line',
  directives: ['series', 'x-label', 'y-label', 'no-value'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
