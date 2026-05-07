import type { ConformanceFixture } from './_types';

// Spec §8 §7.7 Options: direction-tb, active-tag. solid-fill via
// SOLID_FILL_CAPABLE. Pipe metadata in PIPE_METADATA: description, tech.
export const fixture: ConformanceFixture = {
  chartType: 'c4',
  specSection: '8',
  firstLineKeyword: 'c4',
  directives: ['direction-tb', 'active-tag', 'solid-fill'],
  pipeKeys: {
    node: ['description', 'tech', 'technology'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
