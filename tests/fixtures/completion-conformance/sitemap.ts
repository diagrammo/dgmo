import type { ConformanceFixture } from './_types';

// Spec §12 §11.5 Options: direction-tb, active-tag.
// solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'sitemap',
  specSection: '12',
  firstLineKeyword: 'sitemap',
  directives: ['direction-tb', 'active-tag', 'solid-fill'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
