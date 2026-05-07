import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'class',
  specSection: '10',
  source: `class Domain
no-auto-color

User
  + name: string
  + age: int
`,
  assertions: [
    { text: 'class', role: 'chartType' },
    { text: 'no-auto-color', role: 'keyword' },
  ],
};
