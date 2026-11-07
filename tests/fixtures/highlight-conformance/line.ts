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
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'line', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: 'x-label', role: 'keyword' },
    { text: 'y-label', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
    { text: '100', role: 'number' },
  ],
};
