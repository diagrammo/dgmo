import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §10 §9.5 Options: fill family via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'class',
  structuralKeywords: [
    'abstract',
    'interface',
    'enum',
    'extends',
    'implements',
  ],
  specSection: '10',
  firstLineKeyword: 'class',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description'],
  },
};
