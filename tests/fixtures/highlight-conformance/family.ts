import type { HighlightFixture } from './_types';

// Family (genealogy): chart-type declaration, a `tag` group, standalone person
// with metadata, a union line (`+`), and indented children.
export const fixture: HighlightFixture = {
  chartType: 'family',
  specSection: '32',
  source: `family The Rackham Line

tag Allegiance as loyalty
  Brethren red

Elizabeth Swann b: 1687, sex: f, loyalty: Brethren
Elizabeth Swann + "Will Turner" m: 1729
  Henry Turner sex: m
  Anna adopted
`,
  assertions: [
    { text: 'family', role: 'chartType' },
    { text: 'tag', role: 'definitionKeyword' },
  ],
};
