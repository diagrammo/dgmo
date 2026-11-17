import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// No spec section yet (#1873 lands the type first; the spec row follows):
// tag, active-tag, no-legend, the fill family, `type:` on an entity.
export const fixture: ConformanceFixture = {
  chartType: 'ownership',
  structuralKeywords: ['tag'],
  specSection: 'ownership',
  firstLineKeyword: 'ownership',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['type'],
  },
};
