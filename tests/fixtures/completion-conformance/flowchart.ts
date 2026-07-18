import type { ConformanceFixture } from './_types';

// Spec §5 §4.6 Options: direction-lr, the fill family, no-notes. fill family
// via FILL_FAMILY_CAPABLE. The phantom `orientation-vertical` (spec'd +
// completion, zero implementation) was deleted in decision #48.
export const fixture: ConformanceFixture = {
  chartType: 'flowchart',
  specSection: '5',
  firstLineKeyword: 'flowchart',
  directives: [
    'direction-lr',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    'no-notes',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
