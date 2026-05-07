import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'venn',
  specSection: '17',
  source: `venn Skill Overlap

Swordsmanship(red) as sw
Navigation(blue) as nav
sw + nav Sea Raiders
`,
  assertions: [
    { text: 'venn', role: 'chartType' },
    { text: '(red)', role: 'colorAnnotation' },
    { text: 'as', role: 'modifier' },
    { text: '+', role: 'separator' },
  ],
};
