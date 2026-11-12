import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §40: section keywords, tag, active-tag, x-label, y-label, no-axes, no-tint-items.
export const fixture: ConformanceFixture = {
  chartType: 'swot',
  structuralKeywords: [
    'tag',
    'strengths',
    'weaknesses',
    'opportunities',
    'threats',
  ],
  specSection: '40',
  firstLineKeyword: 'swot',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'active-tag',
    'x-label',
    'y-label',
    'no-axes',
    'no-tint-items',
  ],
  pipeKeys: {},
};
