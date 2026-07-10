import type { HighlightFixture } from './_types';

// Body: chart-type declaration, a bare form/view directive, a `tag` group, and
// a catalog part with a trailing tag value + bare-body description.
export const fixture: HighlightFixture = {
  chartType: 'body',
  specSection: 'body',
  source: `body Push Day
muscle

tag Effort as e
  Primary red

chest  e: Primary
  Barbell bench press — 4×8
`,
  assertions: [
    { text: 'body', role: 'chartType' },
    { text: 'tag', role: 'definitionKeyword' },
  ],
};
