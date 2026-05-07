import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'sankey',
  specSection: '16',
  source: `sankey

Source(green)
  Target1(orange) 3000
  Target2 2500
`,
  assertions: [
    { text: 'sankey', role: 'chartType' },
    { text: '(green)', role: 'colorAnnotation' },
    { text: '(orange)', role: 'colorAnnotation' },
    { text: '3000', role: 'number' },
  ],
};
