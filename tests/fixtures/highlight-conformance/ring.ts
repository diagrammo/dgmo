import type { HighlightFixture } from './_types';

// Spec §24. Ring: chart-type, fill-solid directive, layer pipe metadata.
export const fixture: HighlightFixture = {
  chartType: 'ring',
  specSection: '24',
  source: `ring Sphere of Influence
fill-solid

Captain | color: red
Crew | description: Deckhands
The Sea | color: blue
`,
  assertions: [
    { text: 'ring', role: 'chartType' },
    { text: 'fill-solid', role: 'keyword' },
    { text: 'color', role: 'keyword' },
    { text: 'description', role: 'propertyName' },
    { text: '|', role: 'deprecatedSyntax' },
    { text: ':', role: 'separator' },
    { text: 'Captain', role: 'default' },
  ],
};
