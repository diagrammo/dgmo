import type { ConformanceFixture } from './_types';

// Spec §15 (Timeline). `era` and `marker` are structural keywords that
// declare era bands and event markers — not directives. No chart-specific
// directives.
export const fixture: ConformanceFixture = {
  chartType: 'timeline',
  specSection: '15',
  firstLineKeyword: 'timeline',
  directives: [],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
