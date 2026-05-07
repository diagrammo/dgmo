import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Cartesian — `no-value` only.
export const fixture: ConformanceFixture = {
  chartType: 'radar',
  specSection: '16',
  firstLineKeyword: 'radar',
  directives: ['no-value', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
