import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'gantt',
  specSection: '13',
  source: `gantt Project
start 2026-01-01
today-marker
critical-path
no-dependencies
sprint-length 2w
sprint-number 1
sprint-start 2026-01-01
sort time
active-tag X

Task1 2bd
Task2 3bd
`,
  assertions: [
    { text: 'gantt', role: 'chartType' },
    { text: 'start', role: 'keyword' },
    { text: 'today-marker', role: 'keyword' },
    { text: 'critical-path', role: 'keyword' },
    { text: 'no-dependencies', role: 'keyword' },
    { text: 'sprint-length', role: 'keyword' },
    { text: 'sprint-number', role: 'keyword' },
    { text: 'sprint-start', role: 'keyword' },
    { text: 'sort', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
  ],
};
