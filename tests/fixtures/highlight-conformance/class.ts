import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'class',
  specSection: '10',
  source: `class Domain

User
  + name: string
  + age: int
`,
  assertions: [{ text: 'class', role: 'chartType' }],
};
