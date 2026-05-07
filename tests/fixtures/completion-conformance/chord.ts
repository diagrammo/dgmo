import type { ConformanceFixture } from './_types';

// Spec §16 / §15.6. Flow family — same shape as sankey.
export const fixture: ConformanceFixture = {
  chartType: 'chord',
  specSection: '16',
  firstLineKeyword: 'chord',
  directives: ['solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
