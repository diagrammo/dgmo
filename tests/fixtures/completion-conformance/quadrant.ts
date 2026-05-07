import type { ConformanceFixture } from './_types';

// Spec §17 / §16.5. Axis labels are comma-separated low/high pairs.
// Position labels (top-right, top-left, etc.) declare quadrant names —
// structural, not directives.
export const fixture: ConformanceFixture = {
  chartType: 'quadrant',
  specSection: '17',
  firstLineKeyword: 'quadrant',
  directives: ['x-label', 'y-label'],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
