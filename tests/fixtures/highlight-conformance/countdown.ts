import type { HighlightFixture } from './_types';

// Countdown chart: chart-type declaration plus the space-separated `target` /
// `units` / `expired` value directives (no colon).
export const fixture: HighlightFixture = {
  chartType: 'countdown',
  specSection: '24E',
  source: `countdown Trip to Japan

target 2026-08-21
units days
expired Now!
Review the roles list
`,
  assertions: [
    // A keyword in another chart type stays text here (#1734).
    { text: 'roles', role: 'default' },
    { text: 'countdown', role: 'chartType' },
  ],
};
