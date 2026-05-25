import type { ConformanceFixture } from './_types';

// Spec §6 §5.5 Options: direction-tb, solid-fill.
export const fixture: ConformanceFixture = {
  chartType: 'state',
  specSection: '6',
  firstLineKeyword: 'state',
  directives: ['direction-tb', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
