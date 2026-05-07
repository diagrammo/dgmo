import type { ConformanceFixture } from './_types';

// Spec §24 (Ring Diagrams). Two layer-pipe keys (color, description) and
// one chart-specific directive (solid-fill). `inverted` is explicitly
// REJECTED by the parser per §24.5 — listed in `notFirstLineKeywords`.
export const fixture: ConformanceFixture = {
  chartType: 'ring',
  specSection: '24',
  firstLineKeyword: 'ring',

  directives: ['solid-fill'],

  pipeKeys: {
    layer: ['color', 'description'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
