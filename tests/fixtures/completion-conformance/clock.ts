import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §37 (Clock). Flat syntax: directives and entries, no colons (§37.1).
export const fixture: ConformanceFixture = {
  chartType: 'clock',
  specSection: '37',
  firstLineKeyword: 'clock',
  directives: [
    ...FRAME_DIRECTIVES,
    'analog',
    'hours',
    'workweek',
    'no-sun',
    'time-24',
    'direction-lr',
    'direction-tb',
    'color-by',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
  enumChecks: [
    {
      directive: 'color-by',
      values: ['place', 'work', 'daylight', 'time', 'none'],
    },
  ],
};
