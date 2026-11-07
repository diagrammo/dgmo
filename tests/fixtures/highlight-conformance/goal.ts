import type { HighlightFixture } from './_types';

// Goal chart: chart-type declaration, a bare-flag mode directive, and the
// space-separated now/target value directives.
export const fixture: HighlightFixture = {
  chartType: 'goal',
  specSection: '24E',
  source: `goal Marathon Fund ($)

thermometer

now 6400
target 10000
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'goal', role: 'chartType' },
  ],
};
