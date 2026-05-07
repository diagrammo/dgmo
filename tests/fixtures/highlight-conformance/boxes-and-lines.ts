import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'boxes-and-lines',
  specSection: '14',
  source: `boxes-and-lines
direction LR
active-tag X
hide tag:Past

API
  description: Gateway
DB
`,
  assertions: [
    { text: 'boxes-and-lines', role: 'chartType' },
    { text: 'direction', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
    { text: 'hide', role: 'keyword' },
    { text: 'description', role: 'keyword' },
  ],
};
