import type { HighlightFixture } from './_types';

// Clock chart: chart-type declaration plus flat board directives (`face`,
// `hours`, `days`) and place rows (`<place> <IANA/Zone> as <label>`). No colon
// anywhere.
export const fixture: HighlightFixture = {
  chartType: 'clock',
  specSection: '37',
  source: `clock Crew standups
face analog
hours 9-17
days mon-fri

London        Europe/London        as UK team
New York      America/New_York     as Dani (NY)
`,
  assertions: [{ text: 'clock', role: 'chartType' }],
};
