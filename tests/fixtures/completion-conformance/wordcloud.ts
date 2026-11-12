import type { ConformanceFixture } from './_types';
import { FRAME_DIRECTIVES } from './_frame';

// Spec §17 / §16.2. Three options: rotate (enum), max, size.
export const fixture: ConformanceFixture = {
  chartType: 'wordcloud',
  specSection: '17',
  firstLineKeyword: 'wordcloud',
  directives: [...FRAME_DIRECTIVES, 'rotate', 'max', 'size'],
  pipeKeys: {},
  enumChecks: [{ directive: 'rotate', values: ['none', 'mixed', 'angled'] }],
};
