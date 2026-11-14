import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §14 §13.6 + §13.8. Directives: direction booleans (§1.9; key+value
// `direction TB|LR` parses as legacy). Options:
// active-tag, hide, heat, no-value (values default-on per decision #48;
// legacy `show-values` is a no-op). fill family via FILL_FAMILY_CAPABLE.
// Rank hints `same-rank` and `order` (#1840): dgmo's language reference
// §13.6; the root spec's §14 does not list them yet.
export const fixture: ConformanceFixture = {
  chartType: 'boxes-and-lines',
  structuralKeywords: ['tag'],
  specSection: '14',
  firstLineKeyword: 'boxes-and-lines',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'direction-tb',
    'direction-lr',
    'active-tag',
    'hide',
    'heat',
    'no-value',
    'same-rank',
    'order',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'heat'],
  },
};
