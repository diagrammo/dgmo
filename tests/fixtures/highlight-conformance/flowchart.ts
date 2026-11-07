import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'flowchart',
  specSection: '5',
  source: `flowchart Process
direction-lr
orientation-vertical
fill-solid

(Start) -> <Valid?>
  -yes-> [Process] -> (Done)
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'flowchart', role: 'chartType' },
    { text: 'direction-lr', role: 'keyword' },
    { text: 'orientation-vertical', role: 'keyword' },
    { text: 'fill-solid', role: 'keyword' },
  ],
};
