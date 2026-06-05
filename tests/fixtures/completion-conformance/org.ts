import type { ConformanceFixture } from './_types';

// Spec §7 §6.5 Options: direction-tb, sub-node-label, show-sub-node-count,
// hide, active-tag. solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'org',
  structuralKeywords: ['tag'],
  specSection: '7',
  firstLineKeyword: 'org',
  directives: [
    'direction-tb',
    'sub-node-label',
    'show-sub-node-count',
    'hide',
    'active-tag',
    'solid-fill',
  ],
  pipeKeys: {
    node: ['description', 'role', 'location', 'email', 'phone'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
