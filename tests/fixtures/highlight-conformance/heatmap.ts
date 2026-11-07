import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'heatmap',
  specSection: '16',
  source: `heatmap
columns
  Jan
  Feb
no-value

RowA 5 4
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'heatmap', role: 'chartType' },
    { text: 'columns', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
  ],
};
