import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'swimlane',
  specSection: '27',
  source: `swimlane Weekly Publishing
direction LR

lane Writer gray
lane Editor blue

Writer
  Draft Post
Editor
  <Review>

Draft Post -> <Review>
`,
  assertions: [
    { text: 'swimlane', role: 'chartType' },
    { text: 'direction', role: 'keyword' },
    { text: 'lane', role: 'keyword' },
  ],
};
