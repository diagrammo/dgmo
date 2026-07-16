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
`,
  assertions: [
    { text: 'flowchart', role: 'chartType' },
    { text: 'direction-lr', role: 'keyword' },
    { text: 'orientation-vertical', role: 'keyword' },
    { text: 'fill-solid', role: 'keyword' },
  ],
};
