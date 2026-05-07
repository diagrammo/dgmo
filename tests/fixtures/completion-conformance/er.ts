import type { ConformanceFixture } from './_types';

// Spec §9 §8.5 Options: notation (chen/crow), active-tag. solid-fill
// via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'er',
  specSection: '9',
  firstLineKeyword: 'er',
  directives: ['notation', 'active-tag', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    { directive: 'notation', values: ['chen', 'crow'] },
  ],
};
