import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'bar',
  specSection: '16',
  source: `bar Revenue
series
  Sales(red)
  Profit(blue)
no-value

North 850
South 620
`,
  assertions: [
    { text: 'bar', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: '(red)', role: 'colorAnnotation' },
    { text: '(blue)', role: 'colorAnnotation' },
    { text: 'no-value', role: 'keyword' },
    { text: '850', role: 'number' },
  ],
};
