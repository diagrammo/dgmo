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
`,
  assertions: [
    { text: 'wordcloud', role: 'chartType' },
    { text: 'rotate', role: 'keyword' },
    { text: 'max', role: 'keyword' },
    { text: 'size', role: 'keyword' },
  ],
};
