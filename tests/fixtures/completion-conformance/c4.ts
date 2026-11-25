import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §8 §7.7 Options: direction-tb, active-tag, level (#2328). fill family via
// FILL_FAMILY_CAPABLE. Pipe metadata in PIPE_METADATA: description, tech.
export const fixture: ConformanceFixture = {
  chartType: 'c4',
  structuralKeywords: ['containers', 'components', 'deployment', 'tag'],
  specSection: '8',
  firstLineKeyword: 'c4',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'direction-tb',
    'direction-lr',
    'active-tag',
    'level',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'tech', 'technology'],
  },
};
