import type { HighlightFixture } from './_types';

// Event-line: chart-type declaration, a `tag` group, an ISO line-prefix date,
// a trailing tag value, and a bare-body description.
export const fixture: HighlightFixture = {
  chartType: 'event-line',
  specSection: '28',
  source: `event-line Super Bowl Halftime Shows

tag Genre as g
  Pop blue

2012-02-05 XLVI  g: Pop
  Madonna with LMFAO and Nicki Minaj.
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'event-line', role: 'chartType' },
    { text: 'tag', role: 'definitionKeyword' },
  ],
};
