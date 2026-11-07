import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'state',
  specSection: '6',
  source: `state Order
direction-tb
fill-solid

[*] -> Pending
Pending -submit-> Validating
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'state', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'fill-solid', role: 'keyword' },
  ],
};
