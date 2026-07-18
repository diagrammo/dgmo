import type { ConformanceFixture } from './_types';

// Spec §22 (Journey Map Diagrams). Directives: active-tag,
// plus the fill family via FILL_FAMILY_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'journey-map',
  structuralKeywords: ['persona', 'tag'],
  specSection: '22',
  firstLineKeyword: 'journey-map',

  directives: [
    'no-legend',
    'active-tag',
    'fill-tint',
    'fill-solid',
    'fill-outline', // working but not documented in §22 directives table
  ],

  pipeKeys: {
    // Step metadata keys per §1.4.3 reserved-key registry.
    // Tag aliases (e.g. `ch: Web`) are user-defined via `tag` blocks
    // and resolved at runtime, not via static PIPE_METADATA.
    node: ['score', 'emotion', 'description', 'pain', 'opportunity', 'thought'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
