import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'doughnut',
  specSection: '16',
  source: `doughnut
no-name
no-value
no-percent

A 30
`,
  assertions: [
    { text: 'doughnut', role: 'chartType' },
    { text: 'no-name', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
    { text: 'no-percent', role: 'keyword' },
  ],
};
