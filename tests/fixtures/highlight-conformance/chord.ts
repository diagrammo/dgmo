import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'chord',
  specSection: '16',
  source: `chord

A -- B 150
B -> C 20
`,
  assertions: [
    { text: 'chord', role: 'chartType' },
    { text: '->', role: 'operator' },
    { text: '150', role: 'number' },
  ],
};
