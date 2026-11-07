import type { HighlightFixture } from './_types';

// Bracket chart: chart-type declaration, `rounds` column names, a `[Side]`
// header, seeded field, and decided (`beats`) / pending (`vs`) match lines.
export const fixture: HighlightFixture = {
  chartType: 'bracket',
  specSection: '24F',
  source: `bracket Grog Cup
rounds Semis, Final

[Port Side]
  seed 1 Black Pearl
  seed 2 Salty Dog
  Black Pearl beats Salty Dog 6-5

Black Pearl vs Kraken
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'bracket', role: 'chartType' },
  ],
};
