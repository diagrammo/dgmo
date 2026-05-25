import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'flowchart',
  specSection: '5',
  source: `flowchart Process
direction-lr
orientation-vertical
solid-fill

(Start) -> <Valid?>
  -yes-> [Process] -> (Done)
`,
  assertions: [
    { text: 'flowchart', role: 'chartType' },
    { text: 'direction-lr', role: 'keyword' },
    { text: 'orientation-vertical', role: 'keyword' },
    { text: 'solid-fill', role: 'keyword' },
  ],
};
