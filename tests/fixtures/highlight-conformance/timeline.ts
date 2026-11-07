import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'timeline',
  specSection: '15',
  source: `timeline Project Atlas
era 2020 -> 2024 Phase 1 (red)
marker 2022-01 Launch (blue)

2021 First milestone
2022-03 Mid-checkpoint
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'timeline', role: 'chartType' },
    { text: 'era', role: 'keyword' },
    { text: 'marker', role: 'keyword' },
  ],
};
