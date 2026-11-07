import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'class',
  specSection: '10',
  source: `class Domain

User
  + name: string
  + age: int
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'class', role: 'chartType' },
  ],
};
