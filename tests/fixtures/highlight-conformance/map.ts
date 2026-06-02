import type { HighlightFixture } from './_types';

// Spec §24B. Map: chart-type, directives (region-metric), region-fill value
// metadata, and the `:` separator.
export const fixture: HighlightFixture = {
  chartType: 'map',
  specSection: '24B',
  source: `map US Sales
region-metric Sales

California value: 92
poi Denver label: HQ
`,
  assertions: [
    { text: 'map', role: 'chartType' },
    { text: 'value', role: 'propertyName' },
    { text: ':', role: 'separator' },
  ],
};
