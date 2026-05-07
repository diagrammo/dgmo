import type { HighlightFixture } from './_types';

// Spec §21. Cycle: chart-type, three directives, node + edge pipe metadata.
export const fixture: HighlightFixture = {
  chartType: 'cycle',
  specSection: '21',
  source: `cycle OODA Loop
direction-counterclockwise
no-descriptions
circle-nodes

Observe | color: blue, span: 2
  Gather signals
Orient | color: green
Decide | color: orange
Act | color: red
`,
  assertions: [
    { text: 'cycle', role: 'chartType' },
    { text: 'direction-counterclockwise', role: 'keyword' },
    { text: 'no-descriptions', role: 'keyword' },
    { text: 'circle-nodes', role: 'keyword' },
    { text: 'color', role: 'keyword' },
    { text: 'span', role: 'keyword' },
  ],
};
