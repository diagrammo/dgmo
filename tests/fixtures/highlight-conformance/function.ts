import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'function',
  specSection: '16',
  source: `function Trajectories
x 0 to 250
x-label Distance
y-label Height
fill

f(x): x^2 + 1
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'function', role: 'chartType' },
    { text: 'x', role: 'keyword' }, // §15.4 directive — declares x range
    { text: 'x-label', role: 'keyword' },
    { text: 'y-label', role: 'keyword' },
    { text: 'fill', role: 'keyword' },
  ],
};
