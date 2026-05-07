import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'funnel',
  specSection: '16',
  source: `funnel
no-name
no-value

Visits 1200
Signups 800
Purchases 200
`,
  assertions: [
    { text: 'funnel', role: 'chartType' },
    { text: 'no-name', role: 'keyword' },
    { text: 'no-value', role: 'keyword' },
  ],
};
