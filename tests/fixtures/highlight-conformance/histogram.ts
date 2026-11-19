import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'histogram',
  specSection: '16',
  source: `histogram Delivery time
x-axis Minutes
bin-width 5
percent
mean

12 15 17.5 21
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'histogram', role: 'chartType' },
    { text: 'x-axis', role: 'keyword' },
    { text: 'bin-width', role: 'keyword' },
    { text: 'percent', role: 'keyword' },
    { text: 'mean', role: 'keyword' },
  ],
};
