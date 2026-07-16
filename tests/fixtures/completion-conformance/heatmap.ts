import type { ConformanceFixture } from './_types';

// Spec §16 / §15.3. `columns` declares column labels; `no-value` suppresses
// cell value text. the fill family saturates the heat gradient.
export const fixture: ConformanceFixture = {
  chartType: 'heatmap',
  specSection: '16',
  firstLineKeyword: 'heatmap',
  directives: [
    'columns',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
