import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §9 §8.5 Options: notation (chen/crow), active-tag. the fill family
// via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'er',
  structuralKeywords: ['tag'],
  specSection: '9',
  firstLineKeyword: 'er',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'notation',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'domain'],
  },
  enumChecks: [{ directive: 'notation', values: ['chen', 'crow'] }],
};
