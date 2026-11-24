import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES, NUMBER_FORMAT_DIRECTIVES } from './_frame';

// Spec §42 (Waterfall). `direction down` is the only direction value.
// Spec/parser disagreement, left out: §42.3 lists `source` among the frame
// options, but the parser rejects it (utils/chart-frame-parse.ts) and the
// frame section says the footnote carries the source.
export const fixture: ConformanceFixture = {
  chartType: 'waterfall',
  specSection: '42',
  firstLineKeyword: 'waterfall',
  directives: [
    ...FRAME_DIRECTIVES,
    ...NUMBER_FORMAT_DIRECTIVES,
    'direction',
    'no-connectors',
    'no-value',
    'orientation-horizontal',
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'direction', values: ['down'] }],
};
