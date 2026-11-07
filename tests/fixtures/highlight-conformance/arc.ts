import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'arc',
  specSection: '17',
  source: `arc Alliances
order group

[Caribbean] red
  Blackbeard -> Bonnet 8
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'arc', role: 'chartType' },
    { text: 'order', role: 'keyword' },
  ],
};
