import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'slope',
  specSection: '17',
  source: `slope Fleet Strength
period 1715 1725

Blackbeard 40 4
Roberts 12 52
`,
  assertions: [
    { text: 'slope', role: 'chartType' },
    { text: 'period', role: 'keyword' },
  ],
};
