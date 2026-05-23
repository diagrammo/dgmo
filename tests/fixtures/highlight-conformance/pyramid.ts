import type { HighlightFixture } from './_types';

// Spec §23. Pyramid: chart-type, inverted directive, layer pipe metadata.
export const fixture: HighlightFixture = {
  chartType: 'pyramid',
  specSection: '23',
  source: `pyramid Maslow
inverted

Self-Actualization | color: purple
Esteem | color: blue
Safety | description: Security and health
`,
  assertions: [
    { text: 'pyramid', role: 'chartType' },
    { text: 'inverted', role: 'keyword' },
    { text: 'color', role: 'keyword' },
    { text: 'description', role: 'keyword' },
    { text: '|', role: 'deprecatedSyntax' },
  ],
};
