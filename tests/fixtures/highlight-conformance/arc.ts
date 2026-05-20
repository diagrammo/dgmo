import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'arc',
  specSection: '17',
  source: `arc Alliances
order group

[Caribbean] red
  Blackbeard -> Bonnet 8
`,
  assertions: [
    { text: 'arc', role: 'chartType' },
    { text: 'order', role: 'keyword' },
  ],
};
