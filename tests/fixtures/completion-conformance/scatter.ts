import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §16 / §15.2. Point-cloud — supports `no-name`. `size-label` for
// the size axis (bubble variant).
export const fixture: ConformanceFixture = {
  chartType: 'scatter',
  specSection: '16',
  firstLineKeyword: 'scatter',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'no-name',
    'x-label',
    'y-label',
    'size-label',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
