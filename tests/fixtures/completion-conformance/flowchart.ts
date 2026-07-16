import type { ConformanceFixture } from './_types';

// Spec §5 §4.6 Options: direction-lr, orientation-vertical, the fill family,
// no-notes. fill family via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'flowchart',
  specSection: '5',
  firstLineKeyword: 'flowchart',
  directives: [
    'direction-lr',
    'orientation-vertical',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    'no-notes',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
