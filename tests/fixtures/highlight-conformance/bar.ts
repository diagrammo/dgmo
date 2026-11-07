import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'bar',
  specSection: '16',
  source: `bar Revenue
series
  Sales red
  Profit blue
no-value

North 850
South 620
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'bar', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
    { text: '850', role: 'number' },
  ],
};
