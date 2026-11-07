import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'org',
  specSection: '7',
  source: `org Company
direction-tb
sub-node-label Reports
show-sub-node-count
hide tag:Past
active-tag Department

CEO
  VP Engineering
    Team Lead A
    Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'org', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'sub-node-label', role: 'keyword' },
    { text: 'show-sub-node-count', role: 'keyword' },
    { text: 'hide', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
  ],
};
