import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'scatter',
  specSection: '16',
  source: `scatter
x-axis Weight
y-axis Height
size-label Crew
no-name

Pirate 90 8500
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'scatter', role: 'chartType' },
    { text: 'x-axis', role: 'keyword' },
    { text: 'y-axis', role: 'keyword' },
    { text: 'size-label', role: 'keyword' },
    { text: 'no-name', role: 'keyword' },
  ],
};
