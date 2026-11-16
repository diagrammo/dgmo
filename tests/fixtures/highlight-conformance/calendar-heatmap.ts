import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'calendar-heatmap',
  specSection: 'calendar-heatmap',
  source: `calendar-heatmap Runs in 2026
year 2026
unit km
from 2026-03-01 to 2026-05-31
week-start monday
max 20
no-summary

03-02 5.2
2026-03-10 8
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'calendar-heatmap', role: 'chartType' },
    { text: 'year', role: 'keyword' },
    { text: 'unit', role: 'keyword' },
    { text: 'from', role: 'keyword' },
    { text: 'week-start', role: 'keyword' },
    { text: 'max', role: 'keyword' },
    { text: 'no-summary', role: 'keyword' },
  ],
};
