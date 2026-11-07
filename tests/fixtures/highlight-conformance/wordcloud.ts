import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'wordcloud',
  specSection: '17',
  source: `wordcloud Pirate Skills
rotate none
max 50
size 14 80

swordsmanship 95
navigation 88
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'wordcloud', role: 'chartType' },
    { text: 'rotate', role: 'keyword' },
    { text: 'max', role: 'keyword' },
    { text: 'size', role: 'keyword' },
  ],
};
