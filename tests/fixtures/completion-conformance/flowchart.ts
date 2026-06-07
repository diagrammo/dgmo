import type { ConformanceFixture } from './_types';

// Spec §5 §4.6 Options: direction-lr, orientation-vertical, solid-fill,
// no-notes. solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'flowchart',
  specSection: '5',
  firstLineKeyword: 'flowchart',
  directives: [
    'direction-lr',
    'orientation-vertical',
    'solid-fill',
    'no-notes',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
