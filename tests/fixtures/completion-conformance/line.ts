import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Cartesian — `no-value` only. `era` is a structural
// keyword (declares an era band), not a directive.
export const fixture: ConformanceFixture = {
  chartType: 'line',
  specSection: '16',
  firstLineKeyword: 'line',
  directives: [
    'series',
    'fill',
    'x-label',
    'y-label',
    'y-right-label',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
