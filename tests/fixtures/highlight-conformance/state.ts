import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'state',
  specSection: '6',
  source: `state Order
direction-tb
fill-solid

[*] -> Pending
Pending -submit-> Validating
`,
  assertions: [
    { text: 'state', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'fill-solid', role: 'keyword' },
  ],
};
