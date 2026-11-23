import type { ConformanceFixture } from './_types';
import {
  FRAME_DIRECTIVES,
  Y_AXIS_DIRECTIVES,
  NUMBER_FORMAT_DIRECTIVES,
} from './_frame';

// Spec §16 / §15.1. Cartesian — `no-value` only. `era` is a structural
// keyword (declares an era band), not a directive.
export const fixture: ConformanceFixture = {
  chartType: 'line',
  specSection: '16',
  firstLineKeyword: 'line',
  directives: [
    ...FRAME_DIRECTIVES,
    // #1831 number format.
    ...NUMBER_FORMAT_DIRECTIVES,
    // #1830 axis range and scale.
    ...Y_AXIS_DIRECTIVES,
    'no-legend',
    'series',
    // #1846 stacked areas: a `stack` block in place of `series`.
    'stack',
    'fill',
    // #1997 fill between two series.
    'fill-between',
    // #1880 step line.
    'step',
    'step-before',
    // #2208 keep a time-axis line whole across gaps.
    'join-gaps',
    'x-axis',
    'y-axis',
    'y-right-axis',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    // §1.11 emphasis, adopted on bar, line and pie by #1829 (the root spec's
    // table gains the rows in that row's last slice).
    'highlight',
    // #1832 / #2039 annotations.
    'marker',
    'band',
    'note',
    'no-notes',
    // #1954 statistics overlays.
    'mean',
    'median',
    'target',
    'trend',
    'moving-average',
    'no-extremes',
    'values',
  ],
  // #1852 combo: `mark:` on a series line.
  pipeKeys: { node: ['mark'] },
};
