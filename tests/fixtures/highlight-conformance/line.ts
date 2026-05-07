import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'line',
  specSection: '16',
  source: `line Trends
series
  A
x-label Quarter
y-label Revenue
no-value

Q1 100
Q2 200
`,
  assertions: [
    { text: 'line', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: 'x-label', role: 'keyword' },
    { text: 'y-label', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
    { text: '100', role: 'number' },
  ],
};
