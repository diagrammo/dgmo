import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'dot',
  specSection: 'dot',
  source: `dot Engagement score
series 2020, 2025
sort gap
gap
connector direction

Review the roles list 71 78
Sales 64 61
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'dot', role: 'chartType' },
    { text: 'series', role: 'keyword' },
    { text: 'sort', role: 'keyword' },
    { text: 'gap', role: 'keyword' },
    { text: 'connector', role: 'keyword' },
  ],
};
