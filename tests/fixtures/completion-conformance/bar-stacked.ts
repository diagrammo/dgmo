import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Cartesian + stacked — `no-value` suppresses per-segment
// values inside each stack (not stack totals — see §15.1 clarification).
export const fixture: ConformanceFixture = {
  chartType: 'bar-stacked',
  specSection: '16',
  firstLineKeyword: 'bar-stacked',
  directives: [
    'series',
    'x-label',
    'y-label',
    'orientation-horizontal',
    'no-value',
    'solid-fill',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
