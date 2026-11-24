import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES, NUMBER_FORMAT_DIRECTIVES } from './_frame';

// Spec §15.7 (Histograms). Groups are `[Name] color` bracket headings.
export const fixture: ConformanceFixture = {
  chartType: 'histogram',
  specSection: '15.7',
  firstLineKeyword: 'histogram',
  directives: [
    ...FRAME_DIRECTIVES,
    ...NUMBER_FORMAT_DIRECTIVES,
    'no-legend',
    'x-axis',
    'y-axis',
    'bin-width',
    'bins',
    'bin-start',
    'percent',
    'mean',
    'median',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
