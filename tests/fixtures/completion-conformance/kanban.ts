import type { ConformanceFixture } from './_types';

// Spec §11 §10.4 Options: hide, active-tag.
// solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'kanban',
  specSection: '11',
  firstLineKeyword: 'kanban',
  directives: ['hide', 'active-tag', 'solid-fill'],
  pipeKeys: {
    node: ['description', 'assignee', 'due'],
  },
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
