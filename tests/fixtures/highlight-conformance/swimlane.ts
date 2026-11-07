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
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'swimlane', role: 'chartType' },
    { text: 'direction', role: 'keyword' },
    { text: 'lane', role: 'keyword' },
  ],
};
