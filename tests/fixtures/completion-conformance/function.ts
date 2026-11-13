import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES, Y_AXIS_DIRECTIVES } from './_frame';

// Spec §16 / §15.4. Functional family — colon REQUIRED between name and
// expression (§15.4). `x` declares the x-axis range; `fill` shades the
// area below curves.
export const fixture: ConformanceFixture = {
  chartType: 'function',
  specSection: '16',
  firstLineKeyword: 'function',
  directives: [
    ...FRAME_DIRECTIVES,
    // #1830 axis range and scale.
    ...Y_AXIS_DIRECTIVES,
    'no-legend',
    'x',
    'x-label',
    'y-label',
    'fill',
  ],
  pipeKeys: {},
};
