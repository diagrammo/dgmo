import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'waterfall',
  specSection: 'waterfall',
  source: `waterfall Revenue bridge
direction down
no-connectors
orientation-horizontal

FY24 1200 total
Churn -180
Review the roles list 5
FY25 total
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'waterfall', role: 'chartType' },
    { text: 'direction', role: 'keyword' },
    { text: 'no-connectors', role: 'keyword' },
    { text: 'orientation-horizontal', role: 'keyword' },
  ],
};
