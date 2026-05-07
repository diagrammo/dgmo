import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'radar',
  specSection: '16',
  source: `radar Skills
no-value

A 5 4 3
`,
  assertions: [
    { text: 'radar', role: 'chartType' },
    { text: 'no-value', role: 'keyword' },
    { text: '5', role: 'number' },
  ],
};
