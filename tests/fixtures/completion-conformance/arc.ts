import type { ConformanceFixture } from './_types';

// Spec §17 / §16.3. One option: order (enum).
export const fixture: ConformanceFixture = {
  chartType: 'arc',
  specSection: '17',
  firstLineKeyword: 'arc',
  directives: ['order', 'fill-tint', 'fill-solid', 'fill-outline'],
  pipeKeys: {},
  enumChecks: [
    { directive: 'palette', source: 'palettes' },
    {
      directive: 'order',
      values: ['appearance', 'name', 'group', 'degree'],
    },
  ],
};
