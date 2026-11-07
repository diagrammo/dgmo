import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'er',
  specSection: '9',
  source: `er Schema
notation crow
active-tag X

users
  id int pk
  email varchar
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'er', role: 'chartType' },
    { text: 'notation', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
    { text: 'int', role: 'modifier' },
    { text: 'pk', role: 'modifier' },
    { text: 'varchar', role: 'modifier' },
  ],
};
