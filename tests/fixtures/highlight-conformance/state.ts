import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'state',
  specSection: '6',
  source: `state Order
direction-tb
no-color
solid-fill

[*] -> Pending
Pending -submit-> Validating
`,
  assertions: [
    { text: 'state', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'no-color', role: 'keyword' },
    { text: 'solid-fill', role: 'keyword' },
  ],
};
