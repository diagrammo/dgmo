import type { HighlightFixture } from './_types';

// Clock chart: chart-type declaration plus flat board directives (`analog`,
// `hours`, `days`) and entry rows (`<anchor> [as <label>]`, anchor = city |
// IANA id | UTC offset). No colon anywhere.
export const fixture: HighlightFixture = {
  chartType: 'clock',
  specSection: '37',
  source: `clock Crew standups
analog
hours 9-17
days mon-fri

London as UK team
New York as Dani (NY)
`,
  assertions: [{ text: 'clock', role: 'chartType' }],
};
