import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §17 / §16.3. One option: order (enum).
export const fixture: ConformanceFixture = {
  chartType: 'arc',
  specSection: '17',
  firstLineKeyword: 'arc',
  directives: [
    ...FRAME_DIRECTIVES,
    'order',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
  enumChecks: [
    {
      directive: 'order',
      values: ['appearance', 'name', 'group', 'degree'],
    },
  ],
};
