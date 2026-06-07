import type { ConformanceFixture } from './_types';

// Spec §6 §5.6 Options: direction-tb, solid-fill, no-notes.
export const fixture: ConformanceFixture = {
  chartType: 'state',
  specSection: '6',
  firstLineKeyword: 'state',
  directives: ['direction-tb', 'solid-fill', 'no-notes'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
