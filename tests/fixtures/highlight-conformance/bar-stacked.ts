import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'bar-stacked',
  specSection: '16',
  source: `bar-stacked
series
  X
  Y
x-label Quarter
orientation-horizontal
no-value

Q1 10 20
`,
  assertions: [
    { text: 'bar-stacked', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: 'x-label', role: 'keyword' },
    { text: 'orientation-horizontal', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
  ],
};
