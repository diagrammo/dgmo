import type { ConformanceFixture } from './_types';

// Spec §22 (Journey Map Diagrams). Directives: active-tag,
// plus solid-fill via SOLID_FILL_CAPABLE.
export const fixture: ConformanceFixture = {
  chartType: 'journey-map',
  specSection: '22',
  firstLineKeyword: 'journey-map',

  directives: [
    'active-tag',
    'solid-fill', // working but not documented in §22 directives table
  ],

  pipeKeys: {
    // Step metadata keys per §1.4.3 reserved-key registry.
    // Tag aliases (e.g. `ch: Web`) are user-defined via `tag` blocks
    // and resolved at runtime, not via static PIPE_METADATA.
    node: ['score', 'emotion', 'description', 'pain', 'opportunity', 'thought'],
  },

  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
