import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'sitemap',
  specSection: '12',
  source: `sitemap Website
direction-tb
active-tag X

Home
  -About-> About
  -Blog-> Blog
`,
  assertions: [
    { text: 'sitemap', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
  ],
};
