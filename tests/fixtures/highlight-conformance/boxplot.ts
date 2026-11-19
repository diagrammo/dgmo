import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'boxplot',
  specSection: '16',
  source: `boxplot Cycle time
points
mean

[Platform]
2 3 3 4 5 5 6 8 21
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'boxplot', role: 'chartType' },
    { text: 'points', role: 'keyword' },
    { text: 'mean', role: 'keyword' },
  ],
};
