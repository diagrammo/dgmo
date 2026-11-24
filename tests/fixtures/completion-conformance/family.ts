import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §32 (Family). Person keys are the closed GEDCOM-flavoured set (§32.6);
// `m` is the union-level marriage year.
export const fixture: ConformanceFixture = {
  chartType: 'family',
  specSection: '32',
  firstLineKeyword: 'family',
  structuralKeywords: ['tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'active-tag',
    'highlight',
    'generations',
    'no-daggers',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: [
      'sex',
      'b',
      'd',
      'bp',
      'dp',
      'occupation',
      'military',
      'education',
      'religion',
      'burial',
      'm',
    ],
  },
};
