import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1 (Simple Charts). Cartesian family — `no-value` only.
export const fixture: ConformanceFixture = {
  chartType: 'bar',
  specSection: '16',
  firstLineKeyword: 'bar',
  directives: [
    'series',
    'x-label',
    'y-label',
    'orientation-horizontal',
    'no-value',
    'solid-fill',
    // Color is in completion as a bar override; not formally documented in
    // §15.1 but tolerated for back-compat.
    'color',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
