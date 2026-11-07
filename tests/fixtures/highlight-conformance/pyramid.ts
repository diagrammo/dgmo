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
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'pyramid', role: 'chartType' },
    { text: 'inverted', role: 'keyword' },
    { text: 'color', role: 'keyword' },
    { text: 'description', role: 'propertyName' },
    { text: '|', role: 'deprecatedSyntax' },
  ],
};
