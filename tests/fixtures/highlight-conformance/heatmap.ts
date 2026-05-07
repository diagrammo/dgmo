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
`,
  assertions: [
    { text: 'heatmap', role: 'chartType' },
    { text: 'columns', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
  ],
};
