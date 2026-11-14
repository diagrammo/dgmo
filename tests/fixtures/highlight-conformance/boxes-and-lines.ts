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
API ~~ DB
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'boxes-and-lines', role: 'chartType' },
    { text: 'direction', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
    { text: 'hide', role: 'keyword' },
    { text: 'description', role: 'propertyName' },
    // The invisible line `A ~~ B` (#2002) reads as an operator, like `->`.
    { text: '~', role: 'operator' },
  ],
};
