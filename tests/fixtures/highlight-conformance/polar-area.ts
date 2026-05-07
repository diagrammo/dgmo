import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'polar-area',
  specSection: '16',
  source: `polar-area
no-name
no-value
no-percent

A 30
`,
  assertions: [
    { text: 'polar-area', role: 'chartType' },
    { text: 'no-name', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
    { text: 'no-percent', role: 'keyword' },
  ],
};
