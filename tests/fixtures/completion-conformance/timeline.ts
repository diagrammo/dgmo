import type { ConformanceFixture } from './_types';

// Spec §15 (Timeline). `era` and `marker` are structural keywords that
// declare era bands and event markers — not directives.
export const fixture: ConformanceFixture = {
  chartType: 'timeline',
  structuralKeywords: ['era', 'marker', 'tag'],
  specSection: '15',
  firstLineKeyword: 'timeline',
  directives: [
    'no-legend',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    // Universal date directives (§ BL-121).
    'year',
    'date-order',
    'no-current-year',
  ],
  pipeKeys: {
    node: ['description'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
