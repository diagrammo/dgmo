import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §34 (Goal). `actual`, `target`, `bands` and `note` are space-separated
// key-value directives; `thermometer` / `gauge` pick the face.
export const fixture: ConformanceFixture = {
  chartType: 'goal',
  specSection: '34',
  firstLineKeyword: 'goal',
  directives: [
    ...FRAME_DIRECTIVES,
    'actual',
    'target',
    'bands',
    'note',
    'thermometer',
    'gauge',
    'no-percent',
    'no-value',
    'no-notes',
    'no-auto-color',
    'no-ribbon',
    'no-ribbon-labels',
    'shared-scale',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
