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
`,
  assertions: [{ text: 'countdown', role: 'chartType' }],
};
