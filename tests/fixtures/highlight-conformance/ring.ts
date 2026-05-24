import type { HighlightFixture } from './_types';

// Spec §24. Ring: chart-type, solid-fill directive, layer pipe metadata.
export const fixture: HighlightFixture = {
  chartType: 'ring',
  specSection: '24',
  source: `ring Sphere of Influence
solid-fill

Captain | color: red
Crew | description: Deckhands
The Sea | color: blue
`,
  assertions: [
    { text: 'ring', role: 'chartType' },
    { text: 'solid-fill', role: 'keyword' },
    { text: 'color', role: 'keyword' },
    { text: 'description', role: 'propertyName' },
    { text: '|', role: 'deprecatedSyntax' },
    { text: ':', role: 'separator' },
    { text: 'Captain', role: 'default' },
  ],
};
