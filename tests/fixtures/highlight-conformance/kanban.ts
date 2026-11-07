import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'kanban',
  specSection: '11',
  source: `kanban Sprint 14
hide tag:Done
active-tag Priority

[Todo]
  Task | priority: High
[Doing]
  Other Task
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'kanban', role: 'chartType' },
    { text: 'hide', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
  ],
};
