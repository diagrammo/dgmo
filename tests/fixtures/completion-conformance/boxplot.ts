import type { ConformanceFixture } from './_types';
import {
  FRAME_DIRECTIVES,
  Y_AXIS_DIRECTIVES,
  NUMBER_FORMAT_DIRECTIVES,
} from './_frame';

// Spec §16 / §15.8. Box plot (#1848) — free numbers under `[Group]`
// headers; `y-axis` is the value axis in either orientation, `x-axis` a
// title for the groups.
export const fixture: ConformanceFixture = {
  chartType: 'boxplot',
  specSection: '16',
  firstLineKeyword: 'boxplot',
  directives: [
    ...FRAME_DIRECTIVES,
    ...NUMBER_FORMAT_DIRECTIVES,
    ...Y_AXIS_DIRECTIVES,
    'x-axis',
    'y-axis',
    'points',
    'mean',
    'orientation-horizontal',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
