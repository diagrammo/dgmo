import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §30 (Block). Node metadata is `span`, the bare `collapsed` flag and tag
// values (§30.5).
export const fixture: ConformanceFixture = {
  chartType: 'block',
  specSection: '30',
  firstLineKeyword: 'block',
  structuralKeywords: ['tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    'columns',
    'no-legend',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: { node: ['span', 'collapsed'] },
};
