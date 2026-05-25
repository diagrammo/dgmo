import type { ConformanceFixture } from './_types';

// Spec §10 §9.5 Options: solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'class',
  specSection: '10',
  firstLineKeyword: 'class',
  directives: ['solid-fill'],
  pipeKeys: {
    node: ['description'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
