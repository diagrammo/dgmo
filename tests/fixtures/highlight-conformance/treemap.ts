import type { HighlightFixture } from './_types';

// Treemap: chart-type declaration, the `heat:` color-by-value metric key, and
// a bare trailing value number on a leaf.
export const fixture: HighlightFixture = {
  chartType: 'treemap',
  specSection: '25',
  source: `treemap Portfolio

tag Sector as s
  Tech blue

Tech s: Tech
  AAPL 180 heat: -2.4
  NVDA 220 heat: 4.1
`,
  assertions: [
    { text: 'treemap', role: 'chartType' },
    { text: 'tag', role: 'definitionKeyword' },
    { text: 'heat', role: 'propertyName' },
  ],
};
