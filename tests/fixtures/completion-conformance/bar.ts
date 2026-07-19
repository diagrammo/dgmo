import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1 (Simple Charts). Cartesian family — `no-value` only.
export const fixture: ConformanceFixture = {
  chartType: 'bar',
  specSection: '16',
  firstLineKeyword: 'bar',
  directives: [
    'no-legend',
    // Multi-series is declared by a `stack` or `group` layout header (#24);
    // `series` is rejected on bar.
    'stack',
    'group',
    'x-label',
    'y-label',
    'orientation-horizontal',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    // Color is in completion as a bar override; not formally documented in
    // §15.1 but tolerated for back-compat.
    'color',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
