import type { ConformanceFixture } from './_types';

// Spec §12 §11.5 Options: direction-tb, active-tag.
// fill family via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'sitemap',
  structuralKeywords: ['tag'],
  specSection: '12',
  firstLineKeyword: 'sitemap',
  directives: [
    'no-legend',
    'direction-tb',
    'direction-lr',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'status'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
