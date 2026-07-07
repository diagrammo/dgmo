import type { ConformanceFixture } from './_types';

// Spec §16 / §15.7. Funnel family — supports no-name + no-value +
// no-percent (stage-over-stage conversion %, per the §15.1 flag table).
export const fixture: ConformanceFixture = {
  chartType: 'funnel',
  specSection: '16',
  firstLineKeyword: 'funnel',
  directives: [
    'no-name',
    'no-value',
    'no-percent',
    'solid-fill', // working via SOLID_FILL_CAPABLE
  ],
  pipeKeys: {},
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
