import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §28 (Event Line). Eras are `[Name]` bracket headings. Event metadata is
// tag values only in v1 (§28.2), so there are no pipe keys.
export const fixture: ConformanceFixture = {
  chartType: 'event-line',
  specSection: '28',
  firstLineKeyword: 'event-line',
  structuralKeywords: ['tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    // Universal date directives (§2B).
    'year',
    'date-order',
    'no-current-year',
    'no-scale',
    'side',
    'no-box',
    'no-legend',
    'now',
    // §28.3: the `TBD` date prefix.
    'TBD',
    // §1.9: restates the only supported direction.
    'direction-lr',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
