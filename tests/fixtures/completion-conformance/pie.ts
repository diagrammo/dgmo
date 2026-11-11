import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §16 / §15.1. Share-of-total family — supports the full no-* trio.
export const fixture: ConformanceFixture = {
  chartType: 'pie',
  specSection: '16',
  firstLineKeyword: 'pie',
  directives: [
    ...FRAME_DIRECTIVES,
    'hole',
    'no-center-total',
    'sort',
    'other-below',
    'no-name',
    'no-value',
    'no-percent',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
