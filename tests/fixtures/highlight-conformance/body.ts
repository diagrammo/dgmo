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
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'body', role: 'chartType' },
    { text: 'tag', role: 'definitionKeyword' },
  ],
};
