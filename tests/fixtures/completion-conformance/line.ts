import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §16 / §15.1. Cartesian — `no-value` only. `era` is a structural
// keyword (declares an era band), not a directive.
export const fixture: ConformanceFixture = {
  chartType: 'line',
  specSection: '16',
  firstLineKeyword: 'line',
  directives: [
    ...FRAME_DIRECTIVES,
    'no-legend',
    'series',
    'fill',
    'x-label',
    'y-label',
    'y-right-label',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    // §1.11 emphasis, adopted on bar, line and pie by #1829 (the root spec's
    // table gains the rows in that row's last slice).
    'highlight',
  ],
  pipeKeys: {},
};
