import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// No spec section yet (#1855 lands the type first; the spec row follows):
// year, unit, from, week-start, max, no-summary, no-legend.
export const fixture: ConformanceFixture = {
  chartType: 'calendar-heatmap',
  structuralKeywords: [],
  specSection: 'calendar-heatmap',
  firstLineKeyword: 'calendar-heatmap',
  directives: [
    'no-legend',
    'year',
    'unit',
    'from',
    'week-start',
    'max',
    'no-summary',
    ...FRAME_DIRECTIVES,
  ],
  pipeKeys: {},
};
