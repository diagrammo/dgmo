import type { ConformanceFixture } from './_types';

// Spec §16 / §15.5. Flow family — name suppression deferred to Phase 2c
// (§15.1 table). No chart-specific directives currently.
export const fixture: ConformanceFixture = {
  chartType: 'sankey',
  specSection: '16',
  firstLineKeyword: 'sankey',
  directives: [],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
