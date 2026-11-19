import type { ConformanceFixture } from './_types';
import {
  FRAME_DIRECTIVES,
  Y_AXIS_DIRECTIVES,
  NUMBER_FORMAT_DIRECTIVES,
} from './_frame';

// Spec §16 / §15.1 (Simple Charts). Cartesian family — `no-value` only.
export const fixture: ConformanceFixture = {
  chartType: 'bar',
  specSection: '16',
  firstLineKeyword: 'bar',
  directives: [
    ...FRAME_DIRECTIVES,
    // #1831 number format.
    ...NUMBER_FORMAT_DIRECTIVES,
    // #1830 axis range and scale.
    ...Y_AXIS_DIRECTIVES,
    'no-legend',
    // Multi-series is declared by a `stack`, `group` or `mirror` layout header (#24, #1878);
    // `series` is rejected on bar.
    'stack',
    'group',
    'mirror',
    'x-axis',
    'y-axis',
    'orientation-horizontal',
    // #1978 category order.
    'sort',
    // #1979 stem-and-dot bars.
    'lollipop',
    'widths',
    // #1954 statistics overlays.
    'mean',
    'median',
    'target',
    'trend',
    'pareto',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    // Color is in completion as a bar override; not formally documented in
    // §15.1 but tolerated for back-compat.
    'color',
    // §1.11 emphasis, adopted on bar, line and pie by #1829 (the root spec's
    // table gains the rows in that row's last slice).
    'highlight',
    // #1832 / #2039 annotations.
    'marker',
    'band',
    'note',
    'no-notes',
  ],
  // #1852 combo: `mark:` on a series line.
  pipeKeys: { node: ['mark'] },
};
