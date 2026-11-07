import type { HighlightFixture } from './_types';

// Block diagram: chart-type declaration, a `tag` group, and a row of bracketed
// blocks with tag metadata OUTSIDE the bracket.
export const fixture: HighlightFixture = {
  chartType: 'block',
  specSection: '24D',
  source: `block System

tag Layer as l
  Edge blue

[Clients] l: Edge
  [Web] [Mobile]
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'block', role: 'chartType' },
    { text: 'tag', role: 'definitionKeyword' },
  ],
};
