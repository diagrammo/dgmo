import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES, NUMBER_FORMAT_DIRECTIVES } from './_frame';

// Spec §43 (Dot). Spec/parser disagreement, left out: §43.3 lists `source`
// among the frame options, but the parser rejects it
// (utils/chart-frame-parse.ts).
export const fixture: ConformanceFixture = {
  chartType: 'dot',
  specSection: '43',
  firstLineKeyword: 'dot',
  directives: [
    ...FRAME_DIRECTIVES,
    ...NUMBER_FORMAT_DIRECTIVES,
    'series',
    'sort',
    'gap',
    'connector',
    'x-axis',
  ],
  pipeKeys: {},
  enumChecks: [
    { directive: 'sort', values: ['gap', 'name'] },
    { directive: 'connector', values: ['direction', 'direction down'] },
  ],
};
