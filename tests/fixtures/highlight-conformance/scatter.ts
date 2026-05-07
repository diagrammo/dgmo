import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'scatter',
  specSection: '16',
  source: `scatter
x-label Weight
y-label Height
size-label Crew
no-name

Pirate 90 8500
`,
  assertions: [
    { text: 'scatter', role: 'chartType' },
    { text: 'x-label', role: 'keyword' },
    { text: 'y-label', role: 'keyword' },
    { text: 'size-label', role: 'keyword' },
    { text: 'no-name', role: 'keyword' },
  ],
};
