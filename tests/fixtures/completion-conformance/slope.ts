import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES, Y_AXIS_DIRECTIVES } from './_frame';

// Spec §17 / §16.1. `period` is a required structural keyword (block or
// inline form) — not a directive. No chart-specific directives.
export const fixture: ConformanceFixture = {
  chartType: 'slope',
  specSection: '17',
  firstLineKeyword: 'slope',
  // §1.11 emphasis, adopted on slope by #1829.
  directives: [
    ...FRAME_DIRECTIVES,
    // #1830 axis range and scale.
    ...Y_AXIS_DIRECTIVES,
    'highlight',
  ],
  pipeKeys: {},
};
