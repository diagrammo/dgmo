import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §35 (Bracket). `beats`/`vs` are infix operators, `[Side]` is a bracket
// heading.
export const fixture: ConformanceFixture = {
  chartType: 'bracket',
  specSection: '35',
  firstLineKeyword: 'bracket',
  structuralKeywords: ['tag'],
  directives: [
    ...FRAME_DIRECTIVES,
    'rounds',
    'seed',
    'no-round',
    'no-legend',
    'single-elim',
    'double-elim',
    'seeded',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {},
};
