import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'ownership',
  specSection: 'ownership',
  source: `ownership Acme group
tag Jurisdiction as j
  UK blue
  US red
active-tag Jurisdiction
fill-solid

Acme Holdings plc  j: UK
  Review the roles list
  100% Acme Inc  j: US, type: corporation
Partner Fund LP  type: partnership
  40% -> Acme Inc
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'ownership', role: 'chartType' },
    { text: 'active-tag', role: 'keyword' },
    { text: 'fill-solid', role: 'keyword' },
  ],
};
