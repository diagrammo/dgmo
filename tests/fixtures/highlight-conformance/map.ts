import type { HighlightFixture } from './_types';

// Spec §24B. Map: chart-type, directives (region-heat), region-fill heat
// metadata, and the `:` separator.
export const fixture: HighlightFixture = {
  chartType: 'map',
  specSection: '24B',
  source: `map US Sales
region-heat Sales

California heat: 92
poi Denver label: HQ
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'map', role: 'chartType' },
    { text: 'heat', role: 'propertyName' },
    { text: ':', role: 'separator' },
  ],
};
