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
`,
  assertions: [
    { text: 'version-control', role: 'chartType' },
    { text: 'direction', role: 'keyword' },
  ],
};
