import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §16 / §15.1. Share-of-total — same shape as pie.
export const fixture: ConformanceFixture = {
  chartType: 'polar-area',
  specSection: '16',
  firstLineKeyword: 'polar-area',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-name',
    'no-value',
    'no-percent',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
