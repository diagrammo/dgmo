import type { ConformanceFixture } from './_types';

// Spec §23 (Pyramid Diagrams). Layer pipe metadata and one explicit
// directive (inverted). the fill family works on pyramid via FILL_FAMILY_CAPABLE
// but spec §23.5 doesn't document it — TODO: update §23.5 to match
// §24.5 (ring) which does document it.
export const fixture: ConformanceFixture = {
  chartType: 'pyramid',
  specSection: '23',
  firstLineKeyword: 'pyramid',

  directives: [
    'inverted',
    'fill-tint',
    'fill-solid',
    'fill-outline', // working but undocumented in spec §23.5
  ],

  pipeKeys: {
    layer: ['color', 'description'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
