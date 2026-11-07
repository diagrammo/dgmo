import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'pert',
  specSection: '13A',
  source: `pert Voyage
time-unit w
default-confidence medium
direction LR
node-detail compact
trials 10000
seed 42

start 0

start
  -> recruit crew

recruit crew 1 2 4 as rc
  -> sail

sail 3 5 8
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'pert', role: 'chartType' },
    { text: 'time-unit', role: 'keyword' },
    { text: 'default-confidence', role: 'keyword' },
    { text: 'direction', role: 'keyword' },
    { text: 'node-detail', role: 'keyword' },
    { text: 'trials', role: 'keyword' },
    { text: 'seed', role: 'keyword' },
    { text: 'as', role: 'modifier' },
  ],
};
