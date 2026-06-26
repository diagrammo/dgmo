import type { ConformanceFixture } from './_types';

// Spec §14 §13.6 + §13.8. Directive: `direction TB|LR`. Options:
// active-tag, hide, heat, show-values. solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'boxes-and-lines',
  structuralKeywords: ['tag'],
  specSection: '14',
  firstLineKeyword: 'boxes-and-lines',
  directives: [
    'direction',
    'active-tag',
    'hide',
    'heat',
    'show-values',
    'solid-fill',
  ],
  pipeKeys: {
    node: ['description', 'heat'],
  },
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    { directive: 'direction', values: ['LR', 'TB'] },
  ],
};
