import type { ConformanceFixture } from './_types';

// Spec §6 §5.6 Options: direction-tb, fill family, no-notes.
export const fixture: ConformanceFixture = {
  chartType: 'state',
  specSection: '6',
  firstLineKeyword: 'state',
  directives: [
    'direction-tb',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    'no-notes',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
