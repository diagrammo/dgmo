import type { HighlightFixture } from './_types';

// Spec §22. Journey-map: chart-type, persona structural keyword,
// directives, step pipe metadata (`score`).
export const fixture: HighlightFixture = {
  chartType: 'journey-map',
  specSection: '22',
  source: `journey-map Buying a Laptop
no-legend

persona Tech-Savvy Shopper

[Research]
  Compare specs | score: 4
    description: Checked review sites
    pain: Too many options
[Purchase]
  Add to cart | score: 3
`,
  assertions: [
    { text: 'journey-map', role: 'chartType' },
    { text: 'no-legend', role: 'keyword' },
    { text: 'persona', role: 'keyword' },
    { text: 'score', role: 'propertyName' },
    { text: 'description', role: 'propertyName' },
    { text: 'pain', role: 'propertyName' },
    { text: '[', role: 'bracket' },
  ],
};
