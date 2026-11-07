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
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'sitemap', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
  ],
};
