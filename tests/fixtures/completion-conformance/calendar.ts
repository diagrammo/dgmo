import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §41.7 Options (#1877): the span, layout, orientation-horizontal,
// months-per-row, week-start, unit, empty, active-tag, the fill family,
// no-summary, no-legend, no-notes; `heat` and `max` for number groups.
export const fixture: ConformanceFixture = {
  chartType: 'calendar',
  structuralKeywords: ['tag'],
  specSection: 'calendar',
  firstLineKeyword: 'calendar',
  directives: [
    'no-legend',
    'active-tag',
    'year',
    'unit',
    'from',
    'week-start',
    'layout',
    'orientation-horizontal',
    'months-per-row',
    'empty',
    'max',
    'heat',
    'no-summary',
    'no-notes',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    ...FRAME_DIRECTIVES,
  ],
  pipeKeys: {},
};
