import type { HighlightFixture } from './_types';

// Spec §24B. Map: chart-type, directives (region/metric), region-fill score
// metadata, and the `:` separator.
export const fixture: HighlightFixture = {
  chartType: 'map',
  specSection: '24B',
  source: `map US Sales
region us-states
metric Sales

California score: 92
poi Denver label: HQ
`,
  assertions: [
    { text: 'map', role: 'chartType' },
    { text: 'score', role: 'propertyName' },
    { text: ':', role: 'separator' },
  ],
};
