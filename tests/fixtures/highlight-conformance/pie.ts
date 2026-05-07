import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'pie',
  specSection: '16',
  source: `pie Revenue
no-name
no-value
no-percent

A 30
B 70
`,
  assertions: [
    { text: 'pie', role: 'chartType' },
    { text: 'no-name', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
    { text: 'no-percent', role: 'keyword' },
    { text: '30', role: 'number' },
  ],
};
