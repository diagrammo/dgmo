import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'multi-line',
  specSection: '16',
  source: `multi-line
series
  A
  B
x-label X
no-value

Q1 100 200
`,
  assertions: [
    { text: 'multi-line', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: 'x-label', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
  ],
};
