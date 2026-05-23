import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'venn',
  specSection: '17',
  source: `venn Skill Overlap

Swordsmanship as sw red
Navigation as nav blue
sw + nav Sea Raiders
`,
  assertions: [
    { text: 'venn', role: 'chartType' },
    { text: 'as', role: 'modifier' },
    { text: '+', role: 'separator' },
  ],
};
