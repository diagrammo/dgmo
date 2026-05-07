import type { ConformanceFixture } from './_types';

// Spec §17 / §16.2. Three options: rotate (enum), max, size.
export const fixture: ConformanceFixture = {
  chartType: 'wordcloud',
  specSection: '17',
  firstLineKeyword: 'wordcloud',
  directives: ['rotate', 'max', 'size'],
  pipeKeys: {},
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    { directive: 'rotate', values: ['none', 'mixed', 'angled'] },
  ],
};
