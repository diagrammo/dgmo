import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'function',
  specSection: '16',
  source: `function Trajectories
x-axis Distance 0..250
y-axis Height
fill

f(x): x^2 + 1
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'function', role: 'chartType' },
    { text: 'x-axis', role: 'keyword' },
    { text: 'y-axis', role: 'keyword' },
    { text: 'fill', role: 'keyword' },
  ],
};
