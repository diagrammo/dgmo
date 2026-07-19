import type { ConformanceFixture } from './_types';

// Spec §11 §10.4 Options: hide, active-tag.
// fill family via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'kanban',
  structuralKeywords: ['tag'],
  specSection: '11',
  firstLineKeyword: 'kanban',
  directives: [
    'no-legend',
    'hide',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline',
  ],
  pipeKeys: {
    node: ['description', 'assignee', 'due'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
