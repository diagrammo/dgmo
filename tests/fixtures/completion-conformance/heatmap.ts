import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES, NUMBER_FORMAT_DIRECTIVES } from './_frame';

// Spec §16 / §15.3. `columns` declares column labels; `no-value` suppresses
// cell value text. the fill family saturates the heat gradient. `scale
// diverging <mid>` (#1837) splits the ramp at a neutral midpoint.
export const fixture: ConformanceFixture = {
  chartType: 'heatmap',
  specSection: '16',
  firstLineKeyword: 'heatmap',
  directives: [
    ...FRAME_DIRECTIVES,
    // #1831 number format.
    ...NUMBER_FORMAT_DIRECTIVES,
    'columns',
    'no-value',
    'fill-tint',
    'fill-solid',
    'fill-outline',
    'scale',
  ],
  pipeKeys: {},
};
