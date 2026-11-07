import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'sequence',
  specSection: '3',
  source: `sequence Auth Flow
activations: on
active-tag X

User -Login-> API
  if valid
    API -200-> User
  else
    API -401-> User
    Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'sequence', role: 'chartType' },
    { text: 'activations', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
    { text: 'if', role: 'controlKeyword' },
    { text: 'else', role: 'controlKeyword' },
  ],
};
