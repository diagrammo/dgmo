import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'pert',
  specSection: '13A',
  source: `pert Voyage
time-unit w
confidence medium
direction LR
node-detail compact
analysis monte-carlo
trials 10000
seed 42

milestone start

start
  -> recruit crew 1 2 4 as rc

recruit crew
  -> sail 3 5 8
`,
  assertions: [
    { text: 'pert', role: 'chartType' },
    { text: 'time-unit', role: 'keyword' },
    { text: 'confidence', role: 'keyword' },
    { text: 'direction', role: 'keyword' },
    { text: 'node-detail', role: 'keyword' },
    { text: 'analysis', role: 'keyword' },
    { text: 'trials', role: 'keyword' },
    { text: 'seed', role: 'keyword' },
    { text: 'milestone', role: 'keyword' },
    { text: 'as', role: 'modifier' },
  ],
};
