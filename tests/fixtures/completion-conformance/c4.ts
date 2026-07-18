import type { ConformanceFixture } from './_types';

// Spec §8 §7.7 Options: direction-tb, active-tag. fill family via
// FILL_FAMILY_CAPABLE. Pipe metadata in PIPE_METADATA: description, tech.
export const fixture: ConformanceFixture = {
  chartType: 'c4',
  structuralKeywords: ['containers', 'components', 'deployment', 'tag'],
  specSection: '8',
  firstLineKeyword: 'c4',
  directives: [
    'direction-tb',
    'direction-lr',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'tech', 'technology'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
