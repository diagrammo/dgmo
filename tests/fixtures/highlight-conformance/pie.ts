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
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'pie', role: 'chartType' },
    { text: 'no-name', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
    { text: 'no-percent', role: 'keyword' },
    { text: '30', role: 'number' },
  ],
};
