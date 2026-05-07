import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'area',
  specSection: '16',
  source: `area
series
  A
x-label X
y-label Y
no-value

Q1 100
`,
  assertions: [
    { text: 'area', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: 'x-label', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
  ],
};
