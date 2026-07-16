import type { ConformanceFixture } from './_types';

// Spec §16 / §15.2. Point-cloud — supports `no-name`. `size-label` for
// the size axis (bubble variant).
export const fixture: ConformanceFixture = {
  chartType: 'scatter',
  specSection: '16',
  firstLineKeyword: 'scatter',
  directives: [
    'no-name',
    'x-label',
    'y-label',
    'size-label',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
