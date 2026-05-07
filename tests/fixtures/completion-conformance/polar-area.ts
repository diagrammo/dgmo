import type { ConformanceFixture } from './_types';

// Spec §16 / §15.1. Share-of-total — same shape as pie.
export const fixture: ConformanceFixture = {
  chartType: 'polar-area',
  specSection: '16',
  firstLineKeyword: 'polar-area',
  directives: ['no-name', 'no-value', 'no-percent', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
