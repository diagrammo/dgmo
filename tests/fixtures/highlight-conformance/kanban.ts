import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'kanban',
  specSection: '11',
  source: `kanban Sprint 14
no-auto-color
hide tag:Done
active-tag Priority

[Todo]
  Task | priority: High
[Doing]
  Other Task
`,
  assertions: [
    { text: 'kanban', role: 'chartType' },
    { text: 'no-auto-color', role: 'keyword' },
    { text: 'hide', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
  ],
};
