import type { HighlightFixture } from './_types';

// Sketch: chart-type declaration, a `tag` group, bare-name shapes with
// same-line metadata, an alias, an indented edge, and a [Box].
export const fixture: HighlightFixture = {
  chartType: 'sketch',
  specSection: '31',
  source: `sketch Plunder Pipeline

tag Crew
  Deck

Spyglass Feed shape: cloud, at: 0 0, crew: Deck
  -sightings-> con
Captain Console as con at: 2 0

[Below Decks] at: 2 2
  Booty Queue shape: queue, at: 0 0
`,
  assertions: [
    { text: 'sketch', role: 'chartType' },
    { text: 'tag', role: 'definitionKeyword' },
    { text: 'shape', role: 'propertyName' },
    { text: 'at', role: 'propertyName' },
  ],
};
