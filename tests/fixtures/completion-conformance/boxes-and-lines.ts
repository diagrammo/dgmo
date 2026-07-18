import type { ConformanceFixture } from './_types';

// Spec §14 §13.6 + §13.8. Directives: direction booleans (§1.9; key+value
// `direction TB|LR` parses as legacy). Options:
// active-tag, hide, heat, no-value (values default-on per decision #48;
// legacy `show-values` is a no-op). fill family via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'boxes-and-lines',
  structuralKeywords: ['tag'],
  specSection: '14',
  firstLineKeyword: 'boxes-and-lines',
  directives: [
    'no-legend',
    'direction-tb',
    'direction-lr',
    'active-tag',
    'hide',
    'heat',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'heat'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
