import type { ConformanceFixture } from './_types';

// Spec §6 §5.5 Options: direction-tb, no-color, solid-fill.
export const fixture: ConformanceFixture = {
  chartType: 'state',
  specSection: '6',
  firstLineKeyword: 'state',
  directives: ['direction-tb', 'no-color', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
