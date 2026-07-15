import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Share-of-total family — supports the full no-* trio.
export const fixture: ConformanceFixture = {
  chartType: 'pie',
  specSection: '16',
  firstLineKeyword: 'pie',
  directives: [
    'hole',
    'no-center-total',
    'no-name',
    'no-value',
    'no-percent',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
