import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'version-control',
  specSection: '29',
  source: `version-control Feature Branch Workflow
direction LR

main
  Initial commit
  Add README

develop from main
  Set up CI

main
  merge develop tag: v1.0.0
  Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'version-control', role: 'chartType' },
    { text: 'direction', role: 'keyword' },
  ],
};
