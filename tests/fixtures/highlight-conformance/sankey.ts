import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'sankey',
  specSection: '16',
  source: `sankey

Source green
  Target1 orange 3000
  Target2 2500
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'sankey', role: 'chartType' },
    { text: '3000', role: 'number' },
  ],
};
