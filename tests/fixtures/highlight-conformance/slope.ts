import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'slope',
  specSection: '17',
  source: `slope Fleet Strength
period 1715 1725

Blackbeard 40 4
Roberts 12 52
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'slope', role: 'chartType' },
    { text: 'period', role: 'keyword' },
  ],
};
