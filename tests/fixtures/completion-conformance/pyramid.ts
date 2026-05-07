import type { ConformanceFixture } from './_types';

// Spec §23 (Pyramid Diagrams). Layer pipe metadata and one explicit
// directive (inverted). `solid-fill` works on pyramid via SOLID_FILL_CAPABLE
// but spec §23.5 doesn't document it — TODO: update §23.5 to match
// §24.5 (ring) which does document it.
export const fixture: ConformanceFixture = {
  chartType: 'pyramid',
  specSection: '23',
  firstLineKeyword: 'pyramid',

  directives: [
    'inverted',
    'solid-fill', // working but undocumented in spec §23.5
  ],

  pipeKeys: {
    layer: ['color', 'description'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
