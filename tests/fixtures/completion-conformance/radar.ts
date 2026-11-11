import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §16 / §15.1. Cartesian — `no-value` only.
export const fixture: ConformanceFixture = {
  chartType: 'radar',
  specSection: '16',
  firstLineKeyword: 'radar',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
