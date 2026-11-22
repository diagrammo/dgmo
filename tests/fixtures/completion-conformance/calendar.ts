import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §41.4 Options: year, unit, from, week-start, max, heat, no-summary,
// no-legend.
export const fixture: ConformanceFixture = {
  chartType: 'calendar',
  structuralKeywords: [],
  specSection: 'calendar',
  firstLineKeyword: 'calendar',
  directives: [
    'no-legend',
    'year',
    'unit',
    'from',
    'week-start',
    'max',
    'heat',
    'no-summary',
    ...FRAME_DIRECTIVES,
  ],
  pipeKeys: {},
};
